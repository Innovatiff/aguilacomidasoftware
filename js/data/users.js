/**
 * Staff accounts.
 *
 * There is no sign-up for staff. Who may run the panel is decided by the
 * `staffEmails()` list in `firestore.rules` — a file only someone who can
 * deploy the project is able to change. An account on that list signs in and
 * the panel writes its own profile; everyone else is refused by the rules.
 *
 * The rest of this module is the day-to-day afterwards: seeing who has access,
 * taking it away, and giving it back. A revoked account drops to `pending`,
 * which can read nothing but is still a real account, so access can be
 * restored without a redeploy.
 */

import {
  db, doc, collection, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, serverTimestamp, listData,
} from '../firebase.js';

const usersRef = () => collection(db, 'users');

/**
 * Writes the signed-in account's own admin profile.
 *
 * Succeeds only for an address listed in `staffEmails()`; for anyone else the
 * rules reject it, which is exactly the check we want — the app is not
 * deciding anything here, it is asking.
 *
 * Merged rather than overwritten so it also upgrades a profile left behind by
 * an earlier sign-up instead of failing on the document already being there.
 */
export async function claimStaffProfile(user) {
  await setDoc(doc(db, 'users', user.uid), {
    name: user.displayName || '',
    email: user.email || '',
    role: 'admin',
    clientId: null,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

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
