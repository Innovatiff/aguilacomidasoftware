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
 * what is paid.
 *
 * **Nobody here pays in advance.** A period is paid once it has been served:
 * somebody who starts on Wednesday the 7th pays on Wednesday the 21st for the
 * 7th to the 20th, and the money handed over on a collection day is always for
 * the fortnight that just ended. A period can be paid from its last day on
 * (`isPayable`), never before, and `paidThrough` — the last day somebody has
 * paid for — is therefore always a day already served.
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
 * Money is handed over for the fortnight that just ended, on the collection
 * day that closes it — so the payment marks the turn of the cycle: the next
 * fortnight starts on that collection day. Somebody paying a day or two late
 * is paying for the fortnight that ended at the collection day they missed, so
 * the anchor snaps *back* to it. It used to snap forward, which read a payment
 * as the start of a fortnight being paid for ahead of time.
 */
export const cycleFromPayment = (key) => payDayOnOrBefore(key);

/**
 * Whether a period can be paid on `day`.
 *
 * From its last day on: that is the day its last plate goes out, and the
 * kitchen collects for what it has served. Never before — nobody pays for food
 * not yet cooked. The one exception is somebody who has stopped coming: their
 * last period has no rest to wait for, so it can be settled once their last
 * day has come.
 */
export function isPayable(period, client, day = todayKey()) {
  if (!period) return false;
  if (period.end <= day) return true;
  const last = client?.endsOn;
  return !!last && last <= day && period.start <= last;
}

/**
 * Whether a bill is money somebody owes on `day`.
 *
 * A debt written by hand, always. A period's bill once that period can be
 * paid — and never one for a period that began after the person's last day:
 * they were not here to eat it. There are such bills: money handed over
 * beyond what was owed waits on the fortnights ahead (`aheadRows`), and when
 * the person then leaves, what was left unpaid on those used to turn into a
 * debt the day each one's dates went by.
 */
export function isOwed(invoice, client, day = todayKey()) {
  if (!invoice) return false;
  if (isCharge(invoice)) return true;
  if (client?.endsOn && String(invoice.periodStart || '') > client.endsOn) return false;
  return isPayable({ start: invoice.periodStart, end: invoice.periodEnd }, client, day);
}

/**
 * Whether what is written on a client as paid covers a period.
 *
 * `paidThrough` is the last day they have paid for, so a period is covered
 * when it ends on or before it. A period that only *starts* by then is not —
 * reading it that way is what used to count the fortnight a payment was made
 * in as paid by that payment.
 */
export const isCovered = (period, paidThrough) =>
  !!paidThrough && !!period && period.end <= paidThrough;

/**
 * The last day a payment made on `day` can have paid for.
 *
 * The end of the last period that had been served by then: the period that
 * ends on `day` if it ends that day, otherwise the one before the period
 * `day` falls in. For "¿cuándo pagó por última vez?" in the notebook, where a
 * payment on the 21st paid up to the 20th.
 */
export function paidThroughOn(client, day = todayKey()) {
  const period = periodOf(client, day);
  return period.end <= day ? period.end : addDays(period.start, -1);
}

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

