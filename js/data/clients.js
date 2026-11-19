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
  db, doc, collection, getDoc, getDocs, updateDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp,
  writeBatch, arrayUnion, docData, listData, toDate, saved, runTransaction,
} from '../firebase.js';
import { logClientChanges, logMovement, clientBefore, actorName } from './movements.js';
import { today, dayKey, daysBetween, addDays, formatDay } from '../lib/dates.js';
import {
  DEFAULT_DELIVERY_DAYS, DEFAULT_GRACE_DAYS, DEFAULT_PAY_EVERY, payDayOnOrAfter,
} from '../lib/billing.js';
import { matches, fold } from '../lib/format.js';
import { normalizeExtras, periodCharge } from '../lib/pricing.js';
import { findLocation, TERM_FIELDS } from './farms.js';
import { t, inSpanish } from '../lib/i18n.js';

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
  /*
   * Two lists, on purpose.
   *
   * `tags` is what somebody cannot eat and it never leaves the kitchen: it is
   * on the packing screen in red, where the food is still open, and it is
   * never printed on a sticker that gets closed under a lid and driven around
   * a county. `preferencias` is what they asked for — sin picante, sin cebolla
   * — and that is what goes on the label.
   *
   * They started as one list, so most people's preferences were copied out of
   * their restrictions when this was added. A restriction that turns out to be
   * a preference is moved by hand; one that is really an allergy is taken out
   * of here and nothing about it is ever printed.
   */
  preferencias: [],
  // A note for today and nothing else. It carries the day it was written for
  // rather than being cleared by somebody in the morning, because a field that
  // needs clearing is a field that still says "doble tortilla" next Thursday.
  notaDelDia: '',
  notaDelDiaOn: '',
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
 * It is also what words the offer at the counter. Paying late must never push
 * somebody's day forward, so the switch that lets a payment set the cycle is
 * always off until somebody turns it on; what changes with this is what it is
 * called — «Fijar su quincena» while nobody has confirmed one, «Reajustar»
 * after.
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

/**
 * Registered ahead, starting on a later day (Programador → Cliente nuevo):
 * on pause with the day they start, until that morning makes them active.
 */
export const startsLater = (client, day = today()) =>
  client?.status === 'paused' && !!client.startsOn && client.startsOn > day;

/**
 * Whether somebody was on the plan on a given day, by their record of pauses.
 *
 * `status` only says what they are today. Billing asks about days already
 * gone — was this fortnight theirs? — and the answer for somebody who was
 * paused for three weeks and came back is not today's "active". So every
 * change of status is also written down, with its day (`statusLog`), and this
 * reads it: the last change on or before `day` decides.
 *
 * Before the first change written down, they were what that change says they
 * were (`was`) — every change records it now. The ones written before it did
 * carry only what they became, and for those the answer is a guess: the
 * opposite. Mostly right, and wrong in two ways that cost money: confirming
 * the status somebody already had («Sigue» on somebody active) was written
 * down as a change, and from then on every fortnight before that day read as
 * a pause and was never charged; and somebody long in pause marked «Ya no»
 * read as active until that day, and was offered four fortnights to pay.
 * `statusDoubt` finds those, and the panel asks (js/ui/status-review.js).
 *
 * Somebody off today with nothing written down — set before the record
 * existed — counts as off on every day, which is how they were treated until
 * now.
 */
export function onPlanOn(client, day) {
  const log = statusLogOf(client);
  if (!log.length) return !client?.status || client.status === 'active';
  let status = log[0].was || (log[0].status === 'active' ? 'paused' : 'active');
  for (const entry of log) {
    if (String(entry.on) > String(day)) break;
    status = entry.status;
  }
  return status === 'active';
}

