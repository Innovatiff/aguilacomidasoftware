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

import { h, svg } from '../lib/dom.js';
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

/**
 * "R1" for Libreta 1: the number in the libreta's name — or, renamed to a
 * word ("Norte"), the one it was made with, so two libretas never print the
 * same route.
 */
const routeOf = (lineName, lineId) => String(lineName || '').match(/\d+/)?.[0]
  || String(lineId || '').match(/\d+/)?.[0] || '1';

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
 * @param {string} [spec.lineId]    its id, for the number when the name has none
 * @param {number} spec.sequence    their position in that libreta, from 1
 * @param {string} spec.appUrl      where the QR points
 * @param {{ at: number, of: number }} [spec.copy]  which of their containers,
 *   for somebody who takes two comidas and so gets two stickers
 */
export function labelSheet({
  client, farmName, placeName, day, lineName, lineId, sequence, appUrl, copy,
}) {
  const preferences = (client?.preferencias || []).filter(Boolean).map(upper);
  // Today's note wins over the standing one, and disappears with the day.
  const note = sentence(noteFor(client, day));
  const route = routeOf(lineName, lineId);
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
        `${footerDay(day)} · R${route} · ${String(sequence).padStart(3, '0')}`
        + `${copy?.of > 1 ? ` · ${copy.at}/${copy.of}` : ''}`)));
}

/* --- The bag ---------------------------------------------------------------- */

/**
 * The sticker that goes on a bag: the farm and the house, and nothing else.
 *
 * A bag holds four people's containers, all for the same house, and each
 * container already has its own sticker with the person's name on it. This
 * one is for whoever carries the bag, and it answers one question — where it
 * goes — as large as the paper allows: the farm across the top, the ubicación
 * under it. The day and the libreta run small along the bottom, as on every
 * other sticker, so yesterday's bag is not mistaken for today's.
 *
 * @param {object} spec
 * @param {string} spec.farmName
 * @param {string} [spec.placeName]  the house, block or greenhouse; without
 *   one the bag says only the farm
 * @param {string} spec.day          'YYYY-MM-DD'
 * @param {string} spec.lineName     which libreta, for the "R1"
 */
export function placeSheet({
  farmName, placeName, day, lineName, lineId,
}) {
  const place = upper(placeName);
  return h('div.lbl.lbl--place',
    h('div.place__body',
      h('div.place__farm', upper(farmName)),
      place ? h('div.lbl__rule') : null,
      place ? h('div.place__where', place) : null),
    h('div.place__foot', `${footerDay(day)} · R${routeOf(lineName, lineId)}`));
}

/**
 * A bag packed by hand: the farm, the house — or houses — and the people the
 * packer says went in it, with ×2 beside whoever takes two, and along the
 * bottom how many people and containers that makes, which is what whoever
 * closes the bag counts against.
 *
 * Most bags are the libreta's: four people of one house, labelled by
 * `placeSheet`. This is for the ones that are not — two people's food in a
 * bag, or three, because that is how it fitted or how the van is going.
 *
 * @param {object} spec
 * @param {string} spec.farmName
 * @param {string[]} [spec.placeNames]  the houses of the people in it, in order
 * @param {{ name: string, plates: number }[]} spec.people
 * @param {string} spec.day          'YYYY-MM-DD'
 * @param {string} spec.lineName     which libreta, for the "R1"
 */