/**
 * What is left to bill of a period, given what somebody has already been
 * billed and has already paid.
 *
 * A period's days are normally either all billed or not billed at all. They
 * stop being so the day somebody's cycle moves — another pay day, or from
 * weeks to fortnights and back: the periods are then cut from the new dates,
 * and the bills already written keep the old ones. Asked only "is there a
 * bill with this exact start?", a new period lying across an old bill was
 * billed whole, and its days charged twice; and a fortnight that happened to
 * start on the same day as a week already paid was taken for billed, its
 * second week never charged.
 *
 * So the days are looked at. A day is spoken for when a bill covers it, or
 * when it is no later than `paidThrough` — the last day paid for, which is
 * all there is to go by for somebody whose payments were only ever in the
 * notebook. Then:
 *
 *   - none of them spoken for: the whole period (the normal case);
 *   - all of them: nothing;
 *   - a fortnight with one of its two weeks spoken for: **the other week**,
 *     to be billed as a week — which is what a change between weekly and
 *     fortnightly leaves behind;
 *   - anything else — a pay day moved by a few days — goes to the nearest
 *     whole period: billed when most of it is free, left alone when most of
 *     it is not. The plan is sold whole and there is no price for four days;
 *     what a move like that leaves uncharged, or charges over, is under half
 *     a period, and a debt by hand settles it either way.
 *
 * Debts written by hand are not periods and do not count.
 *
 * @param {{ start: string, end: string, every?: number }} period
 * @param {object[]} bills  every bill the client has
 * @param {string} [paidThrough]  the last day they have paid for, if known
 * @returns {null | object}  the period, or one week of it (`every: 7`,
 *   `part: 'week'`), or null when there is nothing to bill
 */
export function unbilledPart(period, bills = [], paidThrough = '') {
  if (!period?.start || !period?.end) return null;
  const overlapping = (bills || []).filter((bill) => !isCharge(bill)
    && bill?.periodStart && bill?.periodEnd
    && bill.periodStart <= period.end && bill.periodEnd >= period.start);
  const paid = paidThrough && String(paidThrough) >= period.start ? String(paidThrough) : '';
  if (!overlapping.length && !paid) return period;

  const days = dayRange(period.start, period.end);
  const free = days.filter((day) => !(paid && day <= paid) && !overlapping.some(
    (bill) => day >= bill.periodStart && day <= bill.periodEnd));
  if (!free.length) return null;
  if (free.length === days.length) return period;

  if (days.length === 14 && free.length === 7) {
    for (const week of [days.slice(0, 7), days.slice(7)]) {
      if (week.every((day, i) => day === free[i])) {
        return { start: week[0], end: week[6], every: 7, part: 'week' };
      }
    }
  }

  // The nearest whole period. A bill with this very start already exists when
  // the dates only differ at the far end; a second one cannot be written.
  const sameStart = overlapping.some((bill) => bill.periodStart === period.start);
  return free.length * 2 > days.length && !sameStart ? period : null;
}

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
 * How many days into a period somebody can have started and still pay it
 * whole with their first payment: Wednesday and Saturday are never more than
 * three days apart going back, so this is as far as the collection day before
 * their first day can be.
 */
export const JOIN_GRACE = 3;

/**
 * Whether a period is one this person pays, given the day they started.
 *
 * Not one already running when they started: the plan is sold whole and there
 * is no half price, so a fortnight they joined halfway is not charged as one
 * (if the kitchen is owed for those days, that is a debt written by hand).
 * It is what the scan for unbilled fortnights and the counter both do.
 *
 * The counter has one way round it, and it is a decision somebody makes, not
 * a default: taking a payment with «Fijar su quincena con este pago» charges
 * the fortnight that just ended to somebody who joined in its first days
 * (`JOIN_GRACE`). Nothing here assumes it will be used — both apps once told
 * every newcomer they would pay the fortnight in progress, with its full
 * price and its pay day, and on that day the counter asked many of them for
 * nothing.
 */
export function paysPeriod(period, since) {
  if (!period) return false;
  return !since || period.start >= since;
}

/** The first period they pay: the one they started in, or the one after it. */
export function firstPaidPeriod(client, since, day = todayKey()) {
  const running = periodOf(client, since || day);
  return paysPeriod(running, since) ? running : periodOfIndex(client, running.index + 1);
}

/**
 * The period this person pays next: the one being served — or, for somebody
 * who started with it already under way (or has not started yet), the first
 * one that is theirs.
 *
 * Every screen that names "the day they pay" reads it off this one. They
 * each worked it out from the period in progress, and so somebody's file
 * could say the 16th while the roster, the counter and the edit form still
 * said the 2nd.
 */
