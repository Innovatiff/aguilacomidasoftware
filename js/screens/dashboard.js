/**
 * Dashboard — what the kitchen needs to know before 7am.
 *
 * The ordering is deliberate: anything that needs a decision today (people not
 * on the route, a stop with a problem, an overdue payment) is surfaced above
 * the numbers, because numbers are reassurance and alerts are work.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton } from '../ui/shell.js';
import {
  card, stat, statGrid, meter, button, itemRow, list, avatar,
  sectionLabel, skeletonRows, dataErrorCard,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm } from '../ui/overlay.js';
import { go } from '../lib/router.js';
import {
  store, subscribe, dayStats, moneyStats, debtors, unscheduled,
  activeClients, unreadCount, isReady, setDay, firstError, startStore,
} from '../data/store.js';
import { plural } from '../lib/format.js';
import { scheduleDay } from '../data/deliveries.js';
import { greeting, formatDayLong, today, humanDelta, daysBetween } from '../lib/dates.js';
import { money, number } from '../lib/format.js';
import { session } from '../data/session.js';

export function renderDashboard() {
  // The dashboard always speaks about today, even if the route screen was left
  // on another date.
  setDay(today());

  // A failed listener is worth the whole screen. Nothing below it would be
  // showing real numbers anyway, and a half-empty dashboard reads as "no work
  // today" rather than "this did not load".
  const failure = () => firstError();

  const draw = () => {
    screen({
      title: greeting(),
      subtitle: formatDayLong(today()),
      tab: 'home',
      actions: [topbarButton('settings', {
        label: 'Ajustes',
        onClick: () => go('/settings'),
      })],
      body: failure()
        ? h('div.page__inner', dataErrorCard(failure().error, { onRetry: () => startStore() }))
        : isReady() ? body() : skeletonRows(5),
    });
  };

  return subscribe(draw);
}

function body() {
  const stats = dayStats();
  const cash = moneyStats();
  const pendingSchedule = unscheduled();
  const problems = store.deliveries.filter((row) => row.status === 'issue');
  const unread = unreadCount();
  const owing = debtors();

  return h('div.page__inner.stack.stack-4',
    routeHero(stats),
    alerts({ pendingSchedule, problems, unread, cash }),

    sectionLabel('Cobranza'),
    statGrid([
      stat({
        label: 'Por cobrar',
        value: money(cash.outstanding, { round: true }),
        foot: cash.outstanding > 0 ? 'En facturas abiertas' : 'Todo al corriente',
        tone: cash.outstanding > 0 ? 'accent' : null,
        onClick: () => go('/billing'),
      }),
      stat({
        label: 'Vencido',
        value: money(cash.overdue, { round: true }),
        foot: cash.overdueCount ? `${cash.overdueCount} ${cash.overdueCount === 1 ? 'factura' : 'facturas'}` : 'Ninguna',
        tone: cash.overdue > 0 ? 'bad' : 'ok',
        onClick: () => go('/billing?filter=overdue'),
      }),
    ]),

    sectionLabel('Hoy'),
    statGrid([
      stat({ label: 'Comidas', value: number(stats.meals), foot: `${stats.mealsDelivered} entregadas` }),
      stat({
        label: 'Clientes activos',
        value: number(activeClients().length),
        foot: `${plural(store.farms.length, 'rancho', 'ranchos')} · ${stats.total} en ruta hoy`,
        onClick: () => go('/farms'),
      }),
    ]),

    owing.length ? sectionLabel('Quién debe', h('button.btn.btn--quiet.btn--sm', {
      type: 'button', onclick: () => go('/billing'),
    }, 'Ver todo')) : null,
    owing.length ? debtorList(owing.slice(0, 4)) : null,

    sectionLabel('Acciones'),
    h('div.stack.stack-2',
      button('Ver la ruta de hoy', { variant: 'dark', block: true, icon: 'route', onClick: () => go('/route') }),
      button('Registrar un cliente', { variant: 'ghost', block: true, icon: 'userPlus', onClick: () => go('/clients/new') }),
      button('Registrar un rancho', { variant: 'ghost', block: true, icon: 'farm', onClick: () => go('/farms/new') })));
}

/* --- Hero: the day's progress ---------------------------------------------- */

function routeHero(stats) {
  const hasRoute = stats.total > 0;

  return h('div.hero',
    h('div.row.row--between',
      h('div',
        h('div.hero__eyebrow', 'Ruta de hoy'),
        h('div.hero__title', hasRoute
          ? `${stats.done} de ${stats.servable} entregas`
          : 'Sin ruta programada')),
      hasRoute ? h('div.t-2xl.w-700', { style: { color: 'var(--brand-400)' } }, `${stats.percent}%`) : null),

    hasRoute ? h('div', { style: { marginTop: '14px' } },
      meter(stats.percent, { tone: stats.percent === 100 ? 'ok' : null, large: true })) : null,

    hasRoute
      ? h('div.hero__stats',
          heroStat(stats.counts.preparing, 'En cocina'),
          heroStat(stats.counts.en_route, 'En camino'),
          heroStat(stats.pending, 'Pendientes'))
      : h('p.hero__note', 'Genera la ruta para que cada quien vea su entrega en la app.'),

    h('div', { style: { marginTop: '16px' } },
      button(hasRoute ? 'Abrir la ruta' : 'Generar la ruta de hoy', {
        variant: hasRoute ? 'soft' : 'primary',
        block: true,
        icon: hasRoute ? 'route' : 'plus',
        onClick: hasRoute ? () => go('/route') : generateToday,
      })));
}

