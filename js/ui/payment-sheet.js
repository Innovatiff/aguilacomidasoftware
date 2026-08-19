/**
 * Recording a payment.
 *
 * Used from the client detail screen and from the billing worklist, so it
 * lives here rather than in either one. On success it posts a note into the
 * farm's thread: the farm manager sees the payment land without having to ask,
 * which is the single most common message the kitchen gets.
 */

import { h, mount } from '../lib/dom.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import { field, moneyInput, input, select, textarea, defList, defRow } from './kit.js';
import { recordPayment } from '../data/invoices.js';
import { postSystemMessage } from '../data/chat.js';
import { balanceOf } from '../lib/billing.js';
import { money, moneyFull } from '../lib/format.js';
import { formatRange, today } from '../lib/dates.js';
import { PAYMENT_METHODS } from '../lib/model.js';
import { dbMessage } from '../firebase.js';

/**
 * @param {object} invoice   the invoice being settled
 * @param {object} author    { uid, name }
 * @returns {Promise<boolean>} true when a payment was recorded
 */
export function openPaymentSheet(invoice, author) {
  const outstanding = balanceOf(invoice);

  return sheet({
    title: 'Registrar pago',
    build: (close) => {
      let amount = outstanding;
      let method = 'cash';
      let reference = '';
      let note = '';
      let date = today();
      let busy = false;

      const remainder = h('div.t-sm.c-soft');
      const updateRemainder = () => {
        const left = Math.max(0, outstanding - (Number(amount) || 0));
        mount(remainder, left > 0.005
          ? `Quedarían ${money(left)} pendientes.`
          : 'Con esto la factura queda saldada.');
      };

      const submit = h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' },
        `Registrar ${money(outstanding)}`);

      const form = h('form.stack.stack-4', {
        onsubmit: async (event) => {
          event.preventDefault();
          if (busy) return;
          const value = Number(amount);
          if (!(value > 0)) { toastBad('El monto debe ser mayor a cero.'); return; }
          if (value > outstanding + 0.005) { toastBad('El monto supera el saldo de la factura.'); return; }

          busy = true;
          submit.disabled = true;
          mount(submit, h('span.spinner.spinner--light'), 'Registrando…');

          try {
            const result = await recordPayment(invoice.id, { amount: value, method, reference, note, date }, author);
            await announce(invoice, result, method);
            toastOk(result.settled ? 'Factura saldada' : `Pago de ${money(value)} registrado`);
            close(true);
          } catch (error) {
            busy = false;
            submit.disabled = false;
            mount(submit, `Registrar ${money(outstanding)}`);
            toastBad(error?.message || dbMessage(error));
          }
        },
      },

      h('div.card.card--tight',
        defList([
          defRow('Rancho', invoice.clientName),
          defRow('Periodo', formatRange(invoice.periodStart, invoice.periodEnd)),
          defRow('Total del periodo', moneyFull(invoice.amount)),
          defRow('Saldo pendiente', money(outstanding), { total: true }),
        ])),

      field({
        label: 'Monto recibido',
        control: moneyInput({
          value: outstanding,
          autofocus: true,
          oninput: (e) => {
            amount = e.target.value;
            updateRemainder();
            mount(submit, `Registrar ${money(Number(amount) || 0)}`);
          },
        }),
      }),
      remainder,

      field({
        label: 'Forma de pago',
        control: select({
          value: method,
          options: Object.entries(PAYMENT_METHODS).map(([value, meta]) => ({ value, label: meta.label })),
          onchange: (e) => { method = e.target.value; },
        }),
      }),

      field({
        label: 'Fecha del pago',
        control: input({ type: 'date', value: date, onchange: (e) => { date = e.target.value || today(); } }),
      }),

      field({
        label: 'Referencia',
        hint: 'Número de transferencia, folio del cheque, quién entregó el efectivo…',
        control: input({ placeholder: 'Opcional', oninput: (e) => { reference = e.target.value; } }),
      }),

      field({
        label: 'Nota interna',
        control: textarea({
          rows: 2, placeholder: 'Opcional — sólo la ve el equipo de la cocina.',
          oninput: (e) => { note = e.target.value; },
        }),
      }),

      submit);

      updateRemainder();
      return form;
    },
  }).then((value) => value === true);
}

/** Tells the farm, in their own thread, that the payment was received. */
async function announce(invoice, result, method) {
  const label = PAYMENT_METHODS[method]?.label || 'pago';
  const text = result.settled
    ? `Recibimos su pago de ${money(result.entry.amount)} (${label}). El periodo ${formatRange(invoice.periodStart, invoice.periodEnd)} queda saldado. ¡Gracias!`
    : `Recibimos su pago de ${money(result.entry.amount)} (${label}). Saldo pendiente del periodo ${formatRange(invoice.periodStart, invoice.periodEnd)}: ${money(result.amount - result.paid)}.`;

  try {
    await postSystemMessage(invoice.clientId, text, {
      meta: { kind: 'payment', invoiceId: invoice.id, amount: result.entry.amount },
      notify: true,
    });
  } catch {
    // The payment is what matters; a failed courtesy note must not undo it.
  }
}
