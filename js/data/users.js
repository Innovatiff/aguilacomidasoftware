/**
 * Staff accounts.
 *
 * Sign-up creates a `pending` profile that can read nothing. An existing admin
 * promotes it here, which is the only path to the `admin` role — deliberately a
 * human decision rather than a shared code, because an admin sees every farm's
 * contact details and every payment.
 */

import {
  db, doc, collection, updateDoc, deleteDoc, onSnapshot, query, where, orderBy,
  serverTimestamp, listData,
} from '../firebase.js';

const usersRef = () => collection(db, 'users');

/** Accounts waiting for approval. */
export function watchPending(onData, onError) {
  return onSnapshot(
    query(usersRef(), where('role', '==', 'pending')),
    (snap) => onData(listData(snap)),
    onError,
  );
}

/** Everyone who can use the admin app. */
export function watchStaff(onData, onError) {
  return onSnapshot(
    query(usersRef(), where('role', '==', 'admin'), orderBy('name')),
    (snap) => onData(listData(snap)),
    onError,
  );
}

export async function approveStaff(uid, author) {
  await updateDoc(doc(db, 'users', uid), {
    role: 'admin',
    approvedAt: serverTimestamp(),
    approvedByName: author?.name || '',
    updatedAt: serverTimestamp(),
  });
}

/**
 * Revokes access without deleting the login. The profile drops back to
 * `pending`, so the person can be re-approved instead of having to sign up
 * again — and the audit trail of who approved whom survives.
 */
export async function revokeStaff(uid) {
  await updateDoc(doc(db, 'users', uid), {
    role: 'pending',
    revokedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Removes the profile document entirely (the Auth login is not touched). */
export const rejectRequest = (uid) => deleteDoc(doc(db, 'users', uid));
