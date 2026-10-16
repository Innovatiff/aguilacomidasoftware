/**
 * Invoices — one per client per bi-weekly cycle.
 *
 * The id is `${clientId}_${periodStart}`, so re-issuing a cycle updates the
 * same document instead of creating a second bill for the same fortnight. It
 * also means a fortnight already served can be billed the moment somebody pays
 * for it, from any screen, without two of them appearing.
 *
 * `settled` is stored as a real boolean because Firestore cannot compare two
 * fields in a query: it is the only way to ask "who still owes money?" in one
 * round trip. Display status is always *derived* (`invoiceStatus`), since
 * "overdue" depends on today's date and would otherwise go stale in the
 * document.
 */

import {
  db, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, limit as qLimit, serverTimestamp, runTransaction,
  docData, listData,
} from '../firebase.js';
import { folioFor } from './receipts.js';
import {
  invoiceId, draftInvoice, draftCharge, chargeIdFor, isCharge, invoiceTitle,
  balanceOf, invoiceStatus, round2, periodOf, periodOfIndex, cycleFromPayment,
  isPayable, isCovered, payDayAfter, periodWord, paymentsOf,
} from '../lib/billing.js';
import { periodCharge } from '../lib/pricing.js';
import {
  today, addDays, daysBetween, formatRange, formatDay, weekdayName,
} from '../lib/dates.js';
import { money } from '../lib/format.js';
import { servingSince } from './clients.js';

/**
 * How many periods back a payment looks for food served and never billed —
 * the same window the panel's own scan for unbilled periods uses.
 */
const LOOK_BACK = 4;

/**
 * How far ahead money that is not owed yet can be kept: a year of fortnights.
 * Past that — or for somebody with no price on their plan, or who has stopped
 * coming — what is left is recorded on the receipt as "a cuenta", never
 * turned away.
 */
const MAX_AHEAD = 26;

/**
 * How many days into a fortnight somebody can have started and still pay it
 * whole with their first payment: Wednesday and Saturday are never more than
 * three days apart going back, so this is as far as the collection day before
 * their first day can be.
 */
const JOIN_GRACE = 3;

const invoicesRef = () => collection(db, 'invoices');

/* --- Reads ----------------------------------------------------------------- */

/** One farm's bills, newest cycle first. */
export function watchClientInvoices(clientId, onData, onError, count = 24) {
  return onSnapshot(
    query(invoicesRef(), where('clientId', '==', clientId),
      orderBy('periodStart', 'desc'), qLimit(count)),
    (snap) => onData(listData(snap)),
    onError,
  );
}

/**
 * Everything still carrying a balance, across all farms — the admin's worklist.
 *
 * Sorted here rather than in the query. Unpaid invoices are few by definition,
 * and pairing the filter with an `orderBy` would demand a composite index —
 * one more thing to create before the panel works at all.
 */
export function watchOutstanding(onData, onError) {
  return onSnapshot(
    query(invoicesRef(), where('settled', '==', false)),
    (snap) => onData(listData(snap).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))),
    onError,
  );
}

/**
 * Recently settled bills, for the "Pagadas" tab.
 *
 * Ordered by `paidAt` alone, which is an automatic single-field index, and
 * filtered in memory. Only a settled invoice carries a real `paidAt`; the rest
 * hold null, which Firestore sorts lowest, so a descending page fills with
 * settled ones first.
 */
export function watchSettled(onData, onError, count = 40) {
  return onSnapshot(
    query(invoicesRef(), orderBy('paidAt', 'desc'), qLimit(count)),
    (snap) => onData(listData(snap).filter((invoice) => invoice.settled)),
    onError,
  );
}

export function watchInvoice(id, onData, onError) {
  return onSnapshot(doc(db, 'invoices', id), (snap) => onData(docData(snap)), onError);
}

export const getInvoice = async (id) => docData(await getDoc(doc(db, 'invoices', id)));

/**
 * Whether any bill has ever been issued for a farm.
 *
 * One read, asked before letting anybody move that farm's billing anchor. The
 * anchor is what cuts the fortnights: every invoice id ends in the start date
 * of the period it belongs to, and `paidThrough` is the end date of one. Move
 * the anchor after bills exist and none of those dates line up with a period
 * any more — the panel then sees fortnights it has "never billed" that overlap
 * ones it already did, and offers to bill the same food twice.
 */
export async function farmHasInvoices(farmId) {
  if (!farmId) return false;
  const snap = await getDocs(query(invoicesRef(), where('farmId', '==', farmId), qLimit(1)));
  return !snap.empty;
}

export async function listClientInvoices(clientId) {
  const snap = await getDocs(query(invoicesRef(), where('clientId', '==', clientId),
    orderBy('periodStart', 'desc')));
  return listData(snap);
}

/* --- Issuing --------------------------------------------------------------- */

/**
 * Issues (or re-issues) the bill for a cycle.
 *
 * Runs in a transaction so a re-issue can never clobber payments already
 * recorded against the cycle: the meals and amount are refreshed, the money
 * that came in is preserved, and `settled` is recomputed from both.
 */
export async function issueInvoice(client, period, charge, meals, author, extra = {}) {
  const id = invoiceId(client.id, period.start);
  const ref = doc(db, 'invoices', id);
  const draft = { ...draftInvoice(client, period, charge, meals), ...extra };

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    // Already written — by the cycle, by a payment, or by somebody who then
    // corrected its amount. Writing it again would put back the plan's price
    // over that correction, so the bill that exists stays the bill.
    if (snap.exists()) return { id, ...snap.data(), existed: true };

    const amount = draft.amount;
    const record = {
      ...draft,
      paid: 0,
      payments: [],
      settled: amount <= 0.005,
      issuedAt: serverTimestamp(),
      issuedByName: author?.name || '',
      updatedAt: serverTimestamp(),
    };
    if (record.settled) record.paidAt = serverTimestamp();

    tx.set(ref, record);
    return { id, ...record };
  });
}

