/**
 * Taking a payment.
 *
 * One flow, opened from anywhere money comes in: the counter, a client's file,
 * a bill, or the moment somebody is registered. It always starts from the
 * *person*, never from a particular invoice, because that is how it happens —
 * someone walks up and hands over cash, and what it settles is worked out
 * afterwards.
 *
 * The amount is pre-filled with the obvious thing and the two other likely
 * amounts are one tap away, so the common case is: find them, confirm, done.
 */

import { h, mount } from '../lib/dom.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import {
  field, moneyInput, input, select, textarea, defList, defRow, button, alert, switchRow,
} from './kit.js';
import { icon } from '../lib/icons.js';
import { takePayment } from '../data/invoices.js';
import { cycleIsSet } from '../data/clients.js';
import { postSystemMessage } from '../data/chat.js';
import {
  balanceOf, periodOf, periodOfIndex, isCharge, invoiceTitle, appliedTitle,
  cycleFromPayment, payDayAfter, payDaysInWords, periodWord, periodWordPlural,
} from '../lib/billing.js';
import { chargeFor } from '../lib/pricing.js';
import { money, moneyFull, plural } from '../lib/format.js';
import { formatRange, formatDay, weekdayName, today } from '../lib/dates.js';
import { PAYMENT_METHODS } from '../lib/model.js';
import { errorText } from '../firebase.js';

/**
 * @param {object} options
 * @param {object} options.client    who is paying
 * @param {object[]} options.invoices  their invoices, to work out what is owed
 * @param {object} options.pricing   the price list
 * @param {object} options.author    { uid, name }
 * @returns {Promise<object|null>} the receipt, or null if nothing was taken
 */
export function openChargeSheet({ client, invoices = [], pricing, author }) {
  const owed = invoices
    .filter((invoice) => balanceOf(invoice) > 0.005)
    .sort((a, b) => String(a.periodStart).localeCompare(String(b.periodStart)));
  const balance = round2(owed.reduce((sum, invoice) => sum + balanceOf(invoice), 0));
  const fortnight = chargeFor(client, pricing);
  const anchor = client.cycleAnchor || today();
  // Everything below reasons about periods, and how long a period is belongs
  // to the person: some pay every week, some every fortnight.
  const payer = { ...client, cycleAnchor: anchor };
  const current = periodOf(payer);
  const word = periodWord(client);
  const words = periodWordPlural(client);

  // What they owe, or — if they are up to date — the period they are about
  // to start. Paying ahead is normal here: people pay when they are at the
  // store, not when the bill falls due.
  const suggested = balance > 0.005 ? balance : fortnight;

  /*
   * The first payment the system sees from somebody sets where their fortnight
   * falls; the ones after it never move it again.
   *
   * Both halves are the kitchen's rule. A client registered from the notebook
   * carries their rancho's date as a placeholder — nobody has said which day is
   * theirs — and the payment they make at the counter is what says it. But once
   * it is said, paying five days late must not push their day forward, or a
   * late payer drifts for free. `cycleSetOn` is the line between the two.
   */
  const cycleKnown = cycleIsSet(client);

  return sheet({
    title: 'Cobrar',
    build: (close) => {
      let amount = suggested;
      let method = 'cash';
      let reference = '';
      let note = '';
      let date = today();
      let setCycle = !cycleKnown;
      let busy = false;

      const submit = h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' });
      const covers = h('div.t-sm.c-soft');
      const cycleLine = h('div.t-sm.c-soft');

      const amountBox = moneyInput({
        value: suggested,
        autofocus: true,
        oninput: (event) => { amount = event.target.value; repaint(); },
      });

      const setAmount = (value) => {
        amount = value;
        amountBox.querySelector('input').value = value;
        repaint();
      };

      function repaint() {
        const value = Number(amount) || 0;
        mount(submit, icon('cash'), `Cobrar ${money(value)}`);
        mount(covers, explain(value, { owed, balance, fortnight, payer, current }));

        const next = cycleFromPayment(date);
        const period = periodOf({ ...payer, cycleAnchor: next });
        mount(cycleLine, setCycle
          ? `Su ${word} queda en ${weekdayName(next)}: empieza el ${formatDay(next)} `
            + `y paga otra vez el ${weekdayName(payDayAfter(period))} `
            + `${formatDay(payDayAfter(period))}.`
          : `Su ${word} no se mueve: sigue pagando el ${weekdayName(payDayAfter(current))} `
            + `${formatDay(payDayAfter(current))}.`);
      }

      const form = h('form.stack.stack-4', {
        onsubmit: async (event) => {
          event.preventDefault();
          if (busy) return;

          const value = Number(amount);
          if (!(value > 0)) { toastBad('El monto debe ser mayor a cero.'); return; }
          if (!fortnight && !balance) {
            toastBad('Falta el precio de su plan. Ponlo en Ajustes → Precios.');
            return;
          }

          busy = true;
          submit.disabled = true;
          mount(submit, h('span.spinner.spinner--light'), 'Cobrando…');

          try {
            const receipt = await takePayment(
              { client, pricing, amount: value, method, reference, note, date, setCycle },
              author);
            await announce(receipt, client);
            toastOk(`Cobrado ${money(value)} · ${receipt.folio}`);
            close(receipt);
          } catch (error) {
            busy = false;
            submit.disabled = false;
            repaint();
            toastBad(errorText(error));
          }
        },
      },

      h('div.card.card--tight',
        defList([
          defRow('Cliente', client.name),
          defRow('Dónde', [client.farmName, client.locationName].filter(Boolean).join(' · ') || '—'),
          defRow('Plan', client.mealsPerDay
            ? `${plural(client.mealsPerDay, 'comida', 'comidas')}/día · `
              + `${fortnight ? money(fortnight) : 'sin precio'} por ${word}`
            : '—'),
          defRow('Debe hoy', balance > 0.005 ? money(balance) : 'Nada', { total: true }),
        ])),

      fortnight ? null : alert('Este plan no tiene precio. Agrégalo en Ajustes → Precios '
        + `para poder cobrar ${words} por adelantado.`, 'warn'),

      field({
        label: 'Monto recibido',
        control: h('div.stack.stack-2',
          amountBox,
          h('div.row.row--wrap', { style: { gap: '6px' } },
            balance > 0.005
              ? quick(`Saldo ${money(balance)}`, () => setAmount(balance))
              : null,
            fortnight ? quick(`Una ${word} ${money(fortnight)}`, () => setAmount(fortnight)) : null,
            fortnight && balance > 0.005
              ? quick(`Saldo + ${word} ${money(round2(balance + fortnight))}`,
                  () => setAmount(round2(balance + fortnight)))
              : null)),
      }),
      covers,

      field({
        label: 'Forma de pago',
        control: select({
          value: method,
          options: Object.entries(PAYMENT_METHODS).map(([value, meta]) => ({ value, label: meta.label })),
          onchange: (event) => { method = event.target.value; },
        }),
      }),

      field({
        label: 'Fecha del pago',
        control: input({
          type: 'date', value: date,
          onchange: (event) => { date = event.target.value || today(); repaint(); },
        }),
      }),

      switchRow(cycleKnown ? `Reajustar su ${word} con este pago` : `Fijar su ${word} con este pago`, {
        checked: !cycleKnown,
        hint: cycleKnown
          ? `Su ${word} ya está fijada. Actívalo sólo si de verdad vuelve a empezar — `
            + 'pagar tarde no le mueve el día.'
          : `Primera vez que el sistema le registra un pago. Se cobra en ${payDaysInWords()}: `
            + `si pagó otro día, la ${word} arranca el siguiente día de cobro.`,
        onChange: (value) => { setCycle = value; repaint(); },
      }),
      cycleLine,

      field({
        label: 'Referencia',
        hint: 'Número de transferencia, folio del cheque, quién entregó el efectivo…',
        control: input({ placeholder: 'Opcional', oninput: (event) => { reference = event.target.value; } }),
      }),

      field({
        label: 'Nota interna',
        control: textarea({
          rows: 2, placeholder: 'Opcional — sólo la ve el equipo de la cocina.',
          oninput: (event) => { note = event.target.value; },
        }),
      }),

      submit);

      repaint();
      return form;
    },
  }).then((receipt) => receipt || null);
}

