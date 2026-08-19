/**
 * Date helpers.
 *
 * Anything that identifies a *day* — a delivery day, a billing period edge —
 * is stored as a "YYYY-MM-DD" key, never a timestamp. A day is a calendar
 * concept, not an instant; keys keep Firestore queries trivial and remove a
 * whole class of timezone bugs between the kitchen's phone and the farm's.
 */

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

export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const weekdayOf = (key) => parseDay(key).getDay();
export const weekdayName = (key) => WEEKDAYS[weekdayOf(key)];
export const weekdayShort = (key) => WEEKDAYS_SHORT[weekdayOf(key)];

/** "12 de marzo" */
export function formatDay(key) {
  const d = parseDay(key);
  return `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

/** "12 mar" — compact, for dense rows. */
export function formatDayShort(key) {
  const d = parseDay(key);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** "miércoles 12 de marzo de 2026" */
export function formatDayLong(key) {
  const d = parseDay(key);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

/** "12 mar – 25 mar", collapsing the month when both ends share it. */
export function formatRange(start, end) {
  const a = parseDay(start), b = parseDay(end);
  const left = a.getMonth() === b.getMonth()
    ? String(a.getDate())
    : `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]}`;
  return `${left} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
}

/** "Hoy" / "Mañana" / "Ayer" / weekday / date — whichever reads best. */
export function relativeDay(key, from = today()) {
  const diff = daysBetween(from, key);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  if (diff > 1 && diff < 7) return capitalize(weekdayName(key));
  return formatDay(key);
}

/** "en 3 días" / "hace 2 días" / "hoy" */
export function humanDelta(days) {
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  if (days === -1) return 'ayer';
  return days > 0 ? `en ${days} días` : `hace ${Math.abs(days)} días`;
}

export function formatTime(value) {
  if (!value) return '';
  return value.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })
    .replace(/\s?([ap])\.?\s?m\.?/i, (_, p) => ` ${p.toLowerCase()}.m.`);
}

/** Chat stamp: time today, "Ayer", weekday this week, date beyond. */
export function formatStamp(value) {
  if (!value) return '';
  const diff = daysBetween(dayKey(value), today());
  if (diff === 0) return formatTime(value);
  if (diff === 1) return 'Ayer';
  if (diff < 7) return capitalize(weekdayShort(dayKey(value)));
  return formatDayShort(dayKey(value));
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
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}
