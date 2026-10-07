/**
 * Empaque — turning the roster into the order the plates get packed in.
 *
 * Two people pack the kitchen's food each morning, on two computers, from two
 * lists. A *libreta* is one of those lists: a set of **locations** the manager
 * assigned to it, in the order they should be worked through. Everything here
 * is about producing that order and nothing else — no Firestore, so the
 * sequence a packer walks can be checked against a handful of objects in a
 * test rather than against a screenshot.
 *
 * **Locations, not farms.** A farm like #332 Morsea has houses spread over a
 * few kilometres, and the kitchen splits them between the two people by
 * geography, not by whose name is on the gate. So Casa 1 can be in Libreta 1
 * while Casa 4 is in Libreta 2, and the unit this file works in is the
 * location.
 *
 * Three rules decide who appears:
 *
 *   **Only people being served.** Somebody paused, or whose last day has
 *   passed, is not packed for. The caller hands in the roster already filtered,
 *   the same way the report does, so "still being served" has one definition in
 *   this app and not three.
 *
 *   **Only people who eat today.** A client's week is their own — Ana takes
 *   Monday to Friday — and a Saturday list that includes her is a plate that
 *   gets made and thrown away.
 *
 *   **In the order the kitchen packs.** Location by location, in the order
 *   the manager set for that libreta — the order the van is loaded in, which
 *   does not care whose name is on a gate. Until somebody sets one it is the
 *   order of the paper book: farm, then its locations, then the people by
 *   name. The people doing this worked from that book for years; the machine
 *   does not ask them to learn a new order until they choose one.
 */

import { mealsOn } from './pricing.js';
import { weekdayOf, today as todayKey } from '../lib/dates.js';

/** The two lists the kitchen packs from. Named so the manager can rename them. */
export const DEFAULT_LINES = [
  { id: 'l1', name: 'Libreta 1', farmIds: [], placeIds: [] },
  { id: 'l2', name: 'Libreta 2', farmIds: [], placeIds: [] },
];

/**
 * How one location is named in a libreta: the farm and the place, together.
 *
 * An empty location is not a mistake — it is the bucket for people whose
 * location was deleted, or who never got one. They still eat, so they still
 * need somewhere to be packed from.
 */
export const placeKey = (farmId, locationId) => `${farmId}:${locationId || ''}`;

/** Splits a key back apart. */
export const readPlaceKey = (key) => {
  const at = String(key || '').indexOf(':');
  return at === -1
    ? { farmId: String(key || ''), locationId: '' }
    : { farmId: key.slice(0, at), locationId: key.slice(at + 1) };
};

/**
 * The stored setup, with anything missing filled in.
 *
 * Always exactly two libretas: the kitchen has two computers and two people,
 * and a setup screen that can grow a third is a setup screen with a question
 * on it nobody asked. If that changes it is a one-line change here.
 */
export function normalizePacking(data) {
  const stored = Array.isArray(data?.lines) ? data.lines : [];

  return {
    /*
     * Whether a label prints by itself as each person comes up.
     *
     * On by default, because that is what the kitchen computers are for. It is
     * a setting at all because it only works on a machine where Chrome was
     * started with `--kiosk-printing`: anywhere else every Siguiente stops for
     * a print dialog, and a packer with wet hands confirming forty dialogs is
     * worse than no labels. Off is also how you pack the morning the label
     * printer dies.
     */
    autoPrint: data?.autoPrint !== false,

    lines: DEFAULT_LINES.map((fallback, i) => {
      const line = stored[i] || {};
      return {
        id: fallback.id,
        name: String(line.name || '').trim() || fallback.name,
        /*
         * `farmIds` is the old shape: a whole farm in one libreta.
         *
         * It is still read, and it still means what it meant, so a kitchen
         * that never opens the setup screen again keeps packing exactly as it
         * did. The first time somebody does open it, the save writes the
         * explicit locations and empties this — see `placesOf`. Nothing has to
         * be migrated on a morning when people are waiting for food.
         */
        farmIds: [...new Set((Array.isArray(line.farmIds) ? line.farmIds : []).filter(Boolean))],
        // De-duplicated, because a location packed twice is a location whose
        // people get two plates each and a count that never reconciles.
        placeIds: [...new Set((Array.isArray(line.placeIds) ? line.placeIds : []).filter(Boolean))],
        /*
         * The order the libreta is packed in, location by location — set by
         * hand in Empaque → Configurar → Orden de empaque.
         *
         * Kept apart from `placeIds` on purpose. Which locations a libreta has
         * and in what order it walks them are two decisions made on two
         * screens, and keeping them in one list meant that picking a house for
         * one libreta quietly rewrote the other's order. Empty means nobody set
         * one, and the morning runs in the paper book's order — see
         * `orderedPlaces`.
         */
        order: [...new Set((Array.isArray(line.order) ? line.order : []).filter(Boolean))],
      };
    }),
  };
}

