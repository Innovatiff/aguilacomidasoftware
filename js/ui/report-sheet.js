/**
 * The report, on paper. One sheet, and always one.
 *
 * The person this is for reads it printed, files it, and takes it out again
 * months later. So it is not a picture of the screen: it is its own document,
 * with the figures set large, in blocks that are taken in at a glance, and
 * nothing anybody has to follow across the page with a finger.
 *
 * **It carries no list of anybody, and that is why it is always one page.** Not
 * who paid, not who owes, not the payments one by one. That is a decision, not
 * an omission: a list grows with the business, and a sheet that runs to one
 * page today runs to five next year. Everything printed here is a total, and a
 * total takes the same room at seven clients as at seven hundred. The lists are
 * on the screen, each behind its own row, for whoever wants to look.
 *
 * It prints the same way a receipt does — built into `#print-root`, everything
 * else hidden by `css/print.css`, `window.print()` — so it needs no driver and
 * no server, and the browser's own "Guardar como PDF" turns it into a file.
 */

import { h } from '../lib/dom.js';
import { money, number, plural } from '../lib/format.js';
import { formatDayLong, formatTime, formatDayShort } from '../lib/dates.js';
import { rangeTitle, rangeSpan } from '../lib/periods.js';
import { debtWord } from '../lib/report.js';

/* --- Building blocks -------------------------------------------------------- */

const band = (text, note) => h('div.rep__band',
  h('span', text),
  note ? h('span.rep__band-n', note) : null);

/** A figure with its name over it, at a size that reads across a desk. */
const figure = (label, value, note) => h('div.rep__fig',
  h('div.rep__fig-k', label),
  h('div.rep__fig-v', value),
  note ? h('div.rep__fig-n', note) : null);

/** Two columns: what it is on the left, what it comes to on the right. */
const row = (key, value, { strong = false } = {}) =>
  h(`div.rep__row${strong ? '.rep__row--strong' : ''}`,
    h('span', key), h('span.rep__num', value));

const signed = (amount) => `${amount < -0.005 ? '−' : ''}${money(Math.abs(amount))}`;

/**
 * Cash, debit, and everything else together.
 *
 * Three fixed cells rather than one per method: the first two are what the
 * store squares up at the end of the day — what should have been in the drawer,
 * what should have reached the bank — and the rest is a footnote. It also keeps
 * the block the same height whatever happens, which is part of why this sheet
 * is one page.
 */
function till(methods) {
  const of = (key) => methods.find((m) => m.key === key)?.takings || 0;
  const others = methods
    .filter((m) => m.key !== 'cash' && m.key !== 'debit')
    .reduce((total, m) => total + m.takings, 0);

  return h('div.rep__till',
    figure('Efectivo', money(of('cash'))),
    figure('Débito', money(of('debit'))),
    figure('Otras formas', money(others)));
}

/* --- The sheet -------------------------------------------------------------- */

/**
 * @param {object} report    what `buildReport` returns
 * @param {object} business  the header, from `config/business`
 * @param {string} [by]      who printed it
 */
export function reportSheet(report, { business = {}, by = '' } = {}) {
  const { range, money: cash, counts, standing, people, days } = report;
  const now = new Date();

  return h('div.rep',
    /* --- Whose it is, which period, and when --------------------------- */
    h('div.rep__top',
      h('div',
        h('div.rep__brand', business.name || 'El Águila Cocina'),
        h('div.rep__sub', [business.address, business.city].filter(Boolean).join(' · ')),
        business.phone ? h('div.rep__sub', `Tel. ${business.phone}`) : null),
      h('div.rep__stamp',
        h('div.rep__kind', 'Reporte'),
        h('div.rep__period', rangeTitle(range)),
        h('div.rep__sub', `${rangeSpan(range)} · ${plural(days.span, 'día', 'días')}`
          + (days.running ? ` · ${days.elapsed} transcurridos` : '')))),

    /* --- What came in. The first thing anybody looks for, so the biggest. */
    h('div.rep__hero',
      h('div.rep__hero-k', 'Se cobró en este periodo'),
      h('div.rep__hero-v', money(cash.collected)),
      h('div.rep__hero-n', counts.payments
        ? `${plural(counts.payments, 'pago', 'pagos')} de ${plural(counts.payers, 'persona', 'personas')}`
        : 'No se recibió ningún pago')),

    till(report.methods),

    /* --- The period's accounts ------------------------------------------ */
    h('section.rep__block',
      band('Las cuentas de este periodo'),
      h('div.rep__cols',
        h('div.rep__col',
          row('Se facturó', money(cash.billed), { strong: true }),
          row('Deudas agregadas a mano', money(cash.added)),
          row('Emitido en total', money(cash.issued))),
        h('div.rep__col',
          row('Pagos recibidos', money(cash.takings), { strong: true }),
          row('Pagos cancelados', signed(cash.refunds)),
          row(debtWord(cash.change), money(Math.abs(cash.change)))))),

    /* --- How many of each thing ----------------------------------------- */
    h('section.rep__block',
      band('El periodo en números'),
      h('div.rep__cols',
        h('div.rep__col',
          row('Pagos recibidos', number(counts.payments)),
          row('Personas que pagaron', number(counts.payers)),
          row('Pagos cancelados', number(counts.refunds))),
        h('div.rep__col',
          row('Facturas emitidas', number(counts.bills)),
          row('Comidas facturadas', number(counts.meals)),
          // Just "por día": how many days that is over is on the masthead, and
          // a label long enough to wrap makes its row a different height from
          // the two beside it.
          row('Promedio por día', money(days.elapsed ? cash.collected / days.elapsed : 0))),
        h('div.rep__col',
          row('Clientes activos', number(people.active)),
          // Lo que la cocina pone en la estufa un día cualquiera. No es lo
          // mismo que "comidas facturadas", que es lo vendido en todo el
          // periodo; esto es contra lo que se compra el mandado.
          row('Comidas al día', number(people.meals)),
          row('Clientes dados de alta', number(people.added)),
          row('Clientes que terminaron', number(people.ended))))),

    /* --- Today's photograph, kept clearly apart from the period --------- */
    h('section.rep__block',
      band('Lo que se debe hoy', formatDayLong(report.day)),
      h('p.rep__note', 'Esto no es del periodo: es lo que se debe en este momento, '
        + 'contando todas las facturas abiertas de cualquier fecha.'),
      h('div.rep__till',
        figure('Por cobrar', money(standing.owed),
          plural(standing.debtors.length, 'cliente debe', 'clientes deben')),
        figure('De eso, vencido', money(standing.overdue),
          plural(standing.overdueCount, 'factura', 'facturas')),
        figure('Todavía en plazo', money(standing.dueSoon), 'Sin vencer'))),

    report.pricingChanged
      ? h('p.rep__note', `Nota: la lista de precios cambió el `
          + `${formatDayShort(report.pricingChanged.date)}, dentro de este periodo`
          + `${report.pricingChanged.byName ? `, la cambió ${report.pricingChanged.byName}` : ''}. `
          + 'Las facturas emitidas antes de ese día conservan el precio que tenían.')
      : null,

    /* --- Footer ---------------------------------------------------------- */
    h('div.rep__foot',
      h('span', `${business.name || 'El Águila Cocina'} · ${rangeSpan(range)}`),
      h('span', `Impreso el ${formatDayShort(report.day)} a las ${formatTime(now)}`
        + `${by ? ` · ${by}` : ''}`)));
}

