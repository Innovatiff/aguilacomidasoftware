/**
 * Reportes — how the business did, over a span you pick.
 *
 * Everywhere else the panel answers "what do I do next". This screen answers
 * the question that only gets asked sitting down: *how did last month go.*
 *
 * It is built for one person in particular — the manager, who is not young,
 * reads it with her glasses on, and wants an answer rather than a dashboard.
 * Three rules follow from that, and they are worth stating because the first
 * version of this screen broke all three:
 *
 *   **One screen, one job.** The summary is the period, five figures and a way
 *   in to each list. Every list — who paid, who owes, who is behind, day by day
 *   — is its own screen, reached by a big row and left by the back chevron. A
 *   page with ten sections on it is a page nobody reads to the bottom.
 *
 *   **Big.** Larger type than the rest of the panel, more space between the
 *   rows, figures set at a size that is legible across a desk.
 *
 *   **Paper is one page.** The printed sheet is a different document — totals
 *   only, no list of anybody — so it is one sheet whether the kitchen serves
 *   seven people or seven hundred. The lists live here, on screen, for whoever
 *   wants to look.
 *
 * The period lives in the address, so the browser's own back button walks out
 * of a list to the summary and out of the summary to Inicio. It is written with
 * `replace` when only the period changes, so stepping back through a year does
 * not leave a year of history to press back through.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton, lifetime } from '../ui/shell.js';
import {
  card, button, avatar, itemRow, list, badge, searchInput,
  emptyState, skeletonRows, alert, dataErrorCard, field,
} from '../ui/kit.js';
import { sheet, toastBad } from '../ui/overlay.js';
import { columnChart } from '../ui/viz.js';
import { reportSheet } from '../ui/report-sheet.js';
import { printSheet } from '../ui/print.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { store, subscribe, activeClients, isReady } from '../data/store.js';
import { loadPeriod, forgetPeriod, cachedPeriod } from '../data/reports.js';
import { buildReport, freshen, debtWord, debtWhy } from '../lib/report.js';
import {
  GRAINS, rangeFor, shiftRange, customRange, rangeTitle, rangeSpan,
  bucketsOf, spanOf, rangeHolds, isFuture,
} from '../lib/periods.js';
import { today, addDays, formatDayShort, formatDay, humanDelta, daysBetween } from '../lib/dates.js';
import { money, number, plural, percent, matches } from '../lib/format.js';
import { paymentMethodMeta } from '../lib/model.js';

/** Plain words for the spans, in the order somebody actually asks for them. */
const WHEN = [
  { grain: 'day', label: 'Hoy' },
  { grain: 'week', label: 'Esta semana' },
  { grain: 'month', label: 'Este mes' },
  { grain: 'year', label: 'Este año' },
];

const BUCKET_WORD = { day: 'día', week: 'semana', month: 'mes' };

/* --- The period, read and kept current ------------------------------------- */

/**
 * What both screens need: the span, the documents behind it, and a report.
 *
 * Split out because the summary and every list are separate routes rendering
 * the same numbers, and two copies of "read the period" is two places for them
 * to disagree about what a month is.
 *
 * `paint` is handed the view rather than reaching for it through a variable of
 * the caller's. The first paint happens inside this call — `subscribe` fires
 * immediately — so a caller writing `const view = periodView(…, () => draw())`
 * would be painting a screen whose `view` is still in its dead zone. That has
 * been the shape of three separate bugs in this codebase; making it impossible
 * costs one parameter.
 *
 * @param {object} [state] a bag the caller keeps across paints — a search term.
 */
