/**
 * Staff accounts.
 *
 * There is no sign-up for staff. An administrator account is created in the
 * Firebase console — an Auth user, plus a `users/{uid}` document with
 * `role: 'admin'` — because an admin sees every farm's contact details and
 * every payment, and that should be a deliberate act by whoever runs the
 * kitchen, not something an app flow can grant.
 *
 * What this module covers is the day-to-day afterwards: seeing who has access,
 * taking it away, and giving it back. A revoked account drops to `pending`,
 * which can read nothing but is still a real account, so access can be
 * restored without touching the console again.
 */

import {
  db, doc, collection, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, serverTimestamp, listData,
} from '../firebase.js';

const usersRef = () => collection(db, 'users');

/** Accounts that exist but cannot get in — revoked, or not set up yet. */
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

/** Grants (or restores) full access to an existing account. */
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
