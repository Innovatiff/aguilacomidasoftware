/**
 * Writing movements down, and reading a span of them back.
 *
 * `movements/{id}` is a line per change that the rest of the database would
 * otherwise write over: one comida became two, a note, a new location, a
 * balance put right. Payments, debts, pauses, messages and new clients are not
 * written here: they already keep their own record with its moment, and the
 * report reads them from there (js/lib/movements.js), so nothing is told twice.
 *
 * **A movement never stops a change.** It is written apart from the change it
 * describes, after it, and a refusal is swallowed: with the new rules not yet
 * published, or the day's allowance spent, the meal count still changes and the
 * payment still goes in — only the line about it is missing. The record serves
 * the work; it does not get to block it.
 */

import {
  db, doc, collection, collectionGroup, query, where, getDocs, setDoc, serverTimestamp, listData,
  Timestamp,
} from '../firebase.js';
import { today } from '../lib/dates.js';
import { clientChanges } from '../lib/movements.js';

const ref = () => collection(db, 'movements');

/**
 * The lines this computer wrote this session, shown straight away: a report
 * open on today would otherwise not hear of the meal count it just changed
 * until somebody pressed "Volver a leer". A line the database turns down is
 * taken back out, so the screen never shows a record that does not exist.
 */
const mine = [];

// Who is doing it, and how a client looked before — handed in at start-up by
// the app and the store, so this file reads neither and they can both use it.
let actor = () => '';
let lookup = () => null;
export const setActor = (fn) => { actor = fn; };
export const setClientLookup = (fn) => { lookup = fn; };

/**
 * One line. Never awaited by the change it describes, never throws.
 *
 * @param {object} entry  `{ kind, text, clientId?, clientName?, farmId?, farmName?, by? }`
 */
export function logMovement(entry) {
  if (!entry?.kind || !entry?.text) return;
  try {
    const client = entry.clientId ? lookup(entry.clientId) : null;
    const target = doc(ref());
    const line = {
      kind: entry.kind,
      text: String(entry.text).slice(0, 500),
      clientId: entry.clientId || '',
      clientName: entry.clientName || client?.name || '',
      farmId: entry.farmId || client?.farmId || '',
      farmName: entry.farmName || client?.farmName || '',
      by: entry.by || actor() || '',
      day: today(),
      ms: Date.now(),
    };
    const held = { id: target.id, ...line };
    mine.push(held);
    if (mine.length > 400) mine.shift();
    setDoc(target, { ...line, at: serverTimestamp() }).catch(() => {
      const at = mine.indexOf(held);
      if (at >= 0) mine.splice(at, 1);
    });
  } catch { /* the record serves the work; it never stops it */ }
}

/**
 * What a write to a client changes, field by field, as movements — worked out
 * against the client as this computer has them before the write lands.
 */
export function logClientChanges(clientId, patch, { by, prefix = '', before = null } = {}) {
  const was = before || lookup(clientId) || {};
  for (const change of clientChanges(was, patch)) {
    logMovement({ ...change, text: `${prefix}${change.text}`, clientId, clientName: was.name, by });
  }
}

/** Who is doing this, for the records that carry a name of their own. */
export const actorName = () => actor() || '';

/** A client as this computer has them now — taken before a write, to compare after. */
export const clientBefore = (clientId) => {
  const found = lookup(clientId);
  return found ? JSON.parse(JSON.stringify(found)) : null;
};

/* --- Reading a span back ------------------------------------------------- */

// Kept like the report's own reads (js/data/reports.js): a span that is over
// is a fact and is read once a session; the span with today in it is read
// every time it is opened. Messages are the costly half — a month of threads —
// so a finished month is never paid for twice.
const cache = new Map();
const inFlight = new Map();
const keyOf = (range) => `${range.start}|${range.end}`;
const settled = (range) => range.end < today();

/** The span, if it is over and was already read without trouble. */
export const cachedMovements = (range) => (settled(range) ? cache.get(keyOf(range)) || null : null);

/** Forgets every span and every line of this session — on sign-out. */
export const forgetMovements = () => { cache.clear(); inFlight.clear(); mine.length = 0; };

/** What was read, plus what this computer has written since. */
export function withMine(found, range) {
  if (!found) return null;
  const seen = new Set(found.logged.map((one) => one.id));
  const extra = mine.filter((one) => !seen.has(one.id) && one.day >= range.start && one.day <= range.end);
  return extra.length ? { ...found, logged: [...found.logged, ...extra] } : found;
}

/**
 * The span's movements and messages.
 *
 * Messages are read across every client's thread at once (a collection group):
 * that needs its own index the first time, and the error that asks for it says
 * where to click. Without it the rest of the movements still show.
 */
export async function loadMovements(range, { fresh = false } = {}) {
  const key = keyOf(range);
  if (fresh) { cache.delete(key); inFlight.delete(key); }
  if (!fresh && settled(range) && cache.has(key)) return cache.get(key);
  if (!inFlight.has(key)) {
    inFlight.set(key, readSpan(range).then((found) => {
      // Only a clean read is kept: a missing index or rule is fixed in the
      // console, and the next look should see the fix without a sign-out.
      if (settled(range) && !found.loggedError && !found.messagesError) cache.set(key, found);
      return found;
    }).finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

async function readSpan(range) {
  const [logged, messages] = await Promise.all([
    getDocs(query(ref(), where('day', '>=', range.start), where('day', '<=', range.end)))
      .then((rows) => ({ rows: listData(rows) }))
      .catch((error) => ({ rows: [], error })),
    getDocs(query(collectionGroup(db, 'messages'),
      where('at', '>=', Timestamp.fromDate(new Date(`${range.start}T00:00:00`))),
      where('at', '<=', Timestamp.fromDate(new Date(`${range.end}T23:59:59.999`)))))
      .then((snap) => ({
        rows: snap.docs.map((one) => ({ id: one.id, clientId: one.ref.parent.parent?.id || '', ...one.data() })),
      }))
      .catch((error) => ({ rows: [], error })),
  ]);
  return {
    logged: logged.rows, loggedError: logged.error || null,
    messages: messages.rows, messagesError: messages.error || null,
  };
}