function periodView(context, paint, state = {}) {
  const life = lifetime();
  const range = fromQuery(context.query);
  let docs = cachedPeriod(range);
  let failure = null;
  let loading = !docs;

  function read({ fresh = false } = {}) {
    if (fresh) forgetPeriod(range);
    const held = fresh ? null : cachedPeriod(range);
    if (held) { docs = held; loading = false; failure = null; return; }

    docs = null;
    loading = true;
    failure = null;

    loadPeriod(range, { fresh })
      .then((found) => {
        // The screen may be gone by the time Firestore answers; painting then
        // would write over whatever the reader moved on to.
        if (!life.alive()) return;
        docs = found;
        loading = false;
        paint(api);
      })
      .catch((error) => {
        if (!life.alive()) return;
        failure = error;
        loading = false;
        paint(api);
      });
  }

  function report() {
    if (!docs) return null;
    // What was read, plus everything the panel has seen since — a payment taken
    // while this screen is open is already in the store's live till.
    const now = freshen(docs, { receipts: store.receipts, invoices: store.outstanding }, range);

    return buildReport({
      range,
      receipts: now.receipts,
      invoices: now.invoices,
      clients: store.clients,
      outstanding: store.outstanding,
      buckets: bucketsOf(range),
      activeCount: activeClients().length,
      pricing: store.pricing,
      day: today(),
    });
  }

  const api = {
    range,
    state,
    report,
    ready: () => !loading && !!docs && isReady(),
    failure: () => failure,
    reload: () => { read({ fresh: true }); paint(api); },
    repaint: () => paint(api),
  };

  read();
  return life.ending(subscribe(() => paint(api)));
}

/* --- The summary ------------------------------------------------------------ */

export const renderReport = (context) => periodView(context, drawSummary);

function drawSummary(view) {
  const report = view.report();

  screen({
    title: 'Reportes',
    subtitle: rangeTitle(view.range),
    backTo: '/',
    tab: 'home',
    sunken: true,
    actions: [topbarButton('refresh', { label: 'Volver a leer', onClick: view.reload })],
    body: h('div.page__inner.rbig.stack.stack-5',
      picker(view.range),
      view.failure()
        ? dataErrorCard(view.failure(), { onRetry: view.reload })
        : view.ready() && report ? summary(report) : skeletonRows(4)),
  });
}

/** The money, the lists, and the print button. Nothing else. */
function summary(report) {
  const { money: cash, counts, standing, range } = report;

  return h('div.stack.stack-5',
    takings(report),

    h('div.rgrid',
      smallBox('Se facturó', money(cash.billed, { round: true }),
        `${plural(counts.bills, 'factura', 'facturas')} de este periodo`),
      smallBox(debtWord(cash.change), money(Math.abs(cash.change), { round: true }),
        debtWhy(cash.change)),
      smallBox('Deben hoy', money(standing.owed, { round: true }),
        `${plural(standing.debtors.length, 'cliente', 'clientes')} · `
        + `${money(standing.overdue, { round: true })} vencido`, 'warn')),

    counts.refunds
      ? alert(`${counts.refunds === 1 ? 'Se canceló' : 'Se cancelaron'} `
        + `${plural(counts.refunds, 'pago', 'pagos')} por ${money(Math.abs(cash.refunds))}. `
        + 'Ya está descontado de lo que se cobró.', 'warn', 'alert')
      : null,

    report.pricingChanged
      ? alert(`Los precios cambiaron el ${formatDayShort(report.pricingChanged.date)}`
        + `${report.pricingChanged.byName ? `, los cambió ${report.pricingChanged.byName}` : ''}. `
        + 'Las facturas de antes de ese día conservan el precio que tenían.', 'info', 'info')
      : null,

    h('div.stack.stack-3',
      h('h2.rhead', 'Ver las listas'),
      h('div.rmenu', LIST_ORDER
        .map((key) => ({ key, ...LISTS[key] }))
        .filter((entry) => entry.count(report) > 0 || !entry.onlyWhenSome)
        .map((entry) => h('a.rmenu__item', { href: `#${urlFor(range, entry.key)}` },
          h('span.rmenu__ico', icon(entry.icon)),
          h('span.rmenu__main',
            h('span.rmenu__t', entry.title),
            h('span.rmenu__s', entry.note(report))),
          icon('chevronR', 'rmenu__chev'))))),

    h('div.stack.stack-2',
      button('Imprimir esta hoja', {
        variant: 'primary', size: 'lg', block: true, icon: 'printer',
        onClick: () => printReport(report),
      }),
      h('p.rfoot',
        'Sale en una sola hoja tamaño carta, con los totales de este periodo. '
        + 'Las listas de personas se quedan aquí en la pantalla.')));
}

