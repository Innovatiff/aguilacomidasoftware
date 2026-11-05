/**
 * Bringing a client's balance over from the notebook.
 *
 * El Águila kept these accounts on paper for years. Migrating them cannot mean
 * typing an invoice per fortnight per person — for two hundred people that is
 * a week of work nobody will do, and the balances would simply never make it
 * into the software.
 *
 * So it asks for the one thing the notebook actually says: **when did they last
 * pay?** Everything else — which fortnights that leaves open, what each costs —
 * follows from their billing anchor and their plan. A payment is always for
 * food already served, so the last payment paid for the fortnight that had
 * ended by then; everything served after it is owed, and the fortnight still
 * running is not, yet.
 *
 * The list is checkable rather than automatic. A notebook is not a database,
 * and the person holding it knows things this does not: a month somebody was
 * away, a fortnight already settled in cash and never written down.
 */

import { h, mount } from '../lib/dom.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import { field, input, alert, card } from './kit.js';
import { icon } from '../lib/icons.js';
import { owedSince, openBalance } from '../data/cycles.js';
import { setPaidThrough } from '../data/clients.js';
import { money, moneyFull } from '../lib/format.js';
import { formatRange, formatDayLong, today, addDays, capitalize } from '../lib/dates.js';
import { periodWord, periodWordPlural, payEveryOf } from '../lib/billing.js';
import { errorText } from '../firebase.js';
import { t } from '../lib/i18n.js';

/**
 * @param {object} options
 * @param {object} options.client  who is being brought over
 * @param {object} options.pricing the price list
 * @param {object} options.author  { uid, name }
 * @returns {Promise<number>} how many periods were written
 */
export function openOpeningSheet({ client, pricing, author }) {
  const word = periodWord(client);
  const words = periodWordPlural(client);

  return sheet({
    title: t('Saldo del cuaderno'),
    build: (close) => {
      // One period back is the common case — most people are one behind — and
      // it is a starting point, not an answer.
      let lastPaidOn = addDays(today(), -payEveryOf(client));
      let found = owedSince(client, lastPaidOn, pricing);
      let busy = false;

      const preview = h('div.stack.stack-3');
      const submit = h('button.btn.btn--primary.btn--block.btn--lg', { type: 'button' });

      const recalc = () => {
        found = owedSince(client, lastPaidOn, pricing);
        paint();
      };

      const total = () => found.periods
        .filter((period) => period.owed)
        .reduce((sum, period) => sum + period.amount, 0);

      function paint() {
        const chosen = found.periods.filter((period) => period.owed).length;

        mount(submit,
          icon('receipt'),
          chosen
            ? t('Registrar {count} {periods} · {amount}', {
              count: chosen, periods: chosen === 1 ? t(word) : t(words), amount: money(total()),
            })
            : t('No hay nada que registrar'));
        submit.disabled = !chosen || busy;

        mount(preview,
          !found.amount
            ? alert(t('Su plan no tiene precio, así que no se puede calcular cuánto debe. Ponlo en Ajustes → Precios.'), 'warn')
            : null,

          found.periods.length
            ? h('div.stack.stack-2',
                h('div.t-xs.upper.c-faint.w-700', t('{periods} desde entonces', { periods: capitalize(t(words)) })),
                card(h('div.stack.stack-1', found.periods.map(periodRow))))
            : alert(t('Con esa fecha no queda ninguna {period} pendiente.', { period: t(word) }), 'info'),

          chosen
            ? h('div.row.row--between',
                h('span.w-650', t('Total que quedará debiendo')),
                h('span.t-lg.w-700', moneyFull(total())))
            : null);
      }

      /** One fortnight, with the tick that decides whether it is billed. */
      function periodRow(period) {
        const box = h('input', {
          type: 'checkbox',
          checked: period.owed,
          onchange: (event) => { period.owed = event.target.checked; paint(); },
        });

        return h('label.switch', { style: { padding: '6px 0' } },
          h('div.grow',
            h('div.w-600', formatRange(period.start, period.end)),
            h('div.t-xs.c-soft', t('Ya servida · {amount}', { amount: money(period.amount) }))),
          box,
          h('span.switch__track'));
      }

      submit.onclick = async () => {
        if (busy) return;
        busy = true;
        paint();
        mount(submit, h('span.spinner.spinner--light'), t('Registrando…'));

        try {
          const issued = await openBalance(client, found.periods, author);
          // The last day that payment paid for — the end of the fortnight it
          // was for — not the day it was made.
          if (found.paidThrough) await setPaidThrough(client.id, found.paidThrough);
          toastOk(issued === 1
            ? t('{count} {period} registrada', { count: issued, period: t(word) })
            : t('{count} {periods} registradas', { count: issued, periods: t(words) }));
          close(issued);
        } catch (error) {
          busy = false;
          paint();
          toastBad(errorText(error));
        }
      };

      paint();

      return h('div.stack.stack-4',
        h('p.t-sm.c-soft',
          t('Lo que {name} traía debiendo antes de usar el sistema. Dinos cuándo pagó por última vez y el panel calcula las {periods} que ya comió y no ha pagado. Cada pago es por lo que ya se sirvió: la que está en curso se paga cuando termine.',
            { name: client.name, periods: t(words) })),

        field({
          label: t('¿Cuándo pagó por última vez?'),
          hint: t('Su ciclo empezó el {day}, así que las {periods} se cuentan desde ahí.',
            { day: formatDayLong(client.cycleAnchor || today()), periods: t(words) }),
          control: input({
            type: 'date',
            value: lastPaidOn,
            max: today(),
            onchange: (event) => { lastPaidOn = event.target.value || today(); recalc(); },
          }),
        }),

        preview,

        h('p.t-xs.c-faint', t('Se emite una factura por {period}, marcada como traída del cuaderno. Puedes cobrarlas como cualquier otra, completas o de a poco.',
          { period: t(word) })),

        submit);
    },
  }).then((issued) => Number(issued) || 0);
}
