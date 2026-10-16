/**
 * Payments that landed on a fortnight before it was served — and where they
 * really belong.
 *
 * Nobody here pays ahead: every payment is for the fortnight that has just
 * been served. But before that rule was written into the software, a payment
 * with no bill to put it on went to the fortnight just *starting*. Somebody who
 * paid on the 10th for the 26th-to-the-9th shows as having paid the 10th to
 * the 23rd, the screen says "pagado hasta el 23", and on the 24th — when they
 * come to pay for the 10th to the 23rd — there is nothing left to put the money
 * on.
 *
 * This works out how to put each of those payments where it belongs: on the
 * fortnight right before the one it sits on, which is the one that had just
 * been served when the money changed hands. Oldest first, so a whole chain —
 * every payment for months one fortnight off — slides back together, each into
 * the place the one before it just left.
 *
 * It does not guess. A payment made two fortnights early, one whose fortnight
 * before was not theirs (they had not started yet), or one whose fortnight
 * before is already paid by something else stays where it is and is listed
 * for a person to look at.
 *
 * Pure: the plan is shown before anything is written, and applied by
 * `fixAdvance` in js/data/advance.js inside a transaction, from the same
 * function run over the same bills read again.
 */

import {
  addDays, daysBetween, today as todayKey, formatRange, formatDay,
} from './dates.js';
import {
  invoiceId, isCharge, isPayable, periodOf, dueDateFor, invoiceTitle, round2, paymentsOf,
} from './billing.js';

const CENT = 0.005;

const periodOfBill = (bill) => ({ start: bill.periodStart, end: bill.periodEnd });
const owedOn = (bill) => Math.max(0, round2((Number(bill.amount) || 0) - (Number(bill.paid) || 0)));
const isSettled = (bill) => (Number(bill.paid) || 0) >= (Number(bill.amount) || 0) - CENT;

/**
 * Paid before the fortnight it sits on could be paid: before its last day,
 * and not on or after the last day of somebody who was leaving.
 *
 * Not money the counter kept "a cuenta" on purpose (`entry.ahead`): that was
 * paid when the system had nothing older for it to go to, and the fortnight
 * before it was already paid. Moving it there would pay that one twice.
 */
export const isAhead = (bill, entry, client = null) =>
  !isCharge(bill) && !!entry?.date && !entry.ahead
  && !isPayable(periodOfBill(bill), client, String(entry.date));

/**
 * @param {object}   input
 * @param {object}   input.client   the client, with `graceDays`, `endsOn`,
 *                                  `paidThrough`
 * @param {object[]} input.bills    every bill they have, as stored, with `id`
 * @param {string}   [input.since]  the first day they were served
 * @param {string}   [input.day]
 *
 * @returns {object}
 *   moves        `[{ amount, date, receiptId, from, to, fromId, toId }]`
 *   stuck        `[{ amount, date, receiptId, from, why }]` — left where they are
 *   writes       the bills to write, whole, each with its `id`
 *   created      ids among `writes` that are new bills
 *   deletes      ids of bills for a fortnight still running that end up empty
 *   paidThrough  the client's "paid up to" once it is done (null for none)
 *   wasPaidThrough  what it says now
 *   owedBefore, owedAfter  what they owe for food already served, now and after
 *   changes      whether applying it writes anything beyond "reviewed"
 */
