/**
 * El tablero de hoy — the kitchen's two whiteboards, worked out from the
 * clients instead of tallied by hand.
 *
 * The kitchen keeps two boards on the wall, MEDIAS and COMPLETAS, and on each
 * one a line per thing somebody cannot eat — "Pollo: Monse 4, Clau 10" — so
 * whoever is cooking knows how many plates of each libreta go without it.
 * Kept by hand, those numbers drift the first week somebody new starts or
 * somebody stops. Here they are counted from every client, every time.
 *
 * What counts:
 *
 *   **Whoever is packed today.** The same people the packing screen walks,
 *   libreta by libreta — so a number on this board is a number of containers
 *   somebody is about to fill. Somebody who eats today but is in no libreta is
 *   not packed, so they are not on the board; they are listed apart instead,
 *   because a person nobody packs for is the thing to fix first.
 *
 *   **Media or completa by today's plates.** One comida today is a media; two
 *   or more is a completa. Today's, not the plan's: an extra plate on Saturday
 *   is a plate that has to be made on Saturday.
 *
 *   **What they cannot eat, from their file.** Everything in "No puede comer",
 *   and whatever in their preferences says *sin* or *no* — "sin picante" is a
 *   plate made without chile whether it was written as an allergy or as a
 *   preference. A preference that does not say *sin* ("doble tortilla") is not
 *   something they cannot eat, so it is not on a board about that.
 *
 * Each person counts once per thing, however many times it is written on
 * their file, and "Sin Pollo", "no pollo" and "pollo" are the same line.
 */

import { packingSequence } from './packing.js';
import { mealsOn } from './pricing.js';
import { weekdayOf, today as todayKey } from './dates.js';

const PREFIX = /^(sin|no|nada de|cero)\b[\s:.,-]*/i;

/**
 * One thing somebody cannot eat, as a line on the board.
 *
 * "SIN POLLO", "no pollo", " pollo " → `{ key: 'pollo', label: 'Pollo' }`.
 * The key drops accents as well as case, so "lácteos" and "lacteos" — typed on
 * two different keyboards — are one line.
 *
 * @param {string}  text
 * @param {boolean} [mustSaySin]  only read it if it starts with sin / no —
 *   for preferences, where "doble tortilla" is a wish, not a restriction
 * @returns {{ key: string, label: string } | null}
 */
export function restriction(text, mustSaySin = false) {
  const raw = String(text || '').trim().replace(/\s+/g, ' ');
  const said = raw.match(PREFIX);
  if (mustSaySin && !said) return null;
  const what = (said ? raw.slice(said[0].length) : raw).trim();
  if (!what) return null;

  const lower = what.toLocaleLowerCase('es');
  return {
    key: lower.normalize('NFD').replace(/[̀-ͯ]/g, ''),
    label: lower[0].toLocaleUpperCase('es') + lower.slice(1),
  };
}

/** Everything one person cannot eat, once each. */
export function restrictionsOf(client) {
  const found = [
    ...(client?.tags || []).map((tag) => restriction(tag)),
    ...(client?.preferencias || []).map((pref) => restriction(pref, true)),
  ].filter(Boolean);
  const seen = new Map();
  for (const one of found) if (!seen.has(one.key)) seen.set(one.key, one);
  return [...seen.values()];
}

/**
 * The board for one day.
 *
 * @param {object}   input
 * @param {object[]} input.lines    both libretas, normalized
 * @param {object[]} input.farms
 * @param {object[]} input.clients  the roster, already filtered to who is served
 * @param {string}   [input.day]
 *
 * @returns {object}
 *   lines    `[{ id, name }]` — one column each
 *   people   `{ total, byLine }` and plates the same, for the whole day
 *   kinds    `[{ id, title, note, people, plates, more, rows }]` — medias and
 *            completas; `rows` is `[{ key, label, total, byLine, names }]`,
 *            alphabetical, with `names` the people behind each number by
 *            libreta; `more` is how many completas take three or more
 *   outside  who eats today but is in no libreta
 */
