/**
 * Taking a payment.
 *
 * One flow, opened from anywhere money comes in: the counter, a client's file,
 * a bill. It always starts from the *person*, never from a particular invoice,
 * because that is how it happens — someone walks up and hands over cash, and
 * what it settles is worked out from there.
 *
 * **It never turns money away.** The amount is pre-filled with what they owe
 * — bills still open and fortnights served and not yet billed — or, for
 * somebody up to date paying a few days early, with the fortnight they are
 * eating now; and it says, before the money is taken, what that pays. Any
 * amount from anybody goes in: the dates on a client can be wrong, and the
 * manager counts every payment that came in. If what they owe cannot even be
 * read, the sheet still opens and the payment still goes in.
 *
 * A payment does not move anybody's dates: it is recorded on the day it was
 * made, and their fortnight stays where it is unless somebody turns on the
 * switch that says to move it.
 */

import { h, mount } from '../lib/dom.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import {
  field, moneyInput, input, select, textarea, defList, defRow, button, alert, switchRow,
} from './kit.js';
import { icon } from '../lib/icons.js';
import {
  takePayment, billsOf, payableRows, aheadRows, nothingOwedYet,
} from '../data/invoices.js';
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
  let bills = [];
  let unread = false;
  try {
    bills = await billsOf(client.id);
  } catch {
    // No internet, or the day's reading allowance spent: the payment is taken
    // all the same, and kept whole until it can be put where it goes.
    unread = true;
  }

  /*
   * Money the old way of taking payments put on a fortnight before it was
   * served. Said inside the sheet, with a way to put it right — never in the
   * way of taking the money.
   */
  const advanceOf = () => {
    try {
      return planAdvanceFix({ client, bills, since: servingSince(client), day: today() });
    } catch {
      return { moves: [] };
    }
  };
  let advance = advanceOf();

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
      // Off: a payment a few days early or late must not drag their
      // fortnight to the day it happened to be made.
      let setCycle = false;
      let busy = false;

      /**
       * What can be paid on the chosen date, with the cycle as it would be —
       * or nothing, for a record the arithmetic cannot read. Either way the
       * payment can be taken.
       */
      const owing = () => {
        const anchor = setCycle ? cycleFromPayment(date) : (client.cycleAnchor || cycleFromPayment(date));
        const payer = { ...client, cycleAnchor: anchor };
        try {
          return { payer, anchor, ...payableRows(payer, bills, pricing, { day: date, setCycle }) };
        } catch {
          return { payer, anchor, rows: [], total: 0 };
        }
      };
      const aheadOf = (value) => {
        try {
          return aheadRows(now.payer, bills, pricing, { day: date, amount: Math.max(0, value - now.total) });
        } catch {
          return [];
        }
      };

      let now = owing();
      // What the box starts at: what they owe, or — up to date, paying a few
      // days early — the fortnight they are eating now.
      const suggested = () => (now.total > 0.005 ? now.total : (fortnight || 0));
      let amount = suggested();

      const submit = h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' });
      const covers = h('div.t-sm.c-soft');
      const owedRow = h('div');
      const quickRow = h('div.row.row--wrap', { style: { gap: '6px' } });
      const cycleLine = h('div.t-sm.c-soft');
      const nothing = h('div');
      const advanceNote = h('div');

      function paintAdvance() {
        mount(advanceNote, advance.moves.length
          ? h('div.stack.stack-2',
              alert('Tiene un pago puesto por adelantado. Se puede corregir ahora o después desde '
                + 'su ficha; el cobro entra igual.', 'warn'),
              button('Revisar y corregir', {
                variant: 'soft', size: 'sm', icon: 'check', onClick: fixAdvance,
              }))
          : null);
      }

      async function fixAdvance() {
        const done = await openAdvanceSheet({ client, author, plan: advance });
        if (!done) return;
        client = { ...client, paidThrough: done.paidThrough, advanceFixedOn: today() };
        try {
          bills = await billsOf(client.id);
        } catch (error) {
          toastBad(errorText(error));
          return;
        }
        advance = advanceOf();
        paintAdvance();
        recompute({ resetAmount: true });
      }

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
        const before = suggested();
        now = owing();
        // Only touch the amount if it was the old suggestion — a number
        // somebody typed is theirs.
        if (resetAmount || Number(amount) === before) setAmount(suggested());
        else repaint();
      }

      function repaint() {
        const value = Number(amount) || 0;

        mount(owedRow, defList([
          defRow('Debe hoy', now.total > 0.005 ? money(now.total) : 'Nada', { total: true }),
        ]));
        mount(nothing, now.total > 0.005 ? null : alert(nothingOwedYet(now.payer, date), 'info'));
        mount(quickRow,
          now.total > 0.005 ? quick(`Todo lo que debe ${money(now.total)}`, () => setAmount(now.total)) : null,
          now.rows.length > 1
            ? quick(`Solo ${now.rows[0].title} ${money(now.rows[0].owed)}`, () => setAmount(now.rows[0].owed))
            : null,
          // Somebody who owes nothing is still paying something: usually a
          // fortnight's worth.
          now.total <= 0.005 && fortnight
            ? quick(`Una ${word} ${money(fortnight)}`, () => setAmount(fortnight))
            : null);

        mount(submit, icon('cash'), `Cobrar ${money(value)}`);
        submit.disabled = busy || !(value > 0);
        mount(covers, explain(value, now, aheadOf(value)));

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

      advanceNote,

      unread
        ? alert('No se pudo leer lo que debe (sin internet o sin conexión con la base de datos). '
          + 'El pago entra igual y queda a cuenta, marcado para revisarlo.', 'warn')
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
        checked: false,
        hint: `Apagado, el pago no le mueve ninguna fecha. Actívalo solo si hoy de verdad empieza `
          + `su ${word} — se cobra en ${payDaysInWords()} —; pagar unos días antes o después no `
          + 'es razón para moverla.',
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
      paintAdvance();
      return form;
    },
  }).then((receipt) => receipt || null);
}