export function planAdvanceFix({ client, bills = [], since = '', day = todayKey() }) {
  // Working copies: the bills and their lists of payments. The entries
  // themselves are shared, so their timestamps are written back untouched.
  const work = new Map(bills.map((bill) => [bill.id, { ...bill, payments: [...paymentsOf(bill)] }]));
  const changed = new Set();
  const created = new Set();
  const moves = [];
  const stuck = [];

  const owedNow = () => round2([...work.values()]
    .filter((bill) => isCharge(bill) || isPayable(periodOfBill(bill), client, day))
    .reduce((sum, bill) => sum + owedOn(bill), 0));
  const owedBefore = owedNow();

  const sources = [...work.values()]
    .filter((bill) => !isCharge(bill) && bill.payments.some((entry) => isAhead(bill, entry, client)))
    .sort((a, b) => String(a.periodStart).localeCompare(String(b.periodStart)));

  for (const source of sources) {
    // As long as this bill is: a week for somebody who pays weekly.
    const every = (daysBetween(source.periodStart, source.periodEnd) + 1) || Number(source.payEvery) || 14;
    // The fortnight right before, cut from this bill's own dates: the
    // client's anchor may have moved since, and this is the one that sat
    // next to it when the money came in.
    const end = addDays(source.periodStart, -1);
    const target = { start: addDays(end, -(every - 1)), end, every };
    const targetId = invoiceId(client.id, target.start);
    const to = formatRange(target.start, target.end);

    for (const entry of [...source.payments]) {
      if (!isAhead(source, entry, client)) continue;
      const amount = round2(entry.amount);
      if (!(amount > 0)) continue;

      const leave = (why) => stuck.push({
        amount, date: entry.date, receiptId: entry.receiptId || null, from: invoiceTitle(source), why,
      });

      if (String(entry.date) < target.end) {
        leave('Se pagó antes de que terminara también la quincena anterior.');
        continue;
      }
      if (since && target.end < since) {
        leave(`La quincena anterior es de antes de que empezara (${formatDay(since)}). Si ya comía `
          + 'aquí antes, corrige «¿Desde cuándo come aquí?» en Editar y vuelve a revisar.');
        continue;
      }
      if (client.endsOn && target.start > client.endsOn) {
        leave('Ya había dejado el servicio.');
        continue;
      }

      let dest = work.get(targetId);
      if (dest && isCharge(dest)) { leave('Esa fecha tiene una deuda escrita a mano.'); continue; }
      if (!dest) {
        // A bill cut with other dates over the same days — from before their
        // fortnight moved — is not something to stack a second one on top of.
        const overlap = [...work.values()].find((bill) => !isCharge(bill)
          && bill.periodStart <= target.end && bill.periodEnd >= target.start);
        if (overlap) {
          leave(`La quincena anterior se cruza con otra factura (${invoiceTitle(overlap)}).`);
          continue;
        }
        dest = {
          ...pricingOf(source),
          id: targetId,
          clientId: source.clientId,
          clientName: source.clientName || '',
          farmId: source.farmId || '',
          farmName: source.farmName || '',
          locationName: source.locationName || '',
          periodStart: target.start,
          periodEnd: target.end,
          payEvery: every,
          dueDate: dueDateFor(target, client.graceDays),
          meals: 0,
          paid: 0,
          payments: [],
          settled: false,
          status: 'due',
          paidAt: null,
          // Says where it came from, a year from now.
          fromAdvanceFix: true,
        };
        work.set(targetId, dest);
        created.add(targetId);
      }

      const room = owedOn(dest);
      if (room <= CENT) { leave('La quincena anterior ya está pagada.'); continue; }

      const take = Math.min(amount, room);
      const index = source.payments.indexOf(entry);
      // The part that moves, and — if the fortnight before could not hold all
      // of it — the part that stays.
      source.payments.splice(index, 1,
        ...(take < amount - CENT ? [{ ...entry, amount: round2(amount - take) }] : []));
      source.paid = round2((Number(source.paid) || 0) - take);
      dest.payments.push({ ...entry, amount: take, movedFrom: source.id, movedOn: day });
      dest.paid = round2((Number(dest.paid) || 0) + take);
      changed.add(source.id);
      changed.add(targetId);

      moves.push({
        amount: take, date: entry.date, receiptId: entry.receiptId || null,
        from: invoiceTitle(source), to, fromId: source.id, toId: targetId,
      });
      if (take < amount - CENT) {
        stuck.push({
          amount: round2(amount - take), date: entry.date, receiptId: entry.receiptId || null,
          from: invoiceTitle(source), why: 'No cupo completo en la quincena anterior.',
        });
      }
    }
  }

  // A target that ended up with nothing in it was never needed.
  for (const id of created) {
    if ((Number(work.get(id).paid) || 0) <= CENT) {
      created.delete(id);
      changed.delete(id);
      work.delete(id);
    }
  }

  const writes = [];
  const deletes = [];
  for (const id of changed) {
    const bill = work.get(id);
    const settled = isSettled(bill);
    const running = !isPayable(periodOfBill(bill), client, day);
    // A bill for a fortnight still being served is not a debt yet; emptied, it
    // goes. One for a fortnight already served stays, unpaid: that food is
    // owed, and the payment that seemed to cover it was for the one before.
    if (running && (Number(bill.paid) || 0) <= CENT && !created.has(id)) {
      deletes.push(id);
      work.delete(id);
      continue;
    }
    writes.push({ ...bill, settled, status: settled ? 'paid' : 'due' });
  }

  const wasPaidThrough = client.paidThrough || null;
  const paidThrough = paidThroughAfter(client, work, changed, day, since);

  return {
    moves,
    stuck,
    writes,
    created: [...created],
    deletes,
    paidThrough,
    wasPaidThrough,
    owedBefore,
    owedAfter: owedNow(),
    changes: writes.length > 0 || deletes.length > 0 || paidThrough !== wasPaidThrough,
  };
}

