/**
 * Farms (clients).
 *
 * A client record holds the commercial terms — meals per day, price per meal,
 * which weekdays are served, and the anchor date its bi-weekly billing cycles
 * are counted from. Everything else about the client (deliveries, invoices,
 * messages) hangs off `clientId`.
 */

import {
  db, doc, collection, getDoc, getDocs, updateDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, arrayUnion, arrayRemove,
  writeBatch, docData, listData,
} from '../firebase.js';
import { today } from '../lib/dates.js';
import { DEFAULT_DELIVERY_DAYS, DEFAULT_GRACE_DAYS } from '../lib/billing.js';

const clientsRef = () => collection(db, 'clients');

/** Ambiguous characters (0/O, 1/I) are left out — codes get read over the phone. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateAccessCode(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export const emptyClient = () => ({
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  mealsPerDay: 10,
  pricePerMeal: 0,
  deliveryDays: [...DEFAULT_DELIVERY_DAYS],
  deliveryWindow: '11:00 – 13:00',
  graceDays: DEFAULT_GRACE_DAYS,
  cycleAnchor: today(),
  status: 'active',
});

/* --- Reads ----------------------------------------------------------------- */

/** Live list of every farm, alphabetical. Returns an unsubscribe function. */
export function watchClients(onData, onError) {
  return onSnapshot(
    query(clientsRef(), orderBy('name')),
    (snap) => onData(listData(snap)),
    onError,
  );
}

export function watchClient(clientId, onData, onError) {
  return onSnapshot(doc(db, 'clients', clientId), (snap) => onData(docData(snap)), onError);
}

export const getClient = async (clientId) => docData(await getDoc(doc(db, 'clients', clientId)));

export async function listActiveClients() {
  const snap = await getDocs(query(clientsRef(), where('status', '==', 'active'), orderBy('name')));
  return listData(snap);
}

/* --- Writes ---------------------------------------------------------------- */

/**
 * Creates the farm and its access code together. The code lives in its own
 * collection so a client app can resolve exactly one code by document id
 * without being able to list — or even see — any other farm.
 */
export async function createClient(data, author) {
  const ref = doc(clientsRef());
  const code = generateAccessCode();
  const batch = writeBatch(db);

  batch.set(ref, {
    ...emptyClient(),
    ...sanitize(data),
    accessCode: code,
    linkedUids: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: author?.uid || null,
    createdByName: author?.name || '',
  });

  batch.set(doc(db, 'accessCodes', code), {
    clientId: ref.id,
    clientName: data.name || '',
    createdAt: serverTimestamp(),
  });

  await batch.commit();
  return { id: ref.id, accessCode: code };
}

export async function updateClient(clientId, patch) {
  await updateDoc(doc(db, 'clients', clientId), {
    ...sanitize(patch),
    updatedAt: serverTimestamp(),
  });
}

/** Issues a fresh code and retires the old one. */
export async function rotateAccessCode(clientId, previousCode) {
  const code = generateAccessCode();
  const batch = writeBatch(db);
  const client = await getClient(clientId);

  batch.set(doc(db, 'accessCodes', code), {
    clientId,
    clientName: client?.name || '',
    createdAt: serverTimestamp(),
  });
  if (previousCode) batch.delete(doc(db, 'accessCodes', previousCode));
  batch.update(doc(db, 'clients', clientId), { accessCode: code, updatedAt: serverTimestamp() });

  await batch.commit();
  return code;
}

export async function setClientStatus(clientId, status) {
  await updateDoc(doc(db, 'clients', clientId), { status, updatedAt: serverTimestamp() });
}

/** Removes a login's access to a farm (admin side). */
export async function unlinkUser(clientId, uid) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'clients', clientId), { linkedUids: arrayRemove(uid) });
  batch.update(doc(db, 'users', uid), { clientId: null });
  await batch.commit();
}

export async function deleteClient(clientId, accessCode) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'clients', clientId));
  if (accessCode) batch.delete(doc(db, 'accessCodes', accessCode));
  await batch.commit();
}

/* --- Access codes ---------------------------------------------------------- */

/** Resolves a code typed by a farm manager. Returns null when it is not valid. */
export async function resolveAccessCode(code) {
  const key = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(key)) return null;
  const snap = await getDoc(doc(db, 'accessCodes', key));
  return snap.exists() ? { code: key, ...snap.data() } : null;
}

/** Links the signed-in login to a farm. Both writes are permitted by the rules. */
export async function linkSelfToClient(uid, clientId) {
  await updateDoc(doc(db, 'clients', clientId), { linkedUids: arrayUnion(uid) });
  await updateDoc(doc(db, 'users', uid), { clientId, linkedAt: serverTimestamp() });
}

/* --- Shaping --------------------------------------------------------------- */

const NUMERIC = new Set(['mealsPerDay', 'pricePerMeal', 'graceDays']);

/** Coerces form strings into the types Firestore should hold. */
function sanitize(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (NUMERIC.has(key)) out[key] = Number(value) || 0;
    else if (key === 'deliveryDays') out[key] = (value || []).map(Number).sort((a, b) => a - b);
    else if (typeof value === 'string') out[key] = value.trim();
    else out[key] = value;
  }
  return out;
}

/** Case- and accent-insensitive search across the fields staff actually type. */
export function matchesSearch(client, term) {
  const needle = normalize(term);
  if (!needle) return true;
  return [client.name, client.contactName, client.phone, client.address, client.email]
    .some((field) => normalize(field).includes(needle));
}

const normalize = (text) =>
  String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
