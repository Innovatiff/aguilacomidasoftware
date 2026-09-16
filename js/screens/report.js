/**
 * Reportes — what the business did, over a span you choose.
 *
 * Everywhere else the panel answers "what do I do next": who owes, who eats
 * today, who is at the counter. This screen answers the other question, the one
 * that only gets asked sitting down — *how did last month go* — and it is the
 * only screen that can, because it is the only one that reads outside the
 * window of documents the app keeps live.
 *
 * Three things shape it:
 *
 *   **The period is the control.** Day, week, month, year, or two dates typed
 *   in. Everything on the page is that span and nothing else, so there is never
 *   a figure on screen whose period the reader has to work out.
 *
 *   **Flow and stock are kept apart.** What came in, what was billed, what was
 *   written off — those belong to the period. What is owed right now does not;
 *   it is today's photograph, it sits in its own section at the bottom, and it
 *   says so. Putting them in the same row of tiles is how a report ends up
 *   claiming a month collected money that arrived in a different one.
 *
 *   **Paper is the point.** Half of why this exists is to be printed and filed,
 *   so the printed sheet is not a screenshot of this screen — it is its own
 *   document, in `ui/report-sheet.js`, and it leaves out the payment-by-payment
 *   ledger that is useful to scroll and useless to carry.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton, lifetime } from '../ui/shell.js';
import {
  card, stat, statGrid, button, badge, avatar, itemRow, list, chips, meter,
  sectionLabel, emptyState, skeletonRows, alert, dataErrorCard, defList, defRow, field,
} from '../ui/kit.js';
import { sheet, toastBad } from '../ui/overlay.js';
import { columnChart } from '../ui/viz.js';
import { reportSheet } from '../ui/report-sheet.js';
import { printSheet } from '../ui/print.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { store, subscribe, activeClients, isReady } from '../data/store.js';
import { loadPeriod, forgetPeriod, cachedPeriod } from '../data/reports.js';
import { buildReport } from '../lib/report.js';
import {
  GRAINS, GRAIN_LABEL, rangeFor, shiftRange, customRange, rangeTitle, rangeSpan,
  bucketsOf, spanOf, rangeHolds, isFuture,
} from '../lib/periods.js';
import { today, addDays, formatDayShort } from '../lib/dates.js';
import { money, number, plural, percent } from '../lib/format.js';
import { paymentMethodMeta } from '../lib/model.js';

/** How many rows a long list shows before it asks to be opened. */
const PREVIEW = 12;

