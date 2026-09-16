/**
 * Calendar periods, for the report.
 *
 * The rest of the app thinks in *billing* periods — a person's fortnight, cut
 * from their own anchor, which is a different span for every client. A report
 * cannot work that way: "how did September go?" has one answer for the whole
 * business, and it is a calendar question. So these are plain calendar spans —
 * a day, a week, a month, a year — expressed the way everything else here
 * expresses a day, as a pair of "YYYY-MM-DD" keys.
 *
 * A week runs Monday to Sunday. That is the Spanish convention, and it happens
 * to suit this kitchen exactly: collections are Wednesdays and Saturdays, so a
 * Monday week holds one of each and never splits a pair across two weeks.
 */

import {
  today, parseDay, dayKey, addDays, daysBetween,
  formatDayLong, formatDayShort, formatRange, capitalize,
} from './dates.js';

export const GRAINS = ['day', 'week', 'month', 'year'];

export const GRAIN_LABEL = {
  day: 'Día', week: 'Semana', month: 'Mes', year: 'Año', custom: 'Personalizado',
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const yearOf = (key) => parseDay(key).getFullYear();

/** Monday of the week `key` falls in. */
function weekStart(key) {
  const shift = (parseDay(key).getDay() + 6) % 7;   // Sunday 0 -> 6, Monday 1 -> 0
  return addDays(key, -shift);
}

/** The span of `grain` that contains `anchor`. */
export function rangeFor(grain, anchor = today()) {
  const date = parseDay(anchor);

  if (grain === 'week') {
    const start = weekStart(anchor);
    return { grain, start, end: addDays(start, 6) };
  }
  if (grain === 'month') {
    return {
      grain,
      start: dayKey(new Date(date.getFullYear(), date.getMonth(), 1)),
      // Day zero of the next month is the last day of this one, leap years
      // included — which is why this is arithmetic rather than a table.
      end: dayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
    };
  }
  if (grain === 'year') {
    return {
      grain,
      start: dayKey(new Date(date.getFullYear(), 0, 1)),
      end: dayKey(new Date(date.getFullYear(), 11, 31)),
    };
  }
  return { grain: 'day', start: anchor, end: anchor };
}

/** A hand-picked span. The two dates are sorted, so either order works. */
export function customRange(from, to) {
  const [start, end] = [from, to].sort();
  return { grain: 'custom', start, end };
}

/** The same grain, `delta` periods along. */
export function shiftRange(range, delta) {
  const date = parseDay(range.start);

  if (range.grain === 'day') return rangeFor('day', addDays(range.start, delta));
  if (range.grain === 'week') return rangeFor('week', addDays(range.start, delta * 7));
  if (range.grain === 'month') {
    return rangeFor('month', dayKey(new Date(date.getFullYear(), date.getMonth() + delta, 1)));
  }
  if (range.grain === 'year') {
    return rangeFor('year', dayKey(new Date(date.getFullYear() + delta, 0, 1)));
  }

  // A hand-picked span slides by its own length, so "the previous one" is the
  // same number of days immediately before it.
  const span = spanOf(range);
  return customRange(addDays(range.start, delta * span), addDays(range.end, delta * span));
}

/** Days in the range, both ends included. */
export const spanOf = (range) => daysBetween(range.start, range.end) + 1;

/** True when the range holds `day` — what makes the period "the one we are in". */
export const rangeHolds = (range, day = today()) => day >= range.start && day <= range.end;

/** True when nothing after this range has happened yet: no point offering "next". */
export const isFuture = (range, day = today()) => range.start > day;

/** The headline: "Septiembre de 2026", "Miércoles 16 de septiembre de 2026". */
export function rangeTitle(range) {
  if (range.grain === 'day') return capitalize(formatDayLong(range.start));
  if (range.grain === 'month') {
    return `${capitalize(MONTHS[parseDay(range.start).getMonth()])} de ${yearOf(range.start)}`;
  }
  if (range.grain === 'year') return String(yearOf(range.start));
  return rangeSpan(range);
}

/**
 * "14 – 20 sep 2026" — the exact span, spelled the same way everywhere it is
 * quoted: under the picker, on the printed header, in the file name.
 *
 * A range that crosses new year spells both, because "28 dic – 3 ene" without
 * them is a span nobody can place.
 */
export function rangeSpan(range) {
  const from = yearOf(range.start), to = yearOf(range.end);
  if (from !== to) return `${formatDayShort(range.start)} ${from} – ${formatDayShort(range.end)} ${to}`;
  return `${formatRange(range.start, range.end)} ${to}`;
}

/** "7 días" — the denominator under every average on the page. */
export const rangeDays = (range) => spanOf(range);

/**
 * How to cut the range up for the chart and the table.
 *
 * By days while a table of them still reads — a month is thirty-one rows,
 * which is a page; a year is three hundred and sixty-five, which is nothing.
 * Then by weeks, then by months. The thresholds are about what a person can
 * take in, not about the data.
 */
export function bucketsOf(range) {
  const span = spanOf(range);
  if (span <= 31) return daily(range);
  if (span <= 186) return weekly(range);
  return monthly(range);
}

function daily(range) {
  return Array.from({ length: spanOf(range) }, (unused, i) => {
    const day = addDays(range.start, i);
    return { grain: 'day', start: day, end: day, label: capitalize(formatDayShort(day)), short: String(parseDay(day).getDate()) };
  });
}

function weekly(range) {
  const out = [];
  for (let cursor = weekStart(range.start); cursor <= range.end; cursor = addDays(cursor, 7)) {
    // Clipped to the range: a month that starts on a Thursday must not report
    // the Monday before it as part of its first week.
    const start = cursor < range.start ? range.start : cursor;
    const end = addDays(cursor, 6) > range.end ? range.end : addDays(cursor, 6);
    out.push({ grain: 'week', start, end, label: formatRange(start, end), short: String(parseDay(start).getDate()) });
  }
  return out;
}

function monthly(range) {
  const out = [];
  const first = parseDay(range.start);
  for (let i = 0; ; i += 1) {
    const monthStart = dayKey(new Date(first.getFullYear(), first.getMonth() + i, 1));
    if (monthStart > range.end) break;
    const monthEnd = dayKey(new Date(first.getFullYear(), first.getMonth() + i + 1, 0));
    const start = monthStart < range.start ? range.start : monthStart;
    const end = monthEnd > range.end ? range.end : monthEnd;
    out.push({
      grain: 'month',
      start,
      end,
      label: capitalize(MONTHS[parseDay(monthStart).getMonth()]),
      short: MONTHS[parseDay(monthStart).getMonth()].slice(0, 3),
    });
  }
  return out;
}
