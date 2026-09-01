/**
 * Clients — the people who eat.
 *
 * A client is one worker, and every worker belongs to a farm and to one of
 * that farm's locations. There is no such thing as a client without a place to
 * take the food to, which is why `farmId` and `locationId` are refused when
 * empty rather than defaulted.
 *
 * The service terms are the farm's, not the worker's: the serving weekdays, the
 * delivery window and the billing anchor are copied down from the farm when the
 * worker is registered and re-copied by `applyTermsToClients` whenever the farm
 * changes them. What belongs to the worker alone is how many meals they take —
 * which is also what decides their price, since a fortnight is sold by plan.
 *
 * `tags` are what this person cannot eat — "sin pollo", "sin espagueti". They
 * live on the client rather than in a notes field because the kitchen has to be
 * able to count them before cooking and read them at a glance while packing,
 * and prose cannot be counted.
 *
 * The email address is optional — plenty of workers do not have one — but when
 * it is present it is not contact detail: it is how that person opens the app.
 * Registering it writes `clientEmails/{email} -> clientId`, and that document
 * is what the security rules consult when they sign in. Changing the address
 * moves the access with it, which is also how access is taken away.
 */

import {
  db, doc, collection, getDoc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp,
  writeBatch, docData, listData, toDate,
} from '../firebase.js';
import { today, dayKey, daysBetween } from '../lib/dates.js';
import {
  DEFAULT_DELIVERY_DAYS, DEFAULT_GRACE_DAYS, DEFAULT_PAY_EVERY, payDayOnOrAfter,
} from '../lib/billing.js';
import { matches, fold } from '../lib/format.js';
import { normalizeExtras } from '../lib/pricing.js';
import { findLocation } from './farms.js';

const clientsRef = () => collection(db, 'clients');

/** Lowercased and trimmed — the lookup document id must match the token. */
export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

/** A blank worker, pre-filled with everything their farm already decided. */
export const emptyClient = (farm) => ({
  farmId: farm?.id || '',
  farmName: farm?.name || '',
  locationId: '',
  locationName: '',
  name: '',
  phone: '',
  email: '',
  notes: '',
  tags: [],
  mealsPerDay: Number(farm?.defaultMealsPerDay) || 1,
  // Extra plates on particular weekdays, keyed by weekday: { '6': 1 } is one
  // more every Saturday.
  extras: {},
  status: 'active',
  // The day they actually started eating here, which is not the same as their
  // billing anchor: the anchor says when the fortnights fall, this says which
  // of those fortnights are theirs to pay for.
  startedOn: today(),
  // The last day they are served, when the kitchen already knows there is one:
  // "pagó y se va el jueves". Empty is the normal case — most people have no
  // end date.
  endsOn: '',
  ...termsOf(farm),
});

/**
 * Whether somebody's fortnight has actually been set, or is still the default.
 *
 * A client registered at a rancho inherits that rancho's date as a starting
 * point. It is a guess: nobody has said "this person pays on Saturdays". The
 * moment a payment fixes the cycle — at the counter or from the notebook —
 * `cycleSetOn` records the day it came from, and that is what tells every
 * screen the difference between a real cycle and a placeholder.
 *
 * It is also what keeps the two rules from fighting. Paying late must never
 * push somebody's day forward; but the first payment the system ever sees from
 * somebody has no day to push. So the offer to set the cycle is on by default
 * exactly while this is empty, and off after.
 */
export const cycleIsSet = (client) => !!client?.cycleSetOn;

/**
 * Whether this person is still being served today.
 *
 * `endsOn` is the kitchen writing down something it already knows: "pagó y se
 * va el jueves". Once that day passes they are finished, and nothing — not the
 * libreta, not the billing scan, not the roster's count — should keep treating
 * them as somebody who eats here. Deriving it means the change happens on the
 * right morning by itself, with nobody remembering to go and switch a status
 * on a day they are not thinking about it.
 *
 * Their stored `status` still wins when it says paused or inactive: an end
 * date does not un-pause anybody.
 */
export function servingStatus(client, day = today()) {
  if (!client) return 'inactive';
  if (client.status !== 'active') return client.status || 'inactive';
  if (client.endsOn && client.endsOn < day) return 'inactive';
  return 'active';
}

export const isServing = (client, day = today()) => servingStatus(client, day) === 'active';

/** Days left before their service ends, or null when there is no end date. */
export function daysLeft(client, day = today()) {
  if (!client?.endsOn) return null;
  return daysBetween(day, client.endsOn);
}