/** The libreta with this id, or null. */
export const lineOf = (lines, id) => (lines || []).find((line) => line.id === id) || null;

/** Which libreta a farm belongs to as a whole, under the old shape. */
export const lineOfFarm = (lines, farmId) =>
  (lines || []).find((line) => (line.farmIds || []).includes(farmId)) || null;

/**
 * Which libreta packs one location.
 *
 * The location wins over the farm. A farm may still be assigned whole under
 * the old shape, and then one of its houses moved to the other libreta; the
 * house that was named explicitly is the one somebody decided about, so it is
 * the one that counts.
 */
export function lineOfPlace(lines, farmId, locationId) {
  const key = placeKey(farmId, locationId);
  const named = (lines || []).find((line) => (line.placeIds || []).includes(key));
  if (named) return named;
  return lineOfFarm(lines, farmId);
}

/**
 * Every location that exists, plus the "no location" bucket for any farm that
 * has people adrift in it.
 *
 * The bucket is only offered where somebody is actually in it. An empty row on
 * every farm would be six rows of nothing to read past on the one screen that
 * has to be read carefully.
 */
export function allPlaces(farms = [], clients = []) {
  const out = [];
  for (const farm of farms) {
    const known = new Set((farm.locations || []).map((place) => place.id));
    for (const place of farm.locations || []) {
      out.push({ key: placeKey(farm.id, place.id), farm, place });
    }
    const adrift = clients.some((client) =>
      client.farmId === farm.id && !known.has(client.locationId));
    if (adrift) {
      out.push({
        key: placeKey(farm.id, ''),
        farm,
        place: { id: '', name: 'Sin ubicación' },
      });
    }
  }
  return out;
}

/**
 * The locations one libreta packs right now, written out in full.
 *
 * This is what turns the old shape into the new one: a farm assigned whole
 * comes back as each of its locations. The setup screen saves what this
 * returns, so the first save after an edit makes the stored setup say exactly
 * what the screen showed.
 */
export const placesOf = (lines, lineId, farms, clients) =>
  allPlaces(farms, clients)
    .filter((entry) => lineOfPlace(lines, entry.farm.id, entry.place.id)?.id === lineId);

/**
 * The locations of one libreta, in the order they are packed.
 *
 * Location by location, in the order the manager set (`line.order`), because
 * the kitchen packs in the order the van is loaded and the van goes house by
 * house, not farm by farm. Until somebody sets one it is the order the morning
 * always had: farms in the order they were first added to the libreta, and
 * inside a farm its own list of locations, which is the paper book's.
 *
 * A location that arrives after the order was set — a new house, or one
 * brought over from the other libreta — goes right after the last location of
 * its own farm, which is where somebody would have put it by hand nine times
 * out of ten; with nothing of its farm here, it goes at the end. Either way it
 * is packed. An order that left a location out would be a quieter way of
 * losing a house than not assigning it at all, and this file exists to make
 * that impossible.
 *
 * @returns {{ key: string, farm: object, place: object }[]}
 */
