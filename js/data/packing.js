/**
 * Empaque, in Firestore.
 *
 * Three things live here, and they are deliberately three different shapes:
 *
 *   `config/packing`   which farms belong to which libreta. One document, read
 *                      by everybody, written by the manager.
 *   `packers`          the people who pack, with the number each one types.
 *   `packRuns`         one document per libreta per morning: who packed it,
 *                      when they started, when they finished, how many people
 *                      it held. This is the record the manager asks for when
 *                      somebody's food was missed.
 *
 * **The number is a name tag, not a password.** The screen it opens is already
 * inside the panel, behind a signed-in kitchen account — anybody who can reach
 * the keypad could reach every other screen without it. What it decides is
 * whose name goes on the morning's record. `packers` is admin-only all the
 * same, because a list of staff and their numbers is not a thing to leave where
 * every worker's phone can read it, and `config/packing` is readable by any
 * signed-in account — which is why the numbers are not kept there.
 */

import {
  db, doc, collection, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, serverTimestamp, docData, listData,
} from '../firebase.js';
import { normalizePacking } from '../lib/packing.js';
import { today } from '../lib/dates.js';

const packingRef = () => doc(db, 'config', 'packing');
const packersRef = () => collection(db, 'packers');
const runsRef = () => collection(db, 'packRuns');

/* --- Which farms go in which libreta ---------------------------------------- */

export function watchPacking(onData, onError) {
  return onSnapshot(packingRef(),
    (snap) => onData(normalizePacking(docData(snap))), onError);
}

export const getPacking = async () => normalizePacking(docData(await getDoc(packingRef())));

/**
 * Replaces the setup.
 *
 * A whole-document write rather than a patch: it is two short lists, edited as
 * two lists, and two managers arranging the same morning at the same moment is
 * not a situation this kitchen has.
 */
export async function savePacking(lines, author) {
  const clean = normalizePacking({ lines });
  await setDoc(packingRef(), {
    ...clean,
    updatedAt: serverTimestamp(),
    updatedByName: author?.name || '',
  }, { merge: true });
  return clean;
}

/* --- Who packs --------------------------------------------------------------- */

export function watchPackers(onData, onError) {
  return onSnapshot(query(packersRef(), orderBy('name')),
    (snap) => onData(listData(snap)), onError);
}

export async function savePacker({ id, name, pin, active = true }, author) {
  const clean = String(name || '').trim();
  const number = String(pin || '').replace(/\D/g, '');
  if (!clean) throw new Error('Escribe el nombre de la persona.');
  if (number.length < 4) throw new Error('El número debe tener al menos 4 dígitos.');

  const ref = id ? doc(db, 'packers', id) : doc(packersRef());
  await setDoc(ref, {
    name: clean,
    pin: number,
    active: !!active,
    updatedAt: serverTimestamp(),
    updatedByName: author?.name || '',
    ...(id ? {} : { createdAt: serverTimestamp() }),
  }, { merge: true });
  return { id: ref.id, name: clean, pin: number, active: !!active };
}

export const removePacker = (id) => deleteDoc(doc(db, 'packers', id));

/* --- The morning's record ---------------------------------------------------- */

/**
 * Every libreta packed on one day.
 *
 * Watched rather than read once, because the point is that the two computers
 * can see each other: the second one to open the screen has to be able to tell
 * that the first is already halfway through Libreta 1.
 */
export function watchPackRuns(day, onData, onError) {
  return onSnapshot(query(runsRef(), where('date', '==', day)),
    (snap) => onData(listData(snap).sort(byStart)), onError);
}

const byStart = (a, b) => {
  const at = (row) => (row.startedAt?.toMillis ? row.startedAt.toMillis() : 0);
  return at(a) - at(b);
};

/**
 * Opens the record for one libreta, before a single plate is packed.
 *
 * Written at the start rather than at the end for two reasons. The other
 * computer can then say who is on which list, which is what stops both people
 * packing Libreta 1. And a morning that is interrupted — a power cut, a browser
 * closed — still leaves evidence that somebody started, instead of leaving the
 * manager to work out from nothing why half a farm has no food.
 *
 * The id is the day and the libreta, so re-opening a libreta somebody already
 * started today continues that record instead of writing a second one.
 */
