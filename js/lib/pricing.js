/**
 * What a fortnight costs.
 *
 * The kitchen sells a fortnight, not a meal: one meal a day is $75 for the
 * two weeks, two meals a day is $140. That is the number quoted at the gate and
 * the number written on the receipt, so it is the number the software bills —
 * a flat price per *plan*, looked up by how many meals that person takes.
 *
 * The plans live in one document (`config/pricing`) instead of on each farm,
 * because there is one price list for the whole business and it changes as a
 * whole. Editing it never touches an invoice already issued: a bill carries the
 * price it was issued at.
 */

/** The price list the business started with, used until Ajustes changes it. */
export const DEFAULT_TIERS = [
  { mealsPerDay: 1, price: 75 },
  { mealsPerDay: 2, price: 140 },
];

/** Sorted, de-duplicated and coerced — what gets stored and what gets read. */
export function normalizeTiers(tiers) {
  const byMeals = new Map();
  for (const tier of tiers || []) {
    const mealsPerDay = Math.round(Number(tier?.mealsPerDay) || 0);
    const price = round2(tier?.price);
    if (mealsPerDay > 0) byMeals.set(mealsPerDay, { mealsPerDay, price });
  }
  return [...byMeals.values()].sort((a, b) => a.mealsPerDay - b.mealsPerDay);
}

/** The plan for somebody taking `mealsPerDay` meals, or null if none exists. */
export const tierFor = (tiers, mealsPerDay) =>
  (tiers || []).find((tier) => tier.mealsPerDay === Math.round(Number(mealsPerDay) || 0)) || null;

/**
 * What one fortnight costs that person, or 0 when no plan covers them.
 *
 * Zero is deliberate rather than a guess: a missing plan is a decision the
 * kitchen has to make, and the screens say so instead of inventing a price.
 */
export const priceFor = (tiers, mealsPerDay) => tierFor(tiers, mealsPerDay)?.price || 0;

/** "2 comidas/día · $140 por quincena" */
export const tierLabel = (tier) => (tier
  ? `${tier.mealsPerDay} ${tier.mealsPerDay === 1 ? 'comida' : 'comidas'}/día`
  : 'Sin plan');

export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
