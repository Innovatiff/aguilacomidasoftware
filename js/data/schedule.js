/**
 * El Programador — storing the changes left for a future day, and carrying
 * them out when it comes. What each change does is in js/lib/schedule.js.
 *
 * `scheduled/{id}` holds one set each. Nothing runs on a server: every
 * computer of the team — the office's and the kitchen's — watches the sets
 * still waiting, and when a day comes the first one open carries them out
 * (see `runSchedule`, called by the store). A kitchen computer turned on at
 * six in the morning puts Monday's "two comidas" in place before anybody
 * packs; one left on overnight does it as the date turns.
 *
 * **Once, whoever does it.** Changes to a client are made in one transaction
 * with the set itself: the set is read, and only if it is still pending is the
 * client changed and the set marked done — so two computers waking together
 * cannot apply it twice, and a computer that dies halfway leaves nothing
 * half-done. Things that are their own operations — a new farm, a payment with
 * its receipt — are claimed first ("applying"), then done, then marked; a set
 * left "applying" is shown in the Programador for somebody to check.
 *
 * Offline, a transaction cannot run: the set waits, and the next snapshot with
 * the server carries it out.
 */

import {
  db, doc, collection, query, where, orderBy, limit as qLimit, onSnapshot, setDoc, updateDoc,
  runTransaction, arrayUnion, serverTimestamp, listData, saved,
} from '../firebase.js';
import {
  KINDS, applyChange, revertChange, dueNow, dueBack, isClientChange,
} from '../lib/schedule.js';
import { addDays, today } from '../lib/dates.js';
import { createClient } from './clients.js';
import { createFarm, addLocations, newLocationId } from './farms.js';
import { addCharge, takePayment, adjustBalance } from './invoices.js';

const setsRef = () => collection(db, 'scheduled');

/** Everything still to happen, or waiting for somebody: what the computers run. */
const OPEN = ['pending', 'applying', 'active', 'reverting', 'remind', 'failed'];

export function watchSchedule(onData, onError) {
  return onSnapshot(query(setsRef(), where('state', 'in', OPEN)),
    (snap) => onData(listData(snap)), onError);
}

/** Everything from `day` on, whatever its state — what the kitchen's Novedades reads. */
export function watchScheduleSince(day, onData, onError) {
  return onSnapshot(query(setsRef(), where('on', '>=', day)),
    (snap) => onData(listData(snap)), onError);
}

/** The latest ones, finished or not, for the Programador's history. */
export function watchScheduleHistory(onData, onError, count = 80) {
  return onSnapshot(query(setsRef(), orderBy('createdAt', 'desc'), qLimit(count)),
    (snap) => onData(listData(snap)), onError);
}

/* --- Writing a set ---------------------------------------------------------- */

/**
 * Leaves a change for its day.
 *
 * @param {object} input
 * @param {string} input.kind    see KINDS
 * @param {string} input.on      the day it takes effect
 * @param {string} [input.until] the last day it holds, for kinds that end
 * @param {object} [input.client]
 * @param {object} [input.farm]  for a new location
 * @param {object} input.value   what it sets
 */
