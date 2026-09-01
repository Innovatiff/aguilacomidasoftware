/**
 * What a fortnight costs.
 *
 * The kitchen sells a fortnight, not a meal: one meal a day is $75 for the two
 * weeks, two meals a day is $140. That is what is quoted at the gate, so that
 * is the number the software bills — a flat price per *plan*, looked up by how
 * many meals that person takes.
 *
 * But not everybody eats the same week. Some are served Monday to Friday, not
 * Monday to Saturday. And some take an extra plate on a particular day — two
 * meals every day, three on Saturdays. Charging both of those the same $140
 * would be wrong in opposite directions.
 *
 * So the plan price buys a **standard fortnight** — a set number of serving
 * days at the plan's meals per day — and anything above or below it is priced
 * per meal:
 *
 *     total = plan price + (meals actually served − standard meals) × rate
 *
 * The rate is the plan price spread over the standard fortnight: $75 over 12
 * serving days is $6.25 a meal. One number, set in Ajustes, applied in both
 * directions — a day dropped is worth the same as a day added.
 *
 * A period is a whole number of weeks, so it contains the same weekdays every
 * time round and this total is the same for a given person in every period. It
 * can be quoted before the period starts, which is what lets somebody pay
 * ahead at the counter.
 *
 * The whole list lives in one document (`config/pricing`) because there is one
 * price list for the business. Editing it never touches an invoice already
 * issued: a bill carries the numbers it was issued with.
 */

/** The price list the business started with, used until Ajustes changes it. */
export const DEFAULT_TIERS = [
  { mealsPerDay: 1, price: 75 },
  { mealsPerDay: 2, price: 140 },
];

/** Monday to Saturday, twice: the week the plan prices assume. */
export const DEFAULT_REFERENCE_DAYS = 12;

/** $75 ÷ 12 serving days. What one meal more or less is worth. */
export const DEFAULT_EXTRA_MEAL_PRICE = 6.25;

/**
 * The plan prices are quoted per fortnight — two weeks of the standard week.
 *
 * A client who pays every week eats half of that and pays half of it. Nothing
 * else changes: the rate for a meal above or below the standard is the same
 * $6.25 either way, because a plate costs what a plate costs.
 */
const WEEKS_PER_FORTNIGHT = 2;

export const DEFAULT_PRICING = {
  tiers: DEFAULT_TIERS,
  referenceDays: DEFAULT_REFERENCE_DAYS,
  extraMealPrice: DEFAULT_EXTRA_MEAL_PRICE,
};

/* --- The price list --------------------------------------------------------- */

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

/** A whole price list, with anything missing filled in from the defaults. */
export function normalizePricing(pricing) {
  const tiers = normalizeTiers(pricing?.tiers);
  return {
    tiers: tiers.length ? tiers : [...DEFAULT_TIERS],
    referenceDays: Math.round(Number(pricing?.referenceDays)) || DEFAULT_REFERENCE_DAYS,
    extraMealPrice: Number(pricing?.extraMealPrice) > 0
      ? round2(pricing.extraMealPrice)
      : DEFAULT_EXTRA_MEAL_PRICE,
  };
}

/** The plan for somebody taking `mealsPerDay` meals, or null if none exists. */
export const tierFor = (pricing, mealsPerDay) =>
  (pricing?.tiers || []).find(
    (tier) => tier.mealsPerDay === Math.round(Number(mealsPerDay) || 0)) || null;

/**
 * The plan's flat price, or 0 when no plan covers them.
 *
 * Zero is deliberate rather than a guess: a missing plan is a decision the
 * kitchen has to make, and the screens say so instead of inventing a price.
 */
export const priceFor = (pricing, mealsPerDay) => tierFor(pricing, mealsPerDay)?.price || 0;

/** "2 comidas/día" */
export const tierLabel = (tier) => (tier
  ? `${tier.mealsPerDay} ${tier.mealsPerDay === 1 ? 'comida' : 'comidas'}/día`
  : 'Sin plan');

/**
 * What the plan price implies one meal is worth, before any override.
 *
 * Shown in Ajustes as the arithmetic it is — $75 ÷ 12 días = $6.25 — so the
 * number is never a mystery to whoever has to defend it at the gate.
 */