/* --- A list, on its own sheet ----------------------------------------------- */

/**
 * One of the report's lists, printed.
 *
 * The overview sheet carries no list of anybody on purpose, so that it is
 * always one page. These are the other half of that decision: when the manager
 * does want the names — who paid this fortnight, who owes today, how each farm
 * did — she opens that list on screen and prints it from there, and gets a
 * document about exactly that one thing.
 *
 * Unlike the overview these may run to several pages, because a list of two
 * hundred people is two hundred people. What makes them readable across a page
 * break is the table header repeating itself at the top of each sheet, and no
 * row ever being split down the middle.
 *
 * @param {object[]} columns  the column titles; the first is the wide one
 * @param {Array[]}  rows     cells, in the same order as the columns
 * @param {Array}    [total]  a totals row, set in bold
 * @param {number[]} [text]   columns past the first that hold words, not figures
 * @param {string}   [filter] what was typed in the search box, if anything
 */
export function listSheet(report, {
  title: name, note, columns, rows, total, text = [],
  business = {}, by = '', filter = '',
} = {}) {
  const { range } = report;
  const now = new Date();

  return h('div.rep.rep--list',
    h('div.rep__top',
      h('div',
        h('div.rep__brand', business.name || 'El Águila Cocina'),
        h('div.rep__sub', [business.address, business.city].filter(Boolean).join(' · '))),
      h('div.rep__stamp',
        h('div.rep__kind', 'Reporte'),
        h('div.rep__period', name),
        h('div.rep__sub', `${rangeTitle(range)} · ${rangeSpan(range)}`))),

    note ? h('p.rep__lead', note) : null,

    // Said out loud, because a list printed while the search box had something
    // in it is a list with people missing, and the paper has to admit that.
    filter
      ? h('p.rep__note', `Sólo los renglones que decían «${filter}». `
        + 'Borra la búsqueda si quieres la lista completa.')
      : null,

    rows.length
      ? table(columns, rows, total, text)
      : h('p.rep__none', 'No hay nada que listar en este periodo.'),

    h('div.rep__foot',
      h('span', `${business.name || 'El Águila Cocina'} · ${name} · ${rangeSpan(range)}`),
      h('span', `Impreso el ${formatDayShort(report.day)} a las ${formatTime(now)}`
        + `${by ? ` · ${by}` : ''}`)));
}

/**
 * The table these sheets are built from.
 *
 * Real `<table>` markup rather than the flex rows the app uses on screen, for
 * one reason that only matters on paper: a table header repeats itself at the
 * top of every page it spills onto, so page four still says which column is
 * the money.
 */
function table(head, rows, total, text = []) {
  const kind = (i) => (i === 0 ? '' : (text.includes(i) ? '.rep__text' : '.rep__num'));
  const cells = (values, tag) => values.map((value, i) => h(`${tag}${kind(i)}`, value));

  return h('table.rep__t',
    h('thead', h('tr', cells(head, 'th'))),
    h('tbody', rows.map((row) => h('tr', cells(row, 'td')))),
    total ? h('tfoot', h('tr', cells(total, 'td'))) : null);
}