/** The one figure the screen exists for, set as large as it deserves. */
function takings(report) {
  const { money: cash, counts } = report;
  const of = (key) => report.methods.find((m) => m.key === key)?.takings || 0;
  const others = report.methods
    .filter((m) => m.key !== 'cash' && m.key !== 'debit')
    .reduce((total, m) => total + m.takings, 0);

  return h('div.rmoney',
    h('div.rmoney__k', rangeHolds(report.range) ? 'Se ha cobrado' : 'Se cobró'),
    h('div.rmoney__v', money(cash.collected, { round: true })),
    h('div.rmoney__n', counts.payments
      ? `${plural(counts.payments, 'pago', 'pagos')} de ${plural(counts.payers, 'persona', 'personas')}`
      : 'No se recibió ningún pago'),

    // Cash against card: the two figures the counter is squared with at the end
    // of the day, and the reason the kitchen started recording how people pay.
    cash.takings > 0
      ? h('div.rmoney__split',
          tillCell('Efectivo', of('cash'), cash.takings),
          tillCell('Débito', of('debit'), cash.takings),
          others ? tillCell('Otras formas', others, cash.takings) : null)
      : null);
}

const tillCell = (label, amount, whole) => h('div.rcell',
  h('div.rcell__k', label),
  h('div.rcell__v', money(amount, { round: true })),
  h('div.rcell__n', `${percent(amount, whole)}% de lo que entró`));

const smallBox = (label, value, note, tone) =>
  h(`div.rbox${tone ? `.rbox--${tone}` : ''}`,
    h('div.rbox__k', label),
    h('div.rbox__v', value),
    h('div.rbox__n', note));

/* --- Choosing the span ------------------------------------------------------ */

function picker(range) {
  const ahead = isFuture(shiftRange(range, 1));
  // Changing the span keeps the day you are looking at, so "este mes" from a
  // week in March is March, not today.
  const anchor = () => (rangeHolds(range) ? today() : range.start);

  return h('div.rwhen',
    h('h2.rhead', '¿Qué quieres ver?'),
    h('div.rwhen__opts',
      WHEN.map((option) => h(
        `button.ropt${range.grain === option.grain ? '.is-active' : ''}`,
        { type: 'button', onclick: () => open(rangeFor(option.grain, anchor())) },
        option.label)),
      h(`button.ropt${range.grain === 'custom' ? '.is-active' : ''}`,
        { type: 'button', onclick: () => pickDates(range) }, 'Otras fechas')),

    h('div.rper',
      h('button.rper__nav', {
        type: 'button', 'aria-label': 'El periodo anterior',
        onclick: () => open(shiftRange(range, -1)),
      }, icon('chevronL')),

      h('button.rper__now', {
        type: 'button',
        'aria-label': 'Regresar al periodo de ahora',
        onclick: () => open(nowLike(range)),
      },
        h('span.rper__t', rangeTitle(range)),
        h('span.rper__s', `${rangeSpan(range)}${rangeHolds(range) ? ' · en curso' : ''}`)),

      h('button.rper__nav', {
        type: 'button', 'aria-label': 'El periodo siguiente',
        disabled: ahead,
        onclick: () => open(shiftRange(range, 1)),
      }, icon('chevronR'))));
}

/**
 * Moves to another period.
 *
 * `replace`, so walking six months back leaves one history entry rather than
 * six — the back button has to mean "salir del reporte", not "deshacer el
 * último clic seis veces".
 */
