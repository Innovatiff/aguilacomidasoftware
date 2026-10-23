/**
 * Novedades — what changed among the clients, for the kitchen.
 *
 * The kitchen cooks from the board in the morning; the office registers
 * people, pauses them and brings them back all day. Nothing used to tell the
 * kitchen. A client registered at ten o'clock was on the libreta at noon and
 * nowhere in the food that had been cooked at eight.
 *
 * So every change that moves the food is listed here, by day, newest first,
 * with what it does to today's plates:
 *
 *   nuevo    registered that day (`createdAt`)
 *   pausa    put on pause (`statusLog`)
 *   termino  paused by itself the day after their last day (`auto`)
 *   volvio   back on the plan
 *   baja     marked as no longer ordering
 *   ultimo   today or tomorrow is their last day (`endsOn`) — said ahead,
 *            listed under today
 *   empieza  registered ahead, and today is the day they start
 *   programado  a change the Programador makes: listed on the day it is
 *            coming, for the next week, and on the day it was made
 *
 * Everything is read from what is already stored on each client: nothing new
 * is written to make this list, so nothing can be forgotten to be written.
 */

import { mealsOn } from './pricing.js';
import { packingLineOf } from './packing.js';
import { changeWords, comingUp, isClientChange } from './schedule.js';
import { addDays, dayOf, weekdayOf, today as todayKey } from './dates.js';

const startOf = (day) => new Date(`${day}T00:00:00`).getTime();

/** A stamp as milliseconds: a Timestamp, a Date, a number, or nothing. */
function msOf(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return 0;
}

/**
 * @param {object}   input
 * @param {object[]} input.clients  everybody, whatever their status
 * @param {object[]} [input.lines]  the libretas, to say where somebody new is packed
 * @param {string}   [input.day]    today
 * @param {number}   [input.days]   how far back, today included
 * @returns {{ day: string, items: object[] }[]} newest day first; each item
 *   `{ kind, client, at, plates, line }` — `plates` is what it does to that
 *   day's food when that day is today (+2, −1), `line` where they are packed
 *   ('' for nowhere, null when it does not apply)
 */
export function novedades({
  clients = [], lines = [], day = todayKey(), days = 7, scheduled = [], farms = [],
}) {
  const first = addDays(day, -(days - 1));
  const tomorrow = addDays(day, 1);
  const weekday = weekdayOf(day);
  const plates = (client) => mealsOn(client, weekday);
  const where = (client) => {
    const line = client.farmId ? packingLineOf(lines, client.farmId, client.locationId) : null;
    return line ? line.name : '';
  };

  const items = [];
  for (const client of clients) {
    const made = dayOf(client.createdAt);
    if (made && made >= first && made <= day) {
      items.push({
        kind: 'nuevo', client, on: made, at: msOf(client.createdAt),
        plates: made === day && client.status === 'active' ? plates(client) : 0,
        line: where(client),
      });
    }

    for (const entry of Array.isArray(client.statusLog) ? client.statusLog : []) {
      if (!entry?.on || entry.on < first || entry.on > day) continue;
      const kind = entry.status === 'active' ? (client.startsOn === entry.on ? 'empieza' : 'volvio')
        : entry.status === 'inactive' ? 'baja'
          : entry.auto ? 'termino' : 'pausa';
      const today = entry.on === day;
      items.push({
        kind, client, on: entry.on,
        at: Number(entry.at) || startOf(entry.on),
        plates: !today ? 0 : kind === 'volvio' ? plates(client) : -plates(client),
        line: kind === 'volvio' || kind === 'empieza' ? where(client) : null,
      });
    }

    // Said ahead: somebody whose last day is today is still packed today, and
    // gone tomorrow — the kitchen wants to know before, not after.
    if (client.status === 'active' && (client.endsOn === day || client.endsOn === tomorrow)) {
      items.push({
        kind: 'ultimo', client, on: day, at: startOf(day), plates: 0, line: null,
        last: client.endsOn,
      });
    }
  }

  // What the Programador is going to do in the next week, and what it did today
  // to a plan (status changes already come in through the record above).
  const byId = new Map(clients.map((client) => [client.id, client]));
  const asClient = (set) => byId.get(set.clientId) || { id: set.clientId, name: set.clientName || '' };
  for (const set of comingUp(scheduled, day, days)) {
    items.push({
      kind: 'programado', client: asClient(set), on: set.on, at: startOf(set.on), plates: 0,
      line: null, text: set.kind === 'start' ? 'empieza' : changeWords(set, farms), until: set.until,
    });
  }
  for (const set of scheduled) {
    if (set.on !== day || !['active', 'done'].includes(set.state) || set.result?.skipped) continue;
    if (!isClientChange(set.kind) || ['status', 'start', 'info'].includes(set.kind) || !set.before) continue;
    const client = byId.get(set.clientId);
    if (!client) continue;
    const before = set.kind === 'diet' ? client : { ...client, ...set.before };
    items.push({
      kind: 'programado', client, on: day,
      at: set.appliedAt?.toMillis?.() || msOf(set.appliedAt) || startOf(day),
      plates: client.status === 'active' ? plates(client) - plates(before) : 0,
      line: set.kind === 'location' ? where(client) : null,
      text: changeWords(set, farms), until: set.until,
    });
  }

  const byDay = new Map();
  for (const item of items) {
    if (!byDay.has(item.on)) byDay.set(item.on, []);
    byDay.get(item.on).push(item);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([on, list]) => ({
      day: on,
      items: list.sort((a, b) => b.at - a.at
        || String(a.client.name).localeCompare(String(b.client.name), 'es')),
    }));
}

/** How many of today's novedades came in after `seenAt` (ms). */
export const unseenToday = (groups, day, seenAt = 0) =>
  (groups.find((group) => group.day === day)?.items || [])
    .filter((item) => item.kind !== 'ultimo' && item.at > seenAt).length;
