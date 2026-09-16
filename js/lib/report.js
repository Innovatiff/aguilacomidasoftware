/**
 * What happened in a period, worked out from the documents.
 *
 * Pure: receipts and bills in, numbers out. Nothing here touches Firestore, so
 * every figure on the report can be checked against a handful of documents in
 * a test instead of against a screenshot.
 *
 * **Two kinds of number, and they are never mixed.**
 *
 *   *Flow* is what happened between two dates: money taken, bills issued, debts
 *   written, corrections made. It belongs to the period, it is finished, and
 *   re-running last month's report next year gives the same answer.
 *
 *   *Stock* is where things stand right now: what the book is owed, who is
 *   overdue. It has no period — it is today's photograph — and it is labelled
 *   as today's on every surface that shows it.
 *
 * Mixing them is how a report ends up claiming the kitchen collected money it
 * did not, so they live in separate halves of the result and are never added
 * to each other.
 *
 * **A cancelled payment is its own movement.** The kitchen corrects a mistake
 * by writing a second, negative receipt rather than by editing the first — so
 * a period's takings are simply the sum of the receipt amounts dated inside
 * it, negatives included. That is a cash book, and it has the property that
 * matters here: every dollar lands in exactly one period, the period it
 * happened in, and the periods add up to the whole. A payment taken in March
 * and given back in April is income in March and an outgoing in April, which
 * is what both months' paper actually showed.
 */

import { round2, balanceOf, invoiceStatus, isCharge, invoiceTitle } from './billing.js';
import { PAYMENT_METHODS, paymentMethodMeta } from './model.js';
import { today, dayOf, daysBetween } from './dates.js';

const sum = (rows, pick) => round2(rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0));

const inRange = (day, range) => !!day && day >= range.start && day <= range.end;

/**
 * @param {object}   input.range        `{ grain, start, end }`
 * @param {object[]} input.receipts     every receipt dated inside the range
 * @param {object[]} input.invoices     every bill whose period starts inside it
 * @param {object[]} input.clients      the whole roster, for the register counts
 * @param {object[]} input.outstanding  everything unpaid right now — today's photograph
 * @param {object[]} input.buckets      how to cut the range up, from `periods.js`
 * @param {number}   input.activeCount  how many are being served today
 * @param {object}   [input.pricing]    the price list, to say if it moved
 */
export function buildReport({
  range, receipts = [], invoices = [], clients = [], outstanding = [], buckets = [],
  activeCount = 0, pricing = null, day = today(),
}) {
  const takings = receipts.filter((row) => Number(row.amount) > 0);
  const givenBack = receipts.filter((row) => Number(row.amount) < 0);

  const bills = invoices.filter((row) => !isCharge(row));
  const debts = invoices.filter((row) => isCharge(row));

  const collected = sum(receipts, (row) => row.amount);
  const billed = sum(bills, (row) => row.amount);
  const added = sum(debts, (row) => row.amount);

  return {
    range,
    day,
    days: spanOf(range, day),

    /* --- The money that moved ------------------------------------------- */
    money: {
      collected,                                  // net of anything given back
      takings: sum(takings, (row) => row.amount),
      refunds: sum(givenBack, (row) => row.amount),   // negative, or zero
      billed,
      added,
      issued: round2(billed + added),
      // What the period did to the book. Bills raise what people owe, money
      // taken lowers it; the difference is how much the debt moved, and its
      // sign is the whole story of the fortnight.
      change: round2(billed + added - collected),
    },

    counts: {
      payments: takings.length,
      refunds: givenBack.length,
      payers: new Set(takings.map((row) => row.clientId).filter(Boolean)).size,
      bills: bills.length,
      debts: debts.length,
      billedClients: new Set(bills.map((row) => row.clientId).filter(Boolean)).size,
      meals: bills.reduce((total, row) => total + mealsOn(row), 0),
    },

    methods: byMethod(receipts),
    farms: byFarm(receipts, invoices),
    buckets: fill(buckets, receipts, invoices),
    payers: byPayer(receipts),
    cashiers: byCashier(receipts),
    corrections: correctionsIn(range, invoices, outstanding),

    /* Screen only: the ledger, newest first. The printed sheet leaves it out
       on purpose — it is the one part of this that is already on paper, one
       receipt at a time, in the drawer under the till. */
    movements: [...receipts].sort(byDayDesc),

    /* The price list moving inside the period is the first thing anybody
       reaches for when a month does not look like the one before it, and it is
       already in memory — so it is said here rather than left to be guessed. */
    pricingChanged: inRange(dayOf(pricing?.updatedAt), range)
      ? { date: dayOf(pricing.updatedAt), byName: pricing.updatedByName || '' }
      : null,

    /* --- Where the book stands, today ----------------------------------- */
    standing: standingOf(outstanding, day),
    people: registerOf(clients, range, activeCount),
  };
}