/** Sets — or clears — the last day this person is served. */
export async function setEndsOn(clientId, endsOn) {
  await updateDoc(doc(db, 'clients', clientId), {
    endsOn: endsOn || '',
    updatedAt: serverTimestamp(),
  });
}

/**
 * The day this person started eating here.
 *
 * Everybody registered from now on carries it. For the ones who were already
 * in the system before the field existed, the day their record was created is
 * the closest true thing the database knows — they were registered because
 * they started, usually the same week. Returns '' when even that is missing,
 * and callers read that as "no date, do not gate on it".
 */
export function servingSince(client) {
  if (client?.startedOn) return client.startedOn;
  const created = toDate(client?.createdAt);
  return created ? dayKey(created) : '';
}

/**
 * The farm's terms, in the shape they are stored on a worker.
 *
 * `cycleAnchor` is a starting point, not a term: from here on it belongs to
 * the person. Their fortnight turns over on the collection day their own cycle
 * began on — where their last payment left them — so it is snapped to one and
 * then never touched by anything the farm does.
 */
export function termsOf(farm) {
  return {
    deliveryDays: [...(farm?.deliveryDays?.length ? farm.deliveryDays : DEFAULT_DELIVERY_DAYS)],
    deliveryWindow: farm?.deliveryWindow || '11:00 – 13:00',
    cycleAnchor: payDayOnOrAfter(farm?.cycleAnchor || today()),
    // How often they pay. A fortnight unless somebody says otherwise, which
    // is what everybody registered before this existed was already on.
    payEvery: Number(farm?.defaultPayEvery) === 7 ? 7 : DEFAULT_PAY_EVERY,
    graceDays: farm?.graceDays ?? DEFAULT_GRACE_DAYS,
  };
}

/* --- Reads ----------------------------------------------------------------- */

/** Live list of every worker, alphabetical. Returns an unsubscribe function. */
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

/** Which worker an address already belongs to, if any. */
export async function clientForEmail(email) {
  const key = normalizeEmail(email);
  if (!isValidEmail(key)) return null;
  const snap = await getDoc(doc(db, 'clientEmails', key));
  return snap.exists() ? { email: key, ...snap.data() } : null;
}

/* --- Writes ---------------------------------------------------------------- */

/**
 * Registers a worker at a farm location, and grants their email access if they
 * gave one.
 *
 * Both writes go in one batch. A worker whose email lookup is missing cannot
 * open the app, and a lookup pointing at a worker who does not exist is a
 * dangling grant; committing them separately would leave either state
 * reachable.
 */
