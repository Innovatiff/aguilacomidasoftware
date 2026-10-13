/**
 * Putting advance payments right — the writing half of js/lib/advance.js.
 *
 * Done per client, inside a transaction, from that client's bills read again
 * at the moment of writing: the plan shown to the manager is made by the same
 * function from the same bills, so what is applied is what was shown — unless
 * something changed in between, in which case it is worked out again rather
 * than written from a stale picture.
 *
 * Receipts are never touched: they are the client's proof of what was paid and
 * when, and nothing may rewrite them. What moves is where the money sits among
 * the bills, which is the kitchen's own bookkeeping. Each payment entry that
 * moves says where it came from (`movedFrom`) and when (`movedOn`).
 */

import {
  db, doc, runTransaction, serverTimestamp,
} from '../firebase.js';
import { billsOf } from './invoices.js';
import { servingSince } from './clients.js';
import { planAdvanceFix } from '../lib/advance.js';
import { today } from '../lib/dates.js';

/** The plan for one client, from their bills as they are now. */
export async function advancePlan(client, day = today()) {
  const bills = await billsOf(client.id);
  return planAdvanceFix({ client, bills, since: servingSince(client), day });
}

/**
 * Applies the plan for one client, and marks them as looked at — also when
 * there was nothing that could be moved, so a payment that has to stay where
 * it is stops being flagged once somebody has seen it.
 *
 * @param {object} client
 * @param {object} author  { uid, name }
 * @returns {Promise<object>} the plan that was applied
 */
export async function fixAdvance(client, author, day = today()) {
  // Which bills exist, read first: a query cannot run inside a transaction.
  const known = (await billsOf(client.id)).map((bill) => bill.id);
  const clientRef = doc(db, 'clients', client.id);

  return runTransaction(db, async (tx) => {
    // Every read first — Firestore refuses a read after a write in the same
    // transaction.
    const clientSnap = await tx.get(clientRef);
    if (!clientSnap.exists()) throw new Error('Ese cliente ya no existe.');
    const fresh = { ...client, ...clientSnap.data(), id: client.id };

    const bills = [];
    for (const id of known) {
      const snap = await tx.get(doc(db, 'invoices', id));
      if (snap.exists()) bills.push({ id, ...snap.data() });
    }
    const plan = planAdvanceFix({ client: fresh, bills, since: servingSince(fresh), day });

    // A bill the plan creates must still not exist; if one appeared since the
    // list above was read, somebody else is working on this client.
    for (const id of plan.created) {
      const snap = await tx.get(doc(db, 'invoices', id));
      if (snap.exists()) throw new Error('Algo cambió en este cliente mientras tanto. Vuelve a intentarlo.');
    }

    for (const bill of plan.writes) {
      const { id, ...data } = bill;
      const ref = doc(db, 'invoices', id);
      const record = {
        ...data,
        paidAt: data.settled ? (data.paidAt || serverTimestamp()) : null,
        updatedAt: serverTimestamp(),
      };
      if (plan.created.includes(id)) {
        tx.set(ref, { ...record, issuedAt: serverTimestamp(), issuedByName: author?.name || '' });
      } else {
        tx.set(ref, record, { merge: true });
      }
    }
    for (const id of plan.deletes) tx.delete(doc(db, 'invoices', id));

    tx.update(clientRef, {
      ...(plan.paidThrough !== plan.wasPaidThrough ? { paidThrough: plan.paidThrough } : {}),
      advanceFixedOn: day,
      advanceFixedByName: author?.name || '',
      updatedAt: serverTimestamp(),
    });
    return plan;
  });
}
