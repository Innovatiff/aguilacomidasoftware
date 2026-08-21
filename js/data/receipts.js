/**
 * Receipts — proof that money changed hands.
 *
 * People pay at the counter, in cash, and walk out. What they get is a folio on
 * their phone: who took the payment, how much, what fortnight it covers and
 * what is left. It exists because the alternative is a paper slip that gets
 * lost, and because "I already paid" has to be answerable by both sides from
 * the same record.
 *
 * A receipt is written once and never touched again — not edited, not deleted,
 * not even by an administrator. A payment taken in error is corrected by
 * reversing it on the invoice, which leaves both the receipt and the reversal
 * visible. That is the point of a record.
 */

import {
  db, doc, collection, getDoc, onSnapshot, query, where, orderBy,
  limit as qLimit, docData, listData,
} from '../firebase.js';

const receiptsRef = () => collection(db, 'receipts');

/** Human folio: readable over the phone, unique without a shared counter. */
export function folioFor(id, day) {
  const short = String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
  return `R-${String(day || '').replace(/-/g, '').slice(2)}-${short || '0000'}`;
}

/* --- Reads ----------------------------------------------------------------- */

/** One person's receipts, newest first. */
export function watchClientReceipts(clientId, onData, onError, count = 30) {
  return onSnapshot(
    query(receiptsRef(), where('clientId', '==', clientId), orderBy('at', 'desc'), qLimit(count)),
    (snap) => onData(listData(snap)),
    onError,
  );
}

/** Everything taken at the counter today — the till, in the order it came in. */
export function watchReceiptsOn(day, onData, onError) {
  return onSnapshot(
    query(receiptsRef(), where('date', '==', day)),
    (snap) => onData(listData(snap).sort(byTimeDesc)),
    onError,
  );
}

export function watchReceipt(id, onData, onError) {
  return onSnapshot(doc(db, 'receipts', id), (snap) => onData(docData(snap)), onError);
}

export const getReceipt = async (id) => docData(await getDoc(doc(db, 'receipts', id)));

/** Total taken in a set of receipts, ignoring the ones that were reversed. */
export const totalOf = (receipts) =>
  Math.round((receipts || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100) / 100;

const byTimeDesc = (a, b) => {
  const at = (row) => (row.at?.toMillis ? row.at.toMillis() : 0);
  return at(b) - at(a);
};