export function payingPeriod(client, since, day = todayKey()) {
  const running = periodOf(client, day);
  return paysPeriod(running, since) ? running : firstPaidPeriod(client, since, day);
}

/**
 * The day the next payment is due: the first day of their next period.
 *
 * Not the same as the invoice's `dueDate`, which adds the grace days before a
 * bill counts as late. This is the day the client turns up — "pagas el
 * sábado 29" — and it is the number the counter actually quotes.
 */
export const payDayAfter = (period) => addDays(period.end, 1);

/**
 * Payment deadline for a period.
 *
 * `graceDays` after the period closes — and never before its collection day,
 * the day after it closes, which is the first day anybody can come and pay it.
 * A farm on "Mismo día" (0) used to get the period's own last day as its
 * deadline, and so read «Vencido · venció ayer» on the very morning its people
 * came to pay.
 */
export function dueDateFor(period, graceDays = DEFAULT_GRACE_DAYS) {
  const due = addDays(period.end, Math.max(0, graceDays ?? DEFAULT_GRACE_DAYS));
  const collection = payDayAfter(period);
  return due < collection ? collection : due;
}

/**
 * The deadline of a bill already written — or '' when it carries none.
 *
 * What it says, unless it says a day before the bill's own collection day —
 * the bills cut for a "Mismo día" farm before the rule above. Read through
 * here, those stop being overdue on the day they are paid without anybody
 * having to rewrite them. A debt by hand has no collection day: its date is
 * its date.
 *
 * A bill saved long ago with no deadline has none, and nothing here invents
 * one: it is owed, never overdue, and its date is shown as a dash. Every
 * reader has to allow for the empty answer — taken for a date, '' is the year
 * 1900, and such a bill read «venció hace 46 mil días».
 */
export function dueOf(invoice) {
  const stored = invoice?.dueDate || '';
  if (!stored || isCharge(invoice) || !invoice.periodEnd) return stored;
  const collection = addDays(invoice.periodEnd, 1);
  return stored < collection ? collection : stored;
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
 * A bill's payments as a list, whatever shape they were stored in.
 *
 * They are written as a list. A bill that has been through older versions of
 * this software, or edited by hand in the console, can carry them as a map —
 * and one bill like that used to take down every screen that read it: the
 * receipt's "Es por", the check for payments made ahead, the payment itself.
 * Anything in it that is not an entry is left out.
 */
export function paymentsOf(bill) {
  const stored = bill?.payments;
  const list = Array.isArray(stored) ? stored
    : (stored && typeof stored === 'object' ? Object.values(stored) : []);
  return list.filter((entry) => entry && typeof entry === 'object');
}

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
  // A week is called a week: somebody who pays every seven days was told
  // they owed "1 quincena" for one.
  const weeks = invoices.filter((invoice) => !isCharge(invoice)
    && Number(invoice.payEvery) === PAY_EVERY.WEEK).length;
  const fortnights = invoices.length - charges - weeks;
  const parts = [];
  if (fortnights) parts.push(`${fortnights} ${fortnights === 1 ? 'quincena' : 'quincenas'}`);
  if (weeks) parts.push(`${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`);
  if (charges) parts.push(`${charges} ${charges === 1 ? 'deuda' : 'deudas'}`);
  if (parts.length > 2) return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
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

/**
 * What a payment is for, as `applied` rows, read off the bills holding it.
 *
 * Not off the receipt: a payment that went to a fortnight before it was
 * served is moved to the one it was for, and the receipt — which nobody may
 * rewrite — still names the first. What the receipt says is the answer only
 * when no bill in hand holds the payment: it was cancelled, or its bills are
 * older than the ones that were read.
 *
 * Money a payment kept "a cuenta" — with no fortnight it could wait on — comes
 * last, as a row of its own with no bill (`kind: 'credit'`).
 *
 * Each row: `{ invoiceId, title, periodStart, periodEnd, kind, amount, moved,
 * early }`, oldest first. `early` is money that went in before the fortnight
 * it sits on had ended: "a cuenta" of it.
 */
export function paidFor(receipt, bills = []) {
  const held = (bills || []).flatMap((bill) => {
    const mine = paymentsOf(bill).filter((payment) => payment.receiptId === receipt?.id);
    if (!mine.length) return [];
    return [{
      invoiceId: bill.id,
      title: invoiceTitle(bill),
      periodStart: bill.periodStart,
      periodEnd: bill.periodEnd,
      kind: bill.kind || 'period',
      amount: round2(mine.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0)),
      moved: mine.some((payment) => !!payment.movedFrom),
      // Not the last fortnight of somebody who was leaving (`final`): that
      // one was paid when it was due, whatever its dates say.
      early: !isCharge(bill) && mine.every((payment) => !!payment.date && !payment.final
        && String(payment.date) < String(bill.periodEnd || '')),
    }];
  });
  const rows = held.length
    ? held.sort((a, b) => String(a.periodStart).localeCompare(String(b.periodStart)))
    : (receipt?.applied || []);
  const loose = round2(receipt?.unapplied || 0);
  return loose > 0.005
    ? [...rows, { invoiceId: null, title: 'A cuenta', kind: 'credit', amount: loose }]
    : rows;
}

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
  // With no deadline there is nothing to be late for.
  const due = dueOf(invoice);
  if (due && daysBetween(due, day) > 0) return 'overdue';
  if (daysBetween(invoice.periodEnd, day) >= 0) return 'due';
  return 'open';
}

