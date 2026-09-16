/**
 * The price list, stored in one document.
 *
 * `config/pricing` holds the fortnight price of each plan, the standard week
 * those prices assume, and what one meal above or below it is worth. Every
 * screen that quotes a number reads it from here, so changing $140 to $150 in
 * Ajustes changes what the next fortnight costs everywhere at once — and
 * changes nothing about the fortnights already billed, because an invoice
 * carries the numbers it was issued with.
 */

import { db, doc, getDoc, setDoc, onSnapshot, serverTimestamp, docData } from '../firebase.js';
import { normalizePricing, normalizeTiers } from '../lib/pricing.js';

const pricingRef = () => doc(db, 'config', 'pricing');

/**
 * The stored list, or the starting one while the document does not exist.
 *
 * `normalizePricing` answers "what are the prices" and deliberately says
 * nothing else, so when it was last changed and by whom are carried alongside
 * rather than folded into it. The report asks: a month that does not look like
 * the one before it is usually a month the price list moved in, and that is
 * worth saying on the page instead of leaving somebody to remember it.
 */
const read = (data) => ({
  ...normalizePricing(data),
  updatedAt: data?.updatedAt || null,
  updatedByName: data?.updatedByName || '',
});

export function watchPricing(onData, onError) {
  return onSnapshot(pricingRef(), (snap) => onData(read(docData(snap))), onError);
}

export const getPricing = async () => read(docData(await getDoc(pricingRef())));

/**
 * Replaces the price list.
 *
 * A whole-document write rather than a patch: the list is small, it is edited
 * as a list, and two people editing different rows of it at the same moment is
 * not a situation this business has.
 */
export async function savePricing(pricing, author) {
  const tiers = normalizeTiers(pricing?.tiers);
  if (!tiers.length) throw new Error('Deja al menos un plan con precio.');

  const clean = normalizePricing({ ...pricing, tiers });

  await setDoc(pricingRef(), {
    ...clean,
    updatedAt: serverTimestamp(),
    updatedByName: author?.name || '',
  }, { merge: true });

  return clean;
}
