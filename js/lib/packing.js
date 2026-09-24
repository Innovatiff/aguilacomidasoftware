/**
 * Empaque — turning the roster into the order the plates get packed in.
 *
 * Two people pack the kitchen's food each morning, on two computers, from two
 * lists. A *libreta* is one of those lists: a set of farms the manager assigned
 * to it, in the order they should be worked through. Everything here is about
 * producing that order and nothing else — no Firestore, so the sequence a
 * packer walks can be checked against a handful of objects in a test rather
 * than against a screenshot.
 *
 * Three rules decide who appears:
 *
 *   **Only people being served.** Somebody paused, or whose last day has
 *   passed, is not packed for. The caller hands in the roster already filtered,
 *   the same way the report does, so "still being served" has one definition in
 *   this app and not three.
 *
 *   **Only people who eat today.** A client's week is their own — Ana takes
 *   Monday to Friday — and a Saturday list that includes her is a plate that
 *   gets made and thrown away.
 *
 *   **In the order of the paper book.** Farm, then location, then name. The
 *   people doing this worked from that book for years; the machine should not
 *   ask them to learn a new order to do the same job.
 */

import { mealsOn } from './pricing.js';
import { weekdayOf, today as todayKey } from '../lib/dates.js';

/** The two lists the kitchen packs from. Named so the manager can rename them. */
export const DEFAULT_LINES = [
  { id: 'l1', name: 'Libreta 1', farmIds: [] },
  { id: 'l2', name: 'Libreta 2', farmIds: [] },
];

/**
 * The stored setup, with anything missing filled in.
 *
 * Always exactly two libretas: the kitchen has two computers and two people,
 * and a setup screen that can grow a third is a setup screen with a question
 * on it nobody asked. If that changes it is a one-line change here.
 */
export function normalizePacking(data) {
  const stored = Array.isArray(data?.lines) ? data.lines : [];

  return {
    lines: DEFAULT_LINES.map((fallback, i) => {
      const line = stored[i] || {};
      return {
        id: fallback.id,
        name: String(line.name || '').trim() || fallback.name,
        // De-duplicated, because a farm packed twice is a farm whose people get
        // two plates each and a count that never reconciles.
        farmIds: [...new Set((Array.isArray(line.farmIds) ? line.farmIds : []).filter(Boolean))],
      };
    }),
  };
}

/** The libreta with this id, or null. */
export const lineOf = (lines, id) => (lines || []).find((line) => line.id === id) || null;

/** Which libreta a farm belongs to, or null when nobody has assigned it. */
export const lineOfFarm = (lines, farmId) =>
  (lines || []).find((line) => line.farmIds.includes(farmId)) || null;

/**
 * Farms nobody assigned to a libreta.
 *
 * The thing that goes wrong with a setup like this is a farm registered in
 * March that nobody adds to a list, whose people are then quietly not packed
 * for. So it is counted and said out loud rather than left to be noticed.
 */
export const unassignedFarms = (lines, farms) =>
  (farms || []).filter((farm) => !lineOfFarm(lines, farm.id));

/* --- The order of the morning ---------------------------------------------- */

/**
 * @param {object}   input.line     the libreta being packed
 * @param {object[]} input.farms    every farm, to resolve ids and locations
 * @param {object[]} input.clients  the roster, already filtered to who is served
 * @param {string}   [input.day]    the day being packed
 *
 * @returns {object} `{ farms, slides, people, plates, missing }`
 *   farms    `[{ farm, groups: [{ place, clients }], people, plates }]`
 *   slides   what the screen walks through, one thing per screen
 *   missing  ids in the libreta that no longer match a farm
 */
export function packingSequence({ line, farms = [], clients = [], day = todayKey() }) {
  const weekday = weekdayOf(day);
  const byId = new Map(farms.map((farm) => [farm.id, farm]));
  const missing = [];
  const out = [];

  for (const farmId of line?.farmIds || []) {
    const farm = byId.get(farmId);
    if (!farm) { missing.push(farmId); continue; }

    const roster = clients
      .filter((client) => client.farmId === farm.id)
      .filter((client) => mealsOn(client, weekday) > 0);

    const groups = [];
    for (const place of farm.locations || []) {
      const here = roster.filter((client) => client.locationId === place.id);
      if (here.length) groups.push({ place, clients: here.sort(byName) });
    }

    // Anybody whose location was removed still has to be packed for, or they
    // vanish from the only list that decides whether they eat.
    const known = new Set((farm.locations || []).map((place) => place.id));
    const adrift = roster.filter((client) => !known.has(client.locationId));
    if (adrift.length) {
      groups.push({ place: { id: '', name: 'Sin ubicación' }, clients: adrift.sort(byName) });
    }

    const people = groups.reduce((sum, group) => sum + group.clients.length, 0);
    if (!people) continue;

    out.push({
      farm,
      groups,
      people,
      plates: groups.reduce((sum, group) =>
        sum + group.clients.reduce((n, client) => n + mealsOn(client, weekday), 0), 0),
    });
  }

  // One screen per thing: the farm you are starting, then its people one at a
  // time. The index on each slide is what the progress bar and "vas en 12 de
  // 34" are read from, so it is worked out once here rather than by the screen.
  const slides = [];
  for (const entry of out) {
    slides.push({ kind: 'farm', farm: entry.farm, people: entry.people, plates: entry.plates });
    for (const group of entry.groups) {
      for (const client of group.clients) {
        slides.push({
          kind: 'client',
          client,
          farm: entry.farm,
          place: group.place,
          plates: mealsOn(client, weekday),
        });
      }
    }
  }
  if (slides.length) slides.push({ kind: 'done' });

  return {
    farms: out,
    slides,
    people: out.reduce((sum, entry) => sum + entry.people, 0),
    plates: out.reduce((sum, entry) => sum + entry.plates, 0),
    missing,
  };
}

const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'es');

/* --- Who is at the keyboard -------------------------------------------------- */

/**
 * The packer whose number this is.
 *
 * Not a password, and nothing here pretends otherwise: the screen it opens
 * already sits inside the panel, behind a signed-in kitchen account. The number
 * answers "whose name goes on this morning's list", which is a question about
 * bookkeeping rather than about access — the same job a punch card does.
 */
export function packerByPin(packers, pin) {
  const typed = String(pin || '').trim();
  if (typed.length < 3) return null;
  return (packers || []).find((packer) => packer.active !== false
    && String(packer.pin || '').trim() === typed) || null;
}

/** True when two packers share a number, which would make the name a coin toss. */
export const duplicatePins = (packers) => {
  const seen = new Set();
  const clashes = new Set();
  for (const packer of packers || []) {
    const pin = String(packer.pin || '').trim();
    if (!pin) continue;
    if (seen.has(pin)) clashes.add(pin);
    seen.add(pin);
  }
  return [...clashes];
};