export const balanceOf = (invoice) =>
  round2((Number(invoice?.amount) || 0) - (Number(invoice?.paid) || 0));

/** Days until the deadline: positive = still time, negative = late; 0 with no deadline. */
export const daysUntilDue = (invoice, day = todayKey()) => {
  const due = invoice ? dueOf(invoice) : '';
  return due ? daysBetween(day, due) : 0;
};

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
  // What can be owed today: a hand-written debt, or a period already served.
  // A bill for a period still running — there are old ones, written when
  // paying ahead was allowed — is not owed yet, so it is not in the balance.
  const outstanding = invoices
    .filter((inv) => balanceOf(inv) > 0.005)
    .filter((inv) => isOwed(inv, client, day))
    // As text, whatever is there: a bill saved long ago without a due date
    // must not stop the screen that is adding the balance up. It goes last:
    // with no deadline of its own, it is not the one to act on first.
    .sort((a, b) => String(dueOf(a) || '9999').localeCompare(String(dueOf(b) || '9999')));

  const overdue = outstanding.filter((inv) => invoiceStatus(inv, day) === 'overdue');
  const balance = round2(outstanding.reduce((sum, inv) => sum + balanceOf(inv), 0));
  const focus = overdue[0] || outstanding[0] || null;

  let status = 'paid';
  if (overdue.length) status = 'overdue';
  else if (focus) status = invoiceStatus(focus, day);
  const deadline = (focus && dueOf(focus)) || dueDateFor(current, client?.graceDays);

  return {
    currentPeriod: current,
    /** The invoice the user should act on next, if any. */
    focus,
    /** Everything still carrying a balance, soonest deadline first. */
    outstanding,
    overdueCount: overdue.length,
    balance,
    status,
    // The deadline of what is owed — or, with nothing owed (or only a bill
    // that never had one), the one of the period being served.
    dueDate: deadline,
    daysToDue: daysBetween(day, deadline),
    /** False when what is owed is a bill saved with no deadline: then the date above is not its own, and is not quoted. */
    hasDeadline: !focus || !!dueOf(focus),
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
    // The day it was written, plus the days of grace. Not `dueDateFor`: a debt
    // has no collection day to wait for.
    dueDate: addDays(day, Math.max(0, client.graceDays ?? DEFAULT_GRACE_DAYS)),
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
