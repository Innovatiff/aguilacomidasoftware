/**
 * Billing by period.
 *
 * Every client is billed on a rolling cycle of their own length — 7 days or 14,
 * whichever they chose — anchored on the day they started (`cycleAnchor`).
 * Periods never drift and never overlap: period *i* runs from `anchor + n·i`
 * through `anchor + n·i + n − 1`, so any date maps to exactly one period with
 * plain arithmetic — no schedule table to maintain and no cron job needed to
 * "open" the next cycle.
 *
 * A period is sold at a flat price for the plan the person is on — one meal a
 * day, two meals a day — not counted meal by meal. That is what is quoted and
 * what is paid, and it means the bill for a period is known the day the period
 * opens, which is what lets somebody walk into the store and pay for a period
 * that has not happened yet.
 *
 * Both lengths are whole weeks, which is what keeps everything below working
 * on either: the serving days in a period are the same every time round, and
 * the collection day never moves.
 *
 * Payment is due `graceDays` after the period closes.
 */

import {
  addDays, daysBetween, today as todayKey, dayRange, weekdayOf, formatRange,
} from './dates.js';
import { periodCharge } from './pricing.js';

/**
 * How often somebody pays.
 *
 * Most people pay every fortnight; some want to pay every week, because they
 * are paid every week and would rather hand over half as much twice as often.
 * It is the same food either way — the plan price is quoted per fortnight and
 * a weekly client pays half of it — so this changes when money is collected,
 * not what it costs to eat here.
 *
 * Both are whole weeks, which is what keeps the collection day fixed: 7 and 14
 * days both land on the same weekday forever, so a client anchored on a
 * Saturday pays on Saturdays whichever of the two they are on.
 */
export const PAY_EVERY = { WEEK: 7, FORTNIGHT: 14 };
export const DEFAULT_PAY_EVERY = PAY_EVERY.FORTNIGHT;

/** Kept for the many places that mean "a fortnight" as a fixed idea. */
export const PERIOD_DAYS = PAY_EVERY.FORTNIGHT;

/** The cadence stored on a client, coerced to one of the two we support. */
export const payEveryOf = (client) =>
  (Number(client?.payEvery) === PAY_EVERY.WEEK ? PAY_EVERY.WEEK : PAY_EVERY.FORTNIGHT);

/** How many weeks one of their periods lasts: 1 or 2. */
export const weeksPerPeriod = (client) => payEveryOf(client) / 7;

/** "semana" / "quincena" — the word for one of this person's periods. */
export const periodWord = (client) =>
  (payEveryOf(client) === PAY_EVERY.WEEK ? 'semana' : 'quincena');

export const periodWordPlural = (client) =>
  (payEveryOf(client) === PAY_EVERY.WEEK ? 'semanas' : 'quincenas');

/** "cada semana" / "cada quincena" — for a sentence about the cadence itself. */
export const cadenceWord = (client) =>
  (payEveryOf(client) === PAY_EVERY.WEEK ? 'cada semana' : 'cada quincena');

export const DEFAULT_GRACE_DAYS = 3;
/** Monday–Saturday: the default serving week. */
export const DEFAULT_DELIVERY_DAYS = [1, 2, 3, 4, 5, 6];

/**
 * Collection days: Wednesday and Saturday.
 *
 * The kitchen collects on two days of the week and no others, so a period has
 * to start on one of them. Both period lengths are whole weeks, so a cycle
 * that starts on a Wednesday lands on a Wednesday forever, weekly or
 * fortnightly — anchoring on a valid day is the whole of the rule.
 *
 * The cycle belongs to the person, not to the rancho. Two people at the same
 * farm can be a week apart because they started a week apart, and the day one
 * of them pays is the day their own period turns over.
 *
 * Every screen that names these days reads them from here. Spelling them into
 * a sentence is how "miércoles o domingo" survives in three hints after the
 * rule underneath has changed.
 */
export const PAY_WEEKDAYS = [3, 6];
export const PAY_WEEKDAY_LABELS = { 3: 'miércoles', 6: 'sábado' };

/** "miércoles o sábado" — for the sentences that have to say it out loud. */
export const payDaysInWords = () =>
  PAY_WEEKDAYS.map((d) => PAY_WEEKDAY_LABELS[d]).join(' o ');