const quick = (label, onClick) => button(label, { variant: 'soft', size: 'sm', onClick });

/**
 * Says in words what the money will settle, before it is taken.
 *
 * The cashier is holding cash and the person is standing there: the moment to
 * catch "that pays two fortnights, not one" is now, not on the receipt.
 */
function explain(value, { owed, balance, fortnight, payer, current }) {
  if (!(value > 0)) return 'Escribe el monto recibido.';

  const parts = [];
  let left = value;

  // The same order the payment itself uses: oldest debt first, then forward.
  for (const invoice of owed) {
    if (left <= 0.005) break;
    const take = Math.min(left, balanceOf(invoice));
    left = round2(left - take);
    parts.push(`${invoiceTitle(invoice)} (${money(take)})`);
  }

  // Only real fortnights block paying ahead. A hand-written debt that happens
  // to be dated on a period start is not that fortnight's bill.
  const paidAhead = new Set(owed.filter((invoice) => !isCharge(invoice))
    .map((invoice) => invoice.periodStart));
  if (fortnight > 0) {
    for (let ahead = 0; left > 0.005 && ahead < 6; ahead += 1) {
      const period = periodOfIndex(payer, current.index + ahead);
      if (paidAhead.has(period.start)) continue;
      const take = Math.min(left, fortnight);
      left = round2(left - take);
      parts.push(`${formatRange(period.start, period.end)} (${money(take)})`);
    }
  }

  if (left > 0.005) {
    return `Sobran ${money(left)} que no se pueden aplicar. Baja el monto.`;
  }

  const owedLeft = round2(balance - Math.min(balance, value));
  return `Cubre ${parts.join(', ')}.`
    + (owedLeft > 0.005 ? ` Quedarían ${money(owedLeft)} pendientes.` : '');
}

/** Tells the client, in their own thread, that the payment landed. */
async function announce(receipt, client) {
  const label = PAYMENT_METHODS[receipt.method]?.label || 'pago';
  const covered = receipt.applied.map(appliedTitle).join(', ');

  const text = receipt.balanceAfter > 0.005
    ? `Recibimos su pago de ${moneyFull(receipt.amount)} (${label}). Cubre ${covered}. `
      + `Saldo pendiente: ${money(receipt.balanceAfter)}. Su recibo ${receipt.folio} está en su app.`
    : `Recibimos su pago de ${moneyFull(receipt.amount)} (${label}). Cubre ${covered} y queda al `
      + `corriente. Su recibo ${receipt.folio} está en su app. ¡Gracias!`;

  try {
    await postSystemMessage(client.id, text, {
      meta: { kind: 'payment', receiptId: receipt.id, amount: receipt.amount },
      notify: true,
    });
  } catch {
    // The payment is what matters; a failed courtesy note must not undo it.
  }
}

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
