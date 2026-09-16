/**
 * The period report, as a document.
 *
 * Paper, not a screen: Letter, black on white, set in tables. It prints through
 * exactly the same mechanism as a receipt — built into `#print-root`, everything
 * else hidden by `css/print.css`, `window.print()` — so it needs no driver and
 * no server, and "Guardar como PDF" in the browser's own dialog turns it into a
 * file the owner can keep or send without this app knowing anything about it.
 *
 * **What it leaves out, on purpose: the payments, one by one.** A month is a
 * few hundred receipts and printing them would bury the figures the sheet
 * exists for under twenty pages of a ledger that is already in the drawer, one
 * slip at a time. Who paid is on it — every person, with their total for the
 * period — because that is the list somebody actually reads down. How they paid,
 * receipt by receipt, is on the screen.
 *
 * The tables are real `<table>` elements rather than the app's flex rows, for
 * one reason that only matters on paper: a table header repeats itself at the
 * top of every page it spills onto, so page four of "quién pagó" still says
 * which column is the money.
 */

import { h } from '../lib/dom.js';
import { money, number, percent, plural } from '../lib/format.js';
import { formatDayLong, formatTime, formatDayShort } from '../lib/dates.js';
import { rangeTitle, rangeSpan, GRAIN_LABEL } from '../lib/periods.js';

/** The stretches of the period where anything happened at all. */
const timeRows = (report) => (report.buckets.length > 1
  ? report.buckets.filter((row) => row.amount || row.billed || row.count)
  : []);

/** What the time table is called, decided by the buckets rather than guessed. */
const BUCKET_HEADING = { day: 'Día a día', week: 'Semana a semana', month: 'Mes a mes' };

/* --- Building blocks -------------------------------------------------------- */

const title = (text, note) => h('div.rep__h',
  h('span', text),
  note ? h('span.rep__h-note', note) : null);

/** A key on the left and a figure on the right. */
const pair = (key, value, { total = false, soft = false, sub = false } = {}) =>
  h(`div.rep__pair${total ? '.rep__pair--total' : ''}${soft ? '.rep__pair--soft' : ''}${sub ? '.rep__pair--sub' : ''}`,
    h('span', key), h('span.rep__num', value));

/**
 * @param {string[]} head    column titles; the first is the wide one
 * @param {Array[]}  rows    cells, in the same order
 * @param {Array}    [foot]  a totals row, set in bold
 * @param {number[]} [text]  columns past the first that hold words, not figures
 */
function table(head, rows, foot, text = []) {
  const kind = (i) => (i === 0 ? '' : (text.includes(i) ? '.rep__text' : '.rep__num'));
  const cells = (values, tag) => values.map((value, i) => h(`${tag}${kind(i)}`, value));

  return h('table.rep__t',
    h('thead', h('tr', cells(head, 'th'))),
    h('tbody', rows.map((row) => h('tr', cells(row, 'td')))),
    foot ? h('tfoot', h('tr', cells(foot, 'td'))) : null);
}

const signed = (amount) => `${amount < -0.005 ? '−' : ''}${money(Math.abs(amount))}`;

/** Which way the book moved. A period that changed nothing says nothing moved. */
const debtWord = (change) => (Math.abs(change) <= 0.005
  ? 'La deuda quedó igual'
  : (change > 0 ? 'La deuda subió' : 'La deuda bajó'));

/* --- The sheet -------------------------------------------------------------- */

/**
 * @param {object} report    from `buildReport`
 * @param {object} business  the header, from `config/business`
 * @param {string} [by]      who asked for it
 */