/** The record of changes of status, oldest first. */
function statusLogOf(client) {
  return (Array.isArray(client?.statusLog) ? client.statusLog : [])
    .filter((entry) => entry?.on && entry?.status)
    // Two changes on one day — paused by mistake and put back — in the order
    // they were made.
    .sort((a, b) => String(a.on).localeCompare(String(b.on)) || (Number(a.at) || 0) - (Number(b.at) || 0));
}

/**
 * The first change of status on somebody's record, when what they were before
 * it is only a guess: written by hand, before changes recorded it (`was`).
 *
 * Not one the system made itself — a last day going by, the Programador:
 * those only ever happen to somebody who was the opposite. And not one made
 * on or before the day they started: there is nothing before it to be wrong
 * about.
 *
 * @returns {null | { entry: object, guess: 'active'|'paused' }}  `guess` is
 *   what `onPlanOn` takes them to have been before it
 */
export function statusDoubt(client) {
  const [first] = statusLogOf(client);
  if (!first || first.was || first.auto || first.prog) return null;
  const since = servingSince(client);
  if (since && String(first.on) <= since) return null;
  return { entry: first, guess: first.status === 'active' ? 'paused' : 'active' };
}

/**
 * Writes down what somebody was before the first change on their record —
 * the answer to `statusDoubt`, given by a person who knows.
 *
 * Nothing else about them changes: not their status, not a bill. Only which
 * fortnights before that day count as theirs.
 *
 * An entry that already says so is left as it is, and the caller is told:
 * somebody else — another computer, a second press — answered first, and one
 * answer must not be written over another in silence.
 */
export async function setStatusBefore(client, entry, was) {
  await rewriteStatusEntry(client, entry, (found) => {
    if (found.was) throw new Error(t('Ese cambio ya estaba contestado. Vuelve a abrir la revisión.'));
    return { ...found, was };
  });
  logMovement({
    kind: 'estado',
    text: inSpanish(() => `Revisión de estado: antes del ${formatDay(entry.on)} estaba ${was === 'active' ? 'activo' : 'en pausa'}`),
    clientId: client.id,
    clientName: client.name,
  });
}

/**
 * Takes that answer back, while it is still the one that was given: the
 * person is asked about again.
 */
export async function clearStatusBefore(client, entry, was) {
  await rewriteStatusEntry(client, entry, (found) => {
    if (found.was !== was) throw new Error(t('Esa respuesta ya cambió. Vuelve a abrir la revisión.'));
    const rest = { ...found };
    delete rest.was;
    return rest;
  });
  logMovement({
    kind: 'estado',
    text: inSpanish(() => `Revisión de estado: se deshizo lo anotado sobre antes del ${formatDay(entry.on)}`),
    clientId: client.id,
    clientName: client.name,
  });
}

/** One entry of the record of pauses, read and written back in one go. */
async function rewriteStatusEntry(client, entry, change) {
  const ref = doc(db, 'clients', client.id);
  const same = (one) => one?.on === entry.on && one?.status === entry.status
    && (one?.at || 0) === (entry.at || 0) && (one?.tag || '') === (entry.tag || '');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(t('Ese cliente ya no existe.'));
    const log = Array.isArray(snap.data().statusLog) ? snap.data().statusLog : [];
    const at = log.findIndex(same);
    if (at < 0) throw new Error(t('Ese cambio ya no está en su registro. Vuelve a abrir la revisión.'));
    const next = [...log];
    next[at] = change(log[at]);
    tx.update(ref, { statusLog: next, updatedAt: serverTimestamp() });
  });
}

/* --- The plan they were on ---------------------------------------------------
   What a period costs comes from the plan: meals a day, the days of the week,
   the extra plates. The client's record only says what the plan is *now* —
   and a period is billed after it ends, sometimes days after. Change the plan
   in between and the period that had already closed was billed with the new
   one: somebody who ate one meal a day for a fortnight and moved to two the
   morning after was charged a fortnight of two. And a change programmed for
   exactly one fortnight — two meals from the 11th to the 24th — was billed
   after it had gone back, at the price of one.

   So the plan being replaced is written down with the last day it applied
   (`planLog`), the way a change of status is, and a period is priced with
   the plan of its own last day (`planOn`). Appended, never read first, so it
   works with no internet. */