const open = (range) => go(urlFor(range), { replace: true });

/** The same shape of span, ending now. */
function nowLike(range) {
  if (range.grain !== 'custom') return rangeFor(range.grain);
  return customRange(addDays(today(), -(spanOf(range) - 1)), today());
}

async function pickDates(range) {
  const from = h('input.input.input--big', { type: 'date', value: range.start, max: today() });
  const to = h('input.input.input--big', { type: 'date', value: range.end, max: today() });
  const note = h('p.t-sm.c-soft');

  /*
   * How long a span they have chosen, live.
   *
   * Not a limit: every period read here reads the payments and bills inside it,
   * and only the reader knows whether they meant three years. Saying the size
   * of the question before it is asked is what lets somebody notice they typed
   * 2020 instead of 2026.
   */
  const measure = () => {
    if (!from.value || !to.value) { note.textContent = ''; return; }
    const picked = customRange(from.value, to.value);
    note.textContent = `Son ${plural(spanOf(picked), 'día', 'días')}: ${rangeSpan(picked)}.`;
  };
  from.addEventListener('change', measure);
  to.addEventListener('change', measure);
  measure();

  const picked = await sheet({
    title: 'Escoge las fechas',
    build: (close) => h('div.stack.stack-4',
      field({ label: 'Desde el día', control: from }),
      field({ label: 'Hasta el día', control: to }),
      note,
      button('Ver este periodo', {
        variant: 'primary', size: 'lg', block: true, onClick: () => close([from.value, to.value]),
      })),
  });

  if (!picked) return;
  const [start, end] = picked;
  if (!start || !end) { toastBad('Faltan las fechas.'); return; }
  open(customRange(start, end));
}

/* --- Paper ------------------------------------------------------------------ */

function printReport(report) {
  if (!report) { toastBad('Todavía se está leyendo el periodo.'); return; }
  printSheet(reportSheet(report, {
    business: store.business,
    by: session.displayName || session.email || '',
  }));
}

/* --- The lists -------------------------------------------------------------- */

/**
 * Each list is its own screen.
 *
 * Which means each one gets the whole width, a search box when it needs one,
 * and a back chevron that goes exactly one place. On the summary they are seven
 * rows with a count on each, which is a menu — and a menu is the one long thing
 * that is easy to read.
 */
