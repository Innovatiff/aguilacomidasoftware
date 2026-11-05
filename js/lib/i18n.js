/**
 * Two languages: Spanish, which the panel is written in, and English.
 *
 * Every word a person reads goes through `t()`, and the Spanish text itself is
 * the key: `t('Guardar')` is "Guardar" in Spanish and "Save" in English. That
 * keeps the Spanish screens exactly as they were — the source still reads as
 * the screen does — and makes a missing English line fall back to the Spanish
 * one instead of to a code nobody understands.
 *
 *   t('Guardar')                                  → "Save"
 *   t('Pago de {amount}', { amount: money(140) }) → "Payment of $140.00"
 *
 * The language belongs to the computer, not to the account: the office may
 * read English while the kitchen next door packs in Spanish. It is kept in the
 * browser and read once, at start-up; changing it reloads the page, so every
 * screen, printed sheet, receipt and label comes out in the language chosen,
 * with nothing left over from the other one.
 *
 * What the panel writes to the database stays in Spanish whatever the screen
 * is showing — the other computers, and the clients' app, read the same
 * records. Text the panel wrote earlier is put into English when it is shown,
 * with `tx()`.
 */

import { EN, PATTERNS } from './i18n-en.js';

const KEY = 'aguila.lang';

function stored() {
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'es'; } catch { return 'es'; }
}

let current = stored();
try { document.documentElement.lang = current; } catch { /* not in a browser */ }

/** "es" or "en". */
export const lang = () => current;

/** True while the panel is in English. */
export const english = () => current === 'en';

/** The locale the browser's own formatting is asked for. */
export const locale = () => (current === 'en' ? 'en-CA' : 'es-MX');

/**
 * Lines asked for in English that have no English yet — shown in Spanish
 * meanwhile. Read by the checks; nobody else needs it.
 */
export const missing = new Set();
try { globalThis.__i18nMissing = missing; } catch { /* nowhere to put it */ }

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (whole, name) => (
  vars[name] === undefined || vars[name] === null ? whole : String(vars[name])));

/**
 * The words, in the language of the screen.
 *
 * @param {string} text  the Spanish, with `{name}` where a value goes
 * @param {object} [vars] the values, already in the screen's language; `ctx`
 *   picks between Englishes for one Spanish word — `t('Después', { ctx: 'later' })`
 *   is "Later" on a button where a column's "Después" is "After"
 */
export function t(text, vars) {
  if (text === undefined || text === null) return '';
  let out = String(text);
  if (current === 'en') {
    const found = (vars?.ctx ? EN[`${vars.ctx}|${out}`] : undefined) ?? EN[out];
    if (found !== undefined) out = found;
    else if (/[a-záéíóúñ]/i.test(out)) missing.add(out);
  }
  return vars ? fill(out, vars) : out;
}

// A fortnight as receipts have it written: "12 – 25 mar", "28 feb – 13 mar".
const ES_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = `(${ES_MONTHS.join('|')})`;
const RANGE = new RegExp(`^(\\d{1,2})(?: ${MONTH})? – (\\d{1,2}) ${MONTH}$`);

function englishRange(value) {
  const found = RANGE.exec(value);
  if (!found) return null;
  const [, fromDay, fromMonth, toDay, toMonth] = found;
  const month = (es) => EN_MONTHS[ES_MONTHS.indexOf(es)];
  return fromMonth && fromMonth !== toMonth
    ? `${month(fromMonth)} ${fromDay} – ${month(toMonth)} ${toDay}`
    : `${month(toMonth)} ${fromDay} – ${toDay}`;
}

/**
 * Text the panel itself wrote to the database, in Spanish — a movement, the
 * outcome of something programmed, the fortnight a receipt paid for — put
 * into English when it is shown. Text a person typed (a note, a name, a
 * message) is never passed through here.
 */
export function tx(text) {
  if (current !== 'en' || !text) return text ?? '';
  const value = String(text);
  if (EN[value] !== undefined) return EN[value];
  const range = englishRange(value);
  if (range) return range;
  for (const [pattern, words] of PATTERNS) {
    if (pattern.test(value)) return value.replace(pattern, words);
  }
  return value;
}

/**
 * Runs `make` with the panel in Spanish, whatever the screen shows, and hands
 * back what it made. For words that leave this computer — a line written to
 * the database, a note sent to a client's chat — which are read by the other
 * computers and by the clients' app, all of them in Spanish. Synchronous only.
 */
export function inSpanish(make) {
  const was = current;
  current = 'es';
  try { return make(); } finally { current = was; }
}

/** Changes the language of this computer, and starts again in it. */
export function setLang(next) {
  const value = next === 'en' ? 'en' : 'es';
  if (value === current) return;
  try { localStorage.setItem(KEY, value); } catch { /* the choice lasts this visit */ }
  current = value;
  location.reload();
}
