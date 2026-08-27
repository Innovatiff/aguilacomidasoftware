/**
 * Fortnights: the ones that closed unbilled, and the ones owed from before.
 *
 * A period that has ended and was never billed is money the kitchen has
 * already cooked and may never ask for. Nobody remembers to press a button
 * every fourteen days, and the periods are staggered — each farm has its own
 * anchor — so there is no single date to remember even if somebody wanted to.
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
import { billableMealsInRange } from './deliveries.js';
import { issueInvoice } from './invoices.js';
import { periodFor, periodByIndex, invoiceId } from '../lib/billing.js';
import { fortnightCharge } from '../lib/pricing.js';
import { today } from '../lib/dates.js';

/** How many closed periods back to look. Beyond this it is history, not a task. */
const LOOK_BACK = 4;

/**
 * Every fortnight that has closed without a bill, for clients who were served
 * in it.
 *
 * Returns `{ rows, total, periods, unpriced }` where a row is one invoice
 * waiting to be issued. Rows are the input to `issueAll`.
 */
export async function pendingBilling(clients, pricing, day = today()) {
  const billable = clients.filter((client) => client.status !== 'inactive');
  if (!billable.length) return empty();

  // Group by the period, not the client: everybody on the same anchor shares
  // one date range, and a range costs one read however many people are in it.
  const periods = new Map();
  for (const client of billable) {
    const anchor = client.cycleAnchor || day;
    const current = periodFor(anchor, day).index;
    for (let back = 1; back <= LOOK_BACK; back += 1) {
      const period = periodByIndex(anchor, current - back);
      const key = period.start;
      if (!periods.has(key)) periods.set(key, { period, clients: [] });
      periods.get(key).clients.push(client);
    }
  }

  const rows = [];
  const unpriced = [];

  for (const { period, clients: group } of periods.values()) {
    // Which of these already have a bill for the period, and who ate in it.
    const [issued, meals] = await Promise.all([
      issuedIn(period.start),
      billableMealsInRange(period.start, period.end),
    ]);

    for (const client of group) {
      if (issued.has(invoiceId(client.id, period.start))) continue;

      // No deliveries at all means the fortnight was not served, and a flat
      // price for nothing is not a bill anybody would defend at the gate.
      const count = meals.get(client.id) || 0;
      if (count <= 0) continue;

      const charge = fortnightCharge(client, pricing);
      if (!charge.priced) { unpriced.push(client); continue; }

      rows.push({ client, period, meals: count, charge, amount: charge.amount });
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
  };
}

/** Issues every row, returning how many bills were written. */
export async function issueAll(rows, author) {
  let issued = 0;
  for (const row of rows) {
    await issueInvoice(row.client, row.period, row.charge, row.meals, author);
    issued += 1;
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
 * them is a name and a date — "last paid July 3" — so that is the only thing
 * this asks for. From it and their billing anchor, the fortnights in between
 * are arithmetic.
 *
 * Every candidate period is returned, closed or not, with `owed` marking the
 * ones that would be billed by default: those that both started after the last
 * payment and have already ended. The fortnight in progress is offered but not
 * assumed, and the whole list is checkable, because a notebook is not a
 * database and the person holding it knows things this does not — a month
 * somebody was away, a fortnight already settled in cash.
 */
export function owedSince(client, lastPaidOn, pricing, day = today()) {
  const anchor = client?.cycleAnchor || day;
  const charge = fortnightCharge(client, pricing);
  const amount = charge.amount;
  if (!lastPaidOn || lastPaidOn >= day) return { periods: [], amount, charge, total: 0 };

  const from = periodFor(anchor, lastPaidOn).index;
  const current = periodFor(anchor, day).index;

  const periods = [];
  for (let index = from; index <= current; index += 1) {
    const period = periodByIndex(anchor, index);
    // A fortnight that was already running when they last paid is theirs to
    // judge: the payment may or may not have covered it.
    if (period.start <= lastPaidOn) continue;
    periods.push({
      ...period,
      id: invoiceId(client.id, period.start),
      closed: period.end < day,
      owed: period.end < day,
      amount,
      charge,
    });
  }

  return {
    periods,
    amount,
    charge,
    total: round2(periods.filter((p) => p.owed).length * amount),
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
    await issueInvoice(
      client,
      { index: period.index, start: period.start, end: period.end },
      period.charge || period.amount,
      0,
      author,
      { fromNotebook: true },
    );
    issued += 1;
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

const empty = () => ({ rows: [], total: 0, periods: 0, unpriced: [] });

const dedupe = (clients) => [...new Map(clients.map((c) => [c.id, c])).values()];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
