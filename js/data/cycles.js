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
import { servingSince, onPlanOn, chargeOf, statusDoubt } from './clients.js';
import {
  periodOf, periodOfIndex, invoiceId, isCovered, isPayable, paidThroughOn, unbilledPart,
  isCharge, paymentsOf, balanceOf,
} from '../lib/billing.js';
import { periodCharge } from '../lib/pricing.js';
import { today, addDays } from '../lib/dates.js';
import { t } from '../lib/i18n.js';

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
 * Returns `{ rows, total, periods, unpriced, skipped, doubts }` where a row is
 * one invoice waiting to be issued and `skipped` counts what was left out and
 * why — a scan that silently drops half its work reads as if it found
 * nothing. `doubts` are the people for whom what is billed hangs on a guess
 * about their past (`doubtOf`).
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

  // Each of them, with the periods of theirs that have closed. A weekly payer
  // and a fortnightly one can start on the same day and still end on
  // different ones: each keeps the periods that are theirs.
  const people = billable.map((client) => {
    const current = periodOf(client, day).index;
    const closed = [];
    for (let back = 1; back <= LOOK_BACK; back += 1) closed.push(periodOfIndex(client, current - back));
    return { client, closed };
  });

  /*
   * One read for all of it, rather than one for each period.
   *
   * Three hundred people spread over two collection days and two cadences make
   * dozens of distinct period starts. Asking for each was a round trip apiece
   * — and it could only answer "is there a bill that starts on this day?",
   * which is the wrong question for somebody whose pay day has moved: their
   * new periods lie across bills cut from the old dates, and were billed
   * again. So every bill that touches the window is read once, and each
   * period is checked against the days its owner has already been billed for
   * (`unbilledPart`). A bill is at most a fortnight long, so one that starts
   * up to thirteen days before the window still reaches into it.
   */
  const every = people.flatMap((one) => one.closed);
  const from = every.reduce((min, period) => (period.start < min ? period.start : min), every[0].start);
  const to = every.reduce((max, period) => (period.end > max ? period.end : max), every[0].end);
  const billed = await billsBetween(addDays(from, -13), to);

  const rows = [];
  const unpriced = [];
  const skipped = { paid: 0, notYet: 0, ended: 0, off: 0 };
  const doubts = [];

  for (const { client, closed } of people) {
    const mine = billed.get(client.id) || [];
    for (const whole of closed) {
      const got = billFor(client, whole, mine, pricing);
      if (got?.row) rows.push(got.row);
      else if (got?.unpriced) unpriced.push(client);
      else if (got?.skip) skipped[got.skip] += 1;
    }
    const doubt = doubtOf(client, closed, mine, pricing);
    if (doubt) doubts.push(doubt);
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
    doubts,
  };
}

/**
 * One closed period of one person: the bill it is waiting for, or why it gets
 * none — `{ row }`, `{ skip: 'off' | 'paid' | 'notYet' | 'ended' }`,
 * `{ unpriced: true }`, or null when it is billed already.
 */
function billFor(client, whole, mine, pricing) {
  // What is left of it to bill: all of it, nearly always. One week of it
  // after a change between weeks and fortnights; none when a pay day that
  // moved laid it over a bill the old dates already wrote.
  const period = isCovered(whole, client.paidThrough)
    ? whole
    : unbilledPart(whole, mine, client.paidThrough);
  if (!period) return null;
  if (mine.some((bill) => bill.id === invoiceId(client.id, period.start))) return null;

  // Paused, or not coming any more, when it began: a fortnight like that
  // they did not eat — the same "on the first day" rule as when they
  // started and when they stopped.
  if (!onPlanOn(client, period.start)) return { skip: 'off' };

  // Covered by what they have paid: `paidThrough` is the last day paid
  // for, so a fortnight is covered when it ends by then. The same test
  // `owedSince` and the counter use, so the cuaderno, this scan and a
  // payment can never disagree about which fortnight is paid.
  if (isCovered(period, client.paidThrough)) return { skip: 'paid' };

  // Closed before they were a client, or already running when they
  // started. Not theirs either way.
  const since = servingSince(client);
  if (since && period.start < since) return { skip: 'notYet' };

  // Begun after the day they stopped eating here. The kitchen wrote that
  // date down precisely so nobody would be charged past it.
  if (client.endsOn && period.start > client.endsOn) return { skip: 'ended' };

  // With the plan they had while they ate it, not the one they have
  // today: a fortnight of one meal a day is not billed at two because the
  // plan changed the morning after it closed.
  const { as, charge } = chargeOf(client, period, pricing);
  if (!charge.priced) return { unpriced: true };

  return { row: { client: as, period, meals: charge.meals, charge, amount: charge.amount } };
}

