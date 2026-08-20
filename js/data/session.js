/**
 * Auth session for the kitchen panel.
 *
 * Who may run the panel is decided by one document: `staff/{your email}`. That
 * document is watched rather than read once, so adding or removing somebody
 * from Ajustes → Equipo takes effect on their phone immediately — no sign-out,
 * no reload.
 *
 * `users/{uid}` is watched too, but it holds only a display name and a phone
 * number. It carries no authority: deleting it would not grant or remove
 * anything.
 */

import {
  auth, db, doc, setDoc, updateDoc, onSnapshot, serverTimestamp,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, docData,
} from '../firebase.js';

const state = { user: null, staff: null, profile: null, ready: false };
const listeners = new Set();
let stopStaff = null;
let stopProfile = null;
/** Guards the "last seen" write — see `touchLastSeen`. */
let seenTouched = false;

export const session = {
  get user() { return state.user; },
  get uid() { return state.user?.uid || null; },
  /** Lowercased, because that is how both lists are keyed. */
  get email() { return (state.user?.email || '').trim().toLowerCase(); },
  get ready() { return state.ready; },
  get staff() { return state.staff; },
  get profile() { return state.profile; },
  get isAdmin() { return !!state.staff; },
  get displayName() {
    return state.profile?.name || state.staff?.name || state.user?.displayName || state.user?.email || '';
  },
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

export function startSession() {
  onAuthStateChanged(auth, (user) => {
    stopStaff?.();
    stopProfile?.();
    stopStaff = null;
    stopProfile = null;

    state.user = user;
    state.staff = null;
    state.profile = null;
    seenTouched = false;

    if (!user) {
      state.ready = true;
      emit();
      return;
    }

    const email = (user.email || '').trim().toLowerCase();
    if (!email) {
      // No address on the token means no way to be on either list.
      state.ready = true;
      emit();
      return;
    }

    stopStaff = onSnapshot(
      doc(db, 'staff', email),
      (snap) => {
        state.staff = docData(snap);
        state.ready = true;
        emit();
        touchLastSeen(email);
      },
      () => {
        // A refused read means "not staff" just as clearly as an empty one.
        state.staff = null;
        state.ready = true;
        emit();
      },
    );

    stopProfile = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => { state.profile = docData(snap); emit(); },
      () => {},
    );
  });
}

/* --- Actions ---------------------------------------------------------------- */

export async function signIn(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return credential.user;
}

export const signOutNow = () => signOut(auth);

export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

/** Saves this person's own name and phone. Grants nothing. */
export async function updateOwnProfile(patch) {
  if (!state.user) throw new Error('Sin sesión');
  await setDoc(doc(db, 'users', state.user.uid), {
    ...patch,
    email: state.user.email || '',
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/**
 * Stamps when this person last opened the panel.
 *
 * Once per session, and never from inside the snapshot that the write itself
 * produces — this document is being watched, so an unguarded write here would
 * retrigger the listener that called it and loop forever.
 */
async function touchLastSeen(email) {
  if (seenTouched || !state.staff) return;
  seenTouched = true;
  try {
    await updateDoc(doc(db, 'staff', email), { lastSeenAt: serverTimestamp() });
  } catch {
    // Not worth surfacing: it is a convenience column in Ajustes → Equipo.
  }
}
