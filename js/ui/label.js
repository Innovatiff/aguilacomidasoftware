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
  const route = String(lineName || '').match(/\d+/)?.[0] || '1';
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
        `${upper(formatDayShort(day))} · R${route} · ${String(sequence).padStart(3, '0')}`)));
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
