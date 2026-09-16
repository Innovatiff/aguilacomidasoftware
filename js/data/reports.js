/**
 * Reading a period out of Firestore, once.
 *
 * Every other screen in the panel works off live listeners the store keeps
 * open for the whole session. A report cannot: it asks about spans the app is
 * not watching — last March, all of 2025 — and those are one-shot questions
 * with one-shot answers.
 *
 * **Two queries per period, and both are cheap to index.** Receipts carry the
 * day they were taken and bills carry the day their period opens, both as
 * "YYYY-MM-DD" strings, so each is a range over a single field — the kind of
 * index Firestore creates by itself. Nothing to publish in the console before
 * the screen works.
 *
 * **What it costs, and why it is asked for.** Firestore bills per document
 * returned. A month of a few hundred people is roughly a thousand documents,
 * a year is twelve times that — which is nothing against a day's allowance,
 * but it is not nothing against *twenty* idle reloads, and this panel has been
 * taken off the air once already by a screen that re-asked an expensive
 * question on every render. So: it is asked when somebody opens a period, the
 * answer is kept for as long as the session lasts, and moving back to a period
 * already looked at costs nothing at all. Re-asking is a deliberate act with a
 * button on it.
 */

import { db, collection, query, where, getDocs, listData } from '../firebase.js';

/** "2026-09-01|2026-09-30" -> the documents behind that span. */
const cache = new Map();

/**
 * The same key, while its read is still in the air.
 *
 * Flicking to another period and back before the first answer lands would
 * otherwise send the identical pair of queries twice — the cache is only filled
 * when the first one returns, so until then it cannot stop anything. Everybody
 * asking for a period that is already being read joins that read.
 */
const inFlight = new Map();

const keyOf = (range) => `${range.start}|${range.end}`;

/** The period, if it has already been read this session. */
export const cachedPeriod = (range) => cache.get(keyOf(range)) || null;

/** Forgets one period, so the next look asks Firestore again. */
export const forgetPeriod = (range) => { cache.delete(keyOf(range)); inFlight.delete(keyOf(range)); };

/**
 * Forgets every period.
 *
 * Called on sign-out for the same reason the billing scan is: what one account
 * read is not the next account's to see, and a cache that outlives the session
 * that filled it is a cache that hands somebody else's books over.
 */
export const forgetPeriods = () => { cache.clear(); inFlight.clear(); };

/**
 * Everything that happened between two days.
 *
 * The two queries go out together rather than one after the other. Neither
 * needs the other's answer, so a year's report waits for the slower of the two
 * instead of for both in turn.
 */
export function loadPeriod(range, { fresh = false } = {}) {
  const key = keyOf(range);
  if (fresh) { cache.delete(key); inFlight.delete(key); }
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inFlight.has(key)) return inFlight.get(key);

  const reading = Promise.all([
    getDocs(query(collection(db, 'receipts'),
      where('date', '>=', range.start), where('date', '<=', range.end))).then(listData),

    // `periodStart` — the day the fortnight a bill covers *opens*, which is
    // also the day a hand-written debt was written. Not `issuedAt`: bills for
    // a closed fortnight are issued days after it ends, sometimes weeks, and a
    // report that filed them under the day somebody got around to pressing the
    // button would say September's food was sold in October.
    getDocs(query(collection(db, 'invoices'),
      where('periodStart', '>=', range.start), where('periodStart', '<=', range.end))).then(listData),
  ]).then(([receipts, invoices]) => {
    const found = { receipts, invoices, readAt: new Date() };
    cache.set(key, found);
    return found;
  }).finally(() => inFlight.delete(key));

  inFlight.set(key, reading);
  return reading;
}
