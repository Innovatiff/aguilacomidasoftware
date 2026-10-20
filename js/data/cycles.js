/**
 * Fortnights: the ones that closed unbilled, and the ones owed from before.
 *
 * A period that has ended and was never billed is money the kitchen has
 * already cooked and may never ask for. Nobody remembers to press a button
 * every fourteen days, and the periods are staggered — each farm has its own
 * anchor — so there is no single date to remember even if somebody wanted to.
 *
 * Every active client is billed for every fortnight that closed. They are on a
 * plan and the plan ran; whether a particular plate was handed over is between
 * the kitchen and the driver. Somebody who should not be charged is paused,
 * which is one tap on their row.
 *
 * So the panel looks for them instead of waiting: this module answers "what
 * has closed and is not billed?" and issues the lot. It is the same
 * calculation whether it is triggered from the roster's banner or from
 * Cobranza, which is why it lives here rather than in a screen.
 *
 * There is no server, so "automatic" means it happens the moment somebody
 * opens the panel, in one tap, rather than overnight. That is the honest
 * version of automatic for a static app — and it still turns a task nobody
 * remembers into one nobody can miss.
 */

import { getDocs, query, where, collection, db, listData } from '../firebase.js';
import { issueInvoice } from './invoices.js';
import { servingSince, onPlanOn } from './clients.js';
import {
  periodOf, periodOfIndex, invoiceId, isCovered, isPayable, paidThroughOn,
} from '../lib/billing.js';
import { periodCharge } from '../lib/pricing.js';
import { today } from '../lib/dates.js';

/** How many closed periods back to look. Beyond this it is history, not a task. */
const LOOK_BACK = 4;

/**
 * Every fortnight that has closed without a bill, for clients who were served
 * in it.
 *
 * "Not billed" is not the same as "owed", and the difference is money taken
 * from somebody twice. Two fortnights have no bill for a perfectly good
 * reason and must never be swept up here:
 *
 *   - one already settled in cash before this software existed. The cuaderno
 *     said "pagó el 21 de julio", that payment was for the fortnight that
 *     ended on the 20th, the 20th is on the client as `paidThrough`, and no
 *     invoice was ever written for what it covered — which reads exactly like
 *     an unbilled fortnight and is the opposite of one.
 *   - one that closed before the person started eating here. Their billing
 *     anchor belongs to the rancho, not to them, so it runs back through
 *     fortnights in which they were not yet a client.
 *
 * A fortnight already running on the day they started is left alone too: the
 * plan is sold whole and there is no half price, so charging the full amount
 * for a few days of it would be wrong. If the kitchen is owed for those days,
 * that is a deuda a mano with the real number on it.
 *
 * Returns `{ rows, total, periods, unpriced, skipped }` where a row is one
 * invoice waiting to be issued and `skipped` counts what was left out and why
 * — a scan that silently drops half its work reads as if it found nothing.
 */
export async function pendingBilling(clients, pricing, day = today()) {
  /*
   * Everybody the kitchen still counts as on the plan — by their stored
   * status, not by whether they are being served *today*.
   *
   * Somebody whose last day was a week ago has stopped eating here, and the
   * libreta drops them the morning after. They still owe for the fortnights
   * they did eat. Filtering them out here would quietly write that money off
   * the day their service ended, which is the opposite of what writing the end
   * date down was for. What their last day does is close the *periods* after
   * it, which is the check further down.
   */
  //
  // And somebody paused or gone now is still asked about the fortnights before
  // that: one they ate and that nobody billed before they were paused is still
  // theirs. Which fortnights those are comes from their record of pauses
  // (`onPlanOn`), checked for each period further down.
  const billable = clients.filter((client) => client.status === 'active'
    || (Array.isArray(client.statusLog) && client.statusLog.length));
  if (!billable.length) return empty();

  // Group by the period, not the client: everybody on the same anchor shares
  // one date range, and a range costs one read however many people are in it.
  const periods = new Map();
  for (const client of billable) {
    const current = periodOf(client, day).index;
    for (let back = 1; back <= LOOK_BACK; back += 1) {
      const period = periodOfIndex(client, current - back);
      // A weekly payer and a fortnightly one can start on the same day and
      // still end on different ones: each keeps the period that is theirs.
      const key = `${period.start}|${period.end}`;
      if (!periods.has(key)) periods.set(key, { period, clients: [] });
      periods.get(key).clients.push(client);
    }
  }

  const rows = [];
  const unpriced = [];
  const skipped = { paid: 0, notYet: 0, ended: 0, off: 0 };

  /*
   * Every period's read at once, rather than one after another.
   *
   * Three hundred people spread over two collection days and two cadences make
   * dozens of distinct period starts, and each one is a round trip. Waiting for
   * each before asking the next turned an open of the roster into several
   * seconds of scanning — long enough that the answer routinely arrived after
   * the manager had already tapped somebody. Asked together, it is one wait.
   */
  const groups = [...periods.values()];
  const reads = new Map();
  const readOnce = (start) => {
    if (!reads.has(start)) reads.set(start, issuedIn(start));
    return reads.get(start);
  };
  const issuedBy = await Promise.all(groups.map(({ period }) => readOnce(period.start)));

  for (let i = 0; i < groups.length; i += 1) {
    const { period, clients: group } = groups[i];
    const issued = issuedBy[i];

    for (const client of group) {
      if (issued.has(invoiceId(client.id, period.start))) continue;

      // Paused, or not coming any more, when it began: a fortnight like that
      // they did not eat — the same "on the first day" rule as when they
      // started and when they stopped.
      if (!onPlanOn(client, period.start)) {
        skipped.off += 1;
        continue;
      }

      // Covered by what they have paid: `paidThrough` is the last day paid
      // for, so a fortnight is covered when it ends by then. The same test
      // `owedSince` and the counter use, so the cuaderno, this scan and a
      // payment can never disagree about which fortnight is paid.
      if (isCovered(period, client.paidThrough)) {
        skipped.paid += 1;
        continue;
      }

      // Closed before they were a client, or already running when they
      // started. Not theirs either way.
      const since = servingSince(client);
      if (since && period.start < since) {
        skipped.notYet += 1;
        continue;
      }

      // Begun after the day they stopped eating here. The kitchen wrote that
      // date down precisely so nobody would be charged past it.
      if (client.endsOn && period.start > client.endsOn) {
        skipped.ended += 1;
        continue;
      }

      const charge = periodCharge(client, pricing);
      if (!charge.priced) { unpriced.push(client); continue; }

      rows.push({ client, period, meals: charge.meals, charge, amount: charge.amount });
    }
  }

  rows.sort((a, b) => a.period.start.localeCompare(b.period.start)
    || String(a.client.farmName).localeCompare(String(b.client.farmName), 'es')
    || String(a.client.name).localeCompare(String(b.client.name), 'es'));

  return {
    rows,
    total: round2(rows.reduce((sum, row) => sum + row.amount, 0)),
    periods: new Set(rows.map((row) => row.period.start)).size,
    unpriced: dedupe(unpriced),
    skipped,
  };
}