/**
 * How many days to divide by.
 *
 * A month in progress is not thirty days of trading yet, and dividing this
 * month's takings by thirty on the sixteenth reports an average roughly half of
 * what the kitchen is actually making. So a period that has not finished is
 * averaged over the days that have happened, and every surface that prints the
 * figure prints the denominator beside it.
 */
function spanOf(range, day) {
  const span = daysBetween(range.start, range.end) + 1;
  const running = day >= range.start && day < range.end;
  const elapsed = running ? daysBetween(range.start, day) + 1 : span;
  return { span, elapsed, running };
}

/** What a bill says it fed. Falls back to the plan when nobody recorded it. */
const mealsOn = (invoice) => Number(invoice.meals) || Number(invoice.plannedMeals) || 0;

const byDayDesc = (a, b) => {
  const day = String(b.date || '').localeCompare(String(a.date || ''));
  if (day) return day;
  const at = (row) => (row.at?.toMillis ? row.at.toMillis() : (row.at?.seconds || 0) * 1000);
  return at(b) - at(a);
};

/* --- Breakdowns ------------------------------------------------------------ */

/**
 * Cash, debit, and the rest.
 *
 * The one the counter is reconciled against: the cash line is what should have
 * been in the drawer and the debit line is what should have reached the bank.
 * Kept in the order of `PAYMENT_METHODS` so the list does not reshuffle itself
 * between two periods.
 *
 * Each way of paying carries three figures, not one, because a single net
 * number cannot be read. Cash can finish a month *negative* — a card payment
 * taken in March and handed back in cash in April leaves April's drawer down
 * without a single cash payment being taken — and "Efectivo −$160" under a
 * heading about money arriving is a figure that stops the reader cold. So:
 * what came in, what went back, and the net of the two. `takings` is the one
 * the percentages are worked out of, because a share of money that arrived is
 * a question with an answer.
 */
function byMethod(receipts) {
  const found = new Map();
  for (const row of receipts) {
    const key = PAYMENT_METHODS[row.method] ? row.method : 'other';
    const amount = Number(row.amount) || 0;
    const entry = found.get(key) || {
      key, label: paymentMethodMeta(key).label, icon: paymentMethodMeta(key).icon,
      amount: 0, takings: 0, refunds: 0, count: 0,
    };
    entry.amount = round2(entry.amount + amount);
    if (amount > 0) { entry.takings = round2(entry.takings + amount); entry.count += 1; }
    else entry.refunds = round2(entry.refunds + amount);
    found.set(key, entry);
  }
  return Object.keys(PAYMENT_METHODS)
    .filter((key) => found.has(key))
    .map((key) => found.get(key));
}

/** Money in and bills out, per farm. Biggest first. */
function byFarm(receipts, invoices) {
  const found = new Map();
  const at = (id, name) => {
    const key = id || '';
    if (!found.has(key)) {
      found.set(key, { farmId: key, name: name || 'Sin rancho', collected: 0, billed: 0, payers: new Set() });
    }
    const entry = found.get(key);
    if (name && entry.name === 'Sin rancho') entry.name = name;
    return entry;
  };

  for (const row of receipts) {
    const entry = at(row.farmId, row.farmName);
    entry.collected = round2(entry.collected + (Number(row.amount) || 0));
    if (Number(row.amount) > 0 && row.clientId) entry.payers.add(row.clientId);
  }
  for (const row of invoices) {
    const entry = at(row.farmId, row.farmName);
    entry.billed = round2(entry.billed + (Number(row.amount) || 0));
  }

  return [...found.values()]
    .map((entry) => ({ ...entry, payers: entry.payers.size }))
    .sort((a, b) => b.collected - a.collected || b.billed - a.billed);
}

/** The time series: what came in and what was billed, bucket by bucket. */
function fill(buckets, receipts, invoices) {
  return buckets.map((bucket) => {
    const inside = receipts.filter((row) => row.date >= bucket.start && row.date <= bucket.end);
    const billed = invoices.filter((row) => row.periodStart >= bucket.start && row.periodStart <= bucket.end);
    return {
      ...bucket,
      day: bucket.start,      // what `columnChart` keys a tooltip on
      amount: sum(inside, (row) => row.amount),
      count: inside.filter((row) => Number(row.amount) > 0).length,
      billed: sum(billed, (row) => row.amount),
    };
  });
}

