/**
 * Auth session + the signed-in user's profile document.
 *
 * `users/{uid}` carries the role (`admin` | `client`) and, for a farm, the
 * `clientId` that links the login to its `clients/{id}` record. The profile is
 * watched rather than fetched once, so linking a login to a farm — or revoking
 * it — takes effect on the user's phone immediately, without a sign-out.
 */

import {
  auth, db, doc, setDoc, updateDoc, onSnapshot, getDoc, serverTimestamp,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile, sendPasswordResetEmail, docData,
} from '../firebase.js';

const state = { user: null, profile: null, ready: false, error: null };
const listeners = new Set();
let stopProfile = null;

export const session = {
  get user() { return state.user; },
  get profile() { return state.profile; },
  get ready() { return state.ready; },
  get uid() { return state.user?.uid || null; },
  get role() { return state.profile?.role || null; },
  get clientId() { return state.profile?.clientId || null; },
  get displayName() {
    return state.profile?.name || state.user?.displayName || state.user?.email || '';
  },
  get isAdmin() { return state.profile?.role === 'admin'; },
  get isClient() { return state.profile?.role === 'client'; },
  /** A client login that has not been linked to a farm yet. */
  get isUnlinked() { return state.profile?.role === 'client' && !state.profile?.clientId; },
};

function emit() {
  for (const fn of listeners) fn(session);
}

/** Subscribe to session changes. Returns an unsubscribe function. */
export function watchSession(fn) {
  listeners.add(fn);
  if (state.ready) fn(session);
  return () => listeners.delete(fn);
}

/** Starts the auth listener. Call once at boot. */
export function startSession() {
  onAuthStateChanged(auth, (user) => {
    stopProfile?.();
    stopProfile = null;
    state.user = user;

    if (!user) {
      state.profile = null;
      state.ready = true;
      emit();
      return;
    }

    stopProfile = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        state.profile = docData(snap);
        state.ready = true;
        state.error = null;
        emit();
      },
      (error) => {
        state.profile = null;
        state.ready = true;
        state.error = error;
        emit();
      },
    );
  });
}

/* --- Actions --------------------------------------------------------------- */

export async function signIn(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  await touchLastSeen(credential.user.uid);
  return credential.user;
}

/**
 * Creates a login and its profile document in one step. The profile is written
 * by the client itself, so the security rules pin `role` to what the caller is
 * allowed to claim (see firestore.rules).
 */
export async function signUp({ email, password, name, role = 'client', phone = '' }) {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const user = credential.user;
  if (name) await updateProfile(user, { displayName: name });

  await setDoc(doc(db, 'users', user.uid), {
    name: name || '',
    email: user.email,
    phone: phone || '',
    role,
    clientId: null,
    createdAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
  });
  return user;
}

export const signOutNow = () => signOut(auth);

export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

export async function updateOwnProfile(patch) {
  if (!state.user) throw new Error('Sin sesión');
  await updateDoc(doc(db, 'users', state.user.uid), { ...patch, updatedAt: serverTimestamp() });
  if (patch.name) await updateProfile(state.user, { displayName: patch.name });
}

async function touchLastSeen(uid) {
  try {
    await updateDoc(doc(db, 'users', uid), { lastSeenAt: serverTimestamp() });
  } catch {
    // A brand-new account may not have its profile document yet; harmless.
  }
}

/** One-shot read of any user profile (admins reading a client's contact). */
export async function fetchProfile(uid) {
  return docData(await getDoc(doc(db, 'users', uid)));
}
