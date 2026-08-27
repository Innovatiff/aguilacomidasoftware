/**
 * Farms.
 *
 * A farm is the place — Mucci Farm — and the commercial agreement made with
 * it: price per meal, which weekdays are served, the delivery window and the
 * billing cycle. The people who actually eat are `clients`, and every one of
 * them belongs to a farm and to one of its locations.
 *
 * Locations live on the farm document as a small array rather than a
 * subcollection. A farm has a handful of them (Casa 1, Bloque Norte,
 * Invernadero 3), they are read every single time the farm is, and keeping
 * them inline means the route screen can group by location without a second
 * listener.
 *
 * Terms are copied onto each client when they are written. That is deliberate
 * denormalisation: a worker's app reads one document and has everything it
 * needs, and the security rules stay a single id comparison. The cost is a
 * fan-out when terms change, which `applyTermsToClients` handles in batches.
 */

import {
  db, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, serverTimestamp, writeBatch, docData, listData,
} from '../firebase.js';
import { today } from '../lib/dates.js';
import { DEFAULT_DELIVERY_DAYS, DEFAULT_GRACE_DAYS } from '../lib/billing.js';
import { matches } from '../lib/format.js';

const farmsRef = () => collection(db, 'farms');
const clientsRef = () => collection(db, 'clients');

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 450;

/**
 * The fields a client inherits from its farm — and keeps inheriting.
 *
 * No price: what a fortnight costs is one list for the whole business, kept in
 * `config/pricing`. A farm decides *when* food arrives, not what it costs.
 *
 * No serving days either, though the farm still supplies them as the starting
 * point for somebody new. Once a client exists their week is theirs — some
 * eat Monday to Friday, some take an extra plate on Saturdays — and a farm-wide
 * change that quietly overwrote all of that would undo real decisions and
 * silently rewrite what those people are charged.
 */
export const TERM_FIELDS = [
  'deliveryWindow', 'cycleAnchor', 'graceDays',
];

export const emptyFarm = () => ({
  name: '',
  contactName: '',
  phone: '',
  address: '',
  notes: '',
  status: 'active',
  locations: [],
  // Terms every worker at this farm inherits.
  deliveryDays: [...DEFAULT_DELIVERY_DAYS],
  deliveryWindow: '11:00 – 13:00',
  cycleAnchor: today(),
  graceDays: DEFAULT_GRACE_DAYS,
  defaultMealsPerDay: 1,
});