const LISTS = {
  pagaron: {
    title: 'Quién pagó',
    unit: ['persona', 'personas'],
    icon: 'wallet',
    count: (r) => r.payers.length,
    note: (r) => (r.payers.length
      ? `${plural(r.payers.length, 'persona pagó', 'personas pagaron')} en este periodo`
      : 'Nadie pagó en este periodo'),
    empty: { icon: 'wallet', title: 'Nadie pagó en este periodo', text: 'Prueba con otro periodo arriba.' },
    search: (row) => [row.name, row.farmName],
    rows: (r) => r.payers,
    render: (row) => itemRow({
      lead: avatar(row.name, { size: 'sm' }),
      title: row.name,
      meta: [row.farmName, row.count > 1 ? plural(row.count, 'pago', 'pagos') : null,
        row.last ? `el ${formatDay(row.last)}` : null,
        // Said on the row rather than taken off the figure beside it: money
        // given back is a different event from money handed over.
        row.refunds ? `se le regresaron ${money(Math.abs(row.refunds))}` : null,
      ].filter(Boolean).join(' · '),
      end: h('div.rlist__money', money(row.amount, { round: true })),
      chevron: !!row.clientId,
      onClick: () => row.clientId && go(`/clients/${row.clientId}`),
    }),
  },

  deben: {
    title: 'Quién debe',
    unit: ['cliente', 'clientes'],
    icon: 'users',
    count: (r) => r.standing.debtors.length,
    note: (r) => (r.standing.debtors.length
      ? `${plural(r.standing.debtors.length, 'cliente debe', 'clientes deben')} `
        + `${money(r.standing.owed, { round: true })} al día de hoy`
      : 'Nadie debe nada'),
    empty: { icon: 'shield', title: 'Nadie debe nada', text: 'Todas las facturas emitidas están pagadas.' },
    head: () => 'Esto no es del periodo: es lo que se debe en este momento, de cualquier fecha.',
    search: (row) => [row.name, row.farmName],
    rows: (r) => r.standing.debtors,
    render: (row) => itemRow({
      lead: avatar(row.name, { size: 'sm' }),
      title: row.name,
      meta: [row.farmName, plural(row.bills, 'factura', 'facturas')].filter(Boolean).join(' · '),
      end: [
        h('div.rlist__money', money(row.balance, { round: true })),
        row.late ? badge('Atrasado', 'bad') : null,
      ],
      onClick: () => go(`/clients/${row.clientId}`),
    }),
  },

  atrasados: {
    title: 'Quién está atrasado',
    unit: ['cliente', 'clientes'],
    icon: 'alert',
    count: (r) => r.standing.late.length,
    note: (r) => (r.standing.late.length
      ? `${plural(r.standing.late.length, 'cliente pasó', 'clientes pasaron')} su fecha de pago`
      : 'Nadie está atrasado'),
    empty: { icon: 'shield', title: 'Nadie está atrasado', text: 'Nadie ha pasado su fecha de pago.' },
    head: () => 'Al día de hoy. Los más viejos primero.',
    search: (row) => [row.name, row.farmName],
    rows: (r) => r.standing.late,
    render: (row) => itemRow({
      lead: avatar(row.name, { size: 'sm' }),
      title: row.name,
      meta: [row.farmName, `venció ${humanDelta(daysBetween(today(), row.oldest))}`]
        .filter(Boolean).join(' · '),
      end: h('div.rlist__money.c-bad', money(row.lateBalance, { round: true })),
      onClick: () => go(`/clients/${row.clientId}`),
    }),
  },

  ranchos: {
    title: 'Por rancho',
    unit: ['rancho', 'ranchos'],
    icon: 'farm',
    count: (r) => r.farms.length,
    note: (r) => `Cuánto entró de cada uno de los ${number(r.farms.length)} ranchos`,
    empty: { icon: 'farm', title: 'Sin movimiento por rancho', text: 'No hubo pagos ni facturas en este periodo.' },
    rows: (r) => r.farms,
    render: (row) => itemRow({
      lead: h('span.c-faint', icon('farm')),
      title: row.name,
      meta: `${plural(row.payers, 'persona pagó', 'personas pagaron')} · `
        + `${money(row.billed, { round: true })} facturado`,
      end: h('div.rlist__money', money(row.collected, { round: true })),
      chevron: !!row.farmId,
      onClick: () => row.farmId && go(`/farms/${row.farmId}`),
    }),
  },

  dias: {
    title: 'Día por día',
    // Named after whatever the period is cut into, which is days for a month
    // and months for a year.
    unit: (r) => (BUCKET_WORD[r.buckets[0]?.grain] === 'mes'
      ? ['mes', 'meses']
      : [BUCKET_WORD[r.buckets[0]?.grain] || 'día', `${BUCKET_WORD[r.buckets[0]?.grain] || 'día'}s`]),
    icon: 'chart',
    // A single day has nothing to compare against itself, so the row does not
    // appear on the menu at all rather than opening an empty list.
    count: (r) => (r.buckets.length > 1 ? r.buckets.length : 0),
    onlyWhenSome: true,
    note: (r) => `Cómo fue cada ${BUCKET_WORD[r.buckets[0]?.grain] || 'día'} del periodo`,
    empty: { icon: 'chart', title: 'Un solo día', text: 'Este periodo es un día; no hay nada que comparar.' },
    chart: true,
    rows: (r) => (r.buckets.length > 1
      ? r.buckets.filter((row) => row.amount || row.billed || row.count)
      : []),
    render: (row) => itemRow({
      title: row.label,
      meta: row.count
        ? `${plural(row.count, 'pago', 'pagos')}${row.billed ? ` · ${money(row.billed, { round: true })} facturado` : ''}`
        : (row.billed ? `${money(row.billed, { round: true })} facturado` : 'Sin pagos'),
      end: h('div.rlist__money', money(row.amount, { round: true })),
      chevron: false,
    }),
  },

  movimientos: {
    title: 'Todos los movimientos',
    unit: ['movimiento', 'movimientos'],
    icon: 'receipt',
    count: (r) => r.movements.length,
    note: (r) => (r.movements.length
      ? `${plural(r.movements.length, 'pago', 'pagos')} uno por uno, con su folio`
      : 'No hubo movimientos'),
    empty: { icon: 'receipt', title: 'No hubo movimientos', text: 'No se registró ningún pago en este periodo.' },
    search: (row) => [row.clientName, row.folio, row.takenByName, row.farmName],
    rows: (r) => r.movements,
    render: (row) => {
      const back = Number(row.amount) < 0;
      return itemRow({
        lead: avatar(row.clientName || '—', { size: 'sm' }),
        title: row.clientName || 'Sin cliente',
        meta: `${formatDay(row.date)} · ${paymentMethodMeta(row.method).label}`
          + `${row.takenByName ? ` · cobró ${row.takenByName}` : ''}`
          + `${row.folio ? ` · ${row.folio}` : ''}`,
        end: [
          h(`div.rlist__money${back ? '.c-bad' : ''}`,
            `${back ? '−' : ''}${money(Math.abs(Number(row.amount) || 0), { round: true })}`),
          back ? badge('Cancelado', 'bad') : null,
        ],
        onClick: () => go(`/receipts/${row.id}`),
      });
    },
  },

  ajustes: {
    title: 'Ajustes de saldo',
    unit: ['ajuste', 'ajustes'],
    icon: 'edit',
    count: (r) => r.corrections.length,
    onlyWhenSome: true,
    note: (r) => `${plural(r.corrections.length, 'cuenta se corrigió', 'cuentas se corrigieron')} a mano`,
    empty: { icon: 'edit', title: 'Sin ajustes', text: 'Nadie cambió un saldo a mano en este periodo.' },
    head: () => 'Cambios hechos a las facturas de este periodo, con el motivo que se escribió.',
    rows: (r) => r.corrections,
    render: (row) => itemRow({
      lead: avatar(row.clientName, { size: 'sm' }),
      title: row.clientName,
      meta: `${row.note || 'Sin motivo'} · ${row.byName || 'sin registrar'} · ${formatDay(row.date)}`,
      end: [
        h(`div.rlist__money${row.delta > 0 ? '' : '.c-ok'}`,
          `${row.delta > 0 ? '+' : '−'}${money(Math.abs(row.delta), { round: true })}`),
        badge(`${money(row.from, { round: true })} → ${money(row.to, { round: true })}`, 'muted'),
      ],
      onClick: () => go(`/invoices/${row.invoiceId}`),
    }),
  },
};

