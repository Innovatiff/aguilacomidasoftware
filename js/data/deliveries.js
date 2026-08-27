/**
 * Deliveries — one document per client per day.
 *
 * The document id is `${clientId}_${YYYY-MM-DD}`, which makes every write
 * idempotent: the kitchen phone and the driver's phone can both mark the same
 * stop without creating duplicates, and a day can be re-scheduled safely.
 *
 * Every stop carries the farm and the location it belongs to. The driver works
 * the route by place — all of Casa 1, then all of Bloque Norte — so grouping
 * has to work from the delivery documents alone, without joining a few hundred
 * client records on a phone with one bar of signal.
 */

import {
  db, doc, collection, getDoc, getDocs, setDoc, updateDoc, onSnapshot,
  query, where, orderBy, limit as qLimit, serverTimestamp, arrayUnion,
  writeBatch, docData, listData,
} from '../firebase.js';
import { deliveryId, servingDays } from '../lib/billing.js';
import { mealsOn } from '../lib/pricing.js';
import { weekdayOf, today } from '../lib/dates.js';
import { DELIVERY_FLOW } from '../lib/model.js';

const deliveriesRef = () => collection(db, 'deliveries');

/* --- Reads ----------------------------------------------------------------- */

/** Every stop on a given day — the kitchen's run sheet. */
export function watchDay(day, onData, onError) {
  return onSnapshot(
    query(deliveriesRef(), where('date', '==', day)),
    (snap) => onData(listData(snap).sort(byRoute)),
    onError,
  );
}

/** One farm's recent days, newest first — the client's history screen. */
export function watchClientDeliveries(clientId, count, onData, onError) {
  return onSnapshot(
    query(deliveriesRef(), where('clientId', '==', clientId), orderBy('date', 'desc'), qLimit(count)),
    (snap) => onData(listData(snap)),
    onError,
  );
}

/** A single day for one farm — the live tracking card. */
export function watchClientDay(clientId, day, onData, onError) {
  return onSnapshot(doc(db, 'deliveries', deliveryId(clientId, day)),
    (snap) => onData(docData(snap)), onError);
}

export async function getDelivery(clientId, day) {
  return docData(await getDoc(doc(db, 'deliveries', deliveryId(clientId, day))));
}

/**
 * Every stop in a date range, for all clients at once.
 *
 * Closing a fortnight for a few hundred workers one query at a time is a few
 * hundred round trips on a phone. The whole period comes back in one read and
 * is bucketed by client in memory instead.
 */
export async function deliveriesInRange(start, end) {
  const snap = await getDocs(query(
    deliveriesRef(),
    where('date', '>=', start),
    where('date', '<=', end),
  ));
  return listData(snap);
}

/** Delivered meals per client id, across a range read in one go. */
export async function billableMealsInRange(start, end) {
  const totals = new Map();
  for (const row of await deliveriesInRange(start, end)) {
    if (row.status !== 'delivered') continue;
    totals.set(row.clientId, (totals.get(row.clientId) || 0) + (Number(row.meals) || 0));
  }
  return totals;
}

/** All delivered days inside a period — the basis for a cycle's invoice. */
export async function deliveriesInPeriod(clientId, period) {
  const snap = await getDocs(query(
    deliveriesRef(),
    where('clientId', '==', clientId),
    where('date', '>=', period.start),
    where('date', '<=', period.end),
  ));
  return listData(snap).sort((a, b) => a.date.localeCompare(b.date));
}

/** Meals actually delivered in a period — what the client is billed for. */
export async function billableMeals(clientId, period) {
  const rows = await deliveriesInPeriod(clientId, period);
  return rows
    .filter((row) => row.status === 'delivered')
    .reduce((sum, row) => sum + (Number(row.meals) || 0), 0);
}

/* --- Writes ---------------------------------------------------------------- */

/**
 * Creates the day's stops for every active farm scheduled to be served.
 * Uses merge writes so running it twice — or after some stops have already
 * been advanced — never overwrites progress.
 */