/**
 * Everybody who paid, with their total for the period.
 *
 * Netted per person, so somebody whose payment was taken and given back inside
 * the same period does not appear as having paid — they did not. The
 * cancellation is still counted in `refunds` and still listed on the screen's
 * movements, so nothing has gone quiet; it is only this list, which answers
 * "who paid?", that declines to say yes about a payment that was undone.
 */
function byPayer(receipts) {
  const found = new Map();
  for (const row of receipts) {
    const key = row.clientId || `sin-cliente:${row.id}`;
    const entry = found.get(key) || {
      clientId: row.clientId || '', name: row.clientName || 'Sin cliente',
      farmName: row.farmName || '', amount: 0, count: 0, last: '',
    };
    entry.amount = round2(entry.amount + (Number(row.amount) || 0));
    if (Number(row.amount) > 0) {
      entry.count += 1;
      if (row.date > entry.last) entry.last = row.date;
    }
    found.set(key, entry);
  }
  return [...found.values()]
    .filter((entry) => entry.amount > 0.005)
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

/** Who took the money. Two people share this counter; the owner asked. */
function byCashier(receipts) {
  const found = new Map();
  for (const row of receipts) {
    const name = row.takenByName || 'Sin registrar';
    const entry = found.get(name) || { name, amount: 0, count: 0 };
    entry.amount = round2(entry.amount + (Number(row.amount) || 0));
    if (Number(row.amount) > 0) entry.count += 1;
    found.set(name, entry);
  }
  return [...found.values()].sort((a, b) => b.amount - a.amount);
}

/**
 * Balances somebody moved by hand, with the reason they gave.
 *
 * A correction lives on the bill it changed, as an entry in its `corrections`
 * list — there is no collection of them to query. So they are gathered from
 * the bills this report already holds: the ones issued for this period, plus
 * everything still unpaid today, which is already in memory and costs nothing
 * to look through. Between them that is every correction anybody is likely to
 * be looking for; what it cannot reach is a correction made during the period
 * to a bill that is both older than it and already settled. The heading says
 * which bills were looked at rather than promising more than that.
 */
function correctionsIn(range, invoices, outstanding) {
  const seen = new Set();
  const out = [];

  for (const invoice of [...invoices, ...outstanding]) {
    if (seen.has(invoice.id)) continue;
    seen.add(invoice.id);

    (invoice.corrections || []).forEach((entry, index) => {
      if (!inRange(entry.date, range)) return;
      out.push({
        key: `${invoice.id}#${index}`,
        invoiceId: invoice.id,
        clientId: invoice.clientId || '',
        clientName: invoice.clientName || '',
        title: invoiceTitle(invoice),
        from: round2(entry.from),
        to: round2(entry.to),
        delta: round2((Number(entry.to) || 0) - (Number(entry.from) || 0)),
        note: entry.note || '',
        date: entry.date,
        byName: entry.byName || '',
      });
    });
  }

  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/* --- Today's photograph ---------------------------------------------------- */

/** What the book is owed right now — no period, and said so wherever it shows. */
function standingOf(outstanding, day) {
  let owed = 0, overdue = 0, overdueCount = 0;
  const owing = new Map();

  for (const invoice of outstanding) {
    const balance = balanceOf(invoice);
    if (balance <= 0.005) continue;
    owed = round2(owed + balance);
    if (invoiceStatus(invoice, day) === 'overdue') {
      overdue = round2(overdue + balance);
      overdueCount += 1;
    }
    const entry = owing.get(invoice.clientId)
      || { clientId: invoice.clientId, name: invoice.clientName || '', farmName: invoice.farmName || '', balance: 0, bills: 0 };
    entry.balance = round2(entry.balance + balance);
    entry.bills += 1;
    owing.set(invoice.clientId, entry);
  }

  return {
    owed,
    overdue,
    overdueCount,
    dueSoon: round2(owed - overdue),
    debtors: [...owing.values()].sort((a, b) => b.balance - a.balance),
  };
}

/**
 * The register: who is on the books, who joined, who finished.
 *
 * Read off the roster the app already holds, so it costs nothing. The joins
 * and the departures are flow and belong to the period; the head-count is a
 * photograph like any other balance, so it is handed in rather than worked out
 * again — `activeClients` in the store is what Inicio counts, and a report that
 * derived its own copy of "still being served" is a report that would sooner or
 * later disagree with the dashboard about how many people eat here.
 */
function registerOf(clients, range, activeCount) {
  return {
    active: activeCount,
    total: clients.length,
    added: clients.filter((client) => inRange(dayOf(client.createdAt), range)).length,
    ended: clients.filter((client) => inRange(client.endsOn, range)).length,
  };
}