/**
 * "Paid up to", worked out again once the payments are where they belong.
 *
 * It never reaches into a fortnight still being served: nothing is paid ahead,
 * so the most it can say is the last day of the fortnight just served. A date
 * from the notebook that sits inside the one running — "pagó el 10", taken
 * once as paid *into* that fortnight — becomes the day before it began, which
 * is what that payment was for.
 *
 * It never reaches past a fortnight this left unpaid either. And it moves up
 * to the end of any fortnight served and paid in full, the way taking a
 * payment moves it. A day before they started is no day at all: nothing.
 */
function paidThroughAfter(client, work, changed, day, since = '') {
  const running = periodOf(client, day);
  const cap = isPayable(running, client, day) ? running.end : addDays(running.start, -1);

  let kept = client.paidThrough ? (client.paidThrough < cap ? client.paidThrough : cap) : '';
  for (const id of changed) {
    const bill = work.get(id);
    if (!bill || isCharge(bill) || isSettled(bill)) continue;
    if (!isPayable(periodOfBill(bill), client, day)) continue;
    const before = addDays(bill.periodStart, -1);
    if (kept && before < kept) kept = before;
  }

  const ends = [...work.values()]
    .filter((bill) => !isCharge(bill) && isSettled(bill) && (Number(bill.amount) || 0) > CENT)
    .filter((bill) => isPayable(periodOfBill(bill), client, day))
    .map((bill) => bill.periodEnd);

  const last = [kept, ...ends].filter(Boolean).sort().pop() || null;
  return last && since && last < since ? null : last;
}

/**
 * Which clients have a payment made before its fortnight could be paid, read
 * off the receipts already in memory.
 *
 * Cheap, and good enough to know who to look at: a receipt says what it was
 * applied to and on what day. The plan itself is always made from the bills.
 * Receipts are never rewritten, so one that was looked at already — taken on
 * or before the day somebody reviewed this client — is not news.
 *
 * @param {object[]} receipts
 * @param {object}   options
 * @param {Set}      [options.cancelled]  ids of receipts taken back
 * @param {Map}      [options.clients]    id → client
 */
export function clientsWithAdvance(receipts = [], { cancelled = new Set(), clients = new Map() } = {}) {
  const ids = new Set();
  for (const receipt of receipts) {
    if (!(Number(receipt.amount) > 0) || cancelled.has(receipt.id)) continue;
    const client = clients.get(receipt.clientId);
    if (!client) continue;
    if (client.advanceFixedOn && String(receipt.date || '') <= client.advanceFixedOn) continue;
    for (const row of receipt.applied || []) {
      // A debt by hand, or money kept "a cuenta" on purpose: neither is the
      // old misplacement.
      if (row.kind === 'charge' || row.ahead || !row.periodEnd) continue;
      const bill = { periodStart: row.periodStart, periodEnd: row.periodEnd };
      if (isAhead(bill, { date: receipt.date }, client)) ids.add(receipt.clientId);
    }
  }
  return ids;
}

/** The arithmetic a bill was issued with, carried to the fortnight it moves to. */
function pricingOf(bill) {
  return {
    amount: round2(bill.amount),
    planPrice: round2(bill.planPrice ?? bill.amount),
    adjustment: round2(bill.adjustment || 0),
    mealsPerDay: Number(bill.mealsPerDay) || 0,
    plannedMeals: Number(bill.plannedMeals) || 0,
    plannedDays: Number(bill.plannedDays) || 0,
    extraMeals: Number(bill.extraMeals) || 0,
    extras: bill.extras || [],
    mealPrice: round2(bill.mealPrice || 0),
    deliveryDays: [...(bill.deliveryDays || [])],
  };
}
