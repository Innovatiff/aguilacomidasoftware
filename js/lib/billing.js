/**
 * Bi-weekly billing.
 *
 * Every client is billed on a rolling 14-day cycle anchored on the day they
 * started (`cycleAnchor`). Periods never drift and never overlap: period *i*
 * runs from `anchor + 14i` through `anchor + 14i + 13`, so any date maps to
 * exactly one period with plain arithmetic — no schedule table to maintain and
 * no cron job needed to "open" the next cycle.
 *
 * A fortnight is sold at a flat price for the plan the person is on — one meal
 * a day, two meals a day — not counted meal by meal. That is what is quoted
 * and what is paid, and it means the bill for a period is known the day the
 * period opens, which is what lets somebody walk into the store and pay for a
 * fortnight that has not happened yet.
 *
 * Payment is due `graceDays` after the period closes.
 */

import { addDays, daysBetween, today as todayKey, dayRange, weekdayOf } from './dates.js';
import { priceFor } from './pricing.js';

export const PERIOD_DAYS = 14;
export const DEFAULT_GRACE_DAYS = 3;
/** Monday–Saturday: the default serving week. */
export const DEFAULT_DELIVERY_DAYS = [1, 2, 3, 4, 5, 6];

/** Which cycle a day falls in, counting from the anchor. Can be negative. */
export function periodIndex(anchor, day = todayKey()) {
  return Math.floor(daysBetween(anchor, day) / PERIOD_DAYS);
}

/** The period containing `day`: `{ index, start, end }`, both ends inclusive. */
export function periodFor(anchor, day = todayKey()) {
  const index = periodIndex(anchor, day);
  return periodByIndex(anchor, index);
}

export function periodByIndex(anchor, index) {
  const start = addDays(anchor, index * PERIOD_DAYS);
  return { index, start, end: addDays(start, PERIOD_DAYS - 1) };
}

export const nextPeriod = (anchor, period) => periodByIndex(anchor, period.index + 1);
export const prevPeriod = (anchor, period) => periodByIndex(anchor, period.index - 1);

/** Payment deadline for a period. */
export function dueDateFor(period, graceDays = DEFAULT_GRACE_DAYS) {
  return addDays(period.end, Math.max(0, graceDays ?? DEFAULT_GRACE_DAYS));
}

/** Deterministic invoice id, so re-issuing a cycle can never duplicate it. */
export const invoiceId = (clientId, periodStart) => `${clientId}_${periodStart}`;

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
 * The amount is the plan's flat price; the day and meal counts are what the
 * kitchen has committed to serving for it, shown so the number can be checked
 * against reality rather than taken on faith.
 */
export function projectPeriod(client, period, tiers) {
  const days = servingDays(period, client.deliveryDays);
  const perDay = Number(client.mealsPerDay) || 0;
  return {
    days: days.length,
    meals: days.length * perDay,
    mealsPerDay: perDay,
    amount: priceFor(tiers, perDay),
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
  const anchor = client?.cycleAnchor || day;
  const current = periodFor(anchor, day);
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
 * `amount` is the plan price, stamped onto the bill so a later change to the
 * price list cannot rewrite what somebody was charged. `meals` records what was
 * actually delivered in the period — information, not the basis of the total.
 */
export function draftInvoice(client, period, amount, deliveredMeals, day = todayKey()) {
  const meals = Number(deliveredMeals) || 0;
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
    dueDate: dueDateFor(period, client.graceDays),
    mealsPerDay: Number(client.mealsPerDay) || 0,
    meals,
    amount: round2(amount),
    paid: 0,
    payments: [],
    status: daysBetween(period.end, day) >= 0 ? 'due' : 'open',
  };
}

export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