/** The order they appear in the menu: what came in, then who owes, then detail. */
const LIST_ORDER = ['pagaron', 'deben', 'atrasados', 'dias', 'ranchos', 'movimientos', 'ajustes'];

/** How many rows before the list offers a search box. */
const SEARCH_FROM = 8;

export const renderReportList = (context) =>
  periodView(context, drawList, { which: context.params.lista, term: '' });

function drawList(view) {
  const spec = LISTS[view.state.which];
  const report = view.report();

  screen({
    title: spec ? spec.title : 'Lista',
    subtitle: rangeTitle(view.range),
    // The way back is the report on the same period, so the chevron out of a
    // list never loses the span somebody chose to get here.
    backTo: urlFor(view.range),
    tab: 'home',
    sunken: true,
    body: h('div.page__inner.rbig.stack.stack-4',
      !spec
        ? emptyState({
            icon: 'search', title: 'Esta lista no existe',
            text: 'Regresa al reporte y escoge una de la lista.',
            action: button('Ir al reporte', { onClick: () => go(urlFor(view.range)) }),
          })
        : view.failure()
          ? dataErrorCard(view.failure(), { onRetry: view.reload })
          : view.ready() && report ? listBody(view, spec, report) : skeletonRows(5)),
  });
}

function listBody(view, spec, report) {
  const { state, range } = view;
  const all = spec.rows(report);
  const shown = state.term && spec.search
    ? all.filter((row) => matches(spec.search(row), state.term))
    : all;

  return h('div.stack.stack-4',
    spec.head ? h('p.rnote', spec.head(report)) : null,

    spec.chart && report.buckets.length > 1
      ? card(columnChart(report.buckets, {
          today: rangeHolds(range) ? today() : null,
          tick: (row) => row.short,
          label: (row) => row.label,
          axis: [report.buckets[0].label, report.buckets[report.buckets.length - 1].label],
        }))
      : null,

    all.length >= SEARCH_FROM && spec.search
      ? searchInput({
          placeholder: 'Buscar por nombre…',
          value: state.term,
          onInput: (value) => { state.term = value; refresh(view, spec, report); },
        })
      : null,

    all.length
      ? h('div.stack.stack-2',
          h('p.rcount', state.term
            ? `${plural(shown.length, 'resultado', 'resultados')} de ${all.length}`
            : plural(all.length, ...(typeof spec.unit === 'function' ? spec.unit(report) : spec.unit))),
          shown.length
            ? list(shown.map(spec.render), { card: true })
            : emptyState({ icon: 'search', title: 'Nada con ese nombre', text: 'Prueba escribiendo menos letras.' }))
      : emptyState(spec.empty),

    button('Regresar al reporte', {
      variant: 'ghost', size: 'lg', block: true, icon: 'chevronL',
      onClick: () => go(urlFor(range)),
    }));
}

