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
import { payDaysWords } from '../lib/billing-words.js';
import { greeting, formatDayLong, today, humanDelta, daysBetween } from '../lib/dates.js';
import { money, number, plural } from '../lib/format.js';
import { t } from '../lib/i18n.js';

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
      // Reportes has its own tab now, so the icon that used to sit here would be
      // a second door to one room.
      actions: [topbarButton('settings', { label: t('Ajustes'), onClick: () => go('/settings') })],
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
      sectionLabel(t('Hoy y el negocio')),
      statGrid([
        stat({
          label: t('Cobrado hoy'),
          value: money(cashToday, { round: true }),
          foot: takingsFoot(days),
          tone: cashToday > 0 ? 'accent' : undefined,
          onClick: () => go('/reportes?p=day'),
        }),
        stat({
          label: t('Clientes activos'),
          value: number(active.length),
          foot: `${plural(store.farms.length, 'rancho', 'ranchos')} · ${t('{count} en total', { count: people.length })}`,
          onClick: () => go('/clients?filter=active'),
        }),
        stat({
          label: t('Al corriente'),
          value: number(square.length),
          foot: share(square.length, active.length),
          tone: 'ok',
          onClick: () => go('/clients?filter=current'),
        }),
        stat({
          label: t('Vencidos'),
          value: number(overdue.length),
          foot: overdue.length
            ? t('{amount} sin cobrar', { amount: money(cash.overdue, { round: true }) })
            : t('Nadie atrasado'),
          tone: overdue.length ? 'bad' : undefined,
          onClick: () => go('/clients?filter=overdue'),
        }),
      ], 4)),

    h('div.span-all', alerts({ cash, unread, gaps })),

    /* What a row of tiles cannot say. */
    h('div.span-all.stack.stack-3',
      sectionLabel(t('Cobrado por día'), h('span.t-xs.c-faint', t('Últimos 14 días'))),
      card(h('div.stack.stack-2',
        columnChart(days, { today: today() }),
        h('p.t-xs.c-faint',
          t('Se cobra en {days}. Las barras bajas son los días entre cobros.', { days: payDaysWords() }))))),

    h('div.stack.stack-3',
      sectionLabel(t('Cómo va la cartera')),
      card(shareBar([
        { key: 'ok', label: t('Al corriente'), value: square.length, tone: 'ok' },
        { key: 'soon', label: t('Por vencer'), value: Math.max(0, soon), tone: 'warn' },
        { key: 'bad', label: t('Vencidos'), value: overdue.length, tone: 'bad' },
      ]))),

    owing.length
      ? h('div.stack.stack-3',
          sectionLabel(t('Quién debe'), h('button.btn.btn--quiet.btn--sm', {
            type: 'button', onclick: () => go('/clients?filter=debt'),
          }, t('Ver todo'))),
          debtorList(owing.slice(0, 5)))
      : null,

    h('div.stack.stack-3',
      sectionLabel(t('Acciones')),
      h('div.stack.stack-2',
        // The way in to the counter screen. Deliberately the loudest thing on
        // this list: on the store's machine it is the only thing anybody opens.
        h('button.quickcta', { type: 'button', onclick: () => go('/rapido') },
          h('span.quickcta__ico', icon('bolt')),
          h('span.grow',
            h('span.quickcta__t', { style: { display: 'block' } }, t('Acción rápida')),
            h('span.quickcta__s', t('Pantalla grande para la tienda: cobrar, comidas, días…'))),
          icon('chevronR')),
        button(t('Cobrar en la tienda'), { variant: 'primary', block: true, icon: 'cash', onClick: () => go('/cobrar') }),
        button(t('Empacar la comida de hoy'), { variant: 'dark', block: true, icon: 'box', onClick: () => go('/empaque') }),
        button(t('Ver reportes'), { variant: 'soft', block: true, icon: 'chart', onClick: () => go('/reportes') }),
        button(t('Abrir la libreta'), { variant: 'dark', block: true, icon: 'clipboard', onClick: () => go('/libreta') }),
        button(t('Registrar un cliente'), { variant: 'ghost', block: true, icon: 'userPlus', onClick: () => go('/clients/new') }))));
}

