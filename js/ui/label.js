/**
 * The sticker that goes on a container.
 *
 * 100 × 50 mm, and it is read at arm's length by somebody moving: a 32mm QR on
 * the left, and on the right a column that answers, in this order, whose food
 * this is, where it goes, what they asked for, and what the kitchen wanted to
 * say about it.
 *
 * **No allergies on here.** They are on the packing screen, in red, where a
 * person reads them while the food is still open. A sticker is closed with the
 * lid and travels; an allergy printed on the outside of a container is a
 * medical fact about somebody, stuck to a box, riding in a van.
 *
 * The name is set as large as it fits and shrunk until it stops wrapping,
 * which is a thing only the browser can decide — so the sheet is measured
 * after it is in the document and before the printer is asked for. That is why
 * `#print-root` is parked off the screen instead of being `display: none`: a
 * subtree with no layout has no measurements to take.
 */

import { h, svg, mount } from '../lib/dom.js';
import { qrMatrix } from '../lib/qr.js';
import { formatDayShort } from '../lib/dates.js';
import { plural } from '../lib/format.js';

/* --- The QR ----------------------------------------------------------------- */

/**
 * The code as one SVG path: a rectangle per dark module, drawn on a grid four
 * modules bigger than the code on every side.
 *
 * The four modules are not decoration — without that margin of white a reader
 * cannot tell where the code ends, and a label printed right up to its own
 * border scans about half the time. They are inside the 32mm, so the square on
 * the paper is 32mm including its quiet edge.
 */
export function qrSvg(text, { mm = 32 } = {}) {
  const { size, modules } = qrMatrix(text);
  const quiet = 4;
  const span = size + quiet * 2;

  const parts = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }
  }

  return svg(`<svg class="lbl__qr" viewBox="0 0 ${span} ${span}"
    width="${mm}mm" height="${mm}mm" shape-rendering="crispEdges"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="${span}" height="${span}" fill="#fff"/>
    <path d="${parts.join('')}" fill="#000"/>
  </svg>`);
}

