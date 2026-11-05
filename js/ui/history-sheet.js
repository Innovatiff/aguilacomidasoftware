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
  cycleFromPayment, periodOf, payDayAfter, periodWord, periodWordPlural,
} from '../lib/billing.js';
import { payDaysWords } from '../lib/billing-words.js';
import { money } from '../lib/format.js';
import { formatDay, formatDayLong, weekdayName, today } from '../lib/dates.js';
import { PAYMENT_METHODS } from '../lib/model.js';
import { errorText } from '../firebase.js';
import { t } from '../lib/i18n.js';

/**
 * @param {object} options
 * @param {object} options.client  whose history is being filled in
 * @param {object} options.author  { uid, name }
 * @returns {Promise<object|null>} the receipt written, or null
 */
export function openHistorySheet({ client, author }) {
  const word = periodWord(client);
  return sheet({
    title: t('Registrar un pago anterior'),
    build: (close) => {
      let amount = '';
      let method = 'cash';
      let date = today();
      let note = '';
      // Off by default: a payment never moves anybody's pay date on its own.
      // The switch is there for the one time somebody wants exactly that.
      let setCycle = false;
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
          value > 0 ? t('Registrar {amount}', { amount: money(value) }) : t('Registrar el pago'));
        submit.disabled = busy || !(value > 0) || !date;

        const anchor = cycleFromPayment(date);
        const period = periodOf({ ...client, cycleAnchor: anchor });
        mount(cycleLine, setCycle
          ? t('Su {period} queda anclada al {weekday} {day}. Hoy corre del {start} al {end}, y se paga el {payweekday} {payday}, cuando termine.', {
            period: t(word),
            weekday: weekdayName(anchor),
            day: formatDay(anchor),
            start: formatDay(period.start),
            end: formatDay(period.end),
            payweekday: weekdayName(payDayAfter(period)),
            payday: formatDay(payDayAfter(period)),
          })
          : t('Sólo se guarda el pago; su {period} no se mueve.', { period: t(word) }));
      }

      const form = h('form.stack.stack-4', {
        onsubmit: async (event) => {
          event.preventDefault();
          if (busy) return;
          const value = Number(amount);
          if (!(value > 0)) { toastBad(t('El monto debe ser mayor a cero.')); return; }

          busy = true;
          submit.disabled = true;
          mount(submit, h('span.spinner.spinner--light'), t('Registrando…'));

          try {
            const receipt = await recordPastPayment(
              { client, amount: value, method, date, note }, author);
            if (setCycle) {
              await updateClient(client.id, {
                cycleAnchor: cycleFromPayment(date),
                cycleSetOn: date,
              });
            }
            toastOk(t('Pago registrado · {folio}', { folio: receipt.folio }));
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
          defRow(t('Cliente'), client.name),
          defRow(t('Dónde'), [client.farmName, client.locationName].filter(Boolean).join(' · ') || '—'),
          defRow(t('Su {period} hoy', { period: t(word) }), client.cycleAnchor
            ? formatDayLong(client.cycleAnchor)
            : t('Sin definir')),
        ])),

      alert(t('Es lo que ya te pagaron antes de usar el sistema. Queda en su historial y en la libreta, pero no cambia su saldo: esas {periods} tampoco se facturaron aquí.',
        { periods: t(periodWordPlural(client)) }), 'info'),

      field({ label: t('Cuánto pagó'), control: amountBox }),

      field({
        label: t('¿Qué día pagó?'),
        hint: t('Si fijas su {period} con esta fecha: se cobra en {paydays}, y si eliges otro día, la {period} empieza el siguiente día de cobro.',
          { period: t(word), paydays: payDaysWords() }),
        control: input({
          type: 'date', value: date, max: today(),
          onchange: (event) => { date = event.target.value || today(); repaint(); },
        }),
      }),

      field({
        label: t('Forma de pago'),
        control: select({
          value: method,
          options: Object.entries(PAYMENT_METHODS).map(([value, meta]) => ({ value, label: meta.label })),
          onchange: (event) => { method = event.target.value; },
        }),
      }),

      switchRow(t('Fijar su {period} con esta fecha', { period: t(word) }), {
        checked: setCycle,
        hint: t('Sólo si su fecha de pago de hoy está mal. Es lo que decide cuándo le toca pagar otra vez.'),
        onChange: (value) => { setCycle = value; repaint(); },
      }),
      cycleLine,

      field({
        label: t('Nota interna'),
        control: textarea({
          rows: 2, placeholder: t('Opcional — de qué página del cuaderno salió, por ejemplo.'),
          oninput: (event) => { note = event.target.value; },
        }),
      }),

      submit);

      repaint();
      return form;
    },
  }).then((receipt) => receipt || null);
}