/** "3 de 8 activos" — a count nobody can read without its denominator. */
function share(part, whole) {
  if (!whole) return t('Sin clientes activos');
  return t('{percent}% de {total} activos', { percent: Math.round((part / whole) * 100), total: number(whole) });
}

/** Where today sits against the fortnight behind it. */
function takingsFoot(days) {
  const past = days.slice(0, -1).filter((d) => d.amount > 0);
  if (!past.length) return t('Primer cobro del periodo');
  const best = Math.max(...past.map((d) => d.amount));
  const todayAmount = days[days.length - 1].amount;
  if (todayAmount > best) return t('El día más alto de la quincena');
  return t('El mejor día fueron {amount}', { amount: money(best, { round: true }) });
}

/* --- Hero: the money ------------------------------------------------------- */

function moneyHero(cash, cashToday) {
  const owed = cash.outstanding > 0;

  return h('div.hero',
    h('div.hero__eyebrow', t('Por cobrar')),
    h('div.hero__title', money(cash.outstanding, { round: true })),

    // The three figures that used to sit here are the row of tiles below now.
    // Saying them twice on one screen — three times counting the alert card —
    // made the dashboard look busy without telling anybody anything more.
    h('div.hero__stats',
      heroStat(money(cash.overdue, { round: true }), t('De eso, vencido')),
      heroStat(money(cash.dueSoon, { round: true }), t('Todavía en plazo'))),

    h('div', { style: { marginTop: '16px' } },
      button(owed ? t('Cobrar') : t('Abrir cobranza'), {
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

  // The Programador: a reminder whose day came, or a change it could not make.
  for (const set of store.schedule.filter((one) => one.state === 'remind')) {
    const v = set.value || {};
    rows.push(actionCard({
      tone: 'info', icon: 'bell',
      title: t('Recordatorio: {name}', { name: set.clientName || t('para hoy') }),
      text: [v.amount ? money(v.amount) : '', v.note].filter(Boolean).join(' · '),
      cta: t('Ver'), onClick: () => go('/programador'),
    }));
  }
  const failed = store.schedule.filter((one) => one.state === 'failed');
  if (failed.length) {
    rows.push(actionCard({
      tone: 'bad', icon: 'clock',
      title: t('{changes} hacer', {
        changes: plural(failed.length, 'cambio programado no se pudo', 'cambios programados no se pudieron'),
      }),
      text: failed.map((one) => one.clientName || one.value?.name || '').filter(Boolean).slice(0, 3).join(', ')
        || t('Revísalo en el Programador.'),
      cta: t('Revisar'), onClick: () => go('/programador'),
    }));
  }

  if (cash.overdueCount) {
    rows.push(actionCard({
      tone: 'bad', icon: 'wallet',
      title: t('{amount} vencidos', { amount: money(cash.overdue, { round: true }) }),
      text: cash.overdueCount === 1
        ? t('{count} factura pasó su fecha de pago.', { count: cash.overdueCount })
        : t('{count} facturas pasaron su fecha de pago.', { count: cash.overdueCount }),
      cta: t('Cobrar'), onClick: () => go('/clients?filter=overdue'),
    }));
  }

  if (unread) {
    rows.push(actionCard({
      tone: 'brand', icon: 'chat',
      title: unread === 1 ? t('{count} mensaje sin leer', { count: unread }) : t('{count} mensajes sin leer', { count: unread }),
      text: t('Hay clientes esperando respuesta.'),
      cta: t('Abrir'), onClick: () => go('/messages'),
    }));
  }

  if (gaps.length) {
    rows.push(actionCard({
      tone: 'warn', icon: 'alert',
      title: `${plural(gaps.length, 'cliente por revisar', 'clientes por revisar')}`,
      text: t('Les falta ubicación o precio en su plan, así que no se les puede cobrar.'),
      cta: t('Revisar'), onClick: () => go('/clients?filter=gaps'),
    }));
  }

  if (!rows.length) {
    return card(h('div.row',
      h('span', { style: { color: 'var(--ok-500)' } }, icon('shield')),
      h('div.grow',
        h('div.w-600', t('Todo en orden')),
        h('div.t-sm.c-soft', t('Sin pendientes que requieran tu atención.')))));
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
  const when = { when: humanDelta(delta) };
  return `${plural(count, 'factura', 'facturas')} · ${delta < 0 ? t('venció {when}', when) : t('vence {when}', when)}`;
}
