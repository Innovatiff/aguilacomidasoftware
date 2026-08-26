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
 * follows from their billing anchor and their plan.
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
import { money, moneyFull, plural } from '../lib/format.js';
import { formatRange, formatDayLong, today, addDays } from '../lib/dates.js';
import { dbMessage } from '../firebase.js';

/**
 * @param {object} options
 * @param {object} options.client  who is being brought over
 * @param {object[]} options.tiers the price list
 * @param {object} options.author  { uid, name }
 * @returns {Promise<number>} how many fortnights were written
 */
export function openOpeningSheet({ client, tiers, author }) {
  return sheet({
    title: 'Saldo del cuaderno',
    build: (close) => {
      // Two weeks back is the common case — most people are one fortnight
      // behind — and it is a starting point, not an answer.
      let lastPaidOn = addDays(today(), -14);
      let found = owedSince(client, lastPaidOn, tiers);
      let busy = false;

      const preview = h('div.stack.stack-3');
      const submit = h('button.btn.btn--primary.btn--block.btn--lg', { type: 'button' });

      const recalc = () => {
        found = owedSince(client, lastPaidOn, tiers);
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
            ? `Registrar ${plural(chosen, 'quincena', 'quincenas')} · ${money(total())}`
            : 'No hay nada que registrar');
        submit.disabled = !chosen || busy;

        mount(preview,
          !found.amount
            ? alert('Su plan no tiene precio, así que no se puede calcular cuánto debe. '
              + 'Ponlo en Ajustes → Precios.', 'warn')
            : null,

          found.periods.length
            ? h('div.stack.stack-2',
                h('div.t-xs.upper.c-faint.w-700', 'Quincenas desde entonces'),
                card(h('div.stack.stack-1', found.periods.map(periodRow))))
            : alert('Con esa fecha no queda ninguna quincena pendiente.', 'info'),

          chosen
            ? h('div.row.row--between',
                h('span.w-650', 'Total que quedará debiendo'),
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
            h('div.t-xs.c-soft',
              period.closed ? `Cerrada · ${money(period.amount)}` : `En curso · ${money(period.amount)}`)),
          box,
          h('span.switch__track'));
      }

      submit.onclick = async () => {
        if (busy) return;
        busy = true;
        paint();
        mount(submit, h('span.spinner.spinner--light'), 'Registrando…');

        try {
          const issued = await openBalance(client, found.periods, author);
          // Their account starts the day after the last payment covered.
          await setPaidThrough(client.id, lastPaidOn);
          toastOk(`${plural(issued, 'quincena registrada', 'quincenas registradas')}`);
          close(issued);
        } catch (error) {
          busy = false;
          paint();
          toastBad(error?.message || dbMessage(error));
        }
      };

      paint();

      return h('div.stack.stack-4',
        h('p.t-sm.c-soft',
          `Lo que ${client.name} traía debiendo antes de usar el sistema. Dinos cuándo pagó por `
          + 'última vez y el panel calcula las quincenas que quedaron abiertas.'),

        field({
          label: '¿Cuándo pagó por última vez?',
          hint: `Su ciclo empezó el ${formatDayLong(client.cycleAnchor || today())}, así que las `
            + 'quincenas se cuentan desde ahí.',
          control: input({
            type: 'date',
            value: lastPaidOn,
            max: today(),
            onchange: (event) => { lastPaidOn = event.target.value || today(); recalc(); },
          }),
        }),

        preview,

        h('p.t-xs.c-faint', 'Se emite una factura por quincena, marcada como traída del cuaderno. '
          + 'Puedes cobrarlas como cualquier otra, completas o de a poco.'),

        submit);
    },
  }).then((issued) => Number(issued) || 0);
}
