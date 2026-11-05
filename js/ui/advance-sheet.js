/**
 * Looking at — and putting right — money paid on a fortnight before it was
 * served.
 *
 * Nobody here pays ahead: every payment is for the fortnight that has just
 * been served. The old way of taking money put a payment with nothing billed
 * to settle on the fortnight just starting, so somebody who paid on the 10th
 * for the 26th-to-the-9th shows as "pagado hasta el 23". This shows, client by
 * client, where each of those payments goes — the fortnight before, the one it
 * was for — and what stays where it is and why, before anything is written.
 *
 * Two ways in: one client (their file, or the counter before taking money),
 * and everybody at once from the roster.
 */

import { h, mount } from '../lib/dom.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import {
  alert, badge, button, defList, defRow, itemRow, list, loading,
} from './kit.js';
import { advancePlan, fixAdvance } from '../data/advance.js';
import { periodOf, payDayAfter, periodWord } from '../lib/billing.js';
import { money, plural } from '../lib/format.js';
import { formatDay, formatRange, weekdayName } from '../lib/dates.js';
import { errorText } from '../firebase.js';
import { t } from '../lib/i18n.js';

/* --- One client --------------------------------------------------------------- */

/**
 * @param {object} options
 * @param {object} options.client
 * @param {object} options.author      { uid, name }
 * @param {object} [options.plan]      already worked out, to skip the read
 * @param {boolean} [options.beforeCharge]  opened by the counter on the way to
 *   taking a payment: says so, and offers to carry on without it
 * @returns {Promise<object|null|undefined>} the plan applied; null for "carry
 *   on without it"; undefined when closed
 */
export async function openAdvanceSheet({ client, author, plan = null, beforeCharge = false }) {
  if (!plan) {
    try {
      plan = await advancePlan(client);
    } catch (error) {
      toastBad(errorText(error));
      return undefined;
    }
  }

  return sheet({
    title: t('Pago por adelantado'),
    build: (close) => {
      let busy = false;
      const apply = button(applyLabel(plan), {
        variant: 'primary', block: true, icon: 'check',
        onClick: async () => {
          if (busy) return;
          busy = true;
          apply.disabled = true;
          try {
            const done = await fixAdvance(client, author);
            toastOk(doneText(done));
            close(done);
          } catch (error) {
            busy = false;
            apply.disabled = false;
            toastBad(errorText(error));
          }
        },
      });

      return h('div.stack.stack-4',
        beforeCharge
          ? alert(t('Antes de cobrar: lo que debe sale mal mientras esto no se corrija.'), 'warn')
          : null,
        explain(client, plan),
        planDetail(client, plan),
        apply,
        beforeCharge
          ? button(t('Cobrar sin corregir'), { variant: 'ghost', block: true, onClick: () => close(null) })
          : button(t('Ahora no'), { variant: 'ghost', block: true, onClick: () => close(undefined) }));
    },
  });
}

/** The two sentences somebody needs before they read the numbers. */
function explain(client, plan) {
  const word = periodWord(client);
  if (plan.moves.length) {
    return h('p.t-sm.c-soft',
      t('Aquí nadie paga por adelantado: cada pago es por la {period} que se acaba de servir. A {name} se le puso dinero en una {period} antes de que terminara; va a la {period} anterior, que es la que pagó.',
        { period: t(word), name: client.name }));
  }
  if (plan.paidThrough !== plan.wasPaidThrough) {
    return h('p.t-sm.c-soft',
      t('Su “pagado hasta” cae en una {period} que todavía no se termina de servir. Aquí cada pago es por la {period} anterior, así que queda en el último día ya servido.',
        { period: t(word) }));
  }
  return h('p.t-sm.c-soft',
    t('Tiene un pago hecho antes de que terminara su {period}, y no hay nada que se pueda mover solo. Míralo con el cliente; al marcarlo como revisado deja de salir aquí.',
      { period: t(word) }));
}