/**
 * What a guess about somebody's past is doing to their bills — or null when
 * there is no guess, or it changes nothing.
 *
 * For the first change of status on a record written before changes said what
 * the person was until then, the system assumes the opposite (`statusDoubt`).
 * Here that assumption is turned round and the two answers compared, with the
 * bills in hand:
 *
 *   left     taken for a pause: fortnights that would be billed had they been
 *            active
 *   jumped   the same, but a later fortnight was paid since, so "paid up to"
 *            went past them and they will never come up by themselves — a
 *            fortnight eaten that nobody was asked for
 *   offered  taken for active: fortnights being proposed that would not be
 *            had they been in pause
 *   unpaid   bills already written for fortnights from before that day, with
 *            nothing paid on them
 *
 * Somebody taken for active who was plainly paying until then is no doubt.
 */
function doubtOf(client, closed, mine, pricing) {
  const doubt = statusDoubt(client);
  if (!doubt) return null;
  const { entry, guess } = doubt;
  const same = (one) => one?.on === entry.on && one?.status === entry.status
    && (one?.at || 0) === (entry.at || 0) && (one?.tag || '') === (entry.tag || '');
  const flipped = {
    ...client,
    statusLog: client.statusLog.map((one) => (same(one)
      ? { ...one, was: guess === 'paused' ? 'active' : 'paused' } : one)),
  };
  // Oldest first, the way they are read out.
  const before = closed.filter((whole) => whole.start < entry.on)
    .sort((x, y) => x.start.localeCompare(y.start));
  const rowOf = (who, whole) => billFor(who, whole, mine, pricing)?.row || null;
  const periodBills = mine.filter((bill) => !isCharge(bill) && bill.periodStart && bill.periodEnd);
  const out = { client, entry, guess, left: [], jumped: [], offered: [], unpaid: [] };

  if (guess === 'paused') {
    const since = servingSince(client);
    for (const whole of before) {
      const row = rowOf(flipped, whole);
      if (row && !rowOf(client, whole)) { out.left.push(row); continue; }
      // Never billed, counted as paid only because something later was: the
      // one running on the day of the change, or a hole between two paid
      // bills. (A fortnight from before that, with nothing after it paid, may
      // be covered by what the notebook said, and is left alone.)
      if (!isCovered(whole, client.paidThrough)) continue;
      if (onPlanOn(client, whole.start) || !onPlanOn(flipped, whole.start)) continue;
      if (since && whole.start < since) continue;
      if (client.endsOn && whole.start > client.endsOn) continue;
      if (periodBills.some((bill) => bill.periodStart <= whole.end && bill.periodEnd >= whole.start)) continue;
      const paidAfter = periodBills.some((bill) => bill.periodStart > whole.end && Number(bill.paid) > 0.005);
      const paidBefore = periodBills.some((bill) => bill.periodEnd < whole.start && Number(bill.paid) > 0.005);
      if (!paidAfter || !(whole.end >= entry.on || paidBefore)) continue;
      const priced = chargeOf(client, whole, pricing);
      if (!priced.charge.priced || !(priced.charge.amount > 0)) continue;
      out.jumped.push({
        client: priced.as, period: whole, meals: priced.charge.meals, charge: priced.charge, amount: priced.charge.amount,
      });
    }
    return out.left.length || out.jumped.length ? out : null;
  }

  // Taken for active. Paying in the weeks before it is as good as an answer.
  const recent = addDays(entry.on, -45);
  const paying = (client.paidThrough && client.paidThrough >= recent)
    || periodBills.some((bill) => bill.periodEnd >= recent && paymentsOf(bill).some(
      (payment) => String(payment.date || '') < entry.on && String(payment.date || '') >= recent));
  if (paying) return null;
  for (const whole of before) {
    const row = rowOf(client, whole);
    if (row && !rowOf(flipped, whole)) out.offered.push(row);
  }
  out.unpaid = periodBills
    .filter((bill) => bill.periodStart < entry.on && !bill.notebookPaid
      && balanceOf(bill) > 0.005 && !(Number(bill.paid) > 0.005))
    .map((bill) => ({ start: bill.periodStart, end: bill.periodEnd, amount: balanceOf(bill) }))
    .sort((x, y) => x.start.localeCompare(y.start));
  return out.offered.length || out.unpaid.length ? out : null;
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
    const name = row.client.farmName || t('Sin rancho');
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
    // Each with the plan they had in it, like every other bill (`chargeOf`).
    const then = chargeOf(client, period, pricing);
    periods.push({
      ...period,
      id: invoiceId(client.id, period.start),
      closed: true,
      owed: true,
      amount: then.charge.amount,
      charge: then.charge,
      as: then.as,
    });
  }

  return {
    periods,
    amount,
    charge,
    total: round2(periods.filter((p) => p.owed).reduce((sum, p) => sum + p.amount, 0)),
    paidThrough,
  };
}

