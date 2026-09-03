/**
 * Putting a debt on somebody's account by hand.
 *
 * The kitchen sells more than the plan. Somebody takes a case of drinks, a
 * plate for a visitor turns up, a cooler comes back broken, the notebook says a
 * fortnight came up short. None of it is produced by the billing cycle, and
 * until now the only way to collect any of it was to quietly inflate the next
 * bill — which leaves nothing on paper saying why the number moved, and that is
 * exactly the argument that gets had at the counter two weeks later.
 *
 * So the reason is not optional. A debt with no reason on it is the thing this
 * screen exists to stop: two weeks from now the person who typed it will not
 * remember either, and the client will be the one arguing.
 */

import { h, mount } from '../lib/dom.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import { field, moneyInput, input, defList, defRow, button, alert, switchRow } from './kit.js';
import { icon } from '../lib/icons.js';
import { addCharge } from '../data/invoices.js';
import { postSystemMessage } from '../data/chat.js';
import { balanceOf, periodWord } from '../lib/billing.js';
import { money, moneyFull } from '../lib/format.js';
import { formatDayLong, today } from '../lib/dates.js';
import { errorText } from '../firebase.js';

/**
 * Reasons that save typing, not reasons that stand in for it.
 *
 * They fill the box and stay editable — the point is the fast start, and the
 * manager finishing the sentence with what actually happened.
 */
const COMMON = ['Comida extra', 'Ajuste de saldo'];

/**
 * @param {object} options
 * @param {object} options.client     whose account the debt goes on
 * @param {object[]} options.invoices their unpaid bills, to show the balance
 * @param {object} options.author     { uid, name }
 * @returns {Promise<object|null>} the charge that was written, or null
 */
export function openDebtSheet({ client, invoices = [], author }) {
  const balance = round2(invoices.reduce((sum, invoice) => sum + balanceOf(invoice), 0));
  const word = periodWord(client);

  return sheet({
    title: 'Agregar deuda',
    build: (close) => {
      let amount = '';
      let reason = '';
      let date = today();
      let tell = true;
      let busy = false;

      const submit = h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' });
      const after = h('div.t-sm.c-soft');

      const amountBox = moneyInput({
        value: '',
        autofocus: true,
        placeholder: '0.00',
        oninput: (event) => { amount = event.target.value; repaint(); },
      });

      const reasonBox = input({
        placeholder: 'Ej. una caja de refrescos',
        maxlength: 80,
        oninput: (event) => { reason = event.target.value; repaint(); },
      });

      const setReason = (text) => {
        reason = text;
        reasonBox.value = text;
        reasonBox.focus();
        repaint();
      };

      function repaint() {
        const value = Number(amount) || 0;
        mount(submit, icon('plus'), value > 0 ? `Agregar deuda de ${money(value)}` : 'Agregar deuda');
        submit.disabled = busy || !(value > 0) || !reason.trim();

        mount(after, value > 0
          ? `Su saldo pasa de ${money(balance)} a ${moneyFull(round2(balance + value))}.`
          : 'Escribe cuánto debe.');
      }

      const form = h('form.stack.stack-4', {
        onsubmit: async (event) => {
          event.preventDefault();
          if (busy) return;

          const value = Number(amount);
          if (!(value > 0)) { toastBad('El monto debe ser mayor a cero.'); return; }
          if (!reason.trim()) { toastBad('Escribe de qué es la deuda.'); return; }

          busy = true;
          submit.disabled = true;
          mount(submit, h('span.spinner.spinner--light'), 'Agregando…');

          try {
            const charge = await addCharge(
              { client, amount: value, reason: reason.trim(), date }, author);
            if (tell) await announce(charge, client, round2(balance + value));
            toastOk(`Deuda agregada · ${money(value)}`);
            close(charge);
          } catch (error) {
            busy = false;
            repaint();
            toastBad(errorText(error));
          }
        },
      },

      h('div.card.card--tight',
        defList([
          defRow('Cliente', client.name),
          defRow('Dónde', [client.farmName, client.locationName].filter(Boolean).join(' · ') || '—'),
          defRow('Debe hoy', balance > 0.005 ? money(balance) : 'Nada', { total: true }),
        ])),

      field({
        label: 'Monto de la deuda',
        control: amountBox,
      }),

      field({
        label: '¿De qué es?',
        hint: 'Lo verá el cliente en su app, junto al monto.',
        control: h('div.stack.stack-2',
          reasonBox,
          h('div.row.row--wrap', { style: { gap: '6px' } },
            COMMON.map((text) => button(text, {
              variant: 'soft', size: 'sm', onClick: () => setReason(text),
            })))),
      }),

      field({
        label: 'Fecha',
        hint: 'El día en que se generó la deuda, no el día en que la escribes.',
        control: input({
          type: 'date', value: date, max: today(),
          onchange: (event) => { date = event.target.value || today(); },
        }),
      }),

      after,

      switchRow('Avisarle por mensaje', {
        checked: tell,
        hint: 'Le llega a su app con el monto y el motivo.',
        onChange: (value) => { tell = value; },
      }),

      alert(`Se suma a lo que debe y se cobra como cualquier otro cobro de la ${word}. `
        + 'Mientras no tenga pagos aplicados, se puede quitar desde la misma deuda.', 'info'),

      submit);

      repaint();
      return form;
    },
  }).then((charge) => charge || null);
}

/** Tells the client, in their own thread, what was added and why. */
async function announce(charge, client, balanceAfter) {
  const text = `Se agregó un cargo de ${moneyFull(charge.amount)} a su cuenta: ${charge.reason} `
    + `(${formatDayLong(charge.periodStart)}). Su saldo queda en ${moneyFull(balanceAfter)}. `
    + 'Si hay algún error, escríbanos por aquí.';

  try {
    await postSystemMessage(client.id, text, {
      meta: { kind: 'charge', invoiceId: charge.id, amount: charge.amount },
      notify: true,
    });
  } catch {
    // The debt is what matters; a failed courtesy note must not undo it.
  }
}

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