/* --- Hand-written debts ---------------------------------------------------- */

/**
 * Puts a debt on somebody's account that no fortnight produced.
 *
 * The kitchen sells more than the plan: a case of drinks, a plate for a
 * visitor, something broken and replaced, a fortnight the notebook says is
 * short. Before this, the only way to collect any of it was to overcharge the
 * next bill, which leaves nothing on paper explaining why the number moved —
 * and that is the argument that gets had at the counter two weeks later.
 *
 * So it is written as its own bill, with the reason on it. It joins the queue
 * of what they owe like any other, is paid off like any other, and the reason
 * follows it onto the receipt.
 */
export async function addCharge({ client, amount, reason, date }, author) {
  const total = round2(amount);
  if (!(total > 0)) throw new Error('El monto debe ser mayor a cero.');
  if (!String(reason || '').trim()) throw new Error('Escribe de qué es la deuda.');

  const day = date || today();
  // An auto id borrowed only for its uniqueness: two debts on the same day for
  // the same person must not land on the same document.
  const unique = doc(collection(db, 'invoices')).id.slice(0, 10);
  const id = chargeIdFor(client.id, day, unique);
  const ref = doc(db, 'invoices', id);

  const record = {
    ...draftCharge(client, { amount: total, reason, date: day }),
    issuedAt: serverTimestamp(),
    issuedByName: author?.name || '',
    issuedByUid: author?.uid || null,
    updatedAt: serverTimestamp(),
    paidAt: null,
  };

  await landed(setDoc(ref, record));
  return { id, ...record };
}

/* --- Correcting what somebody owes ----------------------------------------- */

/**
 * Changes the amount of one bill, with the reason attached to it.
 *
 * The notebook years left a lot of numbers that are simply wrong: a fortnight
 * typed at the wrong plan, a debt entered twice, an amount somebody agreed to
 * knock down at the counter. Until now the only tools were to add another debt
 * — which cannot make a number smaller — or to delete a hand-written one, which
 * loses the fact that it ever existed.
 *
 * So a bill's amount is editable, and every edit is kept on the bill: what it
 * was, what it became, who changed it and why. The note is not optional for the
 * same reason a debt's reason is not: a number that moved with no explanation is
 * the argument this whole screen exists to prevent.
 *
 * What it will not do is push a bill below what has already been paid against
 * it. That would mean the kitchen owes the client change, which is a refund —
 * a different thing, with its own record. Cancel the payment first.
 *
 * In a transaction, because a payment landing at the same moment must not be
 * lost, and because `settled` has to be recomputed from both halves.
 */
export async function correctAmount({ invoice, amount, note }, author) {
  const id = invoice?.id;
  if (!id) throw new Error('Esa factura ya no existe.');

  const next = round2(amount);
  const why = String(note || '').trim();
  if (!(next >= 0)) throw new Error('El monto no puede ser negativo.');
  if (!why) throw new Error('Escribe por qué cambia el monto.');

  const ref = doc(db, 'invoices', id);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Esa factura ya no existe.');

    const data = snap.data();
    if (round2(data.amount || 0) === next) return { id, ...data };
    if (next < round2(data.paid || 0)) {
      throw new Error(`Ya pagó ${money(round2(data.paid || 0))} de esta cuenta. `
        + 'Para bajarla de ahí hay que cancelar primero el pago.');
    }

    tx.set(ref, correction(data, next, why, author), { merge: true });
    return { id, ...data, amount: next };
  });
}

/**
 * The patch that moves one bill's amount, with the reason on it.
 *
 * Split out because the balance correction below applies several of these in a
 * single transaction, and the rule for what a corrected bill looks like has to
 * be the same whether one bill is being fixed or four.
 */
function correction(data, next, note, author) {
  const before = round2(data.amount || 0);
  const paid = round2(data.paid || 0);
  const settled = paid >= next - 0.005;

  const record = {
    amount: next,
    settled,
    status: settled ? 'paid' : (data.status === 'open' ? 'open' : 'due'),
    // The whole trail, not just the last change: a bill corrected twice has to
    // be able to answer for both times.
    corrections: [...(data.corrections || []), {
      from: before,
      to: next,
      note,
      date: today(),
      byName: author?.name || '',
      byUid: author?.uid || null,
    }],
    updatedAt: serverTimestamp(),
  };

  if (settled && !data.paidAt) record.paidAt = serverTimestamp();
  if (!settled) record.paidAt = null;
  return record;
}

/**
 * The bills that make up what somebody owes today: hand-written debts, and
 * fortnights already served that are not fully paid. The one rule every
 * balance on screen uses, so a correction moves exactly the number shown.
 */
export function owedBills(bills, client, day = today()) {
  return (bills || []).filter((bill) => balanceOf(bill) > 0.005
    && (isCharge(bill)
      || isPayable({ start: bill.periodStart, end: bill.periodEnd }, client, day)));
}

/**
 * Puts somebody's balance on a number, whatever it takes to get there.
 *
 * This is the one the counter actually reaches for. Nobody thinks "invoice
 * c14_2026-08-26 should be $120" — they think "he owes $140 and it should be
 * $120". So the manager types the total and the arithmetic happens here.
 *
 * Down, it comes off the newest bills first. A reduction is nearly always a
 * recent mistake, and taking it off the oldest would quietly settle a fortnight
 * that has been overdue for a month — the age of a debt is information, and
 * clearing it with a correction would erase it.
 *
 * Up, it is one new debt for the difference carrying the note as its reason,
 * which is exactly what a hand-written debt already is.
 *
 * The reductions go in one transaction. Half of a correction applied is worse
 * than none: the balance would sit on a number nobody chose, and the client
 * would have been told a total that never existed.
 */
