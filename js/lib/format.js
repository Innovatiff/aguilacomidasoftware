/** Number, money and name formatting. Currency is CAD across both apps. */

export const CURRENCY = 'CAD';

const money0 = new Intl.NumberFormat('en-CA', {
  style: 'currency', currency: CURRENCY,
  minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const money2 = new Intl.NumberFormat('en-CA', {
  style: 'currency', currency: CURRENCY,
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const plain = new Intl.NumberFormat('en-CA');

/** "$1,240.00" — pass { round: true } for "$1,240" in dense tiles. */
export function money(amount, { round = false } = {}) {
  const value = Number(amount) || 0;
  return round ? money0.format(value) : money2.format(value);
}

/** "$1,240.00 CAD" — for invoice totals, where the currency should be explicit. */
export function moneyFull(amount) {
  return `${money(amount)} ${CURRENCY}`;
}

export const number = (value) => plain.format(Number(value) || 0);

/** "3 comidas" / "1 comida" */
export function plural(count, one, many) {
  const n = Number(count) || 0;
  return `${number(n)} ${n === 1 ? one : many}`;
}

/** Up to two initials for the avatar. */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** "Rancho El Sol" -> "Rancho El Sol"; trims and collapses whitespace. */
export const clean = (text) => String(text ?? '').trim().replace(/\s+/g, ' ');

/** Digits-only phone, formatted for display: "(604) 555-0143". */
export function phone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return String(raw || '');
}

export const telHref = (raw) => `tel:${String(raw || '').replace(/[^\d+]/g, '')}`;

/** Percentage 0–100, clamped, no decimals. */
export function percent(part, whole) {
  if (!whole) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

/**
 * Accent- and case-insensitive form of a string, for searching.
 *
 * Staff type "pena" and expect to find "Peña", so the comparison happens on a
 * folded copy: decompose to base letter plus combining mark (NFD), then drop
 * the marks.
 */
export const fold = (text) =>
  String(text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** True when every needle word appears somewhere in `fields`. */
export function matches(fields, term) {
  const words = fold(term).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.filter(Boolean).map(fold).join(' ');
  return words.every((word) => hay.includes(word));
}