export async function scheduleDay(clients, day, author) {
  const weekday = weekdayOf(day);
  const due = clients.filter((client) =>
    client.status === 'active' && (client.deliveryDays || []).includes(weekday));

  if (!due.length) return { created: 0, skipped: 0 };

  const existing = new Set(
    (await getDocs(query(deliveriesRef(), where('date', '==', day)))).docs.map((d) => d.id),
  );

  const batch = writeBatch(db);
  let created = 0;

  for (const client of due) {
    const id = deliveryId(client.id, day);
    if (existing.has(id)) continue;
    batch.set(doc(db, 'deliveries', id), {
      ...placeOf(client),
      clientId: client.id,
      clientName: client.name,
      date: day,
      status: 'scheduled',
      // What this weekday calls for, not the plan: somebody on two meals a day
      // with a Saturday extra gets three on Saturdays, and the driver has to
      // see three.
      meals: mealsOn(client, weekday),
      window: client.deliveryWindow || '',
      driver: '',
      notes: '',
      events: [{ status: 'scheduled', at: new Date(), byName: author?.name || 'Sistema' }],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    created += 1;
  }

  if (created) await batch.commit();
  return { created, skipped: due.length - created };
}

/**
 * Moves a stop to a new status and stamps the timeline.
 *
 * `serverTimestamp()` cannot be used inside an array, so timeline entries carry
 * a client Date. The authoritative `updatedAt` on the document is still a
 * server stamp, which is what ordering and staleness checks rely on.
 */
export async function setStatus(delivery, status, author, extra = {}) {
  const event = { status, at: new Date(), byName: author?.name || 'Cocina' };
  const patch = {
    status,
    events: arrayUnion(event),
    updatedAt: serverTimestamp(),
    ...extra,
  };
  if (status === 'delivered') patch.deliveredAt = serverTimestamp();
  await updateDoc(doc(db, 'deliveries', delivery.id), patch);
}

/** Bulk-advance every stop currently at `from` to the next step. */
export async function advanceAll(deliveries, from, author) {
  const next = DELIVERY_FLOW[DELIVERY_FLOW.indexOf(from) + 1];
  if (!next) return 0;
  const targets = deliveries.filter((row) => row.status === from);
  if (!targets.length) return 0;

  const batch = writeBatch(db);
  for (const row of targets) {
    batch.update(doc(db, 'deliveries', row.id), {
      status: next,
      events: arrayUnion({ status: next, at: new Date(), byName: author?.name || 'Cocina' }),
      updatedAt: serverTimestamp(),
      ...(next === 'delivered' ? { deliveredAt: serverTimestamp() } : {}),
    });
  }
  await batch.commit();
  return targets.length;
}

/**
 * Advances a set of stops, each to whatever its own next step is.
 *
 * This is the whole-location tap on the route screen: a group is rarely in one
 * uniform state — someone reported a problem, one was skipped — and the driver
 * means "move this location along", not "move everything that is exactly at
 * *en cocina*". Stops with nowhere to go are left alone.
 */
export async function advanceMany(deliveries, author) {
  const targets = deliveries
    .map((row) => ({ row, next: DELIVERY_FLOW[DELIVERY_FLOW.indexOf(row.status) + 1] }))
    .filter((entry) => entry.next);
  if (!targets.length) return 0;

  const batch = writeBatch(db);
  for (const { row, next } of targets) {
    batch.update(doc(db, 'deliveries', row.id), {
      status: next,
      events: arrayUnion({ status: next, at: new Date(), byName: author?.name || 'Cocina' }),
      updatedAt: serverTimestamp(),
      ...(next === 'delivered' ? { deliveredAt: serverTimestamp() } : {}),
    });
  }
  await batch.commit();
  return targets.length;
}

export async function updateDelivery(id, patch) {
  await updateDoc(doc(db, 'deliveries', id), { ...patch, updatedAt: serverTimestamp() });
}

/** Adds a stop that was not on the schedule (an extra person, a catch-up run). */
export async function createDelivery(client, day, author, meals) {
  const id = deliveryId(client.id, day);
  await setDoc(doc(db, 'deliveries', id), {
    ...placeOf(client),
    clientId: client.id,
    clientName: client.name,
    date: day,
    status: 'scheduled',
    meals: Number(meals ?? mealsOn(client, weekdayOf(day))) || 0,
    window: client.deliveryWindow || '',
    driver: '',
    notes: '',
    events: [{ status: 'scheduled', at: new Date(), byName: author?.name || 'Cocina' }],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return id;
}

/* --- Aggregation ----------------------------------------------------------- */

/** Counts by status plus a completion percentage, for the dashboard header. */
export function summarizeDay(deliveries) {
  const counts = { scheduled: 0, preparing: 0, en_route: 0, delivered: 0, skipped: 0, issue: 0 };
  let meals = 0;
  let mealsDelivered = 0;

  for (const row of deliveries) {
    counts[row.status] = (counts[row.status] || 0) + 1;
    meals += Number(row.meals) || 0;
    if (row.status === 'delivered') mealsDelivered += Number(row.meals) || 0;
  }

  const servable = deliveries.filter((row) => row.status !== 'skipped').length;
  return {
    counts,
    total: deliveries.length,
    servable,
    meals,
    mealsDelivered,
    done: counts.delivered,
    pending: servable - counts.delivered,
    percent: servable ? Math.round((counts.delivered / servable) * 100) : 0,
  };
}

/** Which clients scheduled for today have no delivery document yet. */
export function missingToday(clients, deliveries, day = today()) {
  const weekday = weekdayOf(day);
  const have = new Set(deliveries.map((row) => row.clientId));
  return clients.filter((client) =>
    client.status === 'active'
    && (client.deliveryDays || []).includes(weekday)
    && !have.has(client.id));
}

export { servingDays };

/** The farm and location a stop belongs to, denormalised onto the document. */
const placeOf = (client) => ({
  farmId: client.farmId || '',
  farmName: client.farmName || '',
  locationId: client.locationId || '',
  locationName: client.locationName || '',
});

/** Run-sheet order: farm, then location, then person. */
function byRoute(a, b) {
  return cmp(a.farmName, b.farmName)
    || cmp(a.locationName, b.locationName)
    || cmp(a.clientName, b.clientName);
}

const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'es');

/**
 * Stops grouped the way the route is actually driven: farm, then location.
 *
 * Returns `[{ farmId, farmName, locations: [{ locationId, locationName, rows }] }]`,
 * each level keeping the order `byRoute` put the rows in.
 */
export function groupByPlace(rows) {
  const farms = new Map();

  for (const row of [...rows].sort(byRoute)) {
    const farmId = row.farmId || '';
    if (!farms.has(farmId)) {
      farms.set(farmId, {
        farmId,
        farmName: row.farmName || 'Sin rancho',
        locations: new Map(),
      });
    }
    const farm = farms.get(farmId);
    const locationId = row.locationId || '';
    if (!farm.locations.has(locationId)) {
      farm.locations.set(locationId, {
        locationId,
        locationName: row.locationName || 'Sin ubicación',
        rows: [],
      });
    }
    farm.locations.get(locationId).rows.push(row);
  }

  return [...farms.values()].map((farm) => ({
    ...farm,
    locations: [...farm.locations.values()],
  }));
}