export async function adjustBalance({ client, target, note }, author) {
  const why = String(note || '').trim();
  if (!why) throw new Error('Escribe por qué cambia el saldo.');

  const wanted = round2(target);
  if (!(wanted >= 0)) throw new Error('El saldo no puede ser negativo.');

  const snap = await getDocs(query(invoicesRef(),
    where('clientId', '==', client.id), where('settled', '==', false)));
  // The same bills the balance on screen counts: a fortnight still running is
  // not owed yet, so it is neither in the number nor lowered by it.
  const open = owedBills(listData(snap), client)
    .sort((a, b) => String(b.periodStart).localeCompare(String(a.periodStart)));

  const balance = round2(open.reduce((sum, invoice) => sum + balanceOf(invoice), 0));
  const difference = round2(wanted - balance);
  if (Math.abs(difference) < 0.005) return { changed: 0, balance, touched: [] };

  if (difference > 0) {
    const charge = await addCharge(
      { client, amount: difference, reason: why, date: today() }, author);
    return { changed: difference, balance: wanted, touched: [charge.id] };
  }

  const refs = open.map((invoice) => doc(db, 'invoices', invoice.id));

  const touched = await runTransaction(db, async (tx) => {
    // Every read before every write, which a Firestore transaction requires and
    // which also means the amounts below are the ones actually stored right
    // now — not the ones the screen was showing when the manager typed.
    const snaps = [];
    for (const ref of refs) snaps.push(await tx.get(ref));

    let left = round2(-difference);
    const done = [];

    for (let i = 0; i < snaps.length && left > 0.005; i += 1) {
      if (!snaps[i].exists()) continue;
      const data = snaps[i].data();
      const owing = round2((Number(data.amount) || 0) - (Number(data.paid) || 0));
      if (owing <= 0.005) continue;

      const give = Math.min(left, owing);
      tx.set(refs[i], correction(data, round2((Number(data.amount) || 0) - give), why, author),
        { merge: true });
      done.push(refs[i].id);
      left = round2(left - give);
    }

    if (left > 0.005) {
      throw new Error(`Sólo se pueden bajar ${money(round2(-difference - left))}: `
        + 'el resto ya está pagado. Para devolverlo hay que cancelar el pago.');
    }
    return done;
  });

  return { changed: difference, balance: wanted, touched };
}

/**
 * Removes a debt that should not have been written.
 *
 * Only while nothing has been paid against it. Once money has landed on it the
 * mistake is in the payment, not the debt, and undoing it here would leave a
 * receipt pointing at a bill that no longer exists — so the payment is
 * cancelled first, which is a different action with its own record.
 *
 * A charge carries no receipt and nothing was handed to the client, so there is
 * nothing to preserve: unlike a payment, it is deleted rather than reversed.
 */
export async function voidCharge(invoice) {
  if (!invoice?.id) throw new Error('Ese cargo ya no existe.');
  if (!isCharge(invoice)) throw new Error('Sólo se pueden quitar los cargos agregados a mano.');
  if ((Number(invoice.paid) || 0) > 0.005) {
    throw new Error('Este cargo ya tiene pagos aplicados. Cancela primero el pago.');
  }
  await deleteDoc(doc(db, 'invoices', invoice.id));
}


/**
 * Writes down a payment that happened before the software did.
 *
 * The first notebook was typed in before payments could be recorded at all, so
 * a couple of hundred people carry a real history the panel has never seen —
 * their libreta page reads "sin pagos" for money they handed over in cash.
 *
 * This is a record, not a collection: there is no invoice behind it to settle,
 * so it moves nobody's balance. That is the honest behaviour. The fortnights
 * it covered were never billed either, and inventing bills to match a
 * half-remembered date would be worse than leaving the ledger where it is.
 *
 * What it does do is put the payment in the history and on the libreta page,
 * which is where the question "¿cuándo pagó la última vez?" actually gets
 * asked. It is marked `fromNotebook` so a year from now nobody mistakes it for
 * a payment this system took.
 */
export async function recordPastPayment({ client, amount, method, date, note }, author) {
  const total = round2(amount);
  if (!(total > 0)) throw new Error('El monto debe ser mayor a cero.');
  const day = date || today();
  if (day > today()) throw new Error('Esa fecha todavía no llega.');

  const ref = doc(collection(db, 'receipts'));
  const receipt = {
    clientId: client.id,
    clientName: client.name || '',
    farmId: client.farmId || '',
    farmName: client.farmName || '',
    locationName: client.locationName || '',
    amount: total,
    method: method || 'cash',
    reference: '',
    note: note || '',
    date: day,
    applied: [],
    balanceAfter: 0,
    fromNotebook: true,
    takenByName: author?.name || '',
    takenByUid: author?.uid || null,
    folio: folioFor(ref.id, day),
    at: serverTimestamp(),
  };

  await setDoc(ref, receipt);
  return { id: ref.id, ...receipt, at: new Date() };
}

/* --- Payments -------------------------------------------------------------- */