export function renderReport(context) {
  const life = lifetime();

  // The period is held here rather than in the address bar. A screen whose
  // state lives in the hash re-mounts on every change — twelve teardowns to
  // walk back through a year — and this one has an async read behind it that
  // must not be started twice. A link *in* may still choose the period, which
  // is how the dashboard's "cobrado hoy" arrives asking for today.
  let range = fromQuery(context.query);
  let docs = cachedPeriod(range);
  let failure = null;
  let loading = !docs;
  let showAllPayers = false;
  let showAllMoves = false;

  read();

  /** Reads the period, unless it is already in hand. */
  function read({ fresh = false } = {}) {
    const wanted = range;
    if (fresh) forgetPeriod(wanted);

    const held = fresh ? null : cachedPeriod(wanted);
    if (held) { docs = held; loading = false; failure = null; return; }

    docs = null;
    loading = true;
    failure = null;

    loadPeriod(wanted, { fresh })
      .then((found) => {
        // Two guards, and both have bitten this project before: the screen may
        // be gone by the time Firestore answers, and the reader may have moved
        // to another period while this one was in flight. Either way the answer
        // is stale and painting it would overwrite what is actually on screen.
        if (!life.alive() || wanted !== range) return;
        docs = found;
        loading = false;
        draw();
      })
      .catch((error) => {
        if (!life.alive() || wanted !== range) return;
        failure = error;
        loading = false;
        draw();
      });
  }

  function setRange(next) {
    range = next;
    showAllPayers = false;
    showAllMoves = false;
    read();
    draw();
  }

  /* --- The report, from the documents plus what is already in memory ------ */

  function compute() {
    if (!docs) return null;
    return buildReport({
      range,
      receipts: docs.receipts,
      invoices: docs.invoices,
      clients: store.clients,
      outstanding: store.outstanding,
      buckets: bucketsOf(range),
      activeCount: activeClients().length,
      pricing: store.pricing,
      day: today(),
    });
  }

  function draw() {
    const report = compute();

    screen({
      title: 'Reportes',
      subtitle: rangeTitle(range),
      backTo: '/',
      tab: 'home',
      sunken: true,
      actions: [
        topbarButton('refresh', { label: 'Volver a leer', onClick: () => { read({ fresh: true }); draw(); } }),
        topbarButton('printer', { label: 'Imprimir', onClick: () => print(report) }),
      ],
      sticky: picker(),
      body: failure
        ? h('div.page__inner', dataErrorCard(failure, { onRetry: () => { read({ fresh: true }); draw(); } }))
        : (loading || !report || !isReady())
          ? h('div.page__inner', skeletonRows(6))
          : body(report),
    });
  }

  /* --- Choosing the span --------------------------------------------------- */

  function picker() {
    const ahead = isFuture(shiftRange(range, 1));

    return h('div.searchbar.searchbar--sunken.stack.stack-2',
      chips(
        [...GRAINS.map((grain) => ({ value: grain, label: GRAIN_LABEL[grain] })),
          { value: 'custom', label: GRAIN_LABEL.custom }],
        range.grain,
        (value) => (value === 'custom' ? pickDates() : setRange(rangeFor(value, anchorFor()))),
      ),

      h('div.rper',
        h('button.rper__nav', {
          type: 'button', 'aria-label': 'Periodo anterior',
          onclick: () => setRange(shiftRange(range, -1)),
        }, icon('chevronL')),

        // The middle is a button too: pressed, it comes back to the period we
        // are living in. Walking six months back and then having to press the
        // other arrow six times is the kind of small cruelty that makes people
        // stop using a screen.
        h('button.rper__now', {
          type: 'button',
          onclick: () => setRange(nowRange()),
        },
          h('span.rper__t', rangeTitle(range)),
          h('span.rper__s', `${rangeSpan(range)} · ${plural(spanOf(range), 'día', 'días')}`
            + (rangeHolds(range) ? ' · en curso' : ''))),

        h('button.rper__nav', {
          type: 'button', 'aria-label': 'Periodo siguiente',
          disabled: ahead,
          onclick: () => setRange(shiftRange(range, 1)),
        }, icon('chevronR'))));
  }

  /** Keeps the day you are looking at when you change the size of the window. */
  function anchorFor() {
    return rangeHolds(range) ? today() : range.start;
  }

  /**
   * The same shape of period, ending now.
   *
   * A hand-picked span slides up to today keeping its length rather than
   * turning back into a month: somebody looking at an eighty-day stretch and
   * pressing "come back" means the last eighty days, not September.
   */
  function nowRange() {
    if (range.grain !== 'custom') return rangeFor(range.grain);
    return customRange(addDays(today(), -(spanOf(range) - 1)), today());
  }

  async function pickDates() {
    const from = h('input.input', { type: 'date', value: range.start, max: today() });
    const to = h('input.input', { type: 'date', value: range.end, max: today() });
    const note = h('p.t-xs.c-faint');

    /*
     * How long a span they have chosen, live.
     *
     * Not a limit and not a warning: every period on this screen reads the
     * payments and bills inside it, and the reader is the only one who knows
     * whether they meant three years. Saying the size of the question before it
     * is asked is what lets somebody notice they typed 2020 instead of 2026 —
     * this panel has been taken off the air for a day by a read nobody intended.
     */
    const measure = () => {
      if (!from.value || !to.value) { note.textContent = ''; return; }
      const picked = customRange(from.value, to.value);
      const days = spanOf(picked);
      note.textContent = `${rangeSpan(picked)} · ${plural(days, 'día', 'días')}`
        + (days > 400 ? '. Es un periodo largo: se leen todos los pagos y facturas de esos días.' : '.');
    };
    from.addEventListener('change', measure);
    to.addEventListener('change', measure);
    measure();

    const picked = await sheet({
      title: 'Periodo personalizado',
      build: (close) => h('div.stack.stack-4',
        field({ label: 'Desde', control: from }),
        field({ label: 'Hasta', control: to }),
        note,
        h('p.t-xs.c-faint', 'Cualquier par de fechas. Las flechas después mueven el periodo '
          + 'completo hacia atrás o hacia adelante, del mismo tamaño.'),
        button('Ver el periodo', {
          variant: 'primary', block: true, onClick: () => close([from.value, to.value]),
        })),
    });

    if (!picked) return;
    const [start, end] = picked;
    if (!start || !end) { toastBad('Faltan las fechas.'); return; }
    setRange(customRange(start, end));
  }

  /* --- Paper --------------------------------------------------------------- */

  function print(report) {
    if (!report) { toastBad('Todavía se está leyendo el periodo.'); return; }
    printSheet(reportSheet(report, {
      business: store.business,
      by: session.displayName || session.email || '',
    }));
  }

  /* --- The page ------------------------------------------------------------ */

  function body(report) {
    const { money: cash, counts, standing, people, days } = report;

    return h('div.page__inner.page__inner--flow.stack.stack-4',
      h('div.span-all', hero(cash, report)),

      h('div.span-all.stack.stack-3',
        sectionLabel('Cómo entró el dinero'),
        methodCard(report)),

      h('div.span-all.stack.stack-3',
        sectionLabel('El periodo en números'),
        statGrid([
          stat({
            label: 'Pagos recibidos',
            value: number(counts.payments),
            foot: counts.payers
              ? `${plural(counts.payers, 'persona', 'personas')}`
              : 'Nadie pagó',
          }),
          stat({
            label: 'Facturas emitidas',
            value: number(counts.bills),
            foot: counts.billedClients
              ? `${plural(counts.billedClients, 'cliente', 'clientes')}`
              : 'Ninguna',
          }),
          stat({
            label: 'Comidas facturadas',
            value: number(counts.meals),
            foot: `${plural(people.active, 'cliente activo', 'clientes activos')} hoy`,
          }),
          stat({
            label: 'Promedio por día',
            value: money(days.elapsed ? cash.collected / days.elapsed : 0, { round: true }),
            foot: days.running
              ? `${plural(days.elapsed, 'día', 'días')} de ${days.span}`
              : `${plural(days.span, 'día', 'días')} en el periodo`,
          }),
        ], 4)),

      report.pricingChanged
        ? h('div.span-all', alert(
            `Los precios cambiaron el ${formatDayShort(report.pricingChanged.date)}`
            + `${report.pricingChanged.byName ? `, los cambió ${report.pricingChanged.byName}` : ''}. `
            + 'Las facturas de antes de ese día conservan el precio que tenían.',
            'info', 'info'))
        : null,

      counts.refunds
        ? h('div.span-all', alert(
            `${plural(counts.refunds, 'pago cancelado', 'pagos cancelados')} en este periodo, `
            + `por ${money(Math.abs(cash.refunds))}. Ya está descontado de lo cobrado.`,
            'warn', 'alert'))
        : null,

      report.buckets.length > 1
        ? h('div.span-all.stack.stack-3',
            sectionLabel('Cobrado por ' + BUCKET_WORD[report.buckets[0].grain],
              h('span.t-xs.c-faint', rangeSpan(range))),
            card(h('div.stack.stack-2',
              columnChart(report.buckets, {
                today: rangeHolds(range) ? today() : null,
                tick: (row) => row.short,
                label: (row) => row.label,
                axis: [report.buckets[0].label, report.buckets[report.buckets.length - 1].label],
              }),
              h('p.t-xs.c-faint',
                `Pasa el dedo o el ratón por una barra para ver ese ${BUCKET_WORD[report.buckets[0].grain]}.`))))
        : null,

      report.farms.length
        ? h('div.stack.stack-3', sectionLabel('Por rancho'), farmTable(report))
        : null,

      h('div.stack.stack-3',
        sectionLabel('Quién pagó', report.payers.length > PREVIEW
          ? h('button.btn.btn--quiet.btn--sm', {
              type: 'button', onclick: () => { showAllPayers = !showAllPayers; draw(); },
            }, showAllPayers ? 'Ver menos' : `Ver los ${report.payers.length}`)
          : null),
        payerList(report)),

      report.cashiers.length > 1
        ? h('div.stack.stack-3', sectionLabel('Quién cobró'), cashierCard(report))
        : null,

      report.corrections.length
        ? h('div.span-all.stack.stack-3',
            sectionLabel('Ajustes de saldo',
              h('span.t-xs.c-faint', 'Facturas de este periodo')),
            correctionList(report))
        : null,

      /* The ledger. On screen only — the printed sheet leaves it out. */
      report.movements.length
        ? h('div.span-all.stack.stack-3',
            sectionLabel('Movimientos', report.movements.length > 20
              ? h('button.btn.btn--quiet.btn--sm', {
                  type: 'button', onclick: () => { showAllMoves = !showAllMoves; draw(); },
                }, showAllMoves ? 'Ver menos' : `Ver los ${report.movements.length}`)
              : null),
            movementList(report),
            h('p.t-xs.c-faint', 'Los pagos uno por uno se quedan en esta pantalla: '
              + 'la hoja impresa lleva los totales y la lista de quién pagó.'))
        : null,

      /* --- Today, and said so ---------------------------------------------- */
      h('div.span-all.stack.stack-3',
        sectionLabel('Al día de hoy', h('span.t-xs.c-faint', formatDayShort(today()))),
        h('p.t-xs.c-faint', { style: { marginTop: '-4px' } },
          'Esto no es del periodo: es lo que se debe en este momento, de cualquier fecha.'),
        statGrid([
          stat({
            label: 'Por cobrar',
            value: money(standing.owed, { round: true }),
            foot: `${plural(standing.debtors.length, 'cliente debe', 'clientes deben')}`,
            tone: standing.owed > 0 ? 'accent' : 'ok',
            onClick: () => go('/billing'),
          }),
          stat({
            label: 'Vencido',
            value: money(standing.overdue, { round: true }),
            foot: standing.overdueCount
              ? `${plural(standing.overdueCount, 'factura', 'facturas')}`
              : 'Ninguna',
            tone: standing.overdue > 0 ? 'bad' : 'ok',
            onClick: () => go('/clients?filter=overdue'),
          }),
        ]),
        standing.debtors.length
          ? h('div.stack.stack-2',
              debtorList(standing.debtors.slice(0, 5)),
              standing.debtors.length > 5
                ? h('button.btn.btn--quiet.btn--sm.btn--block', {
                    type: 'button', onclick: () => go('/clients?filter=debt'),
                  }, `Ver los ${standing.debtors.length} que deben`)
                : null,
              h('p.t-xs.c-faint.center',
                'La hoja impresa trae la lista completa de quién debe.'))
          : null),

      h('div.span-all',
        button('Imprimir el reporte', {
          variant: 'primary', block: true, icon: 'printer', onClick: () => print(report),
        })),
      h('div.span-all',
        h('p.t-xs.c-faint.center',
          `Se imprime en hoja tamaño carta. Desde el mismo cuadro de diálogo se puede `
          + `guardar como PDF.`)));
  }

  /* --- Pieces -------------------------------------------------------------- */

  function hero(cash, report) {
    const up = cash.change > 0.005;
    const flat = Math.abs(cash.change) <= 0.005;

    return h('div.hero',
      h('div.hero__eyebrow', rangeHolds(range) ? 'Cobrado en el periodo (en curso)' : 'Cobrado en el periodo'),
      h('div.hero__title', money(cash.collected, { round: true })),
      h('div.hero__stats',
        heroStat(money(cash.billed, { round: true }), 'Facturado'),
        heroStat(money(Math.abs(cash.change), { round: true }),
          flat ? 'La deuda quedó igual' : up ? 'La deuda subió' : 'La deuda bajó')),
      report.counts.payments
        ? h('div.t-xs', { style: { marginTop: '12px', opacity: '.8' } },
            `${plural(report.counts.payments, 'pago', 'pagos')} de `
            + `${plural(report.counts.payers, 'persona', 'personas')}`)
        : null);
  }

  /**
   * Cash against card, with the bar the counter is actually reconciled by.
   *
   * The kitchen started recording this a fortnight ago precisely so it could be
   * asked over a span: the cash line is what should have been in the drawer,
   * the debit line is what should have reached the bank.
   */
  function methodCard(report) {
    if (!report.methods.length) {
      return card(h('div.t-sm.c-soft.center', { style: { padding: '12px 0' } },
        'No se recibió ningún pago en este periodo.'));
    }
    const cash = report.money;

    return card(h('div.stack.stack-3',
      report.methods.map((row) => h('div.stack.stack-1',
        h('div.row.row--between',
          h('div.row',
            h('span.c-faint', icon(paymentMethodMeta(row.key).icon)),
            h('span.w-600', row.label),
            h('span.t-xs.c-faint', plural(row.count, 'pago', 'pagos'))),
          h('div.row', { style: { gap: '8px' } },
            h('span.t-xs.c-faint', `${percent(row.takings, cash.takings)}%`),
            h('span.w-700', money(row.takings)))),
        // The bar is the same percentage as the figure beside it — its share of
        // everything that came in. A bar scaled to the biggest row instead would
        // put a full-width bar next to the number 53%, which is two different
        // answers to one question on one line.
        meter(percent(row.takings, cash.takings)),
        // Only when there is something to explain: a way of paying that also
        // gave money back this period does not reconcile from one figure.
        row.refunds
          ? h('div.t-xs.c-faint',
              `menos ${money(Math.abs(row.refunds))} devueltos · quedan ${money(row.amount)}`)
          : null)),

      // The card has to arrive at the number in the hero, or the two disagree
      // on the same screen. This is that arithmetic, written out.
      cash.refunds
        ? defList([
            defRow('Pagos recibidos', money(cash.takings)),
            defRow('Cancelaciones', `−${money(Math.abs(cash.refunds))}`),
            defRow('Cobrado', money(cash.collected), { total: true }),
          ])
        : null));
  }

  function farmTable(report) {
    return list(report.farms.map((row) => itemRow({
      lead: h('span.c-faint', icon('farm')),
      title: row.name,
      meta: `${plural(row.payers, 'persona pagó', 'personas pagaron')} · `
        + `${money(row.billed, { round: true })} facturado`,
      end: h('div.w-700', money(row.collected, { round: true })),
      chevron: !!row.farmId,
      onClick: () => row.farmId && go(`/farms/${row.farmId}`),
    })), { card: true });
  }

  function payerList(report) {
    if (!report.payers.length) {
      return emptyState({
        icon: 'wallet',
        title: 'Nadie pagó en este periodo',
        text: 'Prueba con un periodo más amplio, o con las flechas de arriba.',
      });
    }
    const rows = showAllPayers ? report.payers : report.payers.slice(0, PREVIEW);

    return h('div.stack.stack-2',
      list(rows.map((row) => itemRow({
        lead: avatar(row.name, { size: 'sm' }),
        title: row.name,
        meta: [row.farmName, row.count > 1 ? plural(row.count, 'pago', 'pagos') : null,
          row.last ? `último ${formatDayShort(row.last)}` : null].filter(Boolean).join(' · '),
        end: h('div.w-700', money(row.amount, { round: true })),
        chevron: !!row.clientId,
        onClick: () => row.clientId && go(`/clients/${row.clientId}`),
      })), { card: true }),
      !showAllPayers && report.payers.length > PREVIEW
        ? h('p.t-xs.c-faint.center',
            `y ${report.payers.length - PREVIEW} más. Todas salen en la hoja impresa.`)
        : null);
  }

  function cashierCard(report) {
    return card(defList(report.cashiers.map((row) => defRow(
      `${row.name} · ${plural(row.count, 'pago', 'pagos')}`,
      money(row.amount),
    ))));
  }

  function correctionList(report) {
    return list(report.corrections.map((row) => itemRow({
      lead: avatar(row.clientName, { size: 'sm' }),
      title: row.clientName,
      meta: `${row.note || 'Sin motivo'} · ${row.byName || 'sin registrar'} · ${formatDayShort(row.date)}`,
      end: [
        h('div.w-700', `${row.delta > 0 ? '+' : '−'}${money(Math.abs(row.delta), { round: true })}`),
        badge(`${money(row.from, { round: true })} → ${money(row.to, { round: true })}`,
          row.delta > 0 ? 'warn' : 'ok'),
      ],
      onClick: () => go(`/invoices/${row.invoiceId}`),
    })), { card: true });
  }

  function movementList(report) {
    const rows = showAllMoves ? report.movements : report.movements.slice(0, 20);

    return list(rows.map((row) => {
      const back = Number(row.amount) < 0;
      return itemRow({
        lead: avatar(row.clientName || '—', { size: 'sm' }),
        title: row.clientName || 'Sin cliente',
        meta: `${formatDayShort(row.date)} · ${paymentMethodMeta(row.method).label}`
          + `${row.takenByName ? ` · ${row.takenByName}` : ''}`
          + `${row.folio ? ` · ${row.folio}` : ''}`,
        end: [
          h(`div.w-700${back ? '.c-bad' : ''}`,
            `${back ? '−' : ''}${money(Math.abs(Number(row.amount) || 0), { round: true })}`),
          back ? badge('Cancelación', 'bad') : null,
        ],
        onClick: () => go(`/receipts/${row.id}`),
      });
    }), { card: true });
  }

  function debtorList(rows) {
    return list(rows.map((row) => itemRow({
      lead: avatar(row.name, { size: 'sm' }),
      title: row.name,
      meta: `${plural(row.bills, 'factura', 'facturas')}${row.farmName ? ` · ${row.farmName}` : ''}`,
      end: h('div.w-700', money(row.balance, { round: true })),
      onClick: () => go(`/clients/${row.clientId}`),
    })), { card: true });
  }

  const unsubscribe = subscribe(draw);
  return life.ending(unsubscribe);
}

const heroStat = (value, label) =>
  h('div', h('div.hero__stat-v', value), h('div.hero__stat-l', label));

const BUCKET_WORD = { day: 'día', week: 'semana', month: 'mes' };

/**
 * The period a link asked for, or this month.
 *
 * `?p=day` from the dashboard's "cobrado hoy", `?p=week&d=2026-09-14` from
 * anywhere that wants to point at a particular one. A month is the default
 * because it is the span somebody sitting down to read a report has in mind —
 * and because a year is twelve times the reading, which is not what an idle
 * open of the screen should cost.
 */
function fromQuery(query = {}) {
  const grain = GRAINS.includes(query.p) ? query.p : 'month';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(query.d || '') ? query.d : today();
  return rangeFor(grain, anchor);
}