export function dayBoard({ lines = [], farms = [], clients = [], day = todayKey() }) {
  const weekday = weekdayOf(day);
  const columns = lines.map((line) => ({ id: line.id, name: line.name }));
  const zero = () => Object.fromEntries(columns.map((line) => [line.id, 0]));

  // Who is packed in which libreta, exactly as the packing screen walks it.
  const packed = [];
  for (const line of lines) {
    const plan = packingSequence({ line, lines, farms, clients, day });
    for (const slide of plan.slides) {
      if (slide.kind === 'client') packed.push({ client: slide.client, line: line.id, plates: slide.plates });
    }
  }
  const inLine = new Set(packed.map((one) => one.client.id));
  const outside = clients
    .filter((client) => mealsOn(client, weekday) > 0 && !inLine.has(client.id))
    .map((client) => ({ id: client.id, name: client.name, farmName: client.farmName || '' }));

  /*
   * "Huevo" and "huevos" are one line. Only merged when both are actually
   * written somewhere, and only by dropping an -s or -es — a rule that turns
   * "res" into "re" when nobody wrote "re" never gets the chance.
   */
  const keys = new Set(packed.flatMap((one) => restrictionsOf(one.client).map((r) => r.key)));
  const base = (key) => {
    if (key.endsWith('es') && keys.has(key.slice(0, -2))) return key.slice(0, -2);
    if (key.endsWith('s') && keys.has(key.slice(0, -1))) return key.slice(0, -1);
    return key;
  };

  /*
   * What each person cannot eat, as board lines — and how each line is
   * spelled. The spelling is chosen once for the whole day, the way most
   * people's files have it, so the same thing reads the same on both boards
   * rather than "Espagueti" on one and "Espaguetis" on the other.
   */
  const spellings = new Map();
  const linesOf = new Map();
  for (const one of packed) {
    const mine = new Set();
    for (const r of restrictionsOf(one.client)) {
      const key = base(r.key);
      if (mine.has(key)) continue;
      mine.add(key);
      if (!spellings.has(key)) spellings.set(key, new Map());
      spellings.get(key).set(r.label, (spellings.get(key).get(r.label) || 0) + 1);
    }
    linesOf.set(one, mine);
  }
  const labelOf = (key) => [...spellings.get(key).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0], 'es'))[0][0];

  const tally = () => ({ total: 0, byLine: zero() });
  const add = (into, line, n = 1) => { into.total += n; into.byLine[line] += n; };

  const KINDS = [
    { id: 'medias', title: 'Medias', note: '1 comida por persona', holds: (n) => n === 1 },
    { id: 'completas', title: 'Completas', note: '2 comidas por persona', holds: (n) => n >= 2 },
  ];

  const kinds = KINDS.map(({ id, title, note, holds }) => {
    const people = tally();
    const plates = tally();
    const rows = new Map();
    let more = 0;

    for (const one of packed) {
      if (!holds(one.plates)) continue;
      add(people, one.line);
      add(plates, one.line, one.plates);
      if (one.plates > 2) more += 1;

      for (const key of linesOf.get(one)) {
        if (!rows.has(key)) {
          rows.set(key, {
            key, label: labelOf(key), ...tally(),
            names: Object.fromEntries(columns.map((line) => [line.id, []])),
          });
        }
        const row = rows.get(key);
        add(row, one.line);
        // Who the number is. A number on a board is believed when you can see
        // who is behind it.
        row.names[one.line].push(one.client.name);
      }
    }

    for (const row of rows.values()) {
      for (const list of Object.values(row.names)) list.sort((a, b) => a.localeCompare(b, 'es'));
    }

    return {
      id, title, note, people, plates, more,
      rows: [...rows.values()].sort((a, b) => a.label.localeCompare(b.label, 'es')),
    };
  });

  const people = tally();
  const plates = tally();
  for (const one of packed) {
    add(people, one.line);
    add(plates, one.line, one.plates);
  }

  return { day, lines: columns, people, plates, kinds, outside };
}
