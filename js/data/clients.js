/**
 * Farms (clients).
 *
 * A client record holds the commercial terms — meals per day, price per meal,
 * which weekdays are served, and the anchor date its bi-weekly billing cycles
 * are counted from. Everything else about the client (deliveries, invoices,
 * messages) hangs off `clientId`.
 *
 * The email address is not just contact detail: it is how the farm gets into
 * its app. Registering a farm writes `clientEmails/{email} -> clientId`, and
 * that document is what the security rules consult when the farm signs in.
 * Changing the email here moves the access with it, which is also how access is
 * taken away.
 */

import {
  db, doc, collection, getDoc, getDocs, updateDoc,
  onSnapshot, query, where, orderBy, serverTimestamp,
  writeBatch, docData, listData,
} from '../firebase.js';
import { today } from '../lib/dates.js';
import { DEFAULT_DELIVERY_DAYS, DEFAULT_GRACE_DAYS } from '../lib/billing.js';

const clientsRef = () => collection(db, 'clients');

/** Lowercased and trimmed — the lookup document id must match the token. */
export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

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

/** Which farm an address already belongs to, if any. */
export async function clientForEmail(email) {
  const key = normalizeEmail(email);
  if (!isValidEmail(key)) return null;
  const snap = await getDoc(doc(db, 'clientEmails', key));
  return snap.exists() ? { email: key, ...snap.data() } : null;
}

/* --- Writes ---------------------------------------------------------------- */

/**
 * Registers a farm and grants its email access, in one batch.
 *
 * The two writes belong together: a farm whose email lookup is missing cannot
 * open its app, and a lookup pointing at a farm that does not exist is a
 * dangling grant. Committing them separately would leave either state
 * reachable.
 */
export async function createClient(data, author) {
  const email = normalizeEmail(data.email);
  if (!isValidEmail(email)) throw new Error('Escribe un correo válido para el rancho.');

  const taken = await clientForEmail(email);
  if (taken) throw new Error(`Ese correo ya está registrado para ${taken.clientName || 'otro rancho'}.`);

  const ref = doc(clientsRef());
  const batch = writeBatch(db);

  batch.set(ref, {
    ...emptyClient(),
    ...sanitize(data),
    email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: author?.uid || null,
    createdByName: author?.name || '',
  });

  batch.set(doc(db, 'clientEmails', email), {
    clientId: ref.id,
    clientName: data.name || '',
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  return { id: ref.id, email };
}

/**
 * Updates a farm, moving its access if the email changed.
 *
 * The old lookup is deleted in the same batch as the new one is written, so
 * the previous address never keeps working after the change.
 */
export async function updateClient(clientId, patch, previousEmail) {
  const patchEmail = patch.email !== undefined;
  const email = patchEmail ? normalizeEmail(patch.email) : null;
  const previous = normalizeEmail(previousEmail);

  if (patchEmail) {
    if (!isValidEmail(email)) throw new Error('Escribe un correo válido para el rancho.');
    if (email !== previous) {
      const taken = await clientForEmail(email);
      if (taken && taken.clientId !== clientId) {
        throw new Error(`Ese correo ya está registrado para ${taken.clientName || 'otro rancho'}.`);
      }
    }
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'clients', clientId), {
    ...sanitize(patch),
    ...(patchEmail ? { email } : {}),
    updatedAt: serverTimestamp(),
  });

  if (patchEmail) {
    if (previous && previous !== email) batch.delete(doc(db, 'clientEmails', previous));
    batch.set(doc(db, 'clientEmails', email), {
      clientId,
      clientName: patch.name || '',
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  await batch.commit();
}

export async function setClientStatus(clientId, status) {
  await updateDoc(doc(db, 'clients', clientId), { status, updatedAt: serverTimestamp() });
}

export async function deleteClient(clientId, email) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'clients', clientId));
  const key = normalizeEmail(email);
  if (key) batch.delete(doc(db, 'clientEmails', key));
  await batch.commit();
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
    else if (key === 'email') out[key] = normalizeEmail(value);
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