export function orderedPlaces(lines, lineId, farms, clients) {
  const line = lineOf(lines, lineId);
  const members = placesOf(lines, lineId, farms, clients);

  // The book's order: farms by first appearance, then each farm's own list.
  // `placesOf` already has each farm's locations in its own order, so a
  // stable sort by farm is all it takes.
  const farmOrder = [];
  for (const key of line?.placeIds || []) {
    const { farmId } = readPlaceKey(key);
    if (farmId && !farmOrder.includes(farmId)) farmOrder.push(farmId);
  }
  for (const farmId of line?.farmIds || []) {
    if (!farmOrder.includes(farmId)) farmOrder.push(farmId);
  }
  const rank = (entry) => {
    const at = farmOrder.indexOf(entry.farm.id);
    return at === -1 ? farmOrder.length : at;
  };
  const book = members
    .map((entry, at) => ({ entry, at }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.at - b.at)
    .map(({ entry }) => entry);

  if (!line?.order?.length) return book;

  // A key that no longer names a location of this libreta is skipped, not an
  // error: the order outlives the houses in it.
  const byKey = new Map(members.map((entry) => [entry.key, entry]));
  const out = line.order.map((key) => byKey.get(key)).filter(Boolean);
  const placed = new Set(out.map((entry) => entry.key));
  for (const entry of book) {
    if (placed.has(entry.key)) continue;
    let after = -1;
    out.forEach((other, at) => { if (other.farm.id === entry.farm.id) after = at; });
    out.splice(after === -1 ? out.length : after + 1, 0, entry);
    placed.add(entry.key);
  }
  return out;
}

/**
 * Locations nobody assigned to a libreta, and that have people in them.
 *
 * The thing that goes wrong with a setup like this is a house added in March
 * that nobody puts on a list, whose people are then quietly not packed for. So
 * it is counted and said out loud rather than left to be noticed. Locations
 * with nobody in them are not mentioned: an empty house is not a problem.
 */
export function unassignedPlaces(lines, farms, clients = []) {
  const known = new Set((farms || []).flatMap((farm) =>
    (farm.locations || []).map((place) => `${farm.id}:${place.id}`)));

  return allPlaces(farms, clients)
    .filter((entry) => !lineOfPlace(lines, entry.farm.id, entry.place.id))
    .filter((entry) => (clients || []).some((client) => {
      if (client.farmId !== entry.farm.id) return false;
      return entry.place.id
        ? client.locationId === entry.place.id
        : !known.has(`${client.farmId}:${client.locationId}`);
    }));
}

/* --- The order of the morning ---------------------------------------------- */

/**
 * @param {object}   input.line     the libreta being packed
 * @param {object[]} [input.lines]  both libretas, so a location named in the
 *   other one is known to be spoken for. Defaults to just this one.
 * @param {object[]} input.farms    every farm, to resolve ids and locations
 * @param {object[]} input.clients  the roster, already filtered to who is served
 * @param {string}   [input.day]    the day being packed
 *
 * @returns {object} `{ farms, farmCount, slides, people, plates, missing }`
 *   farms      `[{ farm, groups: [{ place, clients }], people, plates }]` — one
 *              per stretch of the morning spent on one farm. A farm whose
 *              locations the order splits up appears once per stretch.
 *   farmCount  how many different farms, for anything that counts them
 *   slides     what the screen walks through, one thing per screen
 *   missing    ids in the libreta that no longer match a farm
 */
export function packingSequence({
  line, lines, farms = [], clients = [], day = todayKey(),
}) {
  const weekday = weekdayOf(day);
  const all = lines || (line ? [line] : []);
  const byId = new Map(farms.map((farm) => [farm.id, farm]));

  // A farm that was deleted while it was still on a libreta is reported, not
  // dropped: an empty stretch of the morning nobody can explain is worse.
  const missing = [];
  for (const farmId of [
    ...(line?.placeIds || []).map((key) => readPlaceKey(key).farmId),
    ...(line?.farmIds || []),
  ]) {
    if (farmId && !byId.has(farmId) && !missing.includes(farmId)) missing.push(farmId);
  }

  const roster = clients.filter((client) => mealsOn(client, weekday) > 0);

  /*
   * Location by location, in the libreta's order, with each location's people
   * by name. Consecutive locations of the same farm are one stretch, which is
   * one "Sigue esta farma" slide and one bag. When the order leaves a farm and
   * comes back to it later, that is a second stretch with its own slide and
   * its own bag — the plates were packed at different moments, and a bag
   * labelled with people who are not in it yet is a bag that gets closed
   * short.
   */
  const out = [];
  for (const entry of orderedPlaces(all, line?.id, farms, roster)) {
    const known = new Set((entry.farm.locations || []).map((place) => place.id));
    const here = roster
      .filter((client) => client.farmId === entry.farm.id)
      .filter((client) => (entry.place.id
        ? client.locationId === entry.place.id
        // Anybody whose location was removed still has to be packed for, or
        // they vanish from the only list that decides whether they eat.
        : !known.has(client.locationId)))
      .sort(byName);
    if (!here.length) continue;

    const last = out[out.length - 1];
    if (last && last.farm.id === entry.farm.id) {
      last.groups.push({ place: entry.place, clients: here });
    } else {
      out.push({ farm: entry.farm, groups: [{ place: entry.place, clients: here }] });
    }
  }
  for (const stretch of out) {
    stretch.people = stretch.groups.reduce((sum, group) => sum + group.clients.length, 0);
    stretch.plates = stretch.groups.reduce((sum, group) =>
      sum + group.clients.reduce((n, client) => n + mealsOn(client, weekday), 0), 0);
  }

  // One screen per thing: the farm you are starting, then its people one at a
  // time. The index on each slide is what the progress bar and "vas en 12 de
  // 34" are read from, so it is worked out once here rather than by the screen.
  const slides = [];
  for (const entry of out) {
    slides.push({
      kind: 'farm',
      farm: entry.farm,
      people: entry.people,
      plates: entry.plates,
      // Which of the farm's locations this stretch covers, in order — so a
      // farm that comes back later in the morning says which part it is.
      places: entry.groups.map((group) => group.place),
    });
    for (const group of entry.groups) {
      for (const client of group.clients) {
        slides.push({
          kind: 'client',
          client,
          farm: entry.farm,
          place: group.place,
          plates: mealsOn(client, weekday),
        });
      }
    }
  }
  if (slides.length) slides.push({ kind: 'done' });

  return {
    farms: out,
    farmCount: new Set(out.map((entry) => entry.farm.id)).size,
    slides,
    people: out.reduce((sum, entry) => sum + entry.people, 0),
    plates: out.reduce((sum, entry) => sum + entry.plates, 0),
    missing,
  };
}

const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'es');

