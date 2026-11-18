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
import { rangeTitle, rangeSpan, spanIsTitle } from '../lib/periods.js';
import { debtWord } from '../lib/report.js';
import { t } from '../lib/i18n.js';

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
    figure(t('Efectivo'), money(of('cash'))),
    figure(t('Débito'), money(of('debit'))),
    figure(t('Otras formas'), money(others)));
}

/** Where "clientes activos" and "comidas al día" come from, in one line. */
function dailyWords(people) {
  if (people.from === 'packed') {
    return t('Clientes activos y comidas al día: el promedio de los {days} que se empacó en este periodo.', {
      days: plural(people.days, 'día', 'días'),
    });
  }
  if (people.from === 'today') return t('Clientes activos y comidas al día: los de hoy, según la lista de clientes.');
  return t('Clientes activos y comidas al día: no hay empaque registrado en este periodo.');
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
        h('div.rep__kind', t('Reporte')),
        h('div.rep__period', rangeTitle(range)),
        h('div.rep__sub', `${spanIsTitle(range) ? '' : `${rangeSpan(range)} · `}${plural(days.span, 'día', 'días')}`
          + (days.running ? ` · ${t('{count} transcurridos', { count: days.elapsed })}` : '')))),

    /* --- What came in. The first thing anybody looks for, so the biggest. */
    h('div.rep__hero',
      h('div.rep__hero-k', t('Se cobró en este periodo')),
      h('div.rep__hero-v', money(cash.collected)),
      h('div.rep__hero-n', counts.payments
        ? t('{payments} de {people}', {
          payments: plural(counts.payments, 'pago', 'pagos'), people: plural(counts.payers, 'persona', 'personas'),
        })
        : t('No se recibió ningún pago'))),

    till(report.methods),

    /* --- The period's accounts ------------------------------------------ */
    h('section.rep__block',
      band(t('Las cuentas de este periodo')),
      h('div.rep__cols',
        h('div.rep__col',
          row(t('Se facturó'), money(cash.billed), { strong: true }),
          row(t('Deudas agregadas a mano'), money(cash.added)),
          row(t('Emitido en total'), money(cash.issued))),
        h('div.rep__col',
          row(t('Pagos recibidos'), money(cash.takings), { strong: true }),
          row(t('Pagos cancelados'), signed(cash.refunds)),
          row(debtWord(cash.change), money(Math.abs(cash.change)))))),

    /* --- How many of each thing ----------------------------------------- */
    h('section.rep__block',
      band(t('El periodo en números')),
      h('div.rep__cols',
        h('div.rep__col',
          row(t('Pagos recibidos'), number(counts.payments)),
          row(t('Personas que pagaron'), number(counts.payers)),
          row(t('Pagos cancelados'), number(counts.refunds))),
        h('div.rep__col',
          row(t('Facturas emitidas'), number(counts.bills)),
          row(t('Comidas facturadas'), number(counts.meals)),
          // Just "por día": how many days that is over is on the masthead, and
          // a label long enough to wrap makes its row a different height from
          // the two beside it.
          row(t('Promedio por día'), money(days.elapsed ? cash.collected / days.elapsed : 0))),
        h('div.rep__col',
          row(t('Clientes activos'), people.active === null ? '—' : number(people.active)),
          // Lo que la cocina pone en la estufa un día cualquiera. No es lo
          // mismo que "comidas facturadas", que es lo vendido en todo el
          // periodo; esto es contra lo que se compra el mandado.
          row(t('Comidas al día'), people.meals === null ? '—' : number(people.meals)),
          row(t('Clientes dados de alta'), number(people.added)),
          row(t('Clientes que terminaron'), number(people.ended)))),
      // Two of these figures are a day's, not the period's sum; said here
      // which day, or which days.
      h('p.rep__note.rep__note--after', dailyWords(people))),

    /* --- Today's photograph, kept clearly apart from the period --------- */
    h('section.rep__block',
      band(t('Lo que se debe hoy'), formatDayLong(report.day)),
      h('p.rep__note', t('Esto no es del periodo: es lo que se debe en este momento, contando todas las facturas abiertas de cualquier fecha.')),
      h('div.rep__till',
        figure(t('Por cobrar'), money(standing.owed),
          plural(standing.debtors.length, 'cliente debe', 'clientes deben')),
        figure(t('De eso, vencido'), money(standing.overdue),
          plural(standing.overdueCount, 'factura', 'facturas')),
        figure(t('Todavía en plazo'), money(standing.dueSoon), t('Sin vencer')))),

    report.pricingChanged
      ? h('p.rep__note', report.pricingChanged.byName
        ? t('Nota: la lista de precios cambió el {day}, dentro de este periodo, la cambió {name}. Las facturas emitidas antes de ese día conservan el precio que tenían.', {
          day: formatDayShort(report.pricingChanged.date), name: report.pricingChanged.byName,
        })
        : t('Nota: la lista de precios cambió el {day}, dentro de este periodo. Las facturas emitidas antes de ese día conservan el precio que tenían.', {
          day: formatDayShort(report.pricingChanged.date),
        }))
      : null,

    /* --- Footer ---------------------------------------------------------- */
    h('div.rep__foot',
      h('span', `${business.name || 'El Águila Cocina'} · ${rangeSpan(range)}`),
      h('span', t('Impreso el {day} a las {time}', { day: formatDayShort(report.day), time: formatTime(now) })
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
        h('div.rep__kind', t('Reporte')),
        h('div.rep__period', name),
        h('div.rep__sub', spanIsTitle(range) ? rangeTitle(range) : `${rangeTitle(range)} · ${rangeSpan(range)}`))),

    note ? h('p.rep__lead', note) : null,

    // Said out loud, because a list printed while the search box had something
    // in it is a list with people missing, and the paper has to admit that.
    filter
      ? h('p.rep__note', t('Sólo los renglones que decían «{filter}». Borra la búsqueda si quieres la lista completa.', { filter }))
      : null,

    rows.length
      ? table(columns, rows, total, text)
      : h('p.rep__none', t('No hay nada que listar en este periodo.')),

    h('div.rep__foot',
      h('span', `${business.name || 'El Águila Cocina'} · ${name} · ${rangeSpan(range)}`),
      h('span', t('Impreso el {day} a las {time}', { day: formatDayShort(report.day), time: formatTime(now) })
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

/* --- What the clients have on file ------------------------------------------ */

/**
 * Every client's comments — the note that stays on their file, and today's —
 * farm by farm, for the manager to read with a pen in her hand.
 *
 * Not a period's: a comment is whatever is written there the day it is
 * printed, so the sheet carries that day rather than a span. It may run to
 * several pages; a farm's name opens its people, and the column titles come
 * back at the top of every page, like the other lists.
 *
 * @param {object[]} rows  in order, from the screen: `{ name, farm, where,
 *   status, note, todays }`
 * @param {string}  day       the day it is printed for
 * @param {boolean} everyone  whether the people who no longer order are in it
 */
export function commentsSheet(rows, {
  day, everyone = false, business = {}, by = '',
} = {}) {
  const now = new Date();
  const name = t('Comentarios de los clientes');
  const brand = business.name || 'El Águila Cocina';

  const farms = [];
  for (const row of rows) {
    const last = farms[farms.length - 1];
    if (last && last.farm === row.farm) last.rows.push(row);
    else farms.push({ farm: row.farm, rows: [row] });
  }

  const person = (row) => h('tr',
    h('td',
      h('div.rep__who', row.name),
      row.status ? h('div.rep__tag', row.status) : null),
    h('td.rep__text', row.where || '—'),
    h('td.rep__text.rep__say',
      row.note ? h('div.rep__said', row.note) : null,
      row.todays
        ? h('div.rep__said', h('b', t('Nota de hoy:')), ' ', row.todays)
        : null));

  return h('div.rep.rep--list.rep--notes',
    h('div.rep__top',
      h('div',
        h('div.rep__brand', brand),
        h('div.rep__sub', [business.address, business.city].filter(Boolean).join(' · '))),
      h('div.rep__stamp',
        h('div.rep__kind', t('Lista')),
        h('div.rep__period', name),
        h('div.rep__sub', formatDayLong(day, { year: true })))),

    rows.length
      ? h('p.rep__lead', t('{clients} con comentarios, por rancho y ubicación.', {
        clients: plural(rows.length, 'cliente', 'clientes'),
      }))
      : null,

    h('p.rep__note', everyone
      ? t('Incluye a los que ya no piden.')
      : t('Los que están comiendo y los que están en pausa. No incluye a los que ya no piden.')),

    rows.length
      ? h('table.rep__t',
        h('thead', h('tr',
          h('th', t('Cliente')),
          h('th.rep__text', t('Ubicación')),
          h('th.rep__text', t('Comentarios')))),
        farms.map((group) => h('tbody',
          h('tr.rep__grp',
            h('td', { colSpan: 3 },
              group.farm || t('Sin rancho'),
              h('span.rep__grp-n', ` · ${plural(group.rows.length, 'cliente', 'clientes')}`))),
          group.rows.map(person))))
      : h('p.rep__none', t('Ningún cliente tiene comentarios.')),

    h('div.rep__foot',
      h('span', `${brand} · ${name} · ${formatDayShort(day)}`),
      h('span', t('Impreso el {day} a las {time}', { day: formatDayShort(day), time: formatTime(now) })
        + `${by ? ` · ${by}` : ''}`)));
}

/* --- A libreta, on paper ------------------------------------------------------ */

/**
 * One libreta as it is packed today: farm by farm, location by location, and
 * the people at each with how many comidas they take — in the order the
 * packing screen walks it, because it is built from the same sequence.
 *
 * For the kitchen, so nothing about money is on it, and nothing anybody cannot
 * eat either: that stays on the packing screen. Two columns, read down the
 * first and then the second, so a libreta of a hundred and thirty people is
 * two or three pages and not five; a person is never split from their line,
 * and a heading never ends a column on its own.
 *
 * @param {object} line  the libreta, `{ id, name }`
 * @param {object} plan  what `packingSequence` returns for it
 * @param {string} day   the day it is packed
 */
export function libretaSheet({
  line, plan, day, business = {}, by = '',
} = {}) {
  const now = new Date();
  const brand = business.name || 'El Águila Cocina';
  const plates = new Map(plan.slides
    .filter((slide) => slide.kind === 'client')
    .map((slide) => [slide.client.id, slide.plates]));
  const count = (clients) => {
    const meals = clients.reduce((total, client) => total + (plates.get(client.id) || 0), 0);
    return t('{people} · {meals}', {
      people: plural(clients.length, 'persona', 'personas'),
      meals: plural(meals, 'comida', 'comidas'),
    });
  };

  return h('div.rep.rep--libreta',
    h('div.rep__top',
      h('div',
        h('div.rep__brand', brand),
        h('div.rep__sub', [business.address, business.city].filter(Boolean).join(' · '))),
      h('div.rep__stamp',
        h('div.rep__kind', t('Libreta')),
        h('div.rep__period', line.name),
        h('div.rep__sub', formatDayLong(day, { year: true })))),

    h('p.rep__lead', t('{people} · {meals} · {farms}', {
      people: plural(plan.people, 'persona', 'personas'),
      meals: plural(plan.plates, 'comida', 'comidas'),
      farms: plural(plan.farmCount, 'farma', 'farmas'),
    })),
    h('p.rep__note', t('En el orden en que se empaca, sólo los que comen este día. El número a la derecha es cuántas comidas lleva cada persona.')),

    plan.farms.length
      ? h('div.lib', plan.farms.map((stretch) => h('div.lib__farm',
        h('div.lib__fhead',
          h('span', stretch.farm.name),
          h('span.lib__n', count(stretch.groups.flatMap((group) => group.clients)))),
        stretch.groups.map((group) => h('div.lib__place',
          h('div.lib__phead',
            h('span', group.place?.name || t('Sin ubicación')),
            h('span.lib__n', count(group.clients))),
          group.clients.map((client) => {
            const n = plates.get(client.id) || 0;
            return h('div.lib__row',
              h('span.lib__box'),
              h('span.lib__name', client.name),
              h(`span.lib__q${n > 1 ? '.lib__q--more' : ''}`, number(n)));
          }))))))
      : h('p.rep__none', t('No hay nada que empacar hoy.')),

    h('div.rep__foot',
      h('span', `${brand} · ${line.name} · ${formatDayShort(day)}`),
      h('span', t('Impreso el {day} a las {time}', { day: formatDayShort(day), time: formatTime(now) })
        + `${by ? ` · ${by}` : ''}`)));
}
