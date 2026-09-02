/**
 * Inicio — what the kitchen needs to know before it opens.
 *
 * Four numbers carry the day, and they are the four the kitchen actually asks
 * about: what came in today, how many people are on the plan, how many are
 * square, how many are behind. They sit in one row under the money, because a
 * number that needs scrolling to is a number nobody checks.
 *
 * Under them, the two things a row of tiles cannot say:
 *
 *   - **Today against the days around it.** $340 is good or bad depending on
 *     whether it is a collection day, and the kitchen collects on two days a
 *     week — so the fortnight's shape is the context that makes today mean
 *     something.
 *   - **How much of the book is behind.** "38 vencidos" is a different business
 *     at 60 clients than at 348, and only the proportion says which.
 *
 * Anything needing a decision still sits above all of it. Numbers are
 * reassurance; alerts are work.
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
  store, subscribe, moneyStats, debtors, roster, collectedOn, dailyCollections,
  unreadCount, isReady, firstError, startStore,
} from '../data/store.js';
import { columnChart, shareBar } from '../ui/viz.js';
import { payDaysInWords } from '../lib/billing.js';
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

  const cashToday = collectedOn(today());
  const days = dailyCollections(14);

  // The three states of the book. `state` already decides this once, for the
  // roster, its filters and its chips — reading it again here is what keeps the
  // dashboard and the client list from ever disagreeing about who is behind.
  const overdue = active.filter((row) => row.state === 'overdue');
  const square = active.filter((row) => row.owed <= 0.005);
  const soon = active.length - overdue.length - square.length;

  return h('div.page__inner.page__inner--flow.stack.stack-4',
    h('div.span-all', moneyHero(cash, cashToday)),

    /* The four numbers, first, because they are what the screen is for. */
    h('div.span-all.stack.stack-3',
      sectionLabel('Hoy y el negocio'),
      statGrid([
        stat({
          label: 'Cobrado hoy',
          value: money(cashToday, { round: true }),
          foot: takingsFoot(days),
          tone: cashToday > 0 ? 'accent' : undefined,
          onClick: () => go('/billing'),
        }),
        stat({
          label: 'Clientes activos',
          value: number(active.length),
          foot: `${plural(store.farms.length, 'rancho', 'ranchos')} · ${people.length} en total`,
          onClick: () => go('/clients?filter=active'),
        }),
        stat({
          label: 'Al corriente',
          value: number(square.length),
          foot: share(square.length, active.length),
          tone: 'ok',
          onClick: () => go('/clients?filter=current'),
        }),
        stat({
          label: 'Vencidos',
          value: number(overdue.length),
          foot: overdue.length
            ? `${money(cash.overdue, { round: true })} sin cobrar`
            : 'Nadie atrasado',
          tone: overdue.length ? 'bad' : undefined,
          onClick: () => go('/clients?filter=overdue'),
        }),
      ], 4)),

    h('div.span-all', alerts({ cash, unread, gaps })),

    /* What a row of tiles cannot say. */
    h('div.span-all.stack.stack-3',
      sectionLabel('Cobrado por día', h('span.t-xs.c-faint', 'Últimos 14 días')),
      card(h('div.stack.stack-2',
        columnChart(days, { today: today() }),
        h('p.t-xs.c-faint',
          `Se cobra en ${payDaysInWords()}. Las barras bajas son los días entre cobros.`)))),

    h('div.stack.stack-3',
      sectionLabel('Cómo va la cartera'),
      card(shareBar([
        { key: 'ok', label: 'Al corriente', value: square.length, tone: 'ok' },
        { key: 'soon', label: 'Por vencer', value: Math.max(0, soon), tone: 'warn' },
        { key: 'bad', label: 'Vencidos', value: overdue.length, tone: 'bad' },
      ]))),

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

/** "3 de 8 activos" — a count nobody can read without its denominator. */
function share(part, whole) {
  if (!whole) return 'Sin clientes activos';
  return `${Math.round((part / whole) * 100)}% de ${number(whole)} activos`;
}

/** Where today sits against the fortnight behind it. */
function takingsFoot(days) {
  const past = days.slice(0, -1).filter((d) => d.amount > 0);
  if (!past.length) return 'Primer cobro del periodo';
  const best = Math.max(...past.map((d) => d.amount));
  const todayAmount = days[days.length - 1].amount;
  if (todayAmount > best) return 'El día más alto de la quincena';
  return `El mejor día fueron ${money(best, { round: true })}`;
}

/* --- Hero: the money ------------------------------------------------------- */

function moneyHero(cash, cashToday) {
  const owed = cash.outstanding > 0;

  return h('div.hero',
    h('div.hero__eyebrow', 'Por cobrar'),
    h('div.hero__title', money(cash.outstanding, { round: true })),

    // The three figures that used to sit here are the row of tiles below now.
    // Saying them twice on one screen — three times counting the alert card —
    // made the dashboard look busy without telling anybody anything more.
    h('div.hero__stats',
      heroStat(money(cash.overdue, { round: true }), 'De eso, vencido'),
      heroStat(money(cash.dueSoon, { round: true }), 'Todavía en plazo')),

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

  // Side by side where there is room. Three full-width cards pushed the numbers
  // the screen exists for below the fold.
  return h('div.alertgrid', rows);
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