/**
 * What ticking and unticking that list comes to.
 *
 * A fortnight left ticked is owed: it gets a bill. One unticked was paid in
 * the notebook — "esa sí la pagó, en efectivo, y nunca se anotó" — and that
 * has to be written down too, or nothing says so: the fortnight has no bill
 * and is not covered by "paid up to", which is exactly what an unbilled
 * fortnight looks like, and the next scan charged it.
 *
 * So the unticked ones at the front simply move "paid up to" forward — the
 * last payment reached further than the date typed — and one unticked after a
 * fortnight that is owed is kept as a mark of its own: a bill of $0, settled.
 *
 * @param {{ periods: object[], paidThrough: string|null }} found  as `owedSince` gives it
 * @returns {{ owed: object[], settled: object[], paidThrough: string|null }}
 */
export function notebookOutcome(found) {
  let paidThrough = found?.paidThrough || null;
  const owed = [];
  const settled = [];
  for (const period of found?.periods || []) {
    if (period.owed) owed.push(period);
    else if (!owed.length) paidThrough = period.end;
    else settled.push(period);
  }
  return { owed, settled, paidThrough };
}

/**
 * Writes the opening balance: one bill per fortnight the kitchen ticked, and
 * a mark for each one it unticked in between (see `notebookOutcome`).
 *
 * They are marked `fromNotebook` so a year from now it is obvious these were
 * carried over rather than produced by a delivery run — the meals behind them
 * were served before this software existed and were never recorded.
 *
 * @returns {Promise<number>} how many bills with money on them were written
 */
export async function openBalance(client, periods, author) {
  const { owed, settled } = notebookOutcome({ periods });
  let issued = 0;

  for (const period of owed) {
    const bill = await issueInvoice(
      period.as || client,
      { index: period.index, start: period.start, end: period.end, every: period.every },
      period.charge || period.amount,
      0,
      author,
      { fromNotebook: true },
    );
    if (!bill.existed) issued += 1;
  }
  for (const period of settled) {
    await issueInvoice(
      period.as || client,
      { index: period.index, start: period.start, end: period.end, every: period.every },
      0,
      0,
      author,
      { fromNotebook: true, notebookPaid: true },
    );
  }
  return issued;
}

/* --- Internals -------------------------------------------------------------- */

/**
 * Every bill whose period starts between two days, grouped by client.
 *
 * A range on one field, which Firestore indexes by itself.
 */
async function billsBetween(from, to) {
  const snap = await getDocs(query(
    collection(db, 'invoices'), where('periodStart', '>=', from), where('periodStart', '<=', to),
  ));
  const byClient = new Map();
  for (const bill of listData(snap)) {
    if (!byClient.has(bill.clientId)) byClient.set(bill.clientId, []);
    byClient.get(bill.clientId).push(bill);
  }
  return byClient;
}

const empty = () => ({
  rows: [], total: 0, periods: 0, unpriced: [],
  skipped: { paid: 0, notYet: 0, ended: 0, off: 0 },
  doubts: [],
});

const dedupe = (clients) => [...new Map(clients.map((c) => [c.id, c])).values()];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