/** What moves, what stays, and where it leaves them. */
function planDetail(client, plan) {
  const period = periodOf(client);
  const payDay = payDayAfter(period);
  const word = periodWord(client);

  return h('div.stack.stack-3',
    plan.moves.length
      ? h('div.stack.stack-2',
          h('div.t-xs.upper.c-faint.w-700', t('Se mueve')),
          ...plan.moves.map((move) => h('div.advrow',
            h('div.w-600', t('{amount} pagados el {day}', { amount: money(move.amount), day: formatDay(move.date) })),
            h('div.t-sm',
              h('span.c-faint', t('de ')), h('s.c-soft', move.from),
              h('span.c-faint', t(' a ')), h('span.w-600', move.to)))))
      : null,

    plan.stuck.length
      ? h('div.stack.stack-2',
          h('div.t-xs.upper.c-faint.w-700', t('Se queda donde está')),
          ...plan.stuck.map((item) => h('div.advrow.advrow--stuck',
            h('div.w-600', t('{amount} pagados el {day} · en {from}', {
              amount: money(item.amount), day: formatDay(item.date), from: item.from,
            })),
            h('div.t-sm.c-soft', item.why))))
      : null,

    defList([
      plan.paidThrough !== plan.wasPaidThrough
        ? defRow(t('Pagado hasta'), `${plan.wasPaidThrough ? formatDay(plan.wasPaidThrough) : '—'} → `
          + `${plan.paidThrough ? formatDay(plan.paidThrough) : '—'}`)
        : null,
      defRow(t('Debe de lo ya servido'), plan.owedAfter !== plan.owedBefore
        ? `${money(plan.owedBefore)} → ${money(plan.owedAfter)}`
        : money(plan.owedAfter)),
      defRow(t('Su {period} en curso', { period: t(word) }),
        t('{range} · se paga el {weekday} {day}', {
          range: formatRange(period.start, period.end), weekday: weekdayName(payDay), day: formatDay(payDay),
        })),
    ].filter(Boolean)),

    h('p.t-xs.c-faint',
      t('Los recibos no cambian: siguen diciendo cuánto pagó y cuándo. Lo que cambia es a qué {period} va cada pago.',
        { period: t(word) })));
}

const applyLabel = (plan) => (plan.moves.length || plan.paidThrough !== plan.wasPaidThrough
  ? t('Corregir')
  : t('Marcar como revisado'));

function doneText(plan) {
  if (plan.moves.length) {
    return t('{payments} a la quincena que pagaron',
      { payments: plural(plan.moves.length, 'pago movido', 'pagos movidos') });
  }
  return plan.changes ? t('Corregido') : t('Marcado como revisado');
}

/* --- Everybody ---------------------------------------------------------------- */

/**
 * The roster's list: everybody flagged, each with what would change, and one
 * button for all of those where nothing needs a person's judgement.
 *
 * @param {object} options
 * @param {object[]} options.clients
 * @param {object}   options.author
 * @returns {Promise<number>} how many were put right
 */