/**
 * What goes in one farm's bag: the people on the slides that follow a farm's
 * slide, up to the next farm, in the order they are packed — with how many
 * plates each one takes, and the totals the bag is checked against.
 *
 * Read off the slides rather than worked out again, so the sticker on the bag
 * can never list somebody the screen did not show, or miss somebody it did.
 * When a farm is split between the two libretas, each bag holds its own
 * libreta's half, which is exactly what each packer puts in it.
 *
 * @returns {{ farm: object, people: { name: string, plates: number }[],
 *   plates: number } | null}  null when the slide is not a farm
 */
export function bagOf(slides, index) {
  const head = slides?.[index];
  if (head?.kind !== 'farm') return null;
  const people = [];
  for (let at = index + 1; at < slides.length && slides[at].kind === 'client'; at += 1) {
    people.push({ name: slides[at].client.name, plates: slides[at].plates });
  }
  return {
    farm: head.farm,
    people,
    plates: people.reduce((sum, one) => sum + one.plates, 0),
  };
}

/* --- Who is at the keyboard -------------------------------------------------- */

/**
 * The packer whose number this is.
 *
 * Not a password, and nothing here pretends otherwise: the screen it opens
 * already sits inside the panel, behind a signed-in kitchen account. The number
 * answers "whose name goes on this morning's list", which is a question about
 * bookkeeping rather than about access — the same job a punch card does.
 */
