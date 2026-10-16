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
  query, where, orderBy, serverTimestamp, arrayUnion, docData, listData,
} from '../firebase.js';
import {
  normalizePacking, ABILITIES, pinTakenBy,
} from '../lib/packing.js';
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
  // Only the libretas. Writing the whole normalized object would spread
  // `autoPrint: true` over a kitchen that had deliberately turned it off,
  // every time somebody moved a farm from one libreta to the other.
  await setDoc(packingRef(), {
    lines: clean.lines,
    updatedAt: serverTimestamp(),
    updatedByName: author?.name || '',
  }, { merge: true });
  return clean;
}

/** Whether a label prints by itself as each person comes up. */
export async function setAutoPrint(on, author) {
  await setDoc(packingRef(), {
    autoPrint: !!on,
    updatedAt: serverTimestamp(),
    updatedByName: author?.name || '',
  }, { merge: true });
}

/* --- Who packs --------------------------------------------------------------- */

export function watchPackers(onData, onError) {
  return onSnapshot(query(packersRef(), orderBy('name')),
    (snap) => onData(listData(snap)), onError);
}

/**
 * Creates or updates one user.
 *
 * Every permission is written out, every time. A record that carries only the
 * ones somebody happened to touch would depend on a default for the rest, and
 * a default is a thing that can be changed later by somebody who has never
 * met this person.
 *
 * @param {object} user
 * @param {object} [user.can]  `{ pack: true, newFarm: false, … }`
 * @param {object[]} [others]  everyone else, to refuse a number already in use
 */
export async function savePacker({ id, name, pin, active = true, can = {} }, author, others = []) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  const number = String(pin || '').replace(/\D/g, '');
  if (!clean) throw new Error('Escribe el nombre de la persona.');
  if (number.length < 4) throw new Error('El PIN debe tener al menos 4 dígitos.');
  if (number.length > 8) throw new Error('El PIN no puede tener más de 8 dígitos.');

  const clash = active ? pinTakenBy(others, number, id) : null;
  if (clash) {
    throw new Error(String(clash.pin).trim() === number
      ? `Ese PIN ya lo usa ${clash.name}. Escoge otro.`
      : `Ese PIN empieza igual que el de ${clash.name}, y al teclear uno se entraría con el otro. `
        + 'Escoge otro.');
  }

  const permissions = {};
  for (const { key } of ABILITIES) permissions[key] = can[key] !== false;

  const ref = id ? doc(db, 'packers', id) : doc(packersRef());
  await setDoc(ref, {
    name: clean,
    pin: number,
    active: !!active,
    can: permissions,
    updatedAt: serverTimestamp(),
    updatedByName: author?.name || '',
    ...(id ? {} : { createdAt: serverTimestamp() }),
  }, { merge: true });
  return { id: ref.id, name: clean, pin: number, active: !!active, can: permissions };
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
export const runIdOf = (day, lineId) => `${day}_${lineId}`;

