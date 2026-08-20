/**
 * The team.
 *
 * `staff/{email}` is the list of people who may run the panel — one document
 * per lowercased email address. Adding one grants the whole panel: every
 * farm's contact details, every delivery, every payment. So it is written from
 * Ajustes → Equipo by somebody who is already on it, and nowhere else.
 *
 * The first entry is the exception, since there is nobody to add it. Whoever
 * creates `config/bootstrap` may add themselves — Firestore rejects a create on
 * a document that already exists, so that happens exactly once in the lifetime
 * of the project and the marker can never be rewritten.
 */

import {
  db, doc, collection, getDoc, setDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, listData,
} from '../firebase.js';

const staffRef = () => collection(db, 'staff');
const bootstrapRef = () => doc(db, 'config', 'bootstrap');

/** Lowercased and trimmed — the document id has to match the token's email. */
export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

/* --- Reads ------------------------------------------------------------------ */

/** Live list of everyone who can enter the panel. */
export function watchStaff(onData, onError) {
  return onSnapshot(
    query(staffRef(), orderBy('email')),
    (snap) => onData(listData(snap)),
    onError,
  );
}

/* --- Writes ----------------------------------------------------------------- */

/**
 * Adds an address to the team.
 *
 * The person does not need an account yet — the entry is what matters. When
 * they sign in with that address, the panel opens.
 */
export async function addStaff(email, name, author) {
  const key = normalizeEmail(email);
  if (!isValidEmail(key)) throw new Error('Ese correo no tiene un formato válido.');

  await setDoc(doc(db, 'staff', key), {
    email: key,
    name: String(name || '').trim(),
    addedByName: author?.name || '',
    addedAt: serverTimestamp(),
  }, { merge: true });

  return key;
}

/** Removes access. The Auth account survives; it just cannot enter any more. */
export const removeStaff = (email) => deleteDoc(doc(db, 'staff', normalizeEmail(email)));

/* --- The first administrator ------------------------------------------------- */

/**
 * Whether anyone has claimed the first-administrator seat.
 *
 * On a failure we answer "yes". Offering the seat when we cannot actually tell
 * is the damaging direction to guess in.
 */
export async function isClaimed() {
  try {
    return (await getDoc(bootstrapRef())).exists();
  } catch {
    return true;
  }
}

/**
 * Claims the seat and joins the team.
 *
 * `setDoc` without merge is a create, and Firestore refuses a create on a
 * document that already exists — so if two people press the button at the same
 * moment, exactly one succeeds. The `staff` write that follows is only
 * permitted for the uid recorded in the marker.
 */
export async function claimFirstAdmin(user, name) {
  const key = normalizeEmail(user.email);
  if (!key) throw new Error('Esta cuenta no tiene un correo asociado.');

  await setDoc(bootstrapRef(), {
    ownerUid: user.uid,
    ownerEmail: key,
    at: serverTimestamp(),
  });

  await setDoc(doc(db, 'staff', key), {
    email: key,
    name: String(name || '').trim(),
    addedByName: 'Primera cuenta',
    addedAt: serverTimestamp(),
  });

  return key;
}
