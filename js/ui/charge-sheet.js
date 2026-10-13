/**
 * Taking a payment.
 *
 * One flow, opened from anywhere money comes in: the counter, a client's file,
 * a bill. It always starts from the *person*, never from a particular invoice,
 * because that is how it happens — someone walks up and hands over cash, and
 * what it settles is worked out from there.
 *
 * **It only ever takes money for food already served.** The fortnight somebody
 * is eating now is paid the day it ends, so the amount is pre-filled with what
 * they owe — bills still open and fortnights served and not yet billed — and a
 * bigger number is not accepted. Somebody who owes nothing is told so, with the
 * day their running fortnight is paid, instead of being offered a fortnight
 * ahead.
 */

import { h, mount } from '../lib/dom.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import {
  field, moneyInput, input, select, textarea, defList, defRow, button, alert, switchRow,
} from './kit.js';
import { icon } from '../lib/icons.js';
import { takePayment, billsOf, payableRows, nothingOwedYet } from '../data/invoices.js';
import { cycleIsSet, servingSince } from '../data/clients.js';
import { planAdvanceFix } from '../lib/advance.js';
import { openAdvanceSheet } from './advance-sheet.js';
import { postSystemMessage } from '../data/chat.js';
import {
  periodOf, appliedTitle, cycleFromPayment, payDayAfter, payDaysInWords, periodWord,
} from '../lib/billing.js';
import { chargeFor } from '../lib/pricing.js';
import { money, moneyFull, plural } from '../lib/format.js';
import { formatDay, weekdayName, today, addDays } from '../lib/dates.js';
import { PAYMENT_METHODS } from '../lib/model.js';
import { errorText } from '../firebase.js';

/**
 * @param {object} options
 * @param {object} options.client    who is paying
 * @param {object} options.pricing   the price list
 * @param {object} options.author    { uid, name }
 * @returns {Promise<object|null>} the receipt, or null if nothing was taken
 */