export function reportSheet(report, { business = {}, by = '' } = {}) {
  const { range, money: cash, counts, standing, people, days } = report;
  const now = new Date();

  return h('div.rep',
    /* --- Who, what, when ------------------------------------------------- */
    h('div.rep__top',
      h('div',
        h('div.rep__brand', business.name || 'El Águila Cocina'),
        h('div.rep__sub', [business.address, business.city].filter(Boolean).join(' · ')),
        business.phone ? h('div.rep__sub', `Tel. ${business.phone}`) : null),
      h('div.rep__stamp',
        h('div.rep__kind', 'Reporte de operaciones'),
        h('div.rep__period', rangeTitle(range)),
        h('div.rep__sub', `${rangeSpan(range)} · ${plural(days.span, 'día', 'días')}`
          + (days.running ? ` · ${days.elapsed} transcurridos` : '')))),

    h('div.rep__line'),

    /* --- The money ------------------------------------------------------- */
    h('section.rep__block',
      title('Resumen del periodo'),
      h('div.rep__cols',
        h('div.rep__col',
          pair('Cobrado', money(cash.collected), { total: true }),
          pair('Pagos recibidos', money(cash.takings), { sub: true }),
          pair('Cancelaciones', signed(cash.refunds), { sub: true }),
          pair(days.running ? `Promedio por día (${days.elapsed} días)` : 'Promedio por día',
            money(days.elapsed ? cash.collected / days.elapsed : 0), { soft: true })),
        h('div.rep__col',
          pair('Facturado', money(cash.billed), { total: true }),
          pair('Deudas agregadas', money(cash.added), { sub: true }),
          pair('Emitido en total', money(cash.issued), { sub: true }),
          pair(debtWord(cash.change), money(Math.abs(cash.change)), { soft: true })))),

    /* --- Activity ---------------------------------------------------------
       Counts, in pairs rather than in a table: two columns of eight short
       lines take a third of the paper a two-column table of the same eight
       takes, and nothing here is a column anybody reads down. */
    h('section.rep__block',
      title('Movimiento'),
      h('div.rep__cols',
        h('div.rep__col',
          pair('Pagos recibidos', number(counts.payments)),
          pair('Personas que pagaron', number(counts.payers)),
          pair('Cancelaciones', number(counts.refunds)),
          pair('Comidas facturadas', number(counts.meals))),
        h('div.rep__col',
          pair('Facturas emitidas', number(counts.bills)),
          pair('Deudas agregadas', number(counts.debts)),
          pair('Clientes dados de alta', number(people.added)),
          pair('Clientes que terminaron', number(people.ended))))),

    /* --- How it came in ---------------------------------------------------
       Five columns rather than one, so the sheet reconciles both ways: the
       "entradas" column adds to what people handed over, the "neto" column to
       what is left after anything was given back. A single netted figure per
       method reads as nonsense the first time a month ends with cash below
       zero — which happens whenever a card payment is refunded in notes. */
    h('section.rep__block',
      title('Formas de pago'),
      report.methods.length
        ? table(
            ['Forma', 'Pagos', 'Entradas', 'Parte', 'Devuelto', 'Neto'],
            report.methods.map((row) => [
              row.label, number(row.count), money(row.takings),
              `${percent(row.takings, cash.takings)}%`,
              row.refunds ? signed(row.refunds) : '—', signed(row.amount),
            ]),
            ['Total', number(counts.payments), money(cash.takings), '100%',
              cash.refunds ? signed(cash.refunds) : '—', money(cash.collected)])
        : h('p.rep__none', 'No se recibió ningún pago en este periodo.')),

    /* --- By farm --------------------------------------------------------- */
    report.farms.length
      ? h('section.rep__block',
          title('Por rancho'),
          table(
            ['Rancho', 'Pagaron', 'Cobrado', 'Facturado'],
            report.farms.map((row) => [
              row.name, number(row.payers), signed(row.collected), money(row.billed),
            ]),
            ['Total', number(counts.payers), money(cash.collected), money(cash.issued)]))
      : null,

    /* --- Over time --------------------------------------------------------
       Only the ones where something happened. The chart on screen keeps its
       empty days, because the rhythm of a business that collects twice a week
       is exactly what the gaps show — but a printed table of twenty rows of
       $0.00 is a page of paper saying nothing, and it pushes the part somebody
       wanted onto the next sheet. */
    timeRows(report).length
      ? h('section.rep__block',
          title(BUCKET_HEADING[report.buckets[0].grain] || 'Movimiento',
            timeRows(report).length < report.buckets.length ? 'Sólo con movimiento' : null),
          table(
            ['Periodo', 'Pagos', 'Cobrado', 'Facturado'],
            timeRows(report).map((row) => [
              row.label, number(row.count), signed(row.amount), money(row.billed),
            ]),
            ['Total', number(counts.payments), money(cash.collected), money(cash.issued)]))
      : null,

    /* --- Who paid. Not what each of them paid, one payment at a time. ----- */
    h('section.rep__block',
      title('Quién pagó', report.payers.length
        ? `${plural(report.payers.length, 'persona', 'personas')}`
        : null),
      report.payers.length
        ? table(
            ['Cliente', 'Rancho', 'Pagos', 'Monto'],
            report.payers.map((row) => [
              row.name, row.farmName || '—', number(row.count), money(row.amount),
            ]),
            ['Total', '', number(counts.payments), money(cash.takings)], [1])
        : h('p.rep__none', 'Nadie pagó en este periodo.')),

    /* --- The price list, if it moved -------------------------------------- */
    report.pricingChanged
      ? h('section.rep__block',
          title('Precios'),
          h('p.rep__note', `La lista de precios cambió el `
            + `${formatDayShort(report.pricingChanged.date)} dentro de este periodo`
            + `${report.pricingChanged.byName ? `, la cambió ${report.pricingChanged.byName}` : ''}. `
            + 'Las facturas emitidas antes de ese día conservan el precio que tenían.'))
      : null,

    /* --- Who took it ----------------------------------------------------- */
    report.cashiers.length > 1
      ? h('section.rep__block',
          title('Quién cobró'),
          table(
            ['Persona', 'Pagos', 'Monto'],
            report.cashiers.map((row) => [row.name, number(row.count), signed(row.amount)])))
      : null,

    /* --- Balances moved by hand ------------------------------------------ */
    report.corrections.length
      ? h('section.rep__block',
          title('Ajustes de saldo', 'Cambios hechos a las cuentas de este periodo'),
          table(
            ['Cliente', 'Motivo', 'Antes', 'Después', 'Quién'],
            report.corrections.map((row) => [
              row.clientName, row.note || '—', money(row.from), money(row.to), row.byName || '—',
            ]), null, [1, 4]))
      : null,

    /* --- The photograph, clearly dated ----------------------------------- */
    h('section.rep__block',
      title('Al día de hoy', formatDayLong(report.day)),
      h('p.rep__note', 'Esto no es del periodo: es lo que se debe en este momento, '
        + 'contando todas las facturas abiertas de cualquier fecha.'),
      h('div.rep__cols',
        h('div.rep__col',
          pair('Por cobrar', money(standing.owed), { total: true }),
          pair('De eso, vencido', money(standing.overdue), { sub: true }),
          pair('Todavía en plazo', money(standing.dueSoon), { sub: true })),
        h('div.rep__col',
          pair('Clientes que deben', number(standing.debtors.length), { total: true }),
          pair('Facturas vencidas', number(standing.overdueCount), { sub: true }),
          pair('Clientes activos', number(people.active), { sub: true })))),

    standing.debtors.length
      ? h('section.rep__block',
          title('Quién debe', 'Al día de hoy'),
          table(
            ['Cliente', 'Rancho', 'Facturas', 'Saldo'],
            standing.debtors.map((row) => [
              row.name, row.farmName || '—', number(row.bills), money(row.balance),
            ]),
            ['Total', '', number(standing.debtors.reduce((n, row) => n + row.bills, 0)),
              money(standing.owed)], [1]))
      : null,

    /* --- Footer ----------------------------------------------------------- */
    h('div.rep__line'),
    h('div.rep__foot',
      h('span', `${business.name || 'El Águila Cocina'} · ${GRAIN_LABEL[range.grain] || 'Periodo'}: ${rangeSpan(range)}`),
      h('span', `Generado ${formatDayShort(report.day)} ${formatTime(now)}${by ? ` · ${by}` : ''}`)));
}