export async function createClient(data, farm, author) {
  const placed = place(data, farm);
  const email = normalizeEmail(data.email);

  if (email) {
    if (!isValidEmail(email)) throw new Error('El correo no es válido. Déjalo vacío si no tiene.');
    const taken = await clientForEmail(email);
    if (taken) throw new Error(`Ese correo ya es de ${taken.clientName || 'otro cliente'}.`);
  }

  const ref = doc(clientsRef());
  const batch = writeBatch(db);

  batch.set(ref, {
    ...emptyClient(farm),
    ...sanitize(data),
    ...placed,
    email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: author?.uid || null,
    createdByName: author?.name || '',
  });

  if (email) {
    batch.set(doc(db, 'clientEmails', email), {
      clientId: ref.id,
      clientName: data.name || '',
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return { id: ref.id, email };
}

/**
 * Updates a worker, moving their access if the email changed.
 *
 * The old lookup is deleted in the same batch as the new one is written, so
 * the previous address never keeps working after the change. Clearing the
 * field removes the access outright.
 */
export async function updateClient(clientId, patch, previousEmail, farm) {
  const patchEmail = patch.email !== undefined;
  const email = patchEmail ? normalizeEmail(patch.email) : null;
  const previous = normalizeEmail(previousEmail);

  if (patchEmail && email) {
    if (!isValidEmail(email)) throw new Error('El correo no es válido. Déjalo vacío si no tiene.');
    if (email !== previous) {
      const taken = await clientForEmail(email);
      if (taken && taken.clientId !== clientId) {
        throw new Error(`Ese correo ya es de ${taken.clientName || 'otro cliente'}.`);
      }
    }
  }

  // Only re-resolve the location when the write is actually moving the worker;
  // a patch that just renames them has no farm to check against.
  const placed = (patch.farmId !== undefined || patch.locationId !== undefined)
    ? place({ ...patch, farmId: patch.farmId ?? farm?.id }, farm)
    : {};

  const batch = writeBatch(db);
  batch.update(doc(db, 'clients', clientId), {
    ...sanitize(patch),
    ...placed,
    ...(patchEmail ? { email } : {}),
    updatedAt: serverTimestamp(),
  });

  if (patchEmail) {
    if (previous && previous !== email) batch.delete(doc(db, 'clientEmails', previous));
    if (email) {
      batch.set(doc(db, 'clientEmails', email), {
        clientId,
        clientName: patch.name || '',
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  }

  await batch.commit();
}

/** Moves a worker to another location — of their farm, or of another one. */
export async function moveClient(clientId, farm, locationId) {
  const placed = place({ farmId: farm?.id, locationId }, farm);
  await updateDoc(doc(db, 'clients', clientId), {
    ...placed,
    ...termsOf(farm),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Sets how far a client is paid up.
 *
 * Written by the payment transaction as a rule; this is for the one case that
 * happens outside it — a balance carried over from the notebook, where the
 * date comes from paper rather than from a receipt this software issued.
 */
export async function setPaidThrough(clientId, paidThrough) {
  await updateDoc(doc(db, 'clients', clientId), { paidThrough, updatedAt: serverTimestamp() });
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

/* --- Placement ------------------------------------------------------------- */

/**
 * Resolves farm + location into the four fields stored on the worker.
 *
 * The names travel with the ids on purpose: the route screen groups thousands
 * of stops by location and the client's own app shows where they eat, and
 * neither should need a second read to say "Casa 1".
 */
function place(data, farm) {
  const farmId = data.farmId || farm?.id || '';
  if (!farmId) throw new Error('Elige el rancho al que pertenece.');
  if (farm && farm.id !== farmId) throw new Error('El rancho no coincide con la ubicación elegida.');

  const locationId = data.locationId || '';
  if (!locationId) throw new Error('Elige la ubicación donde está esta persona.');

  const location = findLocation(farm, locationId);
  if (!location) throw new Error('Esa ubicación ya no existe en el rancho.');

  return {
    farmId,
    farmName: farm?.name || '',
    locationId,
    locationName: location.name,
  };
}

/* --- Restrictions ----------------------------------------------------------- */

/**
 * Tidies one tag: trimmed, single-spaced, never empty.
 *
 * Case is left alone. "Sin Pollo" and "sin pollo" are the same restriction and
 * are deduplicated as such, but whichever spelling the kitchen typed first is
 * the one everybody keeps seeing — correcting people's capitalisation is not
 * this software's job.
 */
export const cleanTag = (tag) => String(tag || '').trim().replace(/\s+/g, ' ');

/** A tag list with the blanks and the repeats gone, in the order given. */
export function normalizeTags(tags) {
  const seen = new Set();
  const out = [];
  for (const raw of tags || []) {
    const tag = cleanTag(raw);
    const key = fold(tag);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export const hasTag = (client, tag) =>
  (client?.tags || []).some((one) => fold(one) === fold(tag));

/**
 * Every restriction in use, most common first.
 *
 * The form offers these before it offers an empty box: "sin pollo" is typed
 * once and picked forever after, which is what keeps one restriction from
 * becoming four spellings nobody can count.
 */
export function tagsInUse(clients) {
  const counts = new Map();
  for (const client of clients || []) {
    for (const tag of client.tags || []) {
      const key = fold(tag);
      const entry = counts.get(key) || { tag, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'es'));
}

const NUMERIC = new Set(['mealsPerDay', 'graceDays', 'payEvery']);

/** Fields a worker never sets for themselves — they belong to the farm. */
const NOT_WRITABLE = new Set(['id', 'farmId', 'farmName', 'locationId', 'locationName', 'email']);

/** Coerces form strings into the types Firestore should hold. */
function sanitize(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || NOT_WRITABLE.has(key)) continue;
    if (NUMERIC.has(key)) out[key] = Number(value) || 0;
    else if (key === 'deliveryDays') out[key] = (value || []).map(Number).sort((a, b) => a - b);
    else if (key === 'tags') out[key] = normalizeTags(value);
    else if (key === 'extras') out[key] = normalizeExtras(value, data.deliveryDays);
    else if (typeof value === 'string') out[key] = value.trim();
    else out[key] = value;
  }
  return out;
}

/** Case- and accent-insensitive search across the fields staff actually type. */
export const matchesSearch = (client, term) => matches(
  [client.name, client.phone, client.email, client.farmName, client.locationName,
    ...(client.tags || [])], term);
