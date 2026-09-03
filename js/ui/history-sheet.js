/**
 * Writing down a payment that happened before the software did.
 *
 * The first notebook was typed into the panel before payments could be
 * recorded at all. A couple of hundred people therefore carry a real history
 * nothing here has ever seen: their libreta page says "sin pagos" about money
 * they handed over in cash, and "¿cuándo pagó la última vez?" — the question
 * that page exists to answer — has no answer for them.
 *
 * So this records the payment as a receipt and nothing more. It settles no
 * invoice, because there is no invoice: those fortnights were never billed
 * either, and inventing bills to match a half-remembered date would put wrong
 * numbers on somebody's account instead of leaving a blank. The balance does
 * not move.
 *
 * The date does one more thing, and it is the useful one: it sets where their
 * fortnight falls. Somebody who last paid on a Sunday pays again the Sunday
 * after next, and that is the whole cycle.
 */

import { h, mount } from '../lib/dom.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import { field, moneyInput, input, select, textarea, defList, defRow, alert, switchRow } from './kit.js';
import { icon } from '../lib/icons.js';
import { recordPastPayment } from '../data/invoices.js';
import { updateClient } from '../data/clients.js';
import {
  cycleFromPayment, periodOf, payDayAfter, payDaysInWords, periodWord, periodWordPlural,
} from '../lib/billing.js';
import { money } from '../lib/format.js';
import { formatDay, formatDayLong, weekdayName, today } from '../lib/dates.js';
import { PAYMENT_METHODS } from '../lib/model.js';
import { errorText } from '../firebase.js';

/**
 * @param {object} options
 * @param {object} options.client  whose history is being filled in
 * @param {object} options.author  { uid, name }
 * @returns {Promise<object|null>} the receipt written, or null
 */
export function openHistorySheet({ client, author }) {
  const word = periodWord(client);
  return sheet({
    title: 'Registrar un pago anterior',
    build: (close) => {
      let amount = '';
      let method = 'cash';
      let date = today();
      let note = '';
      // On by default: the date of the last payment is where the fortnight
      // falls, and setting it here is the point of typing the payment in.
      let setCycle = true;
      let busy = false;

      const submit = h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' });
      const cycleLine = h('div.t-sm.c-soft');

      const amountBox = moneyInput({
        value: '', autofocus: true, placeholder: '0.00',
        oninput: (event) => { amount = event.target.value; repaint(); },
      });

      function repaint() {
        const value = Number(amount) || 0;
        mount(submit, icon('receipt'),
          value > 0 ? `Registrar ${money(value)}` : 'Registrar el pago');
        submit.disabled = busy || !(value > 0) || !date;

        const anchor = cycleFromPayment(date);
        const period = periodOf({ ...client, cycleAnchor: anchor });
        mount(cycleLine, setCycle
          ? `Su ${word} queda anclada al ${weekdayName(anchor)} ${formatDay(anchor)}. `
            + `Hoy corre del ${formatDay(period.start)} al ${formatDay(period.end)}, `
            + `y paga otra vez el ${weekdayName(payDayAfter(period))} `
            + `${formatDay(payDayAfter(period))}.`
          : `Sólo se guarda el pago; su ${word} no se mueve.`);
      }

      const form = h('form.stack.stack-4', {
        onsubmit: async (event) => {
          event.preventDefault();
          if (busy) return;
          const value = Number(amount);
          if (!(value > 0)) { toastBad('El monto debe ser mayor a cero.'); return; }

          busy = true;
          submit.disabled = true;
          mount(submit, h('span.spinner.spinner--light'), 'Registrando…');

          try {
            const receipt = await recordPastPayment(
              { client, amount: value, method, date, note }, author);
            if (setCycle) {
              await updateClient(client.id, {
                cycleAnchor: cycleFromPayment(date),
                cycleSetOn: date,
              });
            }
            toastOk(`Pago registrado · ${receipt.folio}`);
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
          defRow(`Su ${word} hoy`, client.cycleAnchor
            ? formatDayLong(client.cycleAnchor)
            : 'Sin definir'),
        ])),

      alert('Es lo que ya te pagaron antes de usar el sistema. Queda en su historial y en la '
        + `libreta, pero no cambia su saldo: esas ${periodWordPlural(client)} tampoco se `
        + 'facturaron aquí.', 'info'),

      field({ label: 'Cuánto pagó', control: amountBox }),

      field({
        label: '¿Qué día pagó?',
        hint: `De esta fecha sale su ${word}. Se cobra en ${payDaysInWords()}; si eliges `
          + `otro día, la ${word} empieza el siguiente día de cobro.`,
        control: input({
          type: 'date', value: date, max: today(),
          onchange: (event) => { date = event.target.value || today(); repaint(); },
        }),
      }),

      field({
        label: 'Forma de pago',
        control: select({
          value: method,
          options: Object.entries(PAYMENT_METHODS).map(([value, meta]) => ({ value, label: meta.label })),
          onchange: (event) => { method = event.target.value; },
        }),
      }),

      switchRow(`Fijar su ${word} con esta fecha`, {
        checked: setCycle,
        hint: 'Recomendado. Es lo que decide cuándo le toca pagar otra vez.',
        onChange: (value) => { setCycle = value; repaint(); },
      }),
      cycleLine,

      field({
        label: 'Nota interna',
        control: textarea({
          rows: 2, placeholder: 'Opcional — de qué página del cuaderno salió, por ejemplo.',
          oninput: (event) => { note = event.target.value; },
        }),
      }),

      submit);

      repaint();
      return form;
    },
  }).then((receipt) => receipt || null);
}