export function derivedMealPrice(pricing) {
  const first = (pricing?.tiers || [])[0];
  const days = Number(pricing?.referenceDays) || DEFAULT_REFERENCE_DAYS;
  if (!first || !days) return 0;
  return round2(first.price / (days * first.mealsPerDay));
}

/* --- One person's week ------------------------------------------------------ */

/**
 * Extras keyed by weekday, cleaned: whole numbers above zero.
 *
 * Pass `deliveryDays` to also drop extras on days nobody is served — an extra
 * plate on a day with no delivery is not an extra, it is a leftover from
 * turning that day off. Omit it when the caller does not know the week: a
 * partial update that only touches the extras must not silently discard them
 * for want of a day list it was never given.
 */
export function normalizeExtras(extras, deliveryDays) {
  const serves = deliveryDays ? new Set(deliveryDays.map(Number)) : null;
  const out = {};
  for (const [key, value] of Object.entries(extras || {})) {
    const weekday = Number(key);
    const count = Math.round(Number(value) || 0);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (count <= 0) continue;
    if (serves && !serves.has(weekday)) continue;
    out[String(weekday)] = count;
  }
  return out;
}

/** How many meals this person gets on a given weekday. Zero if not served. */
export function mealsOn(client, weekday) {
  const serves = (client?.deliveryDays || []).map(Number).includes(Number(weekday));
  if (!serves) return 0;
  const base = Number(client?.mealsPerDay) || 0;
  return base + (Number(client?.extras?.[String(weekday)]) || 0);
}

/** Every extra this person takes, as `[{ weekday, count }]`, Monday first. */
export function extrasOf(client) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order
    .map((weekday) => ({ weekday, count: Number(client?.extras?.[String(weekday)]) || 0 }))
    .filter((entry) => entry.count > 0 && mealsOn(client, entry.weekday) > 0);
}

/* --- What a fortnight comes to ---------------------------------------------- */

/**
 * The full charge for one of this person's periods, and the arithmetic behind it.
 *
 * Returned in parts rather than as one number because the parts are what a
 * client asks about — "why is mine $152.50 and his is $140?" — and a bill that
 * cannot answer that is a bill somebody argues with.
 */
export function periodCharge(client, pricing) {
  const list = normalizePricing(pricing);
  const plan = tierFor(list, client?.mealsPerDay);
  const perDay = Number(client?.mealsPerDay) || 0;

  // 1 for somebody who pays weekly, 2 for a fortnight. Everything the plan
  // price assumes is a fortnight's worth, so this is what scales it.
  const weeks = weeksOf(client);
  const share = weeks / WEEKS_PER_FORTNIGHT;

  const days = ((client?.deliveryDays || []).length) * weeks;
  const extras = extrasOf(client);
  const extraMeals = extras.reduce((sum, entry) => sum + entry.count, 0) * weeks;
  const meals = days * perDay + extraMeals;

  const standardMeals = list.referenceDays * perDay * share;
  const base = round2((plan?.price || 0) * share);
  const difference = meals - standardMeals;
  const adjustment = plan ? round2(difference * list.extraMealPrice) : 0;

  return {
    plan,
    priced: !!plan,
    // Carried out with the numbers so anything that renders a breakdown can
    // say "quincena" or "semana" without having to ask the client again.
    payEvery: weeks * 7,
    base,
    days,
    perDay,
    weeks,
    meals,
    extras,
    extraMeals,
    standardMeals,
    standardDays: list.referenceDays * share,
    mealPrice: list.extraMealPrice,
    difference,
    adjustment,
    // Never below zero. The adjustment is subtractive for a short week, and a
    // week short enough — one serving day on a two-meal plan — drives the plan
    // price negative. A bill for less than nothing is the kitchen owing the
    // client money for food it cooked, which is not a thing that can be true.
    amount: plan ? Math.max(0, round2(base + adjustment)) : 0,
  };
}

/** Just the number, for the many places that only need the number. */
export const chargeFor = (client, pricing) => periodCharge(client, pricing).amount;

/**
 * How many weeks one of this person's periods lasts.
 *
 * Read here rather than imported from billing.js, which imports this file —
 * one small duplicated rule beats a cycle between the two modules everything
 * else depends on.
 */
const weeksOf = (client) => (Number(client?.payEvery) === 7 ? 1 : WEEKS_PER_FORTNIGHT);

export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