const quick = (label, onClick) => button(label, { variant: 'soft', size: 'sm', onClick });

/**
 * Says in words what the money will settle, before it is taken.
 *
 * The cashier is holding cash and the person is standing there: the moment to
 * catch "that pays two fortnights, not one" — or "that is more than they owe,
 * and the rest waits on the fortnight being served" — is now, not on the
 * receipt. It explains; it never stops the payment.
 *
 * @param {object[]} ahead  where anything past what is owed would wait
 */
function explain(value, now, ahead = []) {
  if (!(value > 0)) return 'Escribe el monto recibido.';

  // The same order the payment itself uses: oldest first, then what waits.
  const spread = (rows, money0) => {
    const parts = [];
    let left = money0;
    for (const row of rows) {
      if (left <= 0.005) break;
      const take = Math.min(left, row.owed);
      left = round2(left - take);
      parts.push(`${row.title} (${money(take)})`);
    }
    return { parts, left };
  };

  const paid = spread(now.rows, Math.min(value, now.total));
  const waiting = spread(ahead, round2(value - now.total));
  const owedLeft = round2(now.total - Math.min(value, now.total));

  const said = [];
  if (paid.parts.length) said.push(`Paga ${paid.parts.join(', ')}.`);
  if (waiting.parts.length) {
    said.push(`${paid.parts.length ? 'Lo que sobra queda' : 'Queda'} a cuenta de `
      + `${waiting.parts.join(', ')}.`);
  }
  if (waiting.left > 0.005) said.push(`${money(waiting.left)} quedan a cuenta, sin quincena.`);
  said.push(owedLeft > 0.005 ? `Quedarían ${money(owedLeft)} pendientes.` : 'Queda al corriente.');
  return said.join(' ');
}

/** Tells the client, in their own thread, that the payment landed. */
async function announce(receipt, client) {
  const label = PAYMENT_METHODS[receipt.method]?.label || 'pago';
  const served = receipt.applied.filter((row) => !row.ahead).map(appliedTitle);
  const waiting = receipt.applied.filter((row) => row.ahead).map(appliedTitle);
  const what = [
    served.length ? `por ${served.join(', ')}` : '',
    waiting.length ? `a cuenta de ${waiting.join(', ')}` : '',
    receipt.unapplied ? `${money(receipt.unapplied)} a cuenta` : '',
  ].filter(Boolean).join(' y ') || 'a su cuenta';

  const text = receipt.held
    ? `Recibimos su pago de ${moneyFull(receipt.amount)} (${label}). Su recibo ${receipt.folio} `
      + 'está en su app. ¡Gracias!'
    : receipt.balanceAfter > 0.005
      ? `Recibimos su pago de ${moneyFull(receipt.amount)} (${label}), ${what}. `
        + `Saldo pendiente: ${money(receipt.balanceAfter)}. Su recibo ${receipt.folio} está en su app.`
      : `Recibimos su pago de ${moneyFull(receipt.amount)} (${label}), ${what}. Queda al `
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
