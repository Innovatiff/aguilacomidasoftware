/**
 * Date helpers.
 *
 * Anything that identifies a *day* — a delivery day, a billing period edge —
 * is stored as a "YYYY-MM-DD" key, never a timestamp. A day is a calendar
 * concept, not an instant; keys keep Firestore queries trivial and remove a
 * whole class of timezone bugs between the kitchen's phone and the farm's.
 */

import { english } from './i18n.js';

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today() {
  return dayKey(new Date());
}

/** Parses "YYYY-MM-DD" into a Date at local midnight. */
export function parseDay(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(key, amount) {
  const date = parseDay(key);
  date.setDate(date.getDate() + amount);
  return dayKey(date);
}

/** Whole days from `a` to `b`; negative when `b` precedes `a`. */
export function daysBetween(a, b) {
  // Compare at UTC noon so a DST shift can never add or shave a day.
  const utc = (key) => {
    const [y, m, d] = String(key).split('-').map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1, 12);
  };
  return Math.round((utc(b) - utc(a)) / 86400000);
}

const NAMES = {
  es: {
    weekdays: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
    weekdaysShort: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
    months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
      'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    monthsShort: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  },
  en: {
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'],
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
};

// Asked at every call rather than once: words written to the database are
// made in Spanish even on a computer reading English (see `inSpanish`).
const ENGLISH = () => english();
const names = () => (english() ? NAMES.en : NAMES.es);

/** The day names in the screen's language, Sunday first. */
export const WEEKDAYS = names().weekdays;
export const WEEKDAYS_SHORT = names().weekdaysShort;

export const weekdayOf = (key) => parseDay(key).getDay();
export const weekdayName = (key) => names().weekdays[weekdayOf(key)];
export const weekdayShort = (key) => names().weekdaysShort[weekdayOf(key)];

/** "12 de marzo" · "March 12" */
export function formatDay(key) {
  const d = parseDay(key);
  return ENGLISH() ? `${names().months[d.getMonth()]} ${d.getDate()}` : `${d.getDate()} de ${names().months[d.getMonth()]}`;
}

/** "12 mar" · "Mar 12" — compact, for dense rows. */
export function formatDayShort(key) {
  const d = parseDay(key);
  return ENGLISH() ? `${names().monthsShort[d.getMonth()]} ${d.getDate()}` : `${d.getDate()} ${names().monthsShort[d.getMonth()]}`;
}

/**
 * "miércoles 12 de marzo de 2026" · "Wednesday, March 12, 2026".
 * `{ year: false }` leaves the year off.
 */
export function formatDayLong(key, { year = true } = {}) {
  const d = parseDay(key);
  if (ENGLISH()) {
    return `${names().weekdays[d.getDay()]}, ${names().months[d.getMonth()]} ${d.getDate()}${year ? `, ${d.getFullYear()}` : ''}`;
  }
  return `${names().weekdays[d.getDay()]} ${d.getDate()} de ${names().months[d.getMonth()]}${year ? ` de ${d.getFullYear()}` : ''}`;
}

/** "octubre" · "October" — the month a day is in, by itself. */
export const monthName = (key) => names().months[parseDay(key).getMonth()];

/** "Octubre 2026" — a calendar's heading. */
export function formatMonth(key) {
  const d = parseDay(key);
  return `${capitalize(names().months[d.getMonth()])} ${d.getFullYear()}`;
}

/** The first day of the month `amount` months from the one `key` is in. */
export function addMonths(key, amount) {
  const d = parseDay(key);
  return dayKey(new Date(d.getFullYear(), d.getMonth() + amount, 1));
}

/** "12 – 25 mar" · "Mar 12 – 25", collapsing the month when both ends share it. */
export function formatRange(start, end) {
  const a = parseDay(start), b = parseDay(end);
  if (ENGLISH()) {
    const right = a.getMonth() === b.getMonth()
      ? String(b.getDate())
      : `${names().monthsShort[b.getMonth()]} ${b.getDate()}`;
    return `${names().monthsShort[a.getMonth()]} ${a.getDate()} – ${right}`;
  }
  const left = a.getMonth() === b.getMonth()
    ? String(a.getDate())
    : `${a.getDate()} ${names().monthsShort[a.getMonth()]}`;
  return `${left} – ${b.getDate()} ${names().monthsShort[b.getMonth()]}`;
}

/** "Hoy" / "Mañana" / "Ayer" / weekday / date — whichever reads best. */
export function relativeDay(key, from = today()) {
  const diff = daysBetween(from, key);
  if (diff === 0) return ENGLISH() ? 'Today' : 'Hoy';
  if (diff === 1) return ENGLISH() ? 'Tomorrow' : 'Mañana';
  if (diff === -1) return ENGLISH() ? 'Yesterday' : 'Ayer';
  if (diff > 1 && diff < 7) return capitalize(weekdayName(key));
  return formatDay(key);
}

/** "en 3 días" / "hace 2 días" / "hoy" · "in 3 days" / "2 days ago" / "today" */
export function humanDelta(days) {
  if (ENGLISH()) {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
    return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
  }
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  if (days === -1) return 'ayer';
  return days > 0 ? `en ${days} días` : `hace ${Math.abs(days)} días`;
}

export function formatTime(value) {
  const date = asDate(value);
  if (!date) return '';
  if (ENGLISH()) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })
    .replace(/\s?([ap])\.?\s?m\.?/i, (_, p) => ` ${p.toLowerCase()}.m.`);
}

/**
 * A Date, from a Date or from a Firestore Timestamp.
 *
 * Firestore hands back Timestamps, and every one of these helpers used to
 * assume its caller had already converted. Accepting both is one line here and
 * removes a whole class of "not a function" the moment a new screen renders a
 * stamp it read straight from a document.
 */
function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'number' || typeof value === 'string') return new Date(value);
  return null;
}

/**
 * The day a stamp fell on, as a "YYYY-MM-DD" key, or null.
 *
 * Firestore stores "when this client was registered" as a Timestamp — an
 * instant — while everything that asks about it ("was anybody registered in
 * September?") is asking about a calendar day. This is the one place that
 * conversion happens, so it happens in the reader's timezone once rather than
 * in three screens slightly differently.
 */
export function dayOf(value) {
  const date = asDate(value);
  return date ? dayKey(date) : null;
}

/** Chat stamp: time today, "Ayer", weekday this week, date beyond. */
export function formatStamp(value) {
  const date = asDate(value);
  if (!date) return '';
  const diff = daysBetween(dayKey(date), today());
  if (diff === 0) return formatTime(date);
  if (diff === 1) return ENGLISH() ? 'Yesterday' : 'Ayer';
  if (diff < 7) return capitalize(weekdayShort(dayKey(date)));
  return formatDayShort(dayKey(date));
}

/** Inclusive list of day keys. */
export function dayRange(start, end) {
  const out = [];
  for (let i = 0, n = daysBetween(start, end); i <= n; i++) out.push(addDays(start, i));
  return out;
}

export function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

/** Greeting used on the home screens. */
export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (ENGLISH()) return hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening';
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}