export const isPayDay = (key) => PAY_WEEKDAYS.includes(weekdayOf(key));

/** The first collection day on or after `key`. */
export function payDayOnOrAfter(key) {
  for (let i = 0; i < 7; i += 1) {
    const candidate = addDays(key, i);
    if (isPayDay(candidate)) return candidate;
  }
  return key;
}

/** The last collection day on or before `key`. */
export function payDayOnOrBefore(key) {
  for (let i = 0; i < 7; i += 1) {
    const candidate = addDays(key, -i);
    if (isPayDay(candidate)) return candidate;
  }
  return key;
}

/**
 * The cycle a payment on `key` sets up.
 *
 * Somebody who hands over money on Friday the 28th is paying for the fortnight
 * that begins on the next collection day, not for one starting mid-week — so
 * the anchor snaps forward. Somebody paying *on* a collection day starts that
 * same day.
 */
export const cycleFromPayment = (key) => payDayOnOrAfter(key);

/**
 * Which cycle a day falls in, counting from the anchor. Can be negative.
 *
 * `every` is the client's cadence in days. It defaults to a fortnight so that
 * the handful of places reasoning about a period without a person in hand keep
 * meaning what they always meant.
 */
export function periodIndex(anchor, day = todayKey(), every = DEFAULT_PAY_EVERY) {
  return Math.floor(daysBetween(anchor, day) / every);
}

/** The period containing `day`: `{ index, start, end, every }`, ends inclusive. */
export function periodFor(anchor, day = todayKey(), every = DEFAULT_PAY_EVERY) {
  return periodByIndex(anchor, periodIndex(anchor, day, every), every);
}

export function periodByIndex(anchor, index, every = DEFAULT_PAY_EVERY) {
  const start = addDays(anchor, index * every);
  return { index, start, end: addDays(start, every - 1), every };
}

export const nextPeriod = (anchor, period) =>
  periodByIndex(anchor, period.index + 1, period.every || DEFAULT_PAY_EVERY);
export const prevPeriod = (anchor, period) =>
  periodByIndex(anchor, period.index - 1, period.every || DEFAULT_PAY_EVERY);

/* --- The same, from a person ------------------------------------------------
   Almost every caller has a client rather than a bare anchor, and every one of
   them was writing `periodFor(client.cycleAnchor || today(), today())` by hand.
   Now the cadence lives on the client too, that repetition is one more place
   for the two to fall out of step. */

export const anchorOf = (client) => client?.cycleAnchor || todayKey();

/** The period this person is in right now. */
export const periodOf = (client, day = todayKey()) =>
  periodFor(anchorOf(client), day, payEveryOf(client));

/** Their period `index` counted from their own anchor. */
export const periodOfIndex = (client, index) =>
  periodByIndex(anchorOf(client), index, payEveryOf(client));

/**
 * The day the next payment is due: the first day of their next period.
 *
 * Not the same as the invoice's `dueDate`, which adds the grace days before a
 * bill counts as late. This is the day the client turns up — "pagas el
 * sábado 29" — and it is the number the counter actually quotes.
 */
export const payDayAfter = (period) => addDays(period.end, 1);

/** Payment deadline for a period. */
export function dueDateFor(period, graceDays = DEFAULT_GRACE_DAYS) {
  return addDays(period.end, Math.max(0, graceDays ?? DEFAULT_GRACE_DAYS));
}

/** Deterministic invoice id, so re-issuing a cycle can never duplicate it. */
export const invoiceId = (clientId, periodStart) => `${clientId}_${periodStart}`;

/**
 * A debt the kitchen wrote by hand, rather than a fortnight of food.
 *
 * Somebody breaks a cooler, takes a case of drinks, is owed a refund, gets
 * something the plan does not cover: it is money on their account and it has to
 * be collectable like everything else, so it is stored as an invoice. The only
 * difference is that its amount was typed rather than derived, and that it
 * carries the reason it was typed. Everything downstream — the balance, the
 * roster, the notebook, taking a payment — reads it as one more thing owed.
 */
export const CHARGE_KIND = 'charge';
export const isCharge = (invoice) => invoice?.kind === CHARGE_KIND;

