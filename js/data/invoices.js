/**
 * Invoices — one per client per bi-weekly cycle.
 *
 * The id is `${clientId}_${periodStart}`, so re-issuing a cycle updates the
 * same document instead of creating a second bill for the same fortnight. It
 * also means a fortnight can be billed the moment somebody wants to pay for it,
 * from any screen, without two of them appearing.
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
import { folioFor } from './receipts.js';
import {
  invoiceId, draftInvoice, balanceOf, invoiceStatus, round2, periodFor, periodByIndex,
} from '../lib/billing.js';
import { priceFor } from '../lib/pricing.js';
import { today, addDays } from '../lib/dates.js';

/** How far ahead a single payment may buy: three months, then it is refused. */
const MAX_PREPAID_PERIODS = 6;

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
export async function issueInvoice(client, period, amount, meals, author, extra = {}) {
  const id = invoiceId(client.id, period.start);
  const ref = doc(db, 'invoices', id);
  const draft = { ...draftInvoice(client, period, amount, meals), ...extra };

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

/** Issues the cycle that just closed for a set of clients, at their plan price. */
export async function issueClosedCycle(clients, mealsByClient, tiers, day = today(), author) {
  const results = [];
  for (const client of clients) {
    const anchor = client.cycleAnchor || day;
    const current = periodFor(anchor, day);
    const closed = periodByIndex(anchor, current.index - 1);
    const meals = mealsByClient[client.id] ?? 0;
    if (!meals) continue;
    results.push(await issueInvoice(client, closed, priceFor(tiers, client.mealsPerDay), meals, author));
  }
  return results;
}

/* --- Payments -------------------------------------------------------------- */

/**
 * Takes a payment at the counter and returns the receipt.
 *
 * Somebody walks in with cash. They may owe two fortnights, or none — they may
 * be paying for one that has not started. So the money is applied forward in
 * time: oldest unpaid fortnight first, and when those run out, the current one
 * and the ones after it, opening each bill as it is paid for. One payment, one
 * receipt, however many fortnights it covered.
 *
 * All of it in a single transaction, because the alternative is a payment that
 * half-applied: the cash is already in the drawer by the time this runs, so it
 * either lands completely or not at all.
 */
export async function takePayment({ client, tiers, amount, method, reference, note, date }, author) {
  const total = round2(amount);
  if (!(total > 0)) throw new Error('El monto debe ser mayor a cero.');

  const price = priceFor(tiers, client.mealsPerDay);
  const day = date || today();
  const anchor = client.cycleAnchor || day;
  const current = periodFor(anchor, today());

  // Everything unpaid today, plus the fortnights that could be paid ahead.
  // Read outside the transaction: a query cannot run inside one.
  const open = (await getDocs(query(invoicesRef(),
    where('clientId', '==', client.id), where('settled', '==', false))))
    .docs.map((found) => found.id);

  const ahead = Array.from({ length: MAX_PREPAID_PERIODS }, (unused, i) =>
    periodByIndex(anchor, current.index + i));

  const targets = [];
  const seen = new Set();
  for (const id of open.sort()) {
    seen.add(id);
    targets.push({ id, period: null });
  }
  for (const period of ahead) {
    const id = invoiceId(client.id, period.start);
    if (seen.has(id)) continue;
    seen.add(id);
    targets.push({ id, period });
  }
  // Chronological: the id ends in the period start, so sorting by id is by date.
  targets.sort((a, b) => a.id.localeCompare(b.id));

  const receiptRef = doc(collection(db, 'receipts'));
  const clientRef = doc(db, 'clients', client.id);

  return runTransaction(db, async (tx) => {
    // Every read first — Firestore refuses a read after a write in the same
    // transaction.
    const rows = [];
    for (const target of targets) {
      const ref = doc(db, 'invoices', target.id);
      const snap = await tx.get(ref);
      rows.push({ ...target, ref, data: snap.exists() ? snap.data() : null });
    }

    let left = total;
    const applied = [];
    let balanceAfter = 0;
    // The last fortnight this payment leaves fully settled. Stamped on the
    // client so the roster can answer "is this one paid up?" by reading one
    // field, instead of every screen re-deriving it from the invoice history.
    let paidThrough = client.paidThrough || null;

    for (const row of rows) {
      const draft = row.data
        || (row.period && price > 0
          ? { ...draftInvoice(client, row.period, price, 0), issuedByName: author?.name || '' }
          : null);
      if (!draft) continue;

      const owed = round2((Number(draft.amount) || 0) - (Number(draft.paid) || 0));
      const take = left > 0.005 ? Math.min(left, Math.max(0, owed)) : 0;

      // A fortnight nobody has paid for and nobody is paying for now stays
      // unopened: an invoice that exists is a debt, and inventing one because
      // somebody walked in would be wrong.
      if (!row.data && take <= 0.005) continue;

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
        };

        const record = {
          ...draft,
          paid,
          payments: [...(draft.payments || []), entry],
          settled,
          status: settled ? 'paid' : 'due',
          ...(settled ? { paidAt: serverTimestamp() } : { paidAt: null }),
          updatedAt: serverTimestamp(),
          ...(row.data ? {} : { issuedAt: serverTimestamp() }),
        };
        tx.set(row.ref, record, { merge: true });

        applied.push({
          invoiceId: row.id,
          periodStart: record.periodStart,
          periodEnd: record.periodEnd,
          amount: take,
        });
        if (settled && (!paidThrough || record.periodEnd > paidThrough)) {
          paidThrough = record.periodEnd;
        }
        balanceAfter = round2(balanceAfter + Math.max(0, round2(record.amount - paid)));
      } else {
        balanceAfter = round2(balanceAfter + Math.max(0, owed));
      }
    }

    if (left > 0.005) {
      throw new Error(`El monto es mayor de lo que se puede aplicar. Máximo ${round2(total - left)}.`);
    }
    if (!applied.length) throw new Error('No hay ninguna quincena a la que aplicar este pago.');

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
      balanceAfter,
      takenByName: author?.name || '',
      takenByUid: author?.uid || null,
      folio: folioFor(receiptRef.id, day),
      at: serverTimestamp(),
    };
    tx.set(receiptRef, receipt);

    if (paidThrough && paidThrough !== (client.paidThrough || null)) {
      tx.update(clientRef, { paidThrough, updatedAt: serverTimestamp() });
    }

    return { id: receiptRef.id, ...receipt, at: new Date() };
  });
}

/**
 * Removes a payment recorded by mistake and restores the balance.
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

    // If this fortnight is no longer settled, the client is no longer paid up
    // through it — walk the marker back to the day before it started.
    if (clientSnap?.exists() && !settled) {
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