export async function startRun({ line, packer, people, plates, farms, day = today() }) {
  const id = `${day}_${line.id}`;
  const ref = doc(db, 'packRuns', id);

  // A libreta somebody else already opened today — one person relieved another,
  // or a browser was closed and a different computer picked it up. The record
  // keeps whoever started it *and* everybody who worked it, because "whose list
  // was this?" has more than one honest answer on a morning like that, and a
  // record that silently swaps the name is worse than one that says both.
  const prev = docData(await getDoc(ref));
  const names = [...new Set([
    ...(prev?.packerNames || [prev?.packerName].filter(Boolean)),
    packer?.name || '',
  ].filter(Boolean))];

  const record = {
    date: day,
    lineId: line.id,
    lineName: line.name,
    packerId: prev?.packerId || packer?.id || '',
    packerName: names[0] || packer?.name || '',
    packerNames: names,
    farms: Number(farms) || 0,
    people: Number(people) || 0,
    plates: Number(plates) || 0,
    // Opening a libreta that was already finished — to look at it again, or
    // because somebody tapped the wrong card — does not un-finish the morning.
    // The record says what happened; walking it to the end again closes it
    // again on its own.
    done: prev?.done === true,
    ...(prev?.finishedAt ? {} : { finishedAt: null }),
    ...(prev?.startedAt ? {} : { startedAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, record, { merge: true });
  return { id, ...record };
}

/** Closes it: the libreta was walked to the end. */
export async function finishRun(id, { packed } = {}) {
  await updateDoc(doc(db, 'packRuns', id), {
    done: true,
    packed: Number(packed) || 0,
    finishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** How far through somebody got, so a closed browser does not start over. */
export async function noteProgress(id, packed) {
  await updateDoc(doc(db, 'packRuns', id), {
    packed: Number(packed) || 0,
    updatedAt: serverTimestamp(),
  });
}

/* --- Who is sitting at this computer ----------------------------------------- */

/**
 * The packer this machine is currently being used by.
 *
 * In `sessionStorage` rather than in a screen's memory, because the morning
 * involves walking between the home screen and a libreta several times and
 * being asked for the number on every return would be its own small torture.
 * It is per browser session, so closing the browser forgets — which is the
 * right length of time for a shift, and means nothing is left behind for
 * whoever sits down tomorrow.
 *
 * Not authentication. See the note at the top of this file.
 */
const SEAT = 'aguila.packer';

export function seatedPacker() {
  try { return JSON.parse(sessionStorage.getItem(SEAT) || 'null'); } catch { return null; }
}

export function sitDown(packer) {
  try {
    if (packer) sessionStorage.setItem(SEAT, JSON.stringify(packer));
    else sessionStorage.removeItem(SEAT);
  } catch { /* a locked-down browser simply asks for the number again */ }
}

/* --- How far through a libreta somebody got ---------------------------------- */

/**
 * Progress, on the machine doing the packing.
 *
 * Kept here rather than written to Firestore on every tap: thirty-four writes
 * per libreta is thirty-four round trips between somebody's hand and the next
 * name, and the record only needs the number at the start and at the end. What
 * this is for is a browser that was closed, or a machine that lost power, at
 * plate nineteen.
 */
const trail = (day, lineId) => `aguila.packing.${day}.${lineId}`;

export function rememberSlide(day, lineId, index) {
  try { localStorage.setItem(trail(day, lineId), String(index)); } catch { /* ignore */ }
}

export function recallSlide(day, lineId) {
  try {
    const at = Number(localStorage.getItem(trail(day, lineId)));
    return Number.isFinite(at) && at > 0 ? at : 0;
  } catch { return 0; }
}

export function forgetSlide(day, lineId) {
  try { localStorage.removeItem(trail(day, lineId)); } catch { /* ignore */ }
}