/**
 * A deterministic-ish id that still sorts by date.
 *
 * Payments are applied oldest first, and the code that does it orders bills by
 * their id — which works because a period bill's id ends in its start date. A
 * hand-written charge keeps the same shape so it falls in the right place in
 * that queue, with a unique tail because a client can be charged twice on the
 * same day.
 */
export const chargeIdFor = (clientId, day, unique) => `${clientId}_${day}_x${unique}`;

/**
 * "2 quincenas y 1 deuda" — what a balance is actually made of.
 *
 * Once a hand-written debt can sit in the same pile as the fortnights, saying
 * "debe $220 en 3 quincenas" is simply false, and a manager reading it will go
 * looking for a third fortnight that does not exist.
 */
export function owedBreakdown(invoices = []) {
  const charges = invoices.filter(isCharge).length;
  const periods = invoices.length - charges;
  const parts = [];
  if (periods) parts.push(`${periods} ${periods === 1 ? 'quincena' : 'quincenas'}`);
  if (charges) parts.push(`${charges} ${charges === 1 ? 'deuda' : 'deudas'}`);
  return parts.join(' y ') || 'nada';
}

/** What a bill is called in a list: the fortnight it covers, or its reason. */
export function invoiceTitle(invoice) {
  if (!invoice) return '';
  if (isCharge(invoice)) return invoice.reason || 'Cargo';
  return formatRange(invoice.periodStart, invoice.periodEnd);
}

/**
 * The same, for one line of a receipt's `applied` list.
 *
 * Receipts written before charges existed carry no title, so the period is
 * still the fallback — an old receipt has to keep reading the way it did.
 */
export const appliedTitle = (row) =>
  row?.title || formatRange(row?.periodStart, row?.periodEnd);

/** Deterministic delivery id, so two devices marking the same day converge. */
export const deliveryId = (clientId, day) => `${clientId}_${day}`;

/** The days inside a period on which this client actually gets food. */
export function servingDays(period, deliveryDays = DEFAULT_DELIVERY_DAYS) {
  const serve = new Set(deliveryDays?.length ? deliveryDays : DEFAULT_DELIVERY_DAYS);
  return dayRange(period.start, period.end).filter((day) => serve.has(weekdayOf(day)));
}

/**
 * What a period costs this person, and what they get for it.
 *
 * A period is a whole number of weeks, so it holds the same weekdays every
 * time round: the charge is the same in every period and the day count from
 * the calendar always matches the one the price was built from. Returned
 * together so a screen can show the number and the reason for it in the same
 * breath.
 */
export function projectPeriod(client, period, pricing) {
  const charge = periodCharge(client, pricing);
  return {
    ...charge,
    days: servingDays(period, client.deliveryDays).length,
  };
}

/**
 * Invoice status.
 *
 * open    — the cycle is still running, nothing to collect yet
 * due     — the cycle closed, payment is expected on or before `dueDate`
 * overdue — `dueDate` has passed with a balance outstanding
 * paid    — settled in full
 */
export function invoiceStatus(invoice, day = todayKey()) {
  if (!invoice) return 'open';
  if (balanceOf(invoice) <= 0.005) return 'paid';
  if (daysBetween(invoice.dueDate, day) > 0) return 'overdue';
  if (daysBetween(invoice.periodEnd, day) >= 0) return 'due';
  return 'open';
}

export const balanceOf = (invoice) =>
  round2((Number(invoice?.amount) || 0) - (Number(invoice?.paid) || 0));

/** Days until the deadline: positive = still time, negative = late. */
export const daysUntilDue = (invoice, day = todayKey()) =>
  invoice ? daysBetween(day, invoice.dueDate) : 0;

export const STATUS_LABEL = {
  open: 'En curso',
  due: 'Por pagar',
  overdue: 'Vencido',
  paid: 'Pagado',
  partial: 'Pago parcial',
};

export const STATUS_TONE = { open: 'info', due: 'warn', overdue: 'bad', paid: 'ok', partial: 'warn' };

/**
 * Rolls a client's invoices into the one line the admin list and the client
 * home screen both need: what is owed right now and how urgent it is.
 */
