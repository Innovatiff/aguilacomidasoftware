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
 *
 * What is unticked is written down as well, as paid: left with no record at
 * all, the next scan for unbilled fortnights charged it. And "nothing
 * pending" is an answer that gets saved too — somebody up to date in the
 * notebook has to be up to date here, not four fortnights behind.
 */

import { h, mount } from '../lib/dom.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import { field, input, alert, card } from './kit.js';
import { icon } from '../lib/icons.js';
import { owedSince, openBalance, notebookOutcome } from '../data/cycles.js';
import { setPaidThrough, servingSince, updateClient } from '../data/clients.js';
import { money, moneyFull } from '../lib/format.js';
import {
  formatRange, formatDay, formatDayLong, today, addDays, capitalize, isWholeDay,
} from '../lib/dates.js';
import { periodWord, periodWordPlural, payEveryOf, periodOf } from '../lib/billing.js';
import { errorText } from '../firebase.js';
import { t } from '../lib/i18n.js';

/**
 * @param {object} options
 * @param {object} options.client  who is being brought over
 * @param {object} options.pricing the price list
 * @param {object} options.author  { uid, name }
 * @returns {Promise<{ issued: number, startedOn: string }>} how many bills
 *   were written, and the day they started eating when saving moved it
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
      // The day they started, when saving finds it has to move back.
      let startedOn = '';

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
        // Where "paid up to" ends up: the date typed, moved on over whatever
        // was unticked at the front of the list.
        const upTo = notebookOutcome(found).paidThrough;

        mount(submit,
          icon(chosen ? 'receipt' : 'check'),
          chosen
            ? t('Registrar {count} {periods} · {amount}', {
              count: chosen, periods: chosen === 1 ? t(word) : t(words), amount: money(total()),
            })
            : upTo
              ? t('Guardar: no queda debiendo nada')
              : t('No hay nada que registrar'));
        // Nothing owed is still something to save: without it the system goes
        // on believing they never paid any of it.
        // …but not bills at $0 for a plan with no price: that is a price
        // list to fix first, not three fortnights to mark as settled.
        submit.disabled = busy || !(chosen || upTo) || (chosen > 0 && !found.amount);

        mount(preview,
          !found.amount
            ? alert(t('Su plan no tiene precio, así que no se puede calcular cuánto debe. Ponlo en Ajustes → Precios.'), 'warn')
            : null,

          found.periods.length
            ? h('div.stack.stack-2',
                h('div.t-xs.upper.c-faint.w-700', t('{periods} desde entonces', { periods: capitalize(t(words)) })),
                card(h('div.stack.stack-1', found.periods.map(periodRow))),
                h('p.t-xs.c-faint', t('Deja marcadas las que debe. Las que desmarques quedan anotadas como ya pagadas en el cuaderno, y no se le vuelven a cobrar.')))
            : alert(lastPaidOn
              ? t('Con esa fecha no queda ninguna {period} pendiente.', { period: t(word) })
              : t('Escribe la fecha de su último pago.'), 'info'),

          chosen
            ? h('div.row.row--between',
                h('span.w-650', t('Total que quedará debiendo')),
                h('span.t-lg.w-700', moneyFull(total())))
            : upTo
              ? alert(t('Se guarda que está al corriente hasta el {day}, para que el sistema no le cobre lo de antes.',
                { day: formatDay(upTo) }), 'ok')
              : null,

          // Only when there is a bill to write: said under "nothing pending",
          // it promised invoices that were not coming.
          chosen
            ? h('p.t-xs.c-faint', t('Se emite una factura por {period}, marcada como traída del cuaderno. Puedes cobrarlas como cualquier otra, completas o de a poco.',
              { period: t(word) }))
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
        close.hold(true);
        paint();
        mount(submit, h('span.spinner.spinner--light'), t('Registrando…'));

        try {
          const upTo = notebookOutcome(found).paidThrough;
          const issued = await openBalance(client, found.periods, author);
          // The last day that payment paid for — the end of the fortnight it
          // was for — not the day it was made.
          if (upTo) await setPaidThrough(client.id, upTo);
          // Somebody who was paying in the notebook was eating here before
          // today. Registered just now, their file says they started today —
          // and the fortnight they are in the middle of is then "already
          // running when they started": never charged. They were here at
          // least for the fortnight their last payment was for.
          const from = upTo ? periodOf(client, upTo).start : '';
          const since = servingSince(client);
          if (from && since && since > from) {
            await updateClient(client.id, { startedOn: from });
            startedOn = from;
          }
          toastOk(!issued
            ? t('Guardado: {name} queda al corriente', { name: client.name })
            : issued === 1
              ? t('{count} {period} registrada', { count: issued, period: t(word) })
              : t('{count} {periods} registradas', { count: issued, periods: t(words) }));
          close({ issued, startedOn });
        } catch (error) {
          busy = false;
          close.hold(false);
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
            min: '2000-01-01',
            max: today(),
            // Not while the year is still being typed: "2" is the year 0002,
            // and the list was then two thousand years of fortnights.
            // …and an empty box is no date either: nothing to save until
            // there is one, rather than "paid today" by default.
            onchange: (event) => {
              const value = event.target.value;
              lastPaidOn = isWholeDay(value) ? value : '';
              recalc();
            },
          }),
        }),

        preview,

        submit);
    },
  }).then((done) => ({ issued: Number(done?.issued) || 0, startedOn: done?.startedOn || '' }));
}
