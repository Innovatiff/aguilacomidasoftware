/**
 * Invoices — one per client per bi-weekly cycle.
 *
 * The id is `${clientId}_${periodStart}`, so re-issuing a cycle updates the
 * same document instead of creating a second bill for the same fortnight.
 *
 * `settled` is stored as a real boolean because Firestore cannot compare two
 * fields in a query: it is the only way to ask "who still owes money?" in one
 * round trip. Display status is always *derived* (`invoiceStatus`), since
 * "overdue" depends on today's date and would otherwise go stale in the
 * document.
 */

import {
  db, doc, collection, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, limit as qLimit, serverTimestamp, runTransaction,
  docData, listData,
} from '../firebase.js';
import {
  invoiceId, draftInvoice, balanceOf, invoiceStatus, round2, periodFor, periodByIndex,
} from '../lib/billing.js';
import { today } from '../lib/dates.js';

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
export async function issueInvoice(client, period, meals, author) {
  const id = invoiceId(client.id, period.start);
  const ref = doc(db, 'invoices', id);
  const draft = draftInvoice(client, period, meals);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const paid = snap.exists() ? Number(snap.data().paid) || 0 : 0;
    const payments = snap.exists() ? snap.data().payments || [] : [];
    const amount = draft.amount;

    const record = {
      ...draft,
      paid,
      payments,
      settled: paid >= amount - 0.005,
      issuedAt: snap.exists() ? snap.data().issuedAt || serverTimestamp() : serverTimestamp(),
      issuedByName: author?.name || '',
      updatedAt: serverTimestamp(),
    };
    if (record.settled && !snap.data()?.paidAt) record.paidAt = serverTimestamp();

    tx.set(ref, record, { merge: true });
    return { id, ...record };
  });
}

/** Issues the cycle that just closed for a set of farms, using delivered meals. */
export async function issueClosedCycle(clients, mealsByClient, day = today(), author) {
  const results = [];
  for (const client of clients) {
    const anchor = client.cycleAnchor || day;
    const current = periodFor(anchor, day);
    const closed = periodByIndex(anchor, current.index - 1);
    const meals = mealsByClient[client.id] ?? 0;
    if (!meals) continue;
    results.push(await issueInvoice(client, closed, meals, author));
  }
  return results;
}

/* --- Payments -------------------------------------------------------------- */

/**
 * Records a payment against an invoice.
 *
 * A transaction is essential here, not decorative: two staff members settling
 * the same farm from two phones would otherwise both read `paid: 0` and the
 * second write would erase the first.
 */
export async function recordPayment(invoiceIdOrDoc, payment, author) {
  const id = typeof invoiceIdOrDoc === 'string' ? invoiceIdOrDoc : invoiceIdOrDoc.id;
  const ref = doc(db, 'invoices', id);
  const amount = round2(payment.amount);
  if (!(amount > 0)) throw new Error('El monto debe ser mayor a cero.');

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('La factura ya no existe.');

    const data = snap.data();
    const paid = round2((Number(data.paid) || 0) + amount);
    const settled = paid >= (Number(data.amount) || 0) - 0.005;

    const entry = {
      amount,
      method: payment.method || 'cash',
      date: payment.date || today(),
      reference: payment.reference || '',
      note: payment.note || '',
      byName: author?.name || '',
      byUid: author?.uid || null,
      at: new Date(),
    };

    tx.update(ref, {
      paid,
      payments: [...(data.payments || []), entry],
      settled,
      status: settled ? 'paid' : 'due',
      ...(settled ? { paidAt: serverTimestamp() } : { paidAt: null }),
      updatedAt: serverTimestamp(),
    });

    return { id, paid, settled, entry, amount: Number(data.amount) || 0 };
  });
}

/** Removes a payment recorded by mistake and restores the balance. */
export async function reversePayment(id, index) {
  const ref = doc(db, 'invoices', id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('La factura ya no existe.');

    const data = snap.data();
    const payments = [...(data.payments || [])];
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