export async function scheduleSet({ kind, on, until = '', client = null, farm = null, value }, author) {
  if (!KINDS[kind]) throw new Error('No se sabe qué programar.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(on || ''))) throw new Error('Escoge el día.');
  if (KINDS[kind].client && !client?.id) throw new Error('Escoge a la persona.');
  const end = KINDS[kind].ends && until ? until : '';
  if (end && end < on) throw new Error('El último día no puede ser antes del primero.');

  const ref = doc(setsRef());
  await saved(setDoc(ref, {
    kind,
    on,
    until: end,
    clientId: client?.id || '',
    clientName: client?.name || '',
    farmId: farm?.id || client?.farmId || '',
    farmName: farm?.name || client?.farmName || '',
    value: value || {},
    state: 'pending',
    createdAt: serverTimestamp(),
    createdByName: author?.name || '',
    createdByUid: author?.uid || null,
  }));
  return { id: ref.id };
}

/**
 * A client who starts on a later day: registered now, on pause with the day
 * they start (`startsOn`), and a set that makes them active that morning.
 *
 * Registered ahead so they are in Clientes from today and the kitchen can put
 * their location in a libreta before they eat; on pause so nothing packs them
 * or bills them until then — billing reads the day they started from the
 * record of that change, not from the day they were typed in.
 */
export async function registerFuture({ data, farm, on, until = '' }, author) {
  const client = await createClient({
    ...data, status: 'paused', startsOn: on, startedOn: on,
  }, farm, author);
  const set = await scheduleSet({
    kind: 'start', on, until, client: { id: client.id, name: data.name, farmId: farm?.id, farmName: farm?.name },
    value: {},
  }, author);
  return { clientId: client.id, setId: set.id };
}

/** Called off before its day. A client registered ahead stays, on pause. */
export async function cancelSet(set, author) {
  await saved(updateDoc(doc(db, 'scheduled', set.id), {
    state: 'cancelled', cancelledAt: serverTimestamp(), cancelledByName: author?.name || '',
  }));
  if (set.kind === 'start' && set.clientId) {
    await saved(updateDoc(doc(db, 'clients', set.clientId), { startsOn: '', updatedAt: serverTimestamp() }))
      .catch(() => {});
  }
}

/** A reminder seen, or a failure looked at. */
export const closeSet = (set, author) => saved(updateDoc(doc(db, 'scheduled', set.id), {
  state: 'done', doneAt: serverTimestamp(), closedByName: author?.name || '',
}));

/** Tried again: back to waiting, so the next computer to look carries it out. */
export const retrySet = (set) => saved(updateDoc(doc(db, 'scheduled', set.id), {
  state: 'pending', error: '',
}));

/** Ends a change that has an "until" now instead of on its day. */
export const endNow = (set) => saved(updateDoc(doc(db, 'scheduled', set.id), {
  until: addDays(today(), -1),
}));

/* --- Carrying it out --------------------------------------------------------- */

const entry = (log) => ({
  on: log.on, status: log.status, at: Date.now(),
  tag: Math.random().toString(36).slice(2, 8), prog: log.prog || '',
});

/** A change on a client, together with the set, in one transaction. */
function applyToClient(set, { farms, by }) {
  const setRef = doc(db, 'scheduled', set.id);
  const clientRef = doc(db, 'clients', set.clientId);
  return runTransaction(db, async (tx) => {
    const now = await tx.get(setRef);
    if (!now.exists() || now.data().state !== 'pending') return 'gone';
    const snap = await tx.get(clientRef);
    const client = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    const fresh = { ...now.data(), id: set.id };
    const result = applyChange(fresh, client, { farms });

    if (result.skip) {
      tx.update(setRef, {
        state: 'done', result: { text: result.skip, skipped: true },
        appliedAt: serverTimestamp(), appliedByName: by, doneAt: serverTimestamp(),
      });
      return 'skipped';
    }

    tx.update(clientRef, {
      ...result.patch,
      ...(result.log ? { statusLog: arrayUnion(entry(result.log)) } : {}),
      updatedAt: serverTimestamp(),
    });
    // With an "until", it waits to be put back; a new client's end is their
    // last day, which pauses them by itself.
    const waits = !!fresh.until && fresh.kind !== 'start';
    tx.update(setRef, {
      state: waits ? 'active' : 'done',
      before: result.before,
      applied: result.patch,
      appliedAt: serverTimestamp(),
      appliedByName: by,
      ...(waits ? {} : { doneAt: serverTimestamp() }),
    });
    return 'applied';
  });
}

/** The morning after "until": what is still as the set left it goes back. */
function revertOnClient(set, { farms, by }) {
  const setRef = doc(db, 'scheduled', set.id);
  const clientRef = doc(db, 'clients', set.clientId);
  return runTransaction(db, async (tx) => {
    const now = await tx.get(setRef);
    if (!now.exists() || now.data().state !== 'active') return 'gone';
    const snap = await tx.get(clientRef);
    const client = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    const fresh = { ...now.data(), id: set.id };
    const { patch, skipped, log } = revertChange(fresh, client, { farms });
    if (client && (Object.keys(patch).length || log)) {
      tx.update(clientRef, {
        ...patch,
        ...(log ? { statusLog: arrayUnion(entry(log)) } : {}),
        updatedAt: serverTimestamp(),
      });
    }
    tx.update(setRef, {
      state: 'done', revertedAt: serverTimestamp(), revertedByName: by, doneAt: serverTimestamp(),
      result: { text: skipped.length ? `No se regresó ${skipped.join(' ni ')}: alguien lo cambió antes.` : 'Regresó a como estaba.', skipped: skipped.length > 0 },
    });
    return 'reverted';
  });
}

/** Takes a set that is its own operation, so only one computer does it. */
function claim(set, by, next = 'applying') {
  const setRef = doc(db, 'scheduled', set.id);
  return runTransaction(db, async (tx) => {
    const now = await tx.get(setRef);
    if (!now.exists() || now.data().state !== 'pending') return false;
    tx.update(setRef, { state: next, claimedAt: serverTimestamp(), appliedByName: by });
    return true;
  });
}

/** A new farm, a location, money: claimed, done, then marked. */
async function applyOperation(set, { clients, farms, pricing, by }) {
  if (set.kind === 'reminder') {
    await claim(set, by, 'remind');
    return 'remind';
  }
  if (!(await claim(set, by))) return 'gone';
  const ref = doc(db, 'scheduled', set.id);
  const author = { uid: null, name: `Programador (${set.createdByName || 'oficina'})` };
  const v = set.value || {};
  const client = set.clientId ? clients.find((one) => one.id === set.clientId) : null;
  try {
    let text = '';
    if (set.kind === 'farm') {
      const made = await createFarm({
        name: v.name, locations: (v.locations || []).map((name) => ({ id: newLocationId(), name })),
      }, author);
      text = made?.id ? 'Farma dada de alta.' : '';
    } else if (set.kind === 'place') {
      const farm = farms.find((one) => one.id === set.farmId);
      if (!farm) throw new Error('Esa farma ya no existe.');
      await addLocations(farm, v.names || []);
      text = `${(v.names || []).join(', ')} en ${farm.name}.`;
    } else {
      if (!client) throw new Error('Ese cliente ya no existe.');
      if (set.kind === 'charge') {
        await addCharge({ client, amount: v.amount, reason: v.reason, date: set.on }, author);
        text = 'Deuda agregada.';
      } else if (set.kind === 'payment') {
        const receipt = await takePayment({
          client, pricing, amount: v.amount, method: v.method || 'cash', date: set.on, note: v.note || '',
        }, author);
        text = `Pago registrado${receipt?.folio ? `, recibo ${receipt.folio}` : ''}.`;
      } else if (set.kind === 'balance') {
        await adjustBalance({ client, target: v.target, note: v.note }, author);
        text = 'Saldo corregido.';
      }
    }
    await saved(updateDoc(ref, { state: 'done', doneAt: serverTimestamp(), result: { text } }));
    return 'applied';
  } catch (error) {
    await saved(updateDoc(ref, {
      state: 'failed', error: String(error?.message || error || 'No se pudo.'), failedAt: serverTimestamp(),
    }));
    return 'failed';
  }
}

/* --- The runner ---------------------------------------------------------------- */

// When this computer last tried each set, so one that cannot be carried out
// right now — no internet, a refusal — is not retried on every snapshot, but
// again a few minutes later (the store looks once a minute).
const tried = new Map();
const AGAIN_AFTER = 5 * 60 * 1000;
const fresh = (key) => {
  const last = tried.get(key);
  if (last && Date.now() - last < AGAIN_AFTER) return false;
  tried.set(key, Date.now());
  return true;
};
let running = false;

/**
 * Carries out every set whose day has come, and puts back every one whose
 * "until" has passed — one at a time, oldest first, so two changes to the
 * same person on the same day land in the order they were planned.
 *
 * @param {object} ctx  `{ sets, clients, farms, pricing, day, by }`
 */
export async function runSchedule(ctx) {
  if (running) return;
  running = true;
  try {
    const { sets, day } = ctx;
    for (const set of dueNow(sets, day)) {
      if (!fresh(`apply:${set.id}`)) continue;
      try {
        if (isClientChange(set.kind)) await applyToClient(set, ctx);
        else await applyOperation(set, ctx);
      } catch { /* offline or refused: tried again in a few minutes */ }
    }
    for (const set of dueBack(sets, day)) {
      if (!fresh(`back:${set.id}`)) continue;
      try { await revertOnClient(set, ctx); } catch { /* as above */ }
    }
  } finally {
    running = false;
  }
}

/** Forget what was tried — a new account, or a test. */
export const forgetTried = () => tried.clear();