export function summarize(client, invoices = [], day = todayKey()) {
  const current = periodOf(client, day);
  const outstanding = invoices
    .filter((inv) => balanceOf(inv) > 0.005)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const overdue = outstanding.filter((inv) => invoiceStatus(inv, day) === 'overdue');
  const balance = round2(outstanding.reduce((sum, inv) => sum + balanceOf(inv), 0));
  const focus = overdue[0] || outstanding[0] || null;

  let status = 'paid';
  if (overdue.length) status = 'overdue';
  else if (focus) status = invoiceStatus(focus, day);

  return {
    currentPeriod: current,
    /** The invoice the user should act on next, if any. */
    focus,
    /** Everything still carrying a balance, soonest deadline first. */
    outstanding,
    overdueCount: overdue.length,
    balance,
    status,
    dueDate: focus ? focus.dueDate : dueDateFor(current, client?.graceDays),
    daysToDue: focus ? daysUntilDue(focus, day) : daysBetween(day, dueDateFor(current, client?.graceDays)),
  };
}

/**
 * Builds the invoice document for a client's period.
 *
 * The whole charge is stamped onto the bill, not just the total: the plan
 * price, the adjustment, the days and meals it was built from, the rate used.
 * A later change to the price list cannot rewrite any of it, and a year from
 * now the bill can still answer "why this number?" without the price list it
 * was issued under.
 *
 * `charge` is what `periodCharge` returns; a bare number is accepted for the
 * one case with no breakdown behind it — a balance carried in from paper.
 *
 * `meals` is what was actually delivered in the period. Information, not the
 * basis of the total: the fortnight is sold whole.
 */
export function draftInvoice(client, period, charge, deliveredMeals, day = todayKey()) {
  const meals = Number(deliveredMeals) || 0;
  const priced = typeof charge === 'number' ? { amount: charge } : (charge || {});
  return {
    clientId: client.id,
    clientName: client.name,
    // Carried on the bill so cobranza can group by farm without joining, and
    // so a printed invoice still says where the person eats a year from now.
    farmId: client.farmId || '',
    farmName: client.farmName || '',
    locationName: client.locationName || '',
    periodStart: period.start,
    periodEnd: period.end,
    // Frozen with the bill: a client who moves from weekly to fortnightly
    // must not make last month's invoices describe a period they never had.
    payEvery: period.every || payEveryOf(client),
    dueDate: dueDateFor(period, client.graceDays),
    mealsPerDay: Number(client.mealsPerDay) || 0,
    meals,
    amount: round2(priced.amount),

    // The arithmetic, frozen. Everything a bill needs to explain itself.
    planPrice: round2(priced.base ?? priced.amount),
    adjustment: round2(priced.adjustment || 0),
    plannedMeals: Number(priced.meals) || 0,
    plannedDays: Number(priced.days) || 0,
    extraMeals: Number(priced.extraMeals) || 0,
    extras: priced.extras || [],
    mealPrice: round2(priced.mealPrice || 0),
    deliveryDays: [...(client.deliveryDays || [])],

    paid: 0,
    payments: [],
    status: daysBetween(period.end, day) >= 0 ? 'due' : 'open',
  };
}

/**
 * Builds the document for a hand-written debt.
 *
 * It looks like an invoice because it is one: the balance, the roster, the
 * notebook and the payment counter all work off unsettled invoices, and a debt
 * that lived anywhere else would be a second thing to remember to look at. What
 * it does not have is a fortnight behind it — no plan, no days, no meals — so
 * those fields stay empty rather than being filled with numbers that would read
 * as if food had been served.
 *
 * `periodStart` and `periodEnd` are both the day it was written. Nothing bills
 * a range here; they exist so every query and sort that assumes a bill has a
 * date keeps working.
 */
export function draftCharge(client, { amount, reason, date } = {}) {
  const day = date || todayKey();
  return {
    kind: CHARGE_KIND,
    clientId: client.id,
    clientName: client.name || '',
    farmId: client.farmId || '',
    farmName: client.farmName || '',
    locationName: client.locationName || '',
    reason: String(reason || '').trim(),
    periodStart: day,
    periodEnd: day,
    dueDate: dueDateFor({ start: day, end: day }, client.graceDays),
    mealsPerDay: 0,
    meals: 0,
    amount: round2(amount),
    planPrice: 0,
    adjustment: 0,
    plannedMeals: 0,
    plannedDays: 0,
    extraMeals: 0,
    extras: [],
    mealPrice: 0,
    deliveryDays: [],
    paid: 0,
    payments: [],
    settled: false,
    status: 'due',
  };
}

export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