export async function openChargeSheet({ client, pricing, author }) {
  /*
   * What they owe is read from their own bills, once, before the sheet opens:
   * a fortnight paid in full is not in memory anywhere, and without it a
   * served fortnight could not be told from one never billed. Everything the
   * sheet shows after that — the amount, what it pays, what is left — is
   * worked out from these bills, the same way the payment itself will.
   */
  let bills;
  try {
    bills = await billsOf(client.id);
  } catch (error) {
    toastBad(errorText(error));
    return null;
  }

  /*
   * Money the old way of taking payments put on a fortnight before it was
   * served makes the fortnight they have come to pay look paid already — so
   * it is put right first, with the cashier seeing what moves. Or knowingly
   * not, and the sheet says so.
   */
  let uncorrected = false;
  const ahead = planAdvanceFix({ client, bills, since: servingSince(client), day: today() });
  if (ahead.moves.length) {
    const done = await openAdvanceSheet({ client, author, plan: ahead, beforeCharge: true });
    if (done === undefined) return null;
    if (done) {
      client = { ...client, paidThrough: done.paidThrough, advanceFixedOn: today() };
      try {
        bills = await billsOf(client.id);
      } catch (error) {
        toastBad(errorText(error));
        return null;
      }
    } else {
      uncorrected = true;
    }
  }

  const fortnight = chargeFor(client, pricing);
  const word = periodWord(client);

  /*
   * The first payment the system sees from somebody sets where their fortnight
   * falls; the ones after it never move it again.
   *
   * A client registered from the notebook carries their rancho's date as a
   * placeholder — nobody has said which day is theirs — and the payment they
   * make at the counter is what says it: they pay on the day their fortnight
   * turns over. Once it is said, paying five days late must not move their
   * day, or a late payer drifts. `cycleSetOn` is the line between the two.
   */
  const cycleKnown = cycleIsSet(client);

  return sheet({
    title: 'Cobrar',
    build: (close) => {
      let method = 'cash';
      let reference = '';
      let note = '';
      let date = today();
      let setCycle = !cycleKnown;
      let busy = false;

      /** What can be paid on the chosen date, with the cycle as it would be. */
      const owing = () => {
        const anchor = setCycle ? cycleFromPayment(date) : (client.cycleAnchor || cycleFromPayment(date));
        const payer = { ...client, cycleAnchor: anchor };
        return { payer, anchor, ...payableRows(payer, bills, pricing, { day: date, setCycle }) };
      };

      let now = owing();
      let amount = now.total;

      const submit = h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' });
      const covers = h('div.t-sm.c-soft');
      const owedRow = h('div');
      const quickRow = h('div.row.row--wrap', { style: { gap: '6px' } });
      const cycleLine = h('div.t-sm.c-soft');
      const nothing = h('div');

      const amountBox = moneyInput({
        value: amount || '',
        autofocus: true,
        oninput: (event) => { amount = event.target.value; repaint(); },
      });

      const setAmount = (value) => {
        amount = value;
        amountBox.querySelector('input').value = value;
        repaint();
      };

      /** Everything that depends on the date or the cycle switch. */
      function recompute({ resetAmount = false } = {}) {
        const before = now.total;
        now = owing();
        // Only touch the amount if it was the old total — a number somebody
        // typed is theirs.
        if (resetAmount || Number(amount) === before) setAmount(now.total);
        else repaint();
      }

      function repaint() {
        const value = Number(amount) || 0;
        const tooMuch = value > now.total + 0.005;

        mount(owedRow, defList([
          defRow('Debe hoy', now.total > 0.005 ? money(now.total) : 'Nada', { total: true }),
        ]));
        mount(nothing, now.total > 0.005 ? null : alert(nothingOwedYet(now.payer, date), 'info'));
        mount(quickRow,
          now.total > 0.005 ? quick(`Todo lo que debe ${money(now.total)}`, () => setAmount(now.total)) : null,
          now.rows.length > 1
            ? quick(`Solo ${now.rows[0].title} ${money(now.rows[0].owed)}`, () => setAmount(now.rows[0].owed))
            : null);

        mount(submit, icon('cash'), `Cobrar ${money(value)}`);
        submit.disabled = busy || !(value > 0) || tooMuch || !now.rows.length;
        mount(covers, explain(value, now));

        const running = periodOf(now.payer, date);
        const payDay = payDayAfter(running);
        mount(cycleLine, setCycle
          ? `Su ${word} queda en ${weekdayName(now.anchor)}: este pago es por la que terminó el `
            + `${formatDay(addDays(now.anchor, -1))}, y la que está en curso se paga el `
            + `${weekdayName(payDay)} ${formatDay(payDay)}.`
          : `Su ${word} no se mueve: la que está en curso se paga el ${weekdayName(payDay)} `
            + `${formatDay(payDay)}.`);
      }

      const form = h('form.stack.stack-4', {
        onsubmit: async (event) => {
          event.preventDefault();
          if (busy) return;

          const value = Number(amount);
          if (!(value > 0)) { toastBad('El monto debe ser mayor a cero.'); return; }
          if (!now.rows.length) { toastBad(nothingOwedYet(now.payer, date)); return; }

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
        ]),
        owedRow),

      uncorrected
        ? alert('Tiene un pago por adelantado sin corregir: lo que debe puede salir menos de lo real.', 'warn')
        : null,

      nothing,

      fortnight ? null : alert('Este plan no tiene precio. Agrégalo en Ajustes → Precios '
        + `para poder cobrarle sus ${word === 'semana' ? 'semanas' : 'quincenas'}.`, 'warn'),

      field({
        label: 'Monto recibido',
        control: h('div.stack.stack-2', amountBox, quickRow),
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
          type: 'date', value: date, max: today(),
          onchange: (event) => { date = event.target.value || today(); recompute(); },
        }),
      }),

      switchRow(cycleKnown ? `Reajustar su ${word} con este pago` : `Fijar su ${word} con este pago`, {
        checked: !cycleKnown,
        hint: cycleKnown
          ? `Su ${word} ya está fijada. Actívalo sólo si de verdad vuelve a empezar — `
            + 'pagar tarde no le mueve el día.'
          : `Primera vez que el sistema le registra un pago. Se cobra en ${payDaysInWords()}, el `
            + `día que termina su ${word}: si pagó otro día, cuenta desde el día de cobro anterior.`,
        onChange: (value) => { setCycle = value; recompute(); },
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
 * catch "that pays two fortnights, not one" — or "that is more than they owe" —
 * is now, not on the receipt.
 */
function explain(value, now) {
  if (!now.rows.length) return '';
  if (!(value > 0)) return 'Escribe el monto recibido.';
  if (value > now.total + 0.005) {
    return `Debe ${money(now.total)}. No se cobra por adelantado: baja el monto a `
      + `${money(now.total)} o menos.`;
  }

  // The same order the payment itself uses: oldest first.
  const parts = [];
  let left = value;
  for (const row of now.rows) {
    if (left <= 0.005) break;
    const take = Math.min(left, row.owed);
    left = round2(left - take);
    parts.push(`${row.title} (${money(take)})`);
  }

  const owedLeft = round2(now.total - value);
  return `Paga ${parts.join(', ')}.`
    + (owedLeft > 0.005 ? ` Quedarían ${money(owedLeft)} pendientes.` : ' Queda al corriente.');
}

/** Tells the client, in their own thread, that the payment landed. */
async function announce(receipt, client) {
  const label = PAYMENT_METHODS[receipt.method]?.label || 'pago';
  const what = receipt.applied.map(appliedTitle).join(', ');

  const text = receipt.balanceAfter > 0.005
    ? `Recibimos su pago de ${moneyFull(receipt.amount)} (${label}), por ${what}. `
      + `Saldo pendiente: ${money(receipt.balanceAfter)}. Su recibo ${receipt.folio} está en su app.`
    : `Recibimos su pago de ${moneyFull(receipt.amount)} (${label}), por ${what}. Queda al `
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