/** Issues every row, returning how many bills were written. */
export async function issueAll(rows, author) {
  let issued = 0;
  for (const row of rows) {
    const bill = await issueInvoice(row.client, row.period, row.charge, row.meals, author);
    if (!bill.existed) issued += 1;
  }
  return issued;
}

/** Grouped by farm — how the run is reviewed before it is written. */
export function byFarm(rows) {
  const farms = new Map();
  for (const row of rows) {
    const name = row.client.farmName || 'Sin rancho';
    const entry = farms.get(name) || { name, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount = round2(entry.amount + row.amount);
    farms.set(name, entry);
  }
  return [...farms.values()].sort((a, b) => b.amount - a.amount);
}

/* --- Opening balances ------------------------------------------------------- */

/**
 * What somebody owes since the last time they paid.
 *
 * These clients were on paper for years. All the kitchen knows about each of
 * them is a name and a date — "last paid July 21" — so that is the only thing
 * this asks for. From it and their billing anchor, the fortnights in between
 * are arithmetic.
 *
 * Nobody pays ahead here, so a payment made on the 21st paid for the fortnight
 * that ended on the 20th — `paidThroughOn` — and every fortnight served after
 * that is owed. The one still running is not: it is paid the day it ends, like
 * anybody else's. Every period returned is checkable, because a notebook is
 * not a database and the person holding it knows things this does not — a
 * month somebody was away, a fortnight settled in cash and never written down.
 *
 * @returns {{ periods, amount, charge, total, paidThrough }}  `paidThrough` is
 *   the last day the notebook payment paid for — what to write on the client
 */
export function owedSince(client, lastPaidOn, pricing, day = today()) {
  const charge = periodCharge(client, pricing);
  const amount = charge.amount;
  if (!lastPaidOn || lastPaidOn > day) {
    return { periods: [], amount, charge, total: 0, paidThrough: null };
  }

  const paidThrough = paidThroughOn(client, lastPaidOn);
  const from = periodOf(client, paidThrough).index + 1;
  const current = periodOf(client, day).index;

  const periods = [];
  for (let index = from; index <= current; index += 1) {
    const period = periodOfIndex(client, index);
    // Still being served: not owed yet.
    if (!isPayable(period, client, day)) continue;
    periods.push({
      ...period,
      id: invoiceId(client.id, period.start),
      closed: true,
      owed: true,
      amount,
      charge,
    });
  }

  return {
    periods,
    amount,
    charge,
    total: round2(periods.filter((p) => p.owed).length * amount),
    paidThrough,
  };
}

/**
 * Writes the opening balance: one bill per fortnight the kitchen ticked.
 *
 * They are marked `fromNotebook` so a year from now it is obvious these were
 * carried over rather than produced by a delivery run — the meals behind them
 * were served before this software existed and were never recorded.
 */
export async function openBalance(client, periods, author) {
  const chosen = periods.filter((period) => period.owed);
  let issued = 0;

  for (const period of chosen) {
    const bill = await issueInvoice(
      client,
      { index: period.index, start: period.start, end: period.end },
      period.charge || period.amount,
      0,
      author,
      { fromNotebook: true },
    );
    if (!bill.existed) issued += 1;
  }
  return issued;
}

/* --- Internals -------------------------------------------------------------- */

/** The invoice ids that already exist for one period start. */
async function issuedIn(periodStart) {
  const snap = await getDocs(query(
    collection(db, 'invoices'), where('periodStart', '==', periodStart),
  ));
  return new Set(listData(snap).map((invoice) => invoice.id));
}

const empty = () => ({
  rows: [], total: 0, periods: 0, unpriced: [],
  skipped: { paid: 0, notYet: 0, ended: 0, off: 0 },
});

const dedupe = (clients) => [...new Map(clients.map((c) => [c.id, c])).values()];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