export function openAdvanceReview({ clients, author }) {
  let fixed = 0;

  return sheet({
    title: t('Pagos por adelantado'),
    build: (close) => {
      const host = h('div.stack.stack-4', loading());
      const plans = new Map();
      let busy = false;

      async function load() {
        mount(host, loading());
        // A few at a time: one read each, and a kitchen PC on a farm's wifi.
        const queue = [...clients];
        const work = Array.from({ length: Math.min(4, queue.length) }, async () => {
          while (queue.length) {
            const client = queue.shift();
            try {
              plans.set(client.id, await advancePlan(client));
            } catch (error) {
              plans.set(client.id, { error: errorText(error) });
            }
          }
        });
        await Promise.all(work);
        paint();
      }

      function paint(progress = '') {
        const ready = clients.filter((client) => {
          const plan = plans.get(client.id);
          return plan && !plan.error && !plan.stuck.length;
        });

        mount(host,
          h('p.t-sm.c-soft',
            t('Aquí nadie paga por adelantado: cada pago es por la quincena que se acaba de servir. A estos clientes se les puso dinero en una quincena antes de que terminara. Cada pago va a la quincena anterior, que es la que pagaron.')),

          list(clients.map((client) => reviewRow(client, plans.get(client.id))), { card: true }),

          progress
            ? alert(progress, 'info')
            : ready.length
              ? button(fixAllLabel(ready.length, clients.length), {
                  variant: 'primary', block: true, icon: 'check',
                  onClick: () => fixMany(ready),
                })
              : null,
          clients.length > ready.length && !progress
            ? h('p.t-xs.c-faint', t('Los que tienen algo que no se mueve solo se revisan uno por uno.'))
            : null,
          button(fixed ? t('Listo') : t('Cerrar'), {
            variant: 'ghost', block: true, onClick: () => close(fixed),
          }));
      }

      function reviewRow(client, plan) {
        const open = async () => {
          if (busy) return;
          const done = await openAdvanceSheet({ client, author, plan: plan?.error ? null : plan });
          if (done) {
            fixed += 1;
            clients = clients.filter((one) => one.id !== client.id);
            plans.delete(client.id);
            if (!clients.length) { close(fixed); return; }
            paint();
          }
        };

        return itemRow({
          title: client.name,
          meta: plan ? summary(plan) : t('Revisando…'),
          end: plan && !plan.error && plan.stuck.length ? badge(t('Revisar'), 'warn') : null,
          className: 'item--wrap',
          onClick: open,
        });
      }

      async function fixMany(ready) {
        if (busy) return;
        busy = true;
        let failed = 0;
        for (let i = 0; i < ready.length; i += 1) {
          paint(t('Corrigiendo {n} de {total}…', { n: i + 1, total: ready.length }));
          try {
            await fixAdvance(ready[i], author);
            fixed += 1;
            clients = clients.filter((one) => one.id !== ready[i].id);
          } catch (error) {
            failed += 1;
            plans.set(ready[i].id, { error: errorText(error) });
          }
        }
        busy = false;
        if (failed) {
          toastBad(t('{clients} corregir.', { clients: plural(failed, 'cliente no se pudo', 'clientes no se pudieron') }));
        }
        if (fixed) toastOk(`${plural(fixed, 'cliente corregido', 'clientes corregidos')}`);
        if (!clients.length) { close(fixed); return; }
        paint();
      }

      load();
      return host;
    },
  }).then((value) => Number(value) || fixed);
}

/** "Corregir a los 12", or only the ones nobody needs to look at first. */
function fixAllLabel(ready, total) {
  if (ready === total) return ready === 1 ? t('Corregir') : t('Corregir a los {n}', { n: ready });
  return ready === 1
    ? t('Corregir al que no tiene pendientes')
    : t('Corregir a los {n} sin pendientes', { n: ready });
}

/** One line per client: what would move, and where it leaves them. */
function summary(plan) {
  if (plan.error) return plan.error;
  const parts = [];
  if (plan.moves.length) {
    parts.push(t('{payments} a la quincena anterior',
      { payments: plural(plan.moves.length, 'pago va', 'pagos van') }));
  }
  if (plan.paidThrough !== plan.wasPaidThrough) {
    parts.push(plan.paidThrough
      ? t('pagado hasta el {day}', { day: formatDay(plan.paidThrough) })
      : t('sin “pagado hasta”'));
  }
  if (plan.owedAfter > 0.005) parts.push(t('quedaría debiendo {amount}', { amount: money(plan.owedAfter) }));
  if (plan.stuck.length) {
    parts.push(t('{payments} donde está',
      { payments: plural(plan.stuck.length, 'pago se queda', 'pagos se quedan') }));
  }
  return parts.length ? parts.join(' · ') : t('Nada que mover — solo marcarlo como revisado');
}