const heroStat = (value, label) =>
  h('div', h('div.hero__stat-v', number(value)), h('div.hero__stat-l', label));

/* --- Alerts ---------------------------------------------------------------- */

function alerts({ pendingSchedule, problems, unread, cash }) {
  const rows = [];

  if (pendingSchedule.length) {
    rows.push(actionCard({
      tone: 'warn', icon: 'calendar',
      title: `${pendingSchedule.length} ${pendingSchedule.length === 1 ? 'cliente sin programar' : 'clientes sin programar'}`,
      text: byFarm(pendingSchedule),
      cta: 'Programar', onClick: generateToday,
    }));
  }

  if (problems.length) {
    rows.push(actionCard({
      tone: 'bad', icon: 'alert',
      title: `${problems.length} ${problems.length === 1 ? 'entrega con problema' : 'entregas con problema'}`,
      text: problems.slice(0, 3).map((row) =>
        [row.clientName, row.locationName].filter(Boolean).join(' · ')).join(' · ')
        + (problems.length > 3 ? ` y ${problems.length - 3} más` : ''),
      cta: 'Revisar', onClick: () => go('/route'),
    }));
  }

  if (cash.overdueCount) {
    rows.push(actionCard({
      tone: 'bad', icon: 'wallet',
      title: `${money(cash.overdue, { round: true })} vencidos`,
      text: `${cash.overdueCount} ${cash.overdueCount === 1 ? 'factura pasó' : 'facturas pasaron'} su fecha de pago.`,
      cta: 'Cobrar', onClick: () => go('/billing?filter=overdue'),
    }));
  }

  if (unread) {
    rows.push(actionCard({
      tone: 'brand', icon: 'chat',
      title: `${unread} ${unread === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}`,
      text: 'Hay clientes esperando respuesta.',
      cta: 'Abrir', onClick: () => go('/messages'),
    }));
  }

  if (!rows.length) {
    return card(h('div.row',
      h('span', { style: { color: 'var(--ok-500)' } }, icon('shield')),
      h('div.grow',
        h('div.w-600', 'Todo en orden'),
        h('div.t-sm.c-soft', 'Sin pendientes que requieran tu atención.'))));
  }

  return h('div.stack.stack-3', rows);
}

/** "Mucci Farms (12) · Valle Verde (3)" — where the gap actually is. */
function byFarm(clients) {
  const counts = new Map();
  for (const client of clients) {
    const name = client.farmName || 'Sin rancho';
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => `${name} (${count})`).join(' · ');
}

function actionCard({ tone, icon: ico, title, text, cta, onClick }) {
  return h('div.card.card--tight', { style: { borderColor: `var(--${toneVar(tone)}-500)`, borderLeftWidth: '4px' } },
    h('div.row.row--top',
      h('span', { style: { color: `var(--${toneVar(tone)}-500)`, marginTop: '2px' } }, icon(ico)),
      h('div.grow',
        h('div.w-600', title),
        h('div.t-sm.c-soft', { style: { marginTop: '1px' } }, text)),
      h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: onClick }, cta)));
}

const toneVar = (tone) => ({ warn: 'warn', bad: 'bad', brand: 'brand', ok: 'ok', info: 'info' }[tone] || 'ink');

/* --- Debtors --------------------------------------------------------------- */

function debtorList(rows) {
  return list(rows.map((row) => itemRow({
    lead: avatar(row.clientName),
    title: row.clientName,
    meta: dueLabel(row.invoices[0], row.invoices.length),
    end: h('div.w-700', money(row.balance, { round: true })),
    onClick: () => go(`/clients/${row.clientId}`),
  })), { card: true });
}

/** "2 facturas · venció hace 4 días" — tense follows the deadline. */
function dueLabel(invoice, count) {
  const delta = daysBetween(today(), invoice.dueDate);
  const noun = count === 1 ? 'factura' : 'facturas';
  return `${count} ${noun} · ${delta < 0 ? 'venció' : 'vence'} ${humanDelta(delta)}`;
}

/* --- Actions ---------------------------------------------------------------- */

async function generateToday() {
  const day = today();
  const clients = activeClients();
  if (!clients.length) {
    toastBad('Primero registra un rancho y a su gente.');
    return;
  }

  const ok = await confirm({
    title: 'Generar la ruta de hoy',
    message: `Se crearán las entregas de ${formatDayLong(day)} para los clientes activos que reciben comida hoy. Las entregas que ya existen no se modifican.`,
    confirmLabel: 'Generar ruta',
    icon: 'calendar',
  });
  if (!ok) return;

  try {
    const { created, skipped } = await scheduleDay(clients, day, {
      uid: session.uid, name: session.displayName,
    });
    if (created) {
      toastOk(`${created} ${created === 1 ? 'entrega creada' : 'entregas creadas'}`);
      go('/route');
    } else {
      toastOk(skipped ? 'La ruta ya estaba generada.' : 'Hoy no hay clientes programados.');
    }
  } catch {
    toastBad('No se pudo generar la ruta.');
  }
}