/** Where the QR sends somebody: their own app, on the page that installs it. */
export function installUrl(appUrl, email) {
  const base = String(appUrl || '').trim().replace(/[#/]+$/, '');
  if (!base) return '';
  // The address goes in the fragment, which browsers never send to a server:
  // whoever hosts the app cannot end up with a log of who was handed which
  // container, and neither can anybody in between.
  const who = String(email || '').trim();
  return `${base}/#/instalar${who ? `?e=${encodeURIComponent(who)}` : ''}`;
}

/* --- The sticker ------------------------------------------------------------ */

const upper = (value) => String(value || '').trim().toUpperCase();

/** "02 OCT": the footer's day always takes two digits, so every label reads alike. */
function footerDay(day) {
  const [date, month] = formatDayShort(day).split(' ');
  return `${date.padStart(2, '0')} ${upper(month)}`;
}

/** "R1" for Libreta 1: the number in the libreta's name, or 1. */
const routeOf = (lineName) => String(lineName || '').match(/\d+/)?.[0] || '1';

/** "Sentence case": the kitchen types in whatever case it likes. */
function sentence(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * @param {object} spec
 * @param {object} spec.client      the person this container is for
 * @param {string} spec.farmName
 * @param {string} spec.placeName   the house, block or greenhouse
 * @param {string} spec.day         'YYYY-MM-DD'
 * @param {string} spec.lineName    which libreta, for the "R1" in the footer
 * @param {number} spec.sequence    their position in that libreta, from 1
 * @param {string} spec.appUrl      where the QR points
 */
export function labelSheet({
  client, farmName, placeName, day, lineName, sequence, appUrl,
}) {
  const preferences = (client?.preferencias || []).filter(Boolean).map(upper);
  // Today's note wins over the standing one, and disappears with the day.
  const note = sentence(noteFor(client, day));
  const route = routeOf(lineName);
  const where = [farmName, placeName].filter(Boolean).map(upper).join(' · ');

  const url = installUrl(appUrl, client?.email);

  return h('div.lbl',
    url ? qrSvg(url) : h('div.lbl__qr.lbl__qr--none'),

    h('div.lbl__col',
      h('div.lbl__name', upper(client?.name)),
      h('div.lbl__rule'),
      h('div.lbl__where', where),
      preferences.length ? h('div.lbl__pref', preferences.join(' · ')) : null,
      note ? h('div.lbl__note', note) : null,
      h('div.lbl__foot',
        `${footerDay(day)} · R${route} · ${String(sequence).padStart(3, '0')}`)));
}

/* --- The bag ---------------------------------------------------------------- */

/**
 * The sticker that goes on a farm's bag.
 *
 * A farm's plates travel together in one bag, each with its own sticker on the
 * lid. This one goes on the bag and says what is inside it: the farm, large,
 * for whoever carries it; everybody in it, small and in columns, with ×2
 * beside whoever takes two plates; and along the bottom the day and the
 * libreta on one side and the totals on the other — "10 personas · 16
 * comidas", the number whoever closes the bag counts the plates against.
 *
 * No QR and no notes. It is the bag's packing list, not anybody's sticker.
 *
 * @param {object} spec
 * @param {string} spec.farmName
 * @param {{ name: string, plates: number }[]} spec.people  the ones on this sticker
 * @param {{ people: number, plates: number }} spec.totals  the whole bag's
 * @param {string} spec.day         'YYYY-MM-DD'
 * @param {string} spec.lineName    which libreta, for the "R1"
 * @param {{ at: number, of: number }} [spec.page]  when one sticker is not enough
 */
export function bagSheet({ farmName, people, totals, day, lineName, page }) {
  const part = page?.of > 1 ? ` · ${page.at}/${page.of}` : '';
  return h('div.lbl.lbl--bag',
    h('div.bag__farm', upper(farmName)),
    h('div.lbl__rule'),
    h('div.bag__names', (people || []).map((one) => h('div.bag__who',
      h('span.bag__name', String(one.name || '').trim().replace(/\s+/g, ' ')),
      one.plates > 1 ? h('b.bag__x', `×${one.plates}`) : null))),
    h('div.bag__foot',
      h('span', `${footerDay(day)} · R${routeOf(lineName)}${part}`),
      h('b', `${plural(totals.people, 'persona', 'personas')} · `
        + `${plural(totals.plates, 'comida', 'comidas')}`)));
}

/**
 * The line at the bottom of the sticker: today's note if the kitchen wrote one
 * this morning, otherwise the standing one on their file.
 *
 * Today's note carries the day it was written for, so it expires by itself. A
 * field that has to be cleared by somebody is a field that says "doble
 * tortilla" for a week.
 */
export function noteFor(client, day) {
  const today = String(client?.notaDelDia || '').trim();
  if (today && client?.notaDelDiaOn === day) return today;
  return String(client?.notes || '').trim();
}

/* --- Making it fit ---------------------------------------------------------- */

/**
 * Shrinks a line until it stops overflowing its column.
 *
 * Steps down in quarter-millimetres and stops at `min`, where the line is cut
 * off with an ellipsis instead. The floor is the point: measured, a name like
 * "María Guadalupe Hernández de la Torre" shrank all the way down and came out
 * the same size as the farm underneath it — a complete name nobody can read
 * across a kitchen, which is worse than "MARÍA GUADALUPE HERN…" set large. The
 * name's floor is above the preferences' ceiling, so it is always the biggest
 * thing on the sticker no matter whose it is.
 */
function fitLine(el, { max, min, step = 0.25 }) {
  if (!el) return;
  let size = max;
  el.style.fontSize = `${size}mm`;
  // A guard, not a condition: this converges, and an infinite loop here would
  // hang the machine at the moment somebody is waiting for a label.
  for (let guard = 0; guard < 80 && size > min; guard += 1) {
    if (el.scrollWidth <= el.clientWidth + 1) break;
    size = Math.max(min, size - step);
    el.style.fontSize = `${size}mm`;
  }
}

/**
 * Measures a sticker that is already in the document and sets the two lines
 * that are allowed to shrink. Called by the printer, after mounting and before
 * asking for paper.
 */
export function fitLabel(root) {
  fitLine(root?.querySelector('.lbl__name'), { max: 7, min: 4.5 });
  fitLine(root?.querySelector('.lbl__pref'), { max: 3.8, min: 3 });
}

/*
 * The names on a bag, in millimetres: as large as they fit, and never smaller
 * than a thermal head still prints cleanly — 2.3mm is about 6½ points, which
 * at 203 dpi is still eighteen dots of letter.
 */
const BAG_MAX = 4;
const BAG_MIN = 2.3;
const BAG_STEP = 0.1;
const BAG_COLUMNS = 4;

/**
 * Lays out one bag sticker that is already in the document: the farm's name
 * shrunk until it fits its line, and the names as large as they can be, in as
 * few columns as hold all of them without cutting one short.
 *
 * Larger letters win over fewer columns; at the same size, fewer columns win,
 * because each column is a list read from the top and every extra one is
 * another place to lose your place. If nothing holds every name whole, the
 * smallest letters are used and a name too long for its column ends in "…" —
 * on a list of forty, one shortened surname beats a second sticker.
 *
 * @returns {boolean} false when not even the smallest letters in four columns
 *   hold everybody, and the bag needs more than one sticker
 */
export function fitBag(sheet) {
  fitLine(sheet?.querySelector('.bag__farm'), { max: 6, min: 3.6 });
  const list = sheet?.querySelector('.bag__names');
  if (!list) return true;
  const names = [...list.querySelectorAll('.bag__name')];

  const lay = (size, columns) => {
    list.style.fontSize = `${size}mm`;
    list.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    list.style.gridTemplateRows = `repeat(${Math.max(1, Math.ceil(names.length / columns))}, auto)`;
    return {
      tall: list.scrollHeight <= list.clientHeight + 1,
      whole: names.every((name) => name.scrollWidth <= name.clientWidth + 1),
    };
  };

  // Counted in steps rather than by subtracting a decimal, which drifts.
  const steps = Math.round((BAG_MAX - BAG_MIN) / BAG_STEP);
  for (let step = 0; step <= steps; step += 1) {
    const size = Math.round((BAG_MAX - step * BAG_STEP) * 100) / 100;
    for (let columns = 1; columns <= BAG_COLUMNS; columns += 1) {
      const fit = lay(size, columns);
      if (fit.tall && fit.whole) return true;
      // Short enough but a name is cut: another column only narrows them all,
      // so the next thing worth trying is smaller letters.
      if (fit.tall) break;
    }
  }

  for (let columns = 1; columns <= BAG_COLUMNS; columns += 1) {
    if (lay(BAG_MIN, columns).tall) return true;
  }
  return false;
}

/** How many names one sticker holds in the smallest letters, in four columns. */
function bagCapacity(sheet) {
  const list = sheet.querySelector('.bag__names');
  list.style.fontSize = `${BAG_MIN}mm`;
  const row = list.querySelector('.bag__who')?.getBoundingClientRect().height || 1;
  return Math.max(1, Math.floor((list.clientHeight + 1) / row)) * BAG_COLUMNS;
}

/**
 * Mounts a farm's bag sticker in `root` and lays it out — over as many
 * stickers as it takes, which for a bag anybody can carry is one.
 *
 * Only a bag too big for the smallest letters in four columns goes on to a
 * second sticker, marked 1/2 and 2/2 so the second is not mistaken for another
 * bag's. Each one carries the whole bag's totals: the plates are counted
 * against the bag, not against the sticker.
 *
 * @param {object} spec  as for `bagSheet`, with every person in the bag
 * @returns {number} how many stickers it took
 */
export function mountBag(root, { people = [], ...spec }) {
  const totals = {
    people: people.length,
    plates: people.reduce((sum, one) => sum + (Number(one.plates) || 0), 0),
  };
  mount(root, bagSheet({ ...spec, people, totals }));
  if (fitBag(root.firstElementChild)) return 1;

  // As few stickers as hold everybody, shared out evenly: 30 + 30 + 30 reads
  // better than 40 + 40 + 10, and the letters on each come out larger.
  const count = Math.ceil(people.length / bagCapacity(root.firstElementChild));
  const per = Math.ceil(people.length / count);
  const parts = [];
  for (let at = 0; at < people.length; at += per) parts.push(people.slice(at, at + per));
  mount(root, ...parts.map((part, i) => bagSheet({
    ...spec, people: part, totals, page: { at: i + 1, of: parts.length },
  })));
  for (const sheet of root.querySelectorAll('.lbl--bag')) fitBag(sheet);
  return parts.length;
}