/** What a plan is made of — everything `periodCharge` reads but the cadence. */
const PLAN_FIELDS = ['mealsPerDay', 'deliveryDays', 'extras'];

const planValue = (record, key) => {
  if (key === 'mealsPerDay') return Number(record?.mealsPerDay) || 0;
  if (key === 'deliveryDays') return [...(record?.deliveryDays || [])].map(Number).sort((a, b) => a - b);
  return Object.fromEntries(Object.entries(record?.extras || {})
    .filter(([, count]) => Number(count) > 0)
    .sort(([a], [b]) => String(a).localeCompare(String(b))));
};

/** Whether a patch changes the plan of the record it is applied to. */
export function planChanges(before, patch) {
  if (!before || !patch) return false;
  return PLAN_FIELDS.some((key) => patch[key] !== undefined
    && JSON.stringify(planValue(patch, key)) !== JSON.stringify(planValue(before, key)));
}

/**
 * The plan in `record`, as an entry of the log: it applied up to and
 * including `until`. The moment keeps two changes on one day apart, and in
 * the order they were made.
 */
export const planEntry = (record, until) => ({
  until,
  mealsPerDay: planValue(record, 'mealsPerDay'),
  deliveryDays: planValue(record, 'deliveryDays'),
  extras: planValue(record, 'extras'),
  at: Date.now(),
});

/**
 * The client as they were on `day`: with the plan they had then.
 *
 * The entry that stopped applying soonest after that day is the plan that was
 * running on it; with none, the plan has not changed since and it is the one
 * on the record. Two changes on the same day: the first one made holds the
 * plan from the day before.
 */
export function planOn(client, day) {
  const log = (Array.isArray(client?.planLog) ? client.planLog : [])
    .filter((entry) => entry?.until && String(entry.until) >= String(day))
    .sort((a, b) => String(a.until).localeCompare(String(b.until))
      || (Number(a.at) || 0) - (Number(b.at) || 0));
  if (!log.length) return client;
  const [{ mealsPerDay, deliveryDays, extras }] = log;
  return {
    ...client,
    mealsPerDay: Number(mealsPerDay) || 0,
    deliveryDays: [...(deliveryDays || [])],
    extras: { ...(extras || {}) },
  };
}

/**
 * What one of somebody's periods costs, and who they were in it.
 *
 * Priced with the plan they had on its last day, over its own length: a week
 * left over between two cycles (`unbilledPart`) is a week, whatever cadence
 * they are on now. `as` is the client with that plan and that cadence — what
 * the bill is written from, so it says the meals a day that were eaten.
 *
 * @returns {{ as: object, charge: object }}  `charge` as `periodCharge` gives it
 */
export function chargeOf(client, period, pricing) {
  const as = { ...planOn(client, period?.end || today()) };
  if (period?.every) as.payEvery = period.every;
  return { as, charge: periodCharge(as, pricing) };
}

/**
 * The record of a change of status, made today. See `onPlanOn`. The moment —
 * and a tag of its own, for two in the same millisecond — is what keeps two
 * identical changes on one day from being taken for one: Firestore adds a
 * value to a list only if the same value is not there already.
 */
const statusEntry = (status, was = '', day = today()) => ({
  on: day, status, at: Date.now(), tag: Math.random().toString(36).slice(2, 8),
  // What they were until now, when this computer knows: it is what every day
  // before this change counts as (`onPlanOn`).
  ...(was ? { was } : {}),
  // Who did it, for Movimientos.
  by: actorName(),
});

/** Days left before their service ends, or null when there is no end date. */
export function daysLeft(client, day = today()) {
  if (!client?.endsOn) return null;
  return daysBetween(day, client.endsOn);
}