/**
 * What can be paid on `day`, oldest first.
 *
 * Everything still open for food already served — a fortnight's bill, or a
 * debt written by hand — and every fortnight already served that nobody billed
 * yet. **Never the fortnight still running, never one after it**: nobody here
 * pays for food not yet cooked, so there is nothing ahead to put money on.
 *
 * Read from the client's own bills, not from what a screen holds in memory: a
 * fortnight paid in full is not in memory at all, and mistaking it for one
 * never billed would charge it twice.
 *
 * @returns {Promise<{ payer, anchor, rows, total, charge }>}
 *   payer  the client as this payment sees them, with the anchor it would use
 *   rows   `[{ id, title, periodStart, periodEnd, owed, existing, kind, period }]`
 */
export async function payableFor(client, pricing, { day = today(), setCycle = false } = {}) {
  const anchor = setCycle ? cycleFromPayment(day) : (client.cycleAnchor || cycleFromPayment(day));
  const payer = { ...client, cycleAnchor: anchor };
  const bills = await billsOf(client.id);
  return { payer, anchor, bills, ...payableRows(payer, bills, pricing, { day, setCycle }) };
}

/**
 * Every bill one client has, paid or not, in no particular order.
 *
 * No `orderBy`, so it needs no index of its own; whoever reads it sorts.
 */
export async function billsOf(clientId) {
  const snap = await getDocs(query(invoicesRef(), where('clientId', '==', clientId)));
  return snap.docs.map((found) => ({ id: found.id, ...found.data() }));
}

/** Active, or written before there was a status at all. */
const beingServed = (client) => !client?.status || client.status === 'active';

/**
 * The same, from bills already in hand — the arithmetic, kept apart so it can
 * be checked without a database.
 *
 * A fortnight served and never billed is the client's when they were being
 * served in it: not one that began after their last day, and not one already
 * running when they started — the plan is sold whole and there is no half
 * price. The one exception is the payment that *sets* somebody's fortnight:
 * that payment says which fortnight it is for, and it is the one that just
 * ended even if they joined a few days into it — as many as a collection day
 * can fall before the day somebody starts (`JOIN_GRACE`). Somebody who started
 * a week into it and comes to pay has not finished their first fortnight.
 */
export function payableRows(payer, bills, pricing, { day = today(), setCycle = false } = {}) {
  const rows = [];
  for (const bill of bills) {
    const owed = balanceOf(bill);
    if (owed <= 0.005) continue;
    if (!isCharge(bill)
      && !isPayable({ start: bill.periodStart, end: bill.periodEnd }, payer, day)) continue;
    rows.push({
      id: bill.id,
      title: invoiceTitle(bill),
      periodStart: bill.periodStart,
      periodEnd: bill.periodEnd,
      owed,
      existing: true,
      kind: bill.kind || 'period',
    });
  }

  // Fortnights nobody billed are only worked out for somebody being served. A
  // paused or retired worker is not billed by the cycle, so a fortnight with
  // no bill is one they did not eat: what they pay goes to the bills they do
  // have, and the rest waits on the receipt.
  const charge = periodCharge(payer, pricing);
  if (beingServed(payer) && charge.priced && charge.amount > 0) {
    const known = new Set(bills.map((bill) => bill.id));
    const since = servingSince(payer);
    const current = periodOf(payer, day);
    let latest = true;
    for (let back = 0; back <= LOOK_BACK; back += 1) {
      const period = periodOfIndex(payer, current.index - back);
      if (!isPayable(period, payer, day)) continue;
      // The exception below is for the fortnight that just ended, and only
      // that one: an older one they joined two days before its end is not
      // theirs, whichever payment it is.
      const justEnded = latest;
      latest = false;
      const id = invoiceId(payer.id, period.start);
      if (known.has(id)) continue;
      if (isCovered(period, payer.paidThrough)) continue;
      if (payer.endsOn && period.start > payer.endsOn) continue;
      if (since && period.start < since
        && !(setCycle && justEnded && daysBetween(period.start, since) <= JOIN_GRACE)) continue;
      rows.push({
        id,
        title: formatRange(period.start, period.end),
        periodStart: period.start,
        periodEnd: period.end,
        owed: round2(charge.amount),
        existing: false,
        kind: 'period',
        period,
      });
    }
  }

  // Oldest first: the id of a bill ends in its date, so it breaks a tie the
  // same way the queue always has.
  rows.sort((a, b) => String(a.periodStart).localeCompare(String(b.periodStart))
    || a.id.localeCompare(b.id));
  return { rows, total: round2(rows.reduce((sum, row) => sum + row.owed, 0)), charge };
}

/**
 * Where money goes once everything owed is paid: the fortnight still running,
 * then the ones after it — as many as the money reaches.
 *
 * Nobody here pays ahead, so this is not something the counter offers. It is
 * where a payment lands when the system has nothing left for that person to
 * owe — and that happens: a cycle a few days off the one they really have, a
 * start date typed wrong, a fortnight the system thinks was paid that was
 * not. The money changed hands, so it goes into the software; it waits on the
 * fortnight being served, and the roster flags it for a look
 * (js/lib/advance.js) instead of the counter turning somebody away.
 *
 * Not past their last day, and not for a plan with no price: what does not
 * fit stays on the receipt as "a cuenta".
 *
 * @returns {object[]} rows like `payableRows`, each with `ahead: true`
 */