export function packerByPin(packers, pin) {
  const typed = String(pin || '').trim();
  if (typed.length < 3) return null;
  return (packers || []).find((packer) => packer.active !== false
    && String(packer.pin || '').trim() === typed) || null;
}

/* --- What each person may do ------------------------------------------------ */

/**
 * The actions on the kitchen's menu, each one something a user can be allowed
 * or not.
 *
 * One entry per button, in the order the buttons appear, and nothing that is
 * not a button: a permission nobody can see the effect of is a setting the
 * manager has to take on trust.
 *
 * **This is about what each person is given, not about who can break in.**
 * Everyone at the kitchen computer works under the same signed-in account, and
 * the number they type is a name tag. These decide what a person's menu shows
 * and which screens open for them — the same job as giving the new hire only
 * the keys they need — and they are honest about being exactly that.
 */
export const ABILITIES = [
  { key: 'pack', title: 'Empacar',
    hint: 'Escoger una libreta y empacarla, con sus etiquetas.' },
  { key: 'newFarm', title: 'Nueva farma',
    hint: 'Dar de alta una farma con sus ubicaciones.' },
  { key: 'week', title: 'Calendario semanal',
    hint: 'Cambiar qué días tiene pedido una persona.' },
  { key: 'meals', title: 'Cantidad de pedidos',
    hint: 'Cambiar cuántos pedidos lleva al día.' },
  { key: 'newClient', title: 'Nuevo cliente',
    hint: 'Dar de alta a una persona en una farma.' },
  { key: 'status', title: 'Pausar o reactivar',
    hint: 'Poner a alguien en pausa, o volverlo a activar.' },
  { key: 'lastDay', title: 'Último día de pedido',
    hint: 'Poner hasta qué día recibe pedido una persona.' },
];

/**
 * Everything one user is allowed, as `{ pack: true, newFarm: false, … }`.
 *
 * A permission that was never saved counts as allowed. That is what keeps the
 * people who were already packing on the morning this arrived packing exactly
 * as they did — their records have no permissions on them at all. The first
 * time the manager opens and saves one, every permission is written out, so
 * after that nothing about that person rests on a default.
 */
export function abilitiesOf(packer) {
  const stored = packer?.can && typeof packer.can === 'object' ? packer.can : {};
  const out = {};
  for (const { key } of ABILITIES) out[key] = stored[key] !== false;
  return out;
}

/** Whether one user may do one thing. */
export const canDo = (packer, key) => abilitiesOf(packer)[key] === true;

/** In words, for the list of users: "Puede hacer todo", "Solo empacar", "5 de 7 permisos". */
export function abilitiesInWords(packer) {
  const mine = abilitiesOf(packer);
  const allowed = ABILITIES.filter(({ key }) => mine[key]);
  if (allowed.length === ABILITIES.length) return 'Puede hacer todo';
  if (!allowed.length) return 'Sin permisos';
  if (allowed.length === 1) return `Solo ${allowed[0].title.toLowerCase()}`;
  if (allowed.length === 2) return allowed.map((one) => one.title).join(' y ');
  return `${allowed.length} de ${ABILITIES.length} permisos`;
}

/**
 * Another active user already using this number, or null.
 *
 * Two people with the same number is a coin toss over whose name goes on the
 * morning — and now also over whose permissions open. So it is refused when
 * saving rather than warned about afterwards.
 */
export function pinTakenBy(packers, pin, exceptId) {
  const wanted = String(pin || '').trim();
  if (!wanted) return null;
  return (packers || []).find((packer) => packer.id !== exceptId
    && packer.active !== false
    && String(packer.pin || '').trim() === wanted) || null;
}

/** True when two packers share a number, which would make the name a coin toss. */
export const duplicatePins = (packers) => {
  const seen = new Set();
  const clashes = new Set();
  for (const packer of packers || []) {
    const pin = String(packer.pin || '').trim();
    if (!pin) continue;
    if (seen.has(pin)) clashes.add(pin);
    seen.add(pin);
  }
  return [...clashes];
};