/** Sets — or clears — the last day this person is served. */
export async function setEndsOn(clientId, endsOn) {
  const before = clientBefore(clientId);
  await saved(updateDoc(doc(db, 'clients', clientId), {
    endsOn: endsOn || '',
    updatedAt: serverTimestamp(),
  }));
  logClientChanges(clientId, { endsOn: endsOn || '' }, { before });
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
  // Without internet the address cannot be checked, and writing it blind could
  // take somebody else's app away from them: better to say so.
  let snap = null;
  try {
    snap = await Promise.race([getDoc(doc(db, 'clientEmails', key)),
      new Promise((resolve) => { setTimeout(resolve, 6000); })]);
  } catch { snap = null; }
  if (!snap) {
    throw new Error(t('Sin internet no se puede revisar el correo. Guárdalo sin correo y agrégalo cuando vuelva la conexión.'));
  }
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
    if (!isValidEmail(email)) throw new Error(t('El correo no es válido. Déjalo vacío si no tiene.'));
    const taken = await clientForEmail(email);
    if (taken) throw new Error(t('Ese correo ya es de {name}.', { name: taken.clientName || t('otro cliente') }));
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

  await saved(batch.commit());
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
    if (!isValidEmail(email)) throw new Error(t('El correo no es válido. Déjalo vacío si no tiene.'));
    if (email !== previous) {
      const taken = await clientForEmail(email);
      if (taken && taken.clientId !== clientId) {
        throw new Error(t('Ese correo ya es de {name}.', { name: taken.clientName || t('otro cliente') }));
      }
    }
  }

  // Only re-resolve the location when the write is actually moving the worker;
  // a patch that just renames them has no farm to check against.
  const placed = (patch.farmId !== undefined || patch.locationId !== undefined)
    ? place({ ...patch, farmId: patch.farmId ?? farm?.id }, farm)
    : {};

  const before = clientBefore(clientId);
  // Made active before the day they were registered to start: see
  // `startingEarly`. A start date typed in the same edit is the one that counts.
  const early = patch.status === 'active' ? startingEarly(before) : {};
  if (early.startedOn && patch.startedOn && patch.startedOn <= early.startedOn) delete early.startedOn;

  const clean = sanitize(patch);
  const batch = writeBatch(db);
  batch.update(doc(db, 'clients', clientId), {
    ...clean,
    ...(patch.status !== undefined ? { statusLog: arrayUnion(statusEntry(patch.status, before?.status)) } : {}),
    // The plan they had until yesterday, written down as it is replaced.
    ...(planChanges(before, clean) ? { planLog: arrayUnion(planEntry(before, addDays(today(), -1))) } : {}),
    ...early,
    ...placed,
    ...(patchEmail ? { email } : {}),
    updatedAt: serverTimestamp(),
  });

  if (patchEmail) {
    if (previous && previous !== email) batch.delete(doc(db, 'clientEmails', previous));
    if (email) {
      // The name it already has, when this edit is not about the name:
      // changing only the address used to blank it, and "Ese correo ya es
      // de…" then had nobody to name.
      const name = patch.name ?? before?.name;
      batch.set(doc(db, 'clientEmails', email), {
        clientId,
        ...(name !== undefined ? { clientName: name || '' } : {}),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  }

  await saved(batch.commit());
  logClientChanges(clientId, { ...sanitize(patch), ...placed, ...(patchEmail ? { email } : {}) }, { before });
}

/**
 * Moves a worker to another location — of their farm, or of another one.
 *
 * Their pay date, how often they pay and the days they eat are theirs and go
 * with them. Only what belongs to the farm — the delivery window and the days
 * of grace — changes, and only when the farm does.
 */
export async function moveClient(clientId, farm, locationId, fromFarmId) {
  const placed = place({ farmId: farm?.id, locationId }, farm);
  const terms = termsOf(farm);
  const farmTerms = farm?.id && farm.id !== fromFarmId
    ? Object.fromEntries(TERM_FIELDS.map((field) => [field, terms[field]]))
    : {};
  const before = clientBefore(clientId);
  await saved(updateDoc(doc(db, 'clients', clientId), {
    ...placed,
    ...farmTerms,
    updatedAt: serverTimestamp(),
  }));
  logClientChanges(clientId, { ...placed, ...farmTerms }, { before });
}

/**
 * Sets how far a client is paid up.
 *
 * Written by the payment transaction as a rule; this is for the one case that
 * happens outside it — a balance carried over from the notebook, where the
 * date comes from paper rather than from a receipt this software issued.
 */
export async function setPaidThrough(clientId, paidThrough) {
  await saved(updateDoc(doc(db, 'clients', clientId), { paidThrough, updatedAt: serverTimestamp() }));
}

export async function setClientStatus(clientId, status, client = null) {
  // The status they already have is not a change, and must not be logged as
  // one: `onPlanOn` reads the first entry of the log as the day they became
  // that, and so as the end of having been the opposite — every day before it
  // changes sides. (Active with a last day behind them is the exception:
  // setting them active again is what brings them back.)
  if (client && client.status === status && !(status === 'active' && lastDayGone(client))) return;

  await saved(updateDoc(doc(db, 'clients', clientId), {
    status,
    // Appended without reading the client first, so it works with no internet.
    statusLog: arrayUnion(statusEntry(status, client?.status)),
    // Brought back after their last day went by: that day is over, and left
    // in place it would keep them out of the libreta however active they are.
    ...(status === 'active' && lastDayGone(client) ? { endsOn: '' } : {}),
    ...(status === 'active' ? startingEarly(client) : {}),
    updatedAt: serverTimestamp(),
  }));
}

/**
 * Somebody registered to start on a later day, made active before it.
 *
 * They start today, then, and their record has to say so. Left on the day
 * they were going to start, billing kept reading that day as their first —
 * "nothing that closed before it is theirs" — and the fortnight they really
 * began eating in was never charged; and their file went on saying «Empieza
 * el…» about somebody already in the libreta.
 */
const startingEarly = (client, day = today()) => (client?.startsOn && client.startsOn > day
  ? { startsOn: day, startedOn: day }
  : {});

/** Their last day ("Hasta cuándo come") is behind them. */
export const lastDayGone = (client, day = today()) => !!client?.endsOn && client.endsOn < day;

/**
 * Puts somebody whose last day has gone by in pause — on the morning after it.
 *
 * Nothing runs at midnight here: whichever computer of the kitchen opens
 * first that morning (or is open when the date turns) does it. The pause is
 * written down as of the day after their last one, not the day it happened to
 * be noticed, so billing reads the same thing either way: the fortnight their
 * last day was in is theirs, the ones after it are not.
 *
 * Two computers doing it at once write the same thing: the record of it has
 * no moment of its own, so it is one entry, not two.
 */
export async function pauseAfterLastDay(client) {
  if (!client?.id || client.status !== 'active' || !lastDayGone(client)) return;
  await saved(updateDoc(doc(db, 'clients', client.id), {
    status: 'paused',
    statusLog: arrayUnion({ on: addDays(client.endsOn, 1), status: 'paused', auto: true, was: 'active' }),
    updatedAt: serverTimestamp(),
  }));
}

export async function deleteClient(clientId, email) {
  // Somebody with a bill or a payment has a history, and the file is what
  // ties it together: who they are, where they eat, what they have paid up to.
  // Theirs is set to inactive, which keeps all of it; only a file entered by
  // mistake, with nothing on it yet, is deleted.
  const [bills, receipts] = await Promise.all([
    getDocs(query(collection(db, 'invoices'), where('clientId', '==', clientId), limit(1))),
    getDocs(query(collection(db, 'receipts'), where('clientId', '==', clientId), limit(1))),
  ]);
  if (!bills.empty || !receipts.empty) {
    throw new Error(t('Tiene facturas o pagos registrados. Para no perder su historial, desactívalo en lugar de borrarlo.'));
  }

  const before = clientBefore(clientId);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'clients', clientId));
  const key = normalizeEmail(email);
  if (key) batch.delete(doc(db, 'clientEmails', key));
  await batch.commit();
  logMovement({
    kind: 'alta', text: 'Borró al cliente (se había dado de alta por error)',
    clientId, clientName: before?.name || '', farmName: before?.farmName || '',
  });
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
  if (!farmId) throw new Error(t('Elige el rancho al que pertenece.'));
  if (farm && farm.id !== farmId) throw new Error(t('El rancho no coincide con la ubicación elegida.'));

  const locationId = data.locationId || '';
  if (!locationId) throw new Error(t('Elige la ubicación donde está esta persona.'));

  const location = findLocation(farm, locationId);
  if (!location) throw new Error(t('Esa ubicación ya no existe en el rancho.'));

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

export const hasTag = (client, tag, field = 'tags') =>
  (client?.[field] || []).some((one) => fold(one) === fold(tag));

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 450;

/**
 * Seeds everybody's preferences from the restrictions they already have.
 *
 * The two lists used to be one. When the sticker arrived they had to come
 * apart — an allergy is not printed, a preference is — and there is no way for
 * software to tell "sin picante" from "sin maní" in a list that was typed
 * before the distinction existed. So every restriction is copied across once
 * and the kitchen edits from there: what is really an allergy gets taken back
 * out of the printed list, by somebody who knows.
 *
 * Only people who have never had the field are touched, so running it twice
 * changes nothing and a list somebody has already cleaned up is left alone.
 *
 * @returns {Promise<number>} how many people were given a preferences list.
 */
export async function copyTagsToPreferences(clients) {
  const pending = (clients || []).filter((row) => row.preferencias === undefined);
  for (let from = 0; from < pending.length; from += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const client of pending.slice(from, from + BATCH_LIMIT)) {
      batch.update(doc(db, 'clients', client.id), {
        preferencias: normalizeTags(client.tags || []),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
  return pending.length;
}

/**
 * The note for one morning: "hoy no viene, dejar con su hermano".
 *
 * Stored with the day it is for, so tomorrow it is simply not today's note any
 * more. Nothing has to run at midnight and nobody has to remember to clear it,
 * which is the only version of this that survives a busy Monday.
 */
export async function setDayNote(clientId, text, day = today()) {
  const clean = String(text || '').trim();
  const before = clientBefore(clientId);
  await saved(updateDoc(doc(db, 'clients', clientId), {
    notaDelDia: clean,
    notaDelDiaOn: clean ? day : '',
    updatedAt: serverTimestamp(),
  }));
  logClientChanges(clientId, { notaDelDia: clean }, { before });
}

/**
 * Every restriction in use, most common first.
 *
 * The form offers these before it offers an empty box: "sin pollo" is typed
 * once and picked forever after, which is what keeps one restriction from
 * becoming four spellings nobody can count.
 *
 * `field` picks the list: the restrictions, or the preferences that go on a
 * printed label — where four spellings is four different-looking stickers.
 */
export function tagsInUse(clients, field = 'tags') {
  const counts = new Map();
  for (const client of clients || []) {
    for (const tag of client[field] || []) {
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
const NOT_WRITABLE = new Set(['id', 'farmId', 'farmName', 'locationId', 'locationName', 'email', 'statusLog', 'planLog']);

/** Coerces form strings into the types Firestore should hold. */
function sanitize(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || NOT_WRITABLE.has(key)) continue;
    if (NUMERIC.has(key)) out[key] = Number(value) || 0;
    else if (key === 'deliveryDays') out[key] = (value || []).map(Number).sort((a, b) => a - b);
    else if (key === 'tags' || key === 'preferencias') out[key] = normalizeTags(value);
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