/**
 * Redraws the list alone while somebody is typing in the search box.
 *
 * A full `screen()` would rebuild the box and take the caret with it, which on
 * a long name means retyping from the third letter. Only the page body is
 * replaced, and the caret is put back where it was.
 */
function refresh(view, spec, report) {
  const host = document.querySelector('.page__inner.rbig');
  if (!host) { view.repaint(); return; }
  const box = host.querySelector('input[type="search"]');
  const caret = box ? box.selectionStart : null;

  host.replaceChildren(listBody(view, spec, report));

  const next = host.querySelector('input[type="search"]');
  if (next && box) {
    next.focus();
    if (caret != null) next.setSelectionRange(caret, caret);
  }
}

/* --- Addresses -------------------------------------------------------------- */

/**
 * Where a period lives.
 *
 * In the address rather than in a closure, so the browser's own back button
 * does the right thing: out of a list to the summary, out of the summary to
 * Inicio. A link in may choose the period — Inicio's "cobrado hoy" arrives
 * asking for today.
 */
function urlFor(range, list) {
  const base = list ? `/reportes/${list}` : '/reportes';
  const query = range.grain === 'custom'
    ? `p=custom&d=${range.start}&h=${range.end}`
    : `p=${range.grain}&d=${range.start}`;
  return `${base}?${query}`;
}

function fromQuery(query = {}) {
  const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  const anchor = isDay(query.d) ? query.d : today();
  if (query.p === 'custom' && isDay(query.h)) return customRange(anchor, query.h);
  // A month by default: the span somebody sitting down to read a report has in
  // mind, and a twelfth of the reading a year would cost on an idle open.
  return rangeFor(GRAINS.includes(query.p) ? query.p : 'month', anchor);
}