export function aheadRows(payer, bills, pricing, { day = today(), amount = 0 } = {}) {
  const charge = periodCharge(payer, pricing);
  const byId = new Map((bills || []).map((bill) => [bill.id, bill]));
  const first = periodOf(payer, day);
  const rows = [];
  let left = round2(amount);

  for (let i = 0; i < MAX_AHEAD && left > 0.005; i += 1) {
    const period = periodOfIndex(payer, first.index + i);
    // Already among what is owed: their service ended inside it.
    if (isPayable(period, payer, day)) continue;
    if (payer.endsOn && period.start > payer.endsOn) break;

    const id = invoiceId(payer.id, period.start);
    const bill = byId.get(id);
    if (bill) {
      const owed = balanceOf(bill);
      if (owed <= 0.005) continue;
      rows.push({
        id,
        title: invoiceTitle(bill),
        periodStart: bill.periodStart,
        periodEnd: bill.periodEnd,
        owed,
        existing: true,
        kind: bill.kind || 'period',
        ahead: true,
      });
      left = round2(left - owed);
    } else {
      if (!beingServed(payer) || !(charge.priced && charge.amount > 0)) break;
      rows.push({
        id,
        title: formatRange(period.start, period.end),
        periodStart: period.start,
        periodEnd: period.end,
        owed: round2(charge.amount),
        existing: false,
        kind: 'period',
        period,
        ahead: true,
      });
      left = round2(left - charge.amount);
    }
  }
  return rows;
}

/**
 * What to say when somebody owes nothing for food already served — which is
 * everybody who pays a few days early.
 *
 * Information, never a refusal, and worded so it cannot be read as one: the
 * counter used to say "no debe nada", and a cashier reading that with the
 * button greyed out sent people home with their money. The payment goes to
 * the fortnight they are eating now.
 */
export function nothingOwedYet(client, day = today()) {
  const running = periodOf(client, day);
  const payDay = payDayAfter(running);
  return `Está al corriente con lo ya servido. Lo que pague hoy queda para su ${periodWord(client)} `
    + `en curso (${formatRange(running.start, running.end)}), la que se paga el `
    + `${weekdayName(payDay)} ${formatDay(payDay)}.`;
}

/**
 * Takes a payment at the counter and returns the receipt.
 *
 * Somebody walks in with cash for what they have eaten. The money goes to what
 * they owe, oldest first: bills still open, then fortnights already served and
 * not yet billed, each billed as it is paid for.
 *
 * **Every payment goes in, always.** Whatever the system thinks this person
 * owes — nothing, or less than they are handing over, a few days early or a
 * few days late, active, paused or gone — the money changed hands, and the
 * manager counts what came in. Dates on a client can be wrong. What is left
 * once the debts are paid waits on the fortnight being served and the ones
 * after it (`aheadRows`); what does not fit even there is kept on the receipt
 * as "a cuenta" (`unapplied`). The day is the day it was paid, as given.
 *
 * Applied in a single transaction, because the alternative is a payment that
 * half-applied. And if applying it fails — a client whose record the
 * arithmetic cannot read, no internet at the counter, the database's daily
 * allowance spent — the payment is kept anyway, whole, as its own receipt
 * (`keepPayment`), and marked for somebody to look at. The only thing refused
 * is an amount of zero, which is not a payment.
 */
export async function takePayment(params, author) {
  const total = round2(params.amount);
  if (!(total > 0)) throw new Error('El monto debe ser mayor a cero.');
  const day = params.date || today();
  // Made here so the receipt keeps one id and one folio whichever way it is
  // saved — and so a retry can tell it was saved already.
  const receiptRef = doc(collection(db, 'receipts'));
  try {
    return await applyPayment({ ...params, total, day, receiptRef }, author);
  } catch (error) {
    return keepPayment({ ...params, total, day, receiptRef }, author, error);
  }
}

