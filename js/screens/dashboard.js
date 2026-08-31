/**
 * Inicio — what the kitchen needs to know before it opens.
 *
 * The business runs on two questions now: who owes money, and who is waiting
 * for an answer. So those are the only two things above the fold, and anything
 * needing a decision today sits above the numbers — numbers are reassurance,
 * alerts are work.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton } from '../ui/shell.js';
import {
  card, stat, statGrid, button, itemRow, list, avatar,
  sectionLabel, skeletonRows, dataErrorCard,
} from '../ui/kit.js';
import { go } from '../lib/router.js';
import {
  store, subscribe, moneyStats, debtors, roster,
  unreadCount, isReady, firstError, startStore,
} from '../data/store.js';
import { greeting, formatDayLong, today, humanDelta, daysBetween } from '../lib/dates.js';
import { money, number, plural } from '../lib/format.js';

export function renderDashboard() {
  // A failed listener is worth the whole screen. Nothing below it would be
  // showing real numbers anyway, and a half-empty dashboard reads as "nothing
  // to do today" rather than "this did not load".
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
  const cash = moneyStats();
  const owing = debtors();
  const unread = unreadCount();
  const people = roster();
  const active = people.filter((row) => row.serving === 'active');
  const gaps = people.filter((row) => row.hasGap && row.serving !== 'inactive');

  return h('div.page__inner.page__inner--flow.stack.stack-4',
    h('div.span-all', moneyHero(cash)),
    h('div.span-all', alerts({ cash, unread, gaps })),

    h('div.stack.stack-3',
      sectionLabel('El negocio'),
      statGrid([
        stat({
          label: 'Clientes activos',
          value: number(active.length),
          foot: `${plural(store.farms.length, 'rancho', 'ranchos')} · ${people.length} en total`,
          onClick: () => go('/clients?filter=active'),
        }),
        stat({
          label: 'Al corriente',
          value: number(active.filter((row) => row.owed <= 0).length),
          foot: `${active.filter((row) => row.covered).length} con la quincena pagada`,
          tone: 'ok',
          onClick: () => go('/clients?filter=covered'),
        }),
      ])),

    owing.length
      ? h('div.stack.stack-3',
          sectionLabel('Quién debe', h('button.btn.btn--quiet.btn--sm', {
            type: 'button', onclick: () => go('/clients?filter=debt'),
          }, 'Ver todo')),
          debtorList(owing.slice(0, 5)))
      : null,

    h('div.stack.stack-3',
      sectionLabel('Acciones'),
      h('div.stack.stack-2',
        // The way in to the counter screen. Deliberately the loudest thing on
        // this list: on the store's machine it is the only thing anybody opens.
        h('button.quickcta', { type: 'button', onclick: () => go('/rapido') },
          h('span.quickcta__ico', icon('bolt')),
          h('span.grow',
            h('span.quickcta__t', { style: { display: 'block' } }, 'Acción rápida'),
            h('span.quickcta__s', 'Pantalla grande para la tienda: cobrar, comidas, días…')),
          icon('chevronR')),
        button('Cobrar en la tienda', { variant: 'primary', block: true, icon: 'cash', onClick: () => go('/cobrar') }),
        button('Abrir la libreta', { variant: 'dark', block: true, icon: 'clipboard', onClick: () => go('/libreta') }),
        button('Registrar un cliente', { variant: 'ghost', block: true, icon: 'userPlus', onClick: () => go('/clients/new') }))));
}

/* --- Hero: the money ------------------------------------------------------- */

function moneyHero(cash) {
  const owed = cash.outstanding > 0;

  return h('div.hero',
    h('div.hero__eyebrow', 'Por cobrar'),
    h('div.hero__title', money(cash.outstanding, { round: true })),

    h('div.hero__stats',
      heroStat(money(cash.overdue, { round: true }), 'Vencido'),
      heroStat(number(cash.overdueCount), cash.overdueCount === 1 ? 'Factura vencida' : 'Facturas vencidas'),
      heroStat(money(cash.collected, { round: true }), 'Cobrado')),

    h('div', { style: { marginTop: '16px' } },
      button(owed ? 'Cobrar' : 'Abrir cobranza', {
        variant: owed ? 'primary' : 'soft',
        block: true,
        icon: owed ? 'cash' : 'receipt',
        onClick: () => go(owed ? '/cobrar' : '/billing'),
      })));
}

const heroStat = (value, label) =>
  h('div', h('div.hero__stat-v', value), h('div.hero__stat-l', label));

/* --- Alerts ---------------------------------------------------------------- */

function alerts({ cash, unread, gaps }) {
  const rows = [];

  if (cash.overdueCount) {
    rows.push(actionCard({
      tone: 'bad', icon: 'wallet',
      title: `${money(cash.overdue, { round: true })} vencidos`,
      text: `${cash.overdueCount} ${cash.overdueCount === 1 ? 'factura pasó' : 'facturas pasaron'} su fecha de pago.`,
      cta: 'Cobrar', onClick: () => go('/clients?filter=overdue'),
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

  if (gaps.length) {
    rows.push(actionCard({
      tone: 'warn', icon: 'alert',
      title: `${plural(gaps.length, 'cliente por revisar', 'clientes por revisar')}`,
      text: 'Les falta ubicación o precio en su plan, así que no se les puede cobrar.',
      cta: 'Revisar', onClick: () => go('/clients?filter=gaps'),
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
