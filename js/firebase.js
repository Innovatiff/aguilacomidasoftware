/**
 * Firebase bootstrap.
 *
 * Both apps talk to the same project (`aguilacocina-24496`): the kitchen writes
 * deliveries and payments, the farms read their own. Everything the rest of the
 * code needs from the SDK is re-exported here so the version is pinned in
 * exactly one place and screens never import a CDN URL directly.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile,
  sendPasswordResetEmail, setPersistence, browserLocalPersistence,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore, collection, collectionGroup, doc, getDoc, getDocs, setDoc,
  addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  startAfter, serverTimestamp, Timestamp, increment, arrayUnion, arrayRemove,
  writeBatch, runTransaction, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { t } from './lib/i18n.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyCFpk456SCzwjzvqydvBahmXuvcpW7Wx54',
  authDomain: 'aguilacocina-24496.firebaseapp.com',
  projectId: 'aguilacocina-24496',
  storageBucket: 'aguilacocina-24496.firebasestorage.app',
  messagingSenderId: '17468952649',
  appId: '1:17468952649:web:35ec19332e5be879b9af98',
  measurementId: 'G-VR467GQ1T5',
};

export const app = initializeApp(firebaseConfig);

/**
 * Offline persistence is not a nicety here. Deliveries are marked from a phone
 * in a truck on a farm road; the driver taps "entregado" with one bar of signal
 * and the write has to survive until the connection comes back.
 */
export const db = (() => {
  /*
   * A field left undefined is skipped rather than refused. Without this, one
   * missing value anywhere in a write — a bill saved years ago without a date,
   * a client with no location — makes Firestore reject the whole thing, and
   * at the counter that is a payment that does not go in.
   */
  const always = { ignoreUndefinedProperties: true };
  try {
    return initializeFirestore(app, {
      ...always,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // The browser blocks IndexedDB (private mode): in memory, same rules.
    try {
      return initializeFirestore(app, always);
    } catch {
      // Already initialised.
      return getFirestore(app);
    }
  }
})();

export const auth = getAuth(app);

// Keep the session across app restarts — staff should not log in every morning.
setPersistence(auth, browserLocalPersistence).catch(() => {});

export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile, sendPasswordResetEmail,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
  collection, collectionGroup, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, onSnapshot, query, where, orderBy, limit, startAfter,
  serverTimestamp, Timestamp, increment, arrayUnion, arrayRemove,
  writeBatch, runTransaction,
};

/** Firestore Timestamp | Date | null -> Date | null */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
}

/** Snapshot -> plain object with its id, timestamps left as-is. */
/**
 * Waits for a write to reach the server, but not forever.
 *
 * With no internet — or with the day's database allowance spent — Firestore
 * keeps the change on this computer and sends it as soon as it can, and its
 * promise only settles then. A screen awaiting it would spin with the change
 * already made. So it waits a few seconds: a refusal comes back within them;
 * after that the change counts as made, and it goes up by itself.
 */
export async function saved(write, ms = 4000) {
  write.catch(() => {});
  await Promise.race([write, new Promise((resolve) => { setTimeout(resolve, ms); })]);
}

export const docData = (snap) => (snap.exists() ? { id: snap.id, ...snap.data() } : null);
export const listData = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/** Maps Firebase auth errors onto messages a person can act on. */
export function authMessage(error) {
  const code = String(error?.code || '');
  const messages = {
    'auth/invalid-email': t('El correo no tiene un formato válido.'),
    'auth/user-disabled': t('Esta cuenta está desactivada. Contacta a la cocina.'),
    'auth/user-not-found': t('No encontramos una cuenta con ese correo.'),
    'auth/wrong-password': t('Contraseña incorrecta.'),
    'auth/invalid-credential': t('Correo o contraseña incorrectos.'),
    'auth/email-already-in-use': t('Ya existe una cuenta con ese correo.'),
    'auth/weak-password': t('La contraseña debe tener al menos 6 caracteres.'),
    'auth/too-many-requests': t('Demasiados intentos. Espera un momento e inténtalo de nuevo.'),
    'auth/network-request-failed': t('Sin conexión. Revisa tu internet.'),
    'auth/requires-recent-login': t('Por seguridad, vuelve a iniciar sesión para hacer este cambio.'),
  };
  return messages[code] || t('Algo salió mal. Inténtalo de nuevo.');
}

/**
 * What to show somebody when a write fails.
 *
 * Our own guards throw plain `Error`s already written in Spanish for the person
 * reading them — "El monto debe ser mayor a cero." — and those should be shown
 * as they are. Firestore's errors also carry a `message`, in English, written
 * for a developer: "Quota exceeded." A cashier saw that one over a customer's
 * cash. The `code` is what tells the two apart: only the SDK sets it.
 */
export const errorText = (error) =>
  (error?.code ? dbMessage(error) : (error?.message || dbMessage(error)));

/** Firestore errors, in words for the person who hit them. */

export function dbMessage(error) {
  const code = String(error?.code || '');
  if (code === 'permission-denied') return t('No tienes permiso para hacer esto.');
  if (code === 'unavailable') return t('Sin conexión. Los cambios se guardarán al reconectar.');
  if (code === 'not-found') return t('El registro ya no existe.');
  /*
   * Firestore's daily free allowance, spent. It reads as a bug at the counter —
   * "quota exceeded" over somebody's cash — when it is the base de datos
   * refusing everybody until midnight, and nothing about the payment is wrong.
   * Saying which it is decides whether the cashier retries or takes the money
   * and writes it down.
   */
  if (code === 'resource-exhausted') {
    return t('La base de datos llegó a su límite diario. Anota el pago en papel y regístralo cuando se restablezca (a medianoche). No se cobró nada.');
  }
  return t('No se pudo guardar. Inténtalo de nuevo.');
}