export function specialSheet({
  farmName, placeNames = [], people = [], day, lineName, lineId,
}) {
  const places = placeNames.map(upper).filter(Boolean);
  const plates = people.reduce((sum, one) => sum + (Number(one.plates) || 0), 0);
  return h('div.lbl.lbl--place.lbl--special',
    h('div.place__farm', upper(farmName)),
    places.length ? h('div.place__where', places.join(' · ')) : null,
    h('div.lbl__rule'),
    h('div.place__names', people.map((one) => h('div.place__who',
      h('span.place__name', String(one.name || '').trim().replace(/\s+/g, ' ')),
      one.plates > 1 ? h('b.place__x', `×${one.plates}`) : null))),
    h('div.place__foot',
      h('span', `${footerDay(day)} · R${routeOf(lineName, lineId)}`),
      h('b', `${plural(people.length, 'persona', 'personas')} · ${plural(plates, 'comida', 'comidas')}`)));
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
 *
 * @returns {number} the size it settled on, in millimetres
 */
function fitLine(el, { max, min, step = 0.25 }) {
  if (!el) return 0;
  let size = max;
  el.style.fontSize = `${size}mm`;
  // A guard, not a condition: this converges, and an infinite loop here would
  // hang the machine at the moment somebody is waiting for a label.
  for (let guard = 0; guard < 80 && size > min; guard += 1) {
    if (el.scrollWidth <= el.clientWidth + 1) break;
    size = Math.max(min, size - step);
    el.style.fontSize = `${size}mm`;
  }
  return size;
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

/**
 * Measures a bag's sticker that is already in the document: the farm and the
 * house each as large as it fits on its one line, and the house never larger
 * than the farm above it — a short house under a long farm would otherwise
 * come out as the biggest thing on the bag.
 */
export function fitPlace(sheet) {
  const farm = fitLine(sheet?.querySelector('.place__farm'), { max: 14, min: 5 });
  fitLine(sheet?.querySelector('.place__where'), { max: Math.min(10, farm || 10), min: 4.5 });
}

/*
 * The names on a special bag, in millimetres: as large as they fit, and never
 * smaller than a thermal head still prints cleanly — 2.6mm is about 7½
 * points, twenty dots of letter at 203 dpi.
 */
const NAMES_MAX = 5;
const NAMES_MIN = 2.6;
const NAMES_STEP = 0.1;
const NAMES_COLUMNS = 3;

/**
 * Lays out a special bag's sticker that is already in the document: the farm
 * and the houses on their lines, and the names as large as they can be in as
 * few columns as hold all of them whole.
 *
 * Larger letters win over fewer columns; at the same size, fewer columns win,
 * because each column is a list read from the top. If nothing holds every
 * name whole, the smallest letters are used and a name too long for its
 * column ends in "…" rather than pushing the totals off the paper.
 */
export function fitSpecial(sheet) {
  const farm = fitLine(sheet?.querySelector('.place__farm'), { max: 9, min: 5 });
  fitLine(sheet?.querySelector('.place__where'), { max: Math.min(6, farm || 6), min: 3.4 });
  const list = sheet?.querySelector('.place__names');
  if (!list) return;
  const names = [...list.querySelectorAll('.place__name')];

  const lay = (size, columns) => {
    list.style.fontSize = `${size}mm`;
    list.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    list.style.gridTemplateRows = `repeat(${Math.max(1, Math.ceil(names.length / columns))}, auto)`;
    return {
      short: list.scrollHeight <= list.clientHeight + 1,
      whole: names.every((name) => name.scrollWidth <= name.clientWidth + 1),
    };
  };

  // Counted in steps rather than by subtracting a decimal, which drifts.
  const steps = Math.round((NAMES_MAX - NAMES_MIN) / NAMES_STEP);
  for (let step = 0; step <= steps; step += 1) {
    const size = Math.round((NAMES_MAX - step * NAMES_STEP) * 100) / 100;
    for (let columns = 1; columns <= NAMES_COLUMNS; columns += 1) {
      const fit = lay(size, columns);
      if (fit.short && fit.whole) return;
      // Short enough but a name is cut: another column only narrows them all,
      // so the next thing worth trying is smaller letters.
      if (fit.short) break;
    }
  }
  for (let columns = 1; columns <= NAMES_COLUMNS; columns += 1) {
    if (lay(NAMES_MIN, columns).short) return;
  }
}