/** The payment, spread over what they owe and what they are eating now. */
async function applyPayment({
  client, pricing, total, day, receiptRef, method, reference, note, setCycle = false,
}, author) {

  /*
   * When this payment sets the cycle, it has to set it *before* anything else
   * happens here.
   *
   * The fortnights this money is applied to are cut from the anchor, and every
   * invoice id ends in the start date of the period it belongs to. Re-anchoring
   * afterwards would leave the bills this very payment just wrote sitting on
   * dates that no period lands on any more — the same way moving a rancho's
   * cycle used to. So the new anchor is decided first and everything below is
   * built from it. It snaps back to the collection day the fortnight being
   * paid ended at (see `cycleFromPayment`).
   */
  // Read outside the transaction: a query cannot run inside one.
  const {
    payer, anchor, bills, rows, total: owedNow, charge,
  } = await payableFor(client, pricing, { day, setCycle });
  const extra = round2(total - owedNow);
  const targets = [
    ...rows,
    ...(extra > 0.005 ? aheadRows(payer, bills, pricing, { day, amount: extra }) : []),
  ];

  const clientRef = doc(db, 'clients', client.id);

  return runTransaction(db, async (tx) => {
    // Every read first — Firestore refuses a read after a write in the same
    // transaction.
    const read = [];
    for (const row of targets) {
      const ref = doc(db, 'invoices', row.id);
      const snap = await tx.get(ref);
      read.push({ ...row, ref, data: snap.exists() ? snap.data() : null });
    }

    let left = total;
    const applied = [];
    let balanceAfter = 0;
    // The last day of food this payment leaves paid for. Stamped on the client
    // so the roster can answer "is this one up to date?" by reading one field,
    // instead of every screen re-deriving it from the invoice history.
    let paidThrough = client.paidThrough || null;

    for (const row of read) {
      const draft = row.data
        || (row.period
          ? { ...draftInvoice(payer, row.period, charge, 0), issuedByName: author?.name || '' }
          : null);
      if (!draft) continue;

      const owed = round2((Number(draft.amount) || 0) - (Number(draft.paid) || 0));
      const take = left > 0.005 ? Math.min(left, Math.max(0, owed)) : 0;

      // A fortnight not served yet that this payment did not reach is left
      // alone: it is not a debt, and it is not billed.
      if (row.ahead && take <= 0.005) continue;

      if (take > 0.005) {
        left = round2(left - take);
        const paid = round2((Number(draft.paid) || 0) + take);
        const settled = paid >= (Number(draft.amount) || 0) - 0.005;
        const entry = {
          amount: take,
          method: method || 'cash',
          date: day,
          reference: reference || '',
          note: note || '',
          byName: author?.name || '',
          byUid: author?.uid || null,
          receiptId: receiptRef.id,
          at: new Date(),
          // Kept on a fortnight not served yet because nothing else was owed —
          // on purpose, not the old misplacement js/lib/advance.js looks for.
          ...(row.ahead ? { ahead: true } : {}),
        };

        const record = {
          ...draft,
          paid,
          payments: [...paymentsOf(draft), entry],
          settled,
          status: settled ? 'paid' : 'due',
          ...(settled ? { paidAt: serverTimestamp() } : { paidAt: null }),
          updatedAt: serverTimestamp(),
          ...(row.data ? {} : { issuedAt: serverTimestamp() }),
        };
        tx.set(row.ref, record, { merge: true });

        applied.push({
          invoiceId: row.id,
          // A bill from before dates were kept on every one — a debt typed by
          // hand years ago — has none to copy.
          periodStart: record.periodStart || '',
          periodEnd: record.periodEnd || '',
          // Stamped now so the receipt keeps saying what it paid for even if
          // the bill behind it is later removed.
          title: invoiceTitle(record),
          kind: record.kind || 'period',
          amount: take,
          ...(row.ahead ? { ahead: true } : {}),
        });
        // Only a fortnight of food already served moves "paid up to". Settling
        // a hand-written debt says nothing about which fortnights are covered,
        // and money waiting on a fortnight still running is not one paid for.
        if (!row.ahead && !isCharge(record) && settled
          && (!paidThrough || record.periodEnd > paidThrough)) {
          paidThrough = record.periodEnd;
        }
        // What is left on a fortnight still running is not owed yet.
        if (!row.ahead) balanceAfter = round2(balanceAfter + Math.max(0, round2(record.amount - paid)));
      } else {
        // Served, owed, and not paid by this payment. A fortnight already
        // served is a debt whether or not anybody pressed a button to bill it,
        // so it is billed now, unpaid, and the receipt's "queda debiendo"
        // includes it — rather than the slip saying "al corriente" about food
        // still owed.
        if (!row.data) {
          tx.set(row.ref, {
            ...draft,
            settled: false,
            status: 'due',
            paidAt: null,
            issuedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        balanceAfter = round2(balanceAfter + Math.max(0, owed));
      }
    }

    // Whatever found no fortnight to wait on is still money received.
    const unapplied = round2(left);

    const receipt = {
      clientId: client.id,
      clientName: client.name || '',
      farmId: client.farmId || '',
      farmName: client.farmName || '',
      locationName: client.locationName || '',
      amount: total,
      method: method || 'cash',
      reference: reference || '',
      note: note || '',
      date: day,
      applied,
      ...(unapplied > 0.005 ? { unapplied } : {}),
      balanceAfter,
      ...(setCycle ? { setCycleTo: anchor } : {}),
      takenByName: author?.name || '',
      takenByUid: author?.uid || null,
      folio: folioFor(receiptRef.id, day),
      at: serverTimestamp(),
    };
    tx.set(receiptRef, receipt);

    // One write for whatever actually changed about this person.
    const patch = {};
    if (paidThrough && paidThrough !== (client.paidThrough || null)) patch.paidThrough = paidThrough;
    if (setCycle) {
      patch.cycleAnchor = anchor;
      // The day the cycle was fixed, and from which payment. Its absence is
      // how every screen knows a client is still on the rancho's inherited
      // default rather than on a cycle somebody confirmed.
      patch.cycleSetOn = day;
    }
    if (Object.keys(patch).length) {
      tx.update(clientRef, { ...patch, updatedAt: serverTimestamp() });
    }

    return { id: receiptRef.id, ...receipt, at: new Date() };
  });
}

/**
 * Keeps a payment that could not be applied — the money in, on its own.
 *
 * The receipt says who, how much, how and when, exactly as it was paid, and
 * holds all of it "a cuenta" (`unapplied`): nothing is moved on their bills,
 * so nothing can be moved wrongly. `held` marks it for the manager — the
 * counter's list and the receipt itself say so — with the reason, so it can
 * be looked at and put where it goes.
 *
 * One plain write, no reads, so it goes through where the transaction could
 * not: Firestore keeps it on this computer when there is no internet and
 * sends it when there is, and it needs none of the daily reading allowance.
 * Not waited on past a few seconds for the same reason — the person at the
 * counter is not kept standing while a write waits for the internet.
 */
async function keepPayment({
  client, total, day, receiptRef, method, reference, note,
}, author, error) {
  // A transaction that reached the server before the connection dropped may
  // have saved it already; one receipt per payment, never two.
  try {
    const already = await Promise.race([getDoc(receiptRef), wait(3000)]);
    if (already?.exists?.()) return { id: receiptRef.id, ...already.data() };
  } catch { /* not readable: write it */ }

  const receipt = {
    clientId: client?.id || '',
    clientName: client?.name || '',
    farmId: client?.farmId || '',
    farmName: client?.farmName || '',
    locationName: client?.locationName || '',
    amount: total,
    method: method || 'cash',
    reference: reference || '',
    note: note || '',
    date: day,
    applied: [],
    unapplied: total,
    balanceAfter: null,
    held: true,
    heldWhy: String(error?.code || error?.message || error || '').slice(0, 300),
    takenByName: author?.name || '',
    takenByUid: author?.uid || null,
    folio: folioFor(receiptRef.id, day),
    at: serverTimestamp(),
  };
  await landed(setDoc(receiptRef, receipt));
  return { id: receiptRef.id, ...receipt, at: new Date() };
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Waits for a write to reach the server, but not forever.
 *
 * Offline, Firestore keeps the write on this computer and sends it when the
 * internet is back, and its promise only settles then — a screen awaiting it
 * would spin until somebody reloaded. A refusal still comes back within the
 * wait; one that comes later must not surface as an unhandled error.
 */
async function landed(write, ms = 4000) {
  write.catch(() => {});
  await Promise.race([write, wait(ms)]);
}

/**
 * Cancels a whole payment — every fortnight it touched, in one go.
 *
 * This is the unit a mistake is actually made in. A cashier takes $280, and
 * that one act may settle two fortnights; undoing it invoice by invoice means
 * finding both, remembering there were two, and leaving two separate negative
 * receipts for what was one error. So the receipt is what gets cancelled, and
 * everything it paid for reopens together.
 *
 * The receipt handed over is not edited or deleted — a record of what happened
 * has to keep saying what happened, and it is the only copy the client holds.
 * Instead a second, negative receipt is written against it, the way a cash book
 * is corrected. Both stay visible to both sides, and the two cancel out.
 */
export async function voidReceipt(receipt, author, { date = '', note = '' } = {}) {
  if (!receipt?.id) throw new Error('Ese recibo ya no existe.');
  if (Number(receipt.amount) < 0) throw new Error('Un recibo de cancelación no se puede cancelar.');

  // One cancellation per receipt, whoever presses and however many times: the
  // id is the receipt's, so a second one finds the first already there. The
  // folio comes from a fresh id, or a cancellation on the day of the payment
  // would carry the payment's own folio.
  const counterRef = doc(db, 'receipts', `void_${receipt.id}`);
  const folioId = doc(collection(db, 'receipts')).id;
  const clientRef = receipt.clientId ? doc(db, 'clients', receipt.clientId) : null;
  // The bills this payment went to, as the receipt says — and any bill holding
  // a part of it now. Money that was paid onto a fortnight before it had been
  // served is moved to the fortnight it was really for (js/data/advance.js),
  // and the receipt, which nobody may rewrite, still names the first one.
  const holding = receipt.clientId
    ? (await billsOf(receipt.clientId))
      .filter((bill) => paymentsOf(bill).some((payment) => payment.receiptId === receipt.id))
      .map((bill) => bill.id)
    : [];
  const targets = [...new Set([...(receipt.applied || []).map((row) => row.invoiceId), ...holding])];

  return runTransaction(db, async (tx) => {
    // Every read before any write — Firestore refuses the other order.
    if ((await tx.get(counterRef)).exists()) throw new Error('Este pago ya estaba cancelado.');
    const clientSnap = clientRef ? await tx.get(clientRef) : null;
    const rows = [];
    for (const invoiceId of targets) {
      const ref = doc(db, 'invoices', invoiceId);
      rows.push({ ref, snap: await tx.get(ref) });
    }

    let removed = 0;
    const undone = [];
    // The earliest fortnight that stops being settled: everything from there
    // on is open again, so that is where "paid up to" has to fall back to.
    let reopened = null;

    for (const { ref, snap } of rows) {
      if (!snap.exists()) continue;
      const data = snap.data();

      const kept = paymentsOf(data).filter((payment) => payment.receiptId !== receipt.id);
      const dropped = paymentsOf(data).filter((payment) => payment.receiptId === receipt.id);
      if (!dropped.length) continue;

      const back = round2(dropped.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
      removed = round2(removed + back);

      const paid = round2(kept.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
      const settled = paid >= (Number(data.amount) || 0) - 0.005;

      tx.update(ref, {
        paid,
        payments: kept,
        settled,
        status: settled ? 'paid' : 'due',
        paidAt: settled ? data.paidAt || serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });

      undone.push({
        invoiceId: snap.id,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        title: invoiceTitle({ ...data, id: snap.id }),
        kind: data.kind || 'period',
        amount: -back,
      });

      // Same reasoning in reverse: reopening a hand-written debt does not
      // un-pay any fortnight, so it must not walk "paid up to" backwards.
      if (!isCharge(data) && !settled && (!reopened || data.periodStart < reopened)) {
        reopened = data.periodStart;
      }
    }

    // A receipt from the notebook settled no invoice, so there is nothing to
    // give back — but it still has to be cancellable, or a wrong figure typed
    // in during the migration is stuck on the record forever.
    const historic = !targets.length;
    if (!removed && !historic) throw new Error('Este pago ya estaba cancelado.');

    if (reopened && clientSnap?.exists()) {
      const was = clientSnap.data().paidThrough || null;
      const target = addDays(reopened, -1);
      if (was && was > target) {
        tx.update(clientRef, { paidThrough: target, updatedAt: serverTimestamp() });
      }
    }

    const day = date || today();
    const counter = {
      clientId: receipt.clientId,
      clientName: receipt.clientName || '',
      farmId: receipt.farmId || '',
      farmName: receipt.farmName || '',
      locationName: receipt.locationName || '',
      // What came off the bills, and whatever was kept "a cuenta" with no
      // bill to come off — the whole of what the receipt took in.
      amount: -(round2(removed + (Number(receipt.unapplied) || 0)) || round2(receipt.amount)),
      method: receipt.method || 'cash',
      reference: '',
      note: note || `Cancelación del recibo ${receipt.folio || receipt.id}.`,
      date: day,
      applied: undone,
      balanceAfter: 0,
      reversalOf: receipt.id,
      reversalOfFolio: receipt.folio || '',
      takenByName: author?.name || '',
      takenByUid: author?.uid || null,
      folio: folioFor(folioId, day),
      at: serverTimestamp(),
    };
    tx.set(counterRef, counter);

    return { id: counterRef.id, ...counter, undone };
  });
}

/**
 * Puts a payment that was kept whole onto the fortnights it was for.
 *
 * A payment taken while the bills could not be read — no internet, a bad
 * record — went in entire, "a cuenta", so it was never lost. Its receipt
 * cannot be rewritten, so it is settled the way a cash book is: cancelled on
 * the day it was taken, and the same money taken again on that same day, this
 * time spread over what they owed then. The day's total does not move, and
 * the second receipt says which one it came from.
 */
export async function spreadHeld(receipt, client, pricing, author) {
  if (!receipt?.held) throw new Error('Este pago ya está repartido.');
  if (!client?.id) throw new Error('No encontramos al cliente de este pago.');
  const day = receipt.date || today();
  await voidReceipt(receipt, author, {
    date: day,
    note: `Se repartió en sus quincenas: el recibo ${receipt.folio || receipt.id} se volvió a registrar.`,
  });
  return takePayment({
    client,
    pricing,
    amount: receipt.amount,
    method: receipt.method,
    reference: receipt.reference || '',
    note: [`Repartido del recibo ${receipt.folio || receipt.id}.`, receipt.note].filter(Boolean).join(' '),
    date: day,
  }, author);
}

/**
 * Removes one payment entry from one invoice.
 *
 * Only for a payment with no receipt behind it. Everything the counter takes
 * has one, and is cancelled whole through `voidReceipt`.
 *
 * The receipt that was handed over is not edited or deleted — a record of what
 * happened has to keep saying what happened. Instead a second, negative receipt
 * is written against it, the way a cash book is corrected. Both show in the
 * client's app, and the two cancel out.
 */
export async function reversePayment(id, index, author) {
  const ref = doc(db, 'invoices', id);
  const counterRef = doc(collection(db, 'receipts'));

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('La factura ya no existe.');

    const data = snap.data();
    const clientRef = data.clientId ? doc(db, 'clients', data.clientId) : null;
    const clientSnap = clientRef ? await tx.get(clientRef) : null;
    const payments = [...paymentsOf(data)];
    const [removed] = payments.splice(index, 1);
    if (!removed) throw new Error('Ese pago ya no existe.');

    const paid = round2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    const settled = paid >= (Number(data.amount) || 0) - 0.005;

    tx.update(ref, {
      paid, payments, settled,
      status: settled ? 'paid' : 'due',
      paidAt: settled ? data.paidAt || serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });

    // If this fortnight is no longer settled, the client is no longer paid up
    // through it — walk the marker back to the day before it started. A
    // hand-written debt is not a fortnight: reopening it un-pays no food.
    if (clientSnap?.exists() && !settled && !isCharge(data)) {
      const was = clientSnap.data().paidThrough || null;
      if (was && was >= data.periodEnd) {
        tx.update(clientRef, {
          paidThrough: addDays(data.periodStart, -1),
          updatedAt: serverTimestamp(),
        });
      }
    }

    const day = today();
    tx.set(counterRef, {
      clientId: data.clientId,
      clientName: data.clientName || '',
      farmId: data.farmId || '',
      farmName: data.farmName || '',
      locationName: data.locationName || '',
      amount: -round2(removed.amount),
      method: removed.method || 'cash',
      reference: '',
      note: 'Cancelación de un pago registrado por error.',
      date: day,
      applied: [{
        invoiceId: id,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        amount: -round2(removed.amount),
      }],
      balanceAfter: round2((Number(data.amount) || 0) - paid),
      reversalOf: removed.receiptId || null,
      takenByName: author?.name || '',
      takenByUid: author?.uid || null,
      folio: folioFor(counterRef.id, day),
      at: serverTimestamp(),
    });

    return { removed, paid };
  });
}

export async function updateInvoice(id, patch) {
  await updateDoc(doc(db, 'invoices', id), { ...patch, updatedAt: serverTimestamp() });
}

export const deleteInvoice = (id) => deleteDoc(doc(db, 'invoices', id));

/* --- Aggregation ----------------------------------------------------------- */

/** Totals for the billing dashboard. */
export function summarizeInvoices(invoices, day = today()) {
  let outstanding = 0, overdue = 0, overdueCount = 0, dueSoon = 0, billed = 0, collected = 0;

  for (const invoice of invoices) {
    const balance = balanceOf(invoice);
    billed += Number(invoice.amount) || 0;
    collected += Number(invoice.paid) || 0;
    if (balance <= 0.005) continue;

    outstanding += balance;
    if (invoiceStatus(invoice, day) === 'overdue') { overdue += balance; overdueCount += 1; }
    else dueSoon += balance;
  }

  return {
    outstanding: round2(outstanding),
    overdue: round2(overdue),
    overdueCount,
    dueSoon: round2(dueSoon),
    billed: round2(billed),
    collected: round2(collected),
  };
}

/** Groups outstanding invoices by farm — the admin's "who owes what" view. */
export function groupByClient(invoices) {
  const map = new Map();
  for (const invoice of invoices) {
    const entry = map.get(invoice.clientId)
      || { clientId: invoice.clientId, clientName: invoice.clientName, invoices: [], balance: 0 };
    entry.invoices.push(invoice);
    entry.balance = round2(entry.balance + balanceOf(invoice));
    map.set(invoice.clientId, entry);
  }
  return [...map.values()].sort((a, b) => b.balance - a.balance);
}

export { balanceOf, invoiceStatus, invoiceId };