/** Ids only have to be unique within one farm. */
export const newLocationId = () =>
  `loc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* --- Reads ----------------------------------------------------------------- */

export function watchFarms(onData, onError) {
  return onSnapshot(
    query(farmsRef(), orderBy('name')),
    (snap) => onData(listData(snap)),
    onError,
  );
}

export function watchFarm(farmId, onData, onError) {
  return onSnapshot(doc(db, 'farms', farmId), (snap) => onData(docData(snap)), onError);
}

export const getFarm = async (farmId) => docData(await getDoc(doc(db, 'farms', farmId)));

/** The workers registered at one farm. */
export function watchFarmClients(farmId, onData, onError) {
  return onSnapshot(
    query(clientsRef(), where('farmId', '==', farmId)),
    (snap) => onData(listData(snap).sort(byName)),
    onError,
  );
}

/* --- Writes ---------------------------------------------------------------- */

export async function createFarm(data, author) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Escribe el nombre del rancho.');

  const ref = doc(farmsRef());
  await setDoc(ref, {
    ...emptyFarm(),
    ...sanitize(data),
    name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: author?.uid || null,
    createdByName: author?.name || '',
  });

  return { id: ref.id };
}

/**
 * Updates a farm and pushes anything the workers depend on down to them.
 *
 * The name and the terms are copied onto each client, so changing them here
 * without the fan-out would leave the roster quoting yesterday's price.
 */
export async function updateFarm(farmId, patch, previous) {
  const clean = sanitize(patch);
  await updateDoc(doc(db, 'farms', farmId), { ...clean, updatedAt: serverTimestamp() });

  const nameChanged = clean.name !== undefined && clean.name !== previous?.name;
  const termsChanged = TERM_FIELDS.some(
    (field) => clean[field] !== undefined && !same(clean[field], previous?.[field]),
  );

  if (nameChanged || termsChanged) {
    await applyTermsToClients(farmId, { ...previous, ...clean });
  }
}

export async function setFarmStatus(farmId, status) {
  await updateDoc(doc(db, 'farms', farmId), { status, updatedAt: serverTimestamp() });
}

/**
 * A farm is only deletable once nobody is registered at it.
 *
 * Cascading would silently take a worker's deliveries, invoices and history
 * with it — never what someone tidying up a farm list intends.
 */
export async function deleteFarm(farmId) {
  const roster = await getDocs(query(clientsRef(), where('farmId', '==', farmId)));
  if (!roster.empty) {
    throw new Error(`Primero mueve o elimina los ${roster.size} clientes de este rancho.`);
  }
  await deleteDoc(doc(db, 'farms', farmId));
}

/* --- Locations -------------------------------------------------------------- */

export async function addLocation(farm, name) {
  const label = String(name || '').trim();
  if (!label) throw new Error('Escribe el nombre de la ubicación.');
  if ((farm.locations || []).some((loc) => sameLabel(loc.name, label))) {
    throw new Error('Ese rancho ya tiene una ubicación con ese nombre.');
  }

  const locations = [...(farm.locations || []), { id: newLocationId(), name: label }];
  await updateDoc(doc(db, 'farms', farm.id), { locations, updatedAt: serverTimestamp() });
}

/** Renames a location and carries the new label to everyone standing in it. */
export async function renameLocation(farm, locationId, name) {
  const label = String(name || '').trim();
  if (!label) throw new Error('Escribe el nombre de la ubicación.');
  if ((farm.locations || []).some((loc) => loc.id !== locationId && sameLabel(loc.name, label))) {
    throw new Error('Ese rancho ya tiene una ubicación con ese nombre.');
  }

  const locations = (farm.locations || []).map(
    (loc) => (loc.id === locationId ? { ...loc, name: label } : loc),
  );
  await updateDoc(doc(db, 'farms', farm.id), { locations, updatedAt: serverTimestamp() });

  await eachClient(
    query(clientsRef(), where('farmId', '==', farm.id), where('locationId', '==', locationId)),
    (batch, ref) => batch.update(ref, { locationName: label, updatedAt: serverTimestamp() }),
  );
}

/**
 * Removes a location. Refused while anyone is still assigned to it — a client
 * without a location is exactly the state the whole feature exists to prevent.
 */
export async function removeLocation(farm, locationId) {
  const standing = await getDocs(query(
    clientsRef(),
    where('farmId', '==', farm.id),
    where('locationId', '==', locationId),
  ));
  if (!standing.empty) {
    throw new Error(`Primero mueve los ${standing.size} clientes que están en esa ubicación.`);
  }

  const locations = (farm.locations || []).filter((loc) => loc.id !== locationId);
  await updateDoc(doc(db, 'farms', farm.id), { locations, updatedAt: serverTimestamp() });
}

export const findLocation = (farm, locationId) =>
  (farm?.locations || []).find((loc) => loc.id === locationId) || null;

/* --- Fan-out ---------------------------------------------------------------- */

/** Copies the farm's name and terms onto every worker registered there. */
export async function applyTermsToClients(farmId, farm) {
  const terms = { farmName: farm.name };
  for (const field of TERM_FIELDS) {
    if (farm[field] !== undefined) terms[field] = farm[field];
  }

  return eachClient(
    query(clientsRef(), where('farmId', '==', farmId)),
    (batch, ref) => batch.update(ref, { ...terms, updatedAt: serverTimestamp() }),
  );
}

/** Applies `write` to every client the query returns, in batches. */
async function eachClient(clientQuery, write) {
  const snap = await getDocs(clientQuery);
  let batch = writeBatch(db);
  let pending = 0;
  let total = 0;

  for (const found of snap.docs) {
    write(batch, doc(db, 'clients', found.id));
    pending += 1;
    total += 1;
    if (pending >= BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      pending = 0;
    }
  }

  if (pending) await batch.commit();
  return total;
}

/* --- Shaping ---------------------------------------------------------------- */

const NUMERIC = new Set(['graceDays', 'defaultMealsPerDay']);

function sanitize(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (NUMERIC.has(key)) out[key] = Number(value) || 0;
    else if (key === 'deliveryDays') out[key] = (value || []).map(Number).sort((a, b) => a - b);
    else if (key === 'locations') out[key] = value;
    else if (typeof value === 'string') out[key] = value.trim();
    else out[key] = value;
  }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const sameLabel = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es');

/** Case- and accent-insensitive search over the fields staff actually type. */
export const matchesFarm = (farm, term) => matches(
  [farm.name, farm.contactName, farm.phone, farm.address], term);