export async function startRun({ line, packer, people, plates, farms, day = today() }) {
  const id = runIdOf(day, line.id);
  const ref = doc(db, 'packRuns', id);
  const counts = {
    date: day,
    lineId: line.id,
    lineName: line.name,
    farms: Number(farms) || 0,
    people: Number(people) || 0,
    plates: Number(plates) || 0,
    updatedAt: serverTimestamp(),
  };

  // A libreta somebody else already opened today — one person relieved another,
  // or a browser was closed and a different computer picked it up. The record
  // keeps whoever started it *and* everybody who worked it, because "whose list
  // was this?" has more than one honest answer on a morning like that, and a
  // record that silently swaps the name is worse than one that says both.
  //
  // Without internet that record cannot be read, and the libreta opens all the
  // same: what is written then is only what cannot undo anything — the counts,
  // and this name added to the list of who worked it.
  let found;
  try {
    found = await Promise.race([getDoc(ref), wait(3000)]);
  } catch { found = null; }
  if (!found) {
    const record = {
      ...counts,
      packerId: packer?.id || '',
      packerName: packer?.name || '',
      packerNames: arrayUnion(packer?.name || ''),
    };
    await landed(setDoc(ref, record, { merge: true }));
    return { id, ...record, packerNames: [packer?.name || ''] };
  }
  const prev = docData(found);
  const names = [...new Set([
    ...(prev?.packerNames || [prev?.packerName].filter(Boolean)),
    packer?.name || '',
  ].filter(Boolean))];

  const record = {
    ...counts,
    packerId: prev?.packerId || packer?.id || '',
    packerName: names[0] || packer?.name || '',
    packerNames: names,
    // Opening a libreta that was already finished — to look at it again, or
    // because somebody tapped the wrong card — does not un-finish the morning.
    // The record says what happened; walking it to the end again closes it
    // again on its own.
    done: prev?.done === true,
    ...(prev?.finishedAt ? {} : { finishedAt: null }),
    ...(prev?.startedAt ? {} : { startedAt: serverTimestamp() }),
  };
  await landed(setDoc(ref, record, { merge: true }));
  return { id, ...record };
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Waits for a write to reach the server, but not forever: offline it is kept
 * on this computer and sent when the internet is back, and its promise only
 * settles then. A refusal still comes back within the wait.
 */
async function landed(write, ms = 4000) {
  write.catch(() => {});
  await Promise.race([write, wait(ms)]);
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

/* --- Stickers paused on this computer ------------------------------------------ */

/**
 * Whether this computer's stickers are paused, today.
 *
 * On the machine and not in Firestore: the other computer is packing the
 * other libreta, and pausing this printer must not silence that one. In
 * `localStorage` rather than the session, because the moment a pause is wanted
 * is often right after the browser was closed — a libreta always starts again
 * at its first farm, and walking back up to person sixty-eight with the
 * printer on prints sixty-seven people twice. And it holds for the day it was
 * set, so a pause somebody forgot to undo is over by the next morning instead
 * of being the reason the stickers "stopped working".
 */
const PAUSE = 'aguila.empaque.pausa';

export function printingPaused(day) {
  try { return localStorage.getItem(PAUSE) === day; } catch { return false; }
}

export function pausePrinting(day, paused) {
  try {
    if (paused) localStorage.setItem(PAUSE, day);
    else localStorage.removeItem(PAUSE);
  } catch { /* storage refused: the pause lasts as long as the screen does */ }
}

/* --- Where this computer left each libreta ------------------------------------ */

/**
 * The slide this computer was on in a libreta, today.
 *
 * Going out to the menu — to fix what somebody cannot eat, to look at the
 * board — and coming back used to start the libreta again at its first farm,
 * with that farm's bag sticker and sixty-seven presses of Siguiente to get
 * back to person sixty-eight. Now it comes back to the person it left.
 *
 * On the machine, like the pause, and for the same reasons: it is nothing the
 * other computer needs, nothing in Firestore changes for it, and it is over
 * with the day. The slide is remembered by who is on it (`key`) as well as by
 * its number, so somebody added to an earlier house while the libreta was
 * closed does not move it back by one.
 */
const SPOT = (lineId) => `aguila.empaque.vas.${lineId}`;

export function savedSpot(lineId, day) {
  try {
    const spot = JSON.parse(localStorage.getItem(SPOT(lineId)) || 'null');
    return spot?.day === day && Number.isInteger(spot.index) ? spot : null;
  } catch { return null; }
}

/** Writes it down; `null` forgets it, which is what finishing a libreta does. */
export function saveSpot(lineId, day, spot) {
  try {
    if (!spot) { localStorage.removeItem(SPOT(lineId)); return; }
    localStorage.setItem(SPOT(lineId), JSON.stringify({
      day,
      key: spot.key,
      index: spot.index,
      // Everybody who has been on the screen this pass — so somebody added
      // behind the place it is at can be told apart from those packed.
      seen: Array.isArray(spot.seen) ? spot.seen : undefined,
    }));
  } catch { /* storage refused: the libreta starts at its beginning, as it used to */ }
}
