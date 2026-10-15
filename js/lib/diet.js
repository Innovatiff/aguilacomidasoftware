/**
 * "No puede comer" — what somebody must never get on their plate, kept as one
 * list however many people type into it.
 *
 * The kitchen says it "No puerco", "No pollo"; the panel has been taking
 * "sin pollo". Both mean the same plate, and the day's board already counts
 * them as one line (`restriction` in js/lib/board.js). This is the other half:
 * when somebody types a thing the kitchen already writes another way, the
 * spelling already in use is the one kept — so the client lists and their
 * filters do not slowly fill with four ways of saying chicken.
 */

import { restriction } from './board.js';

/** The thing itself, without "sin"/"no", case or accents: "No Pollo" → "pollo". */
export const dietKey = (text) => restriction(text)?.key || '';

/** Whether two entries are the same thing to leave off a plate. */
export const sameDiet = (a, b) => !!dietKey(a) && dietKey(a) === dietKey(b);

/**
 * What to store for something typed.
 *
 * The spelling the kitchen already uses for the same thing, if there is one —
 * the most used, since `inUse` comes sorted that way (`tagsInUse`). If not,
 * what was typed, said the kitchen's way: "puerco" on its own becomes
 * "No puerco", because this is the list of what they cannot eat.
 *
 * @param {string} text
 * @param {{ tag: string }[]} [inUse]  every spelling in use, most used first
 * @returns {string} '' when there is nothing to add
 */
export function kitchenSpelling(text, inUse = []) {
  const typed = String(text || '').trim().replace(/\s+/g, ' ');
  const key = dietKey(typed);
  if (!key) return '';
  const known = inUse.find((entry) => dietKey(entry.tag) === key);
  if (known) return known.tag;
  if (restriction(typed, true)) return typed.charAt(0).toLocaleUpperCase('es') + typed.slice(1);
  return `No ${typed.toLocaleLowerCase('es')}`;
}

/** What changed between two lists — by the thing, not by how it is spelled. */
export function dietChanges(before = [], after = []) {
  return {
    added: after.filter((one) => !before.some((was) => sameDiet(was, one))),
    removed: before.filter((was) => !after.some((one) => sameDiet(was, one))),
  };
}
