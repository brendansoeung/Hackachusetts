// Post-weigh-in recovery planner: 3 time windows plus between-match fueling.
// Amounts scale with body weight and how much was cut. Carbs are shown as
// food examples first, with grams as secondary detail.

import { LIMITS, lbToKg, mlToOz, round } from './limits.js';

export const WINDOWS = Object.freeze({
  under1h: { label: 'Under 1 hour', hint: 'Same-day weigh-ins, wrestling first (most high school meets).' },
  '1to6h': { label: '1 to 6 hours', hint: 'Most tournaments.' },
  '12plus': { label: 'Overnight (12+ hours)', hint: 'College duals, MMA, boxing, judo.' },
});

// Approximate carb counts (check labels; brands vary).
export const FOODS = Object.freeze([
  { id: 'banana', name: '1 medium banana', carbsG: 27, kind: 'fast' },
  { id: 'pretzels', name: 'a handful of pretzels (about 1 oz)', carbsG: 22, kind: 'fast' },
  { id: 'ricecake', name: '1 rice cake with a drizzle of honey', carbsG: 24, kind: 'fast' },
  { id: 'fruitsnacks', name: '1 pouch of fruit snacks', carbsG: 19, kind: 'fast' },
  { id: 'gel', name: '1 sports gel', carbsG: 22, kind: 'fast' },
  { id: 'toastjam', name: '1 slice of white bread with jam', carbsG: 26, kind: 'fast' },
  { id: 'graham', name: '2 graham cracker sheets', carbsG: 22, kind: 'fast' },
  { id: 'bagel', name: '1 plain bagel with honey', carbsG: 65, kind: 'meal' },
  { id: 'rice', name: '1 cup of white rice', carbsG: 45, kind: 'meal' },
  { id: 'pasta', name: '1 cup of pasta', carbsG: 43, kind: 'meal' },
  { id: 'potato', name: '1 medium potato, no skin', carbsG: 37, kind: 'meal' },
  { id: 'pancakes', name: '2 pancakes with syrup', carbsG: 55, kind: 'meal' },
  { id: 'juice', name: '8 oz of juice', carbsG: 26, kind: 'meal' },
]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const roundTo = (v, step) => Math.round(v / step) * step;

/** Builds up to 3 food combos that land near the carb target (within about 10 g). */
export function foodOptions(targetG, kind = 'fast', maxOptions = 3) {
  const pool = FOODS.filter((f) => f.kind === kind || (kind === 'meal' && f.kind === 'fast'));
  const options = [];
  const seen = new Set();
  for (const first of pool) {
    if (first.carbsG > targetG + 10) continue;
    const picks = [first];
    let total = first.carbsG;
    for (const f of pool) {
      if (total >= targetG - 10) break;
      if (picks.includes(f) || total + f.carbsG > targetG + 10) continue;
      picks.push(f);
      total += f.carbsG;
    }
    const key = picks.map((p) => p.id).sort().join('+');
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ items: picks.map((p) => p.name), carbsG: total });
    if (options.length >= maxOptions) break;
  }
  if (!options.length) {
    const smallest = [...pool].sort((a, b) => a.carbsG - b.carbsG)[0];
    options.push({ items: [smallest.name], carbsG: smallest.carbsG });
  }
  return options;
}

const fluid = (ml) => {
  const r = roundTo(ml, 10);
  return { ml: r, oz: Math.round(mlToOz(r)) };
};

export function validateRecoveryInput({ window, weightLb, cutLb }) {
  const errors = [];
  if (!Object.hasOwn(WINDOWS, window)) errors.push('Pick how long you have between weigh-in and competing.');
  if (!Number.isFinite(weightLb) || weightLb < LIMITS.minWeightLb || weightLb > LIMITS.maxWeightLb) {
    errors.push(`Weigh-in weight must be between ${LIMITS.minWeightLb} and ${LIMITS.maxWeightLb} lb.`);
  }
  if (!Number.isFinite(cutLb) || cutLb < 0 || cutLb > 40) errors.push('Pounds cut must be between 0 and 40.');
  return errors;
}

/**
 * Builds the recovery plan.
 * input: { window: 'under1h'|'1to6h'|'12plus', weightLb (at weigh-in), cutLb (lost in the final days),
 *          heavyDepletion?: boolean, tournament?: boolean }
 */
export function buildRecoveryPlan(input) {
  const errors = validateRecoveryInput(input);
  if (errors.length) return { errors };
  const { window, weightLb, cutLb } = input;
  const weightKg = lbToKg(weightLb);
  const cutKg = lbToKg(cutLb);
  const cutPct = cutLb > 0 ? (cutLb / (weightLb + cutLb)) * 100 : 0;
  const replaceMl = Math.max(cutKg * 1000, LIMITS.under1hFluidMinMl); // about 1 L per kg lost
  const warnings = [];
  const steps = [];
  let fluidTotal;

  if (window === 'under1h') {
    fluidTotal = fluid(clamp(replaceMl, LIMITS.under1hFluidMinMl, LIMITS.under1hFluidMaxMl));
    const carbsG = Math.round(clamp(weightKg * 0.6, 20, LIMITS.maxCarbsGPerHour));
    const first = fluid(fluidTotal.ml * 0.4);
    const rest = fluid(fluidTotal.ml - first.ml);
    steps.push(
      {
        time: '0 to 5 min',
        title: 'Start sipping an electrolyte drink',
        detail: `Sip about ${first.oz} oz (${first.ml} mL) right after you step off the scale. Use an oral rehydration solution (ORS) or an electrolyte drink with real sodium. Plain water alone won't replace the salt you lost, and low salt is what leads to cramps.`,
        fluid: first,
        sources: ['issn'],
      },
      {
        time: '5 to 15 min',
        title: 'Small, fast carb snack',
        detail: 'Pick one option. Low fat, low fiber, easy on the stomach.',
        foods: foodOptions(carbsG, 'fast'),
        carbsG,
        sources: ['issn', 'mw'],
      },
      {
        time: '15 to 35 min',
        title: 'Keep sipping, slowly',
        detail: `Finish about ${rest.oz} more oz (${rest.ml} mL) in a few gulps every 5 to 10 minutes. Don't chug.`,
        fluid: rest,
        sources: ['issn', 'nata'],
      },
      {
        time: '35 min until you wrestle',
        title: 'Stop eating and warm up',
        detail: 'No more food. Small sips only if you are thirsty. Get a real warm-up in so you are loose and sharp.',
        sources: ['mw'],
      },
    );
    warnings.push(
      "Don't overeat. You may wrestle first, and a full stomach feels heavy and can make you sick on the mat.",
      'Skip greasy or high-fiber food (burgers, fries, nuts, salads, protein bars) until after you compete.',
    );
    if (cutPct > LIMITS.shortWindowWaterWarnPct) {
      warnings.push(`You cut about ${round(cutPct)}% of your body weight. You won't fully rehydrate in under an hour. Next time, plan a smaller water cut.`);
    }
  } else if (window === '1to6h') {
    fluidTotal = fluid(Math.max(replaceMl, 500));
    const hour1 = fluid(Math.min(fluidTotal.ml, LIMITS.orsLPerHourMin * 1000));
    const later = fluid(Math.max(0, fluidTotal.ml - hour1.ml));
    const snackG = Math.round(clamp(weightKg * 0.8, 30, LIMITS.maxCarbsGPerHour));
    const mealG = LIMITS.maxCarbsGPerHour;
    steps.push(
      {
        time: 'Hour 1, right away',
        title: 'Electrolyte drink first',
        detail: `Drink about ${hour1.oz} oz (${hour1.ml} mL) of an ORS or salty electrolyte drink over the first hour. Research range: 1 to 1.5 L per hour, but go at a pace your stomach likes.`,
        fluid: hour1,
        sources: ['issn'],
      },
      {
        time: 'Hour 1, after 15 min',
        title: 'Fast carbs',
        detail: 'Pick one option. Up to 60 g of carbs per hour is what the gut can handle.',
        foods: foodOptions(snackG, 'fast'),
        carbsG: snackG,
        sources: ['issn'],
      },
      {
        time: 'Hour 2',
        title: 'Small low-fiber meal',
        detail: 'White carbs plus a little lean protein (like a few slices of turkey). Keep fat and fiber low.',
        foods: foodOptions(mealG, 'meal'),
        carbsG: mealG,
        sources: ['issn'],
      },
      {
        time: 'Hour 3 until 1 hour before',
        title: 'Keep sipping, snack if hungry',
        detail: later.ml > 0
          ? `Sip about ${later.oz} more oz (${later.ml} mL) spread out. A small snack is fine if you're hungry.`
          : "Sip to thirst. A small snack is fine if you're hungry.",
        fluid: later.ml > 0 ? later : null,
        sources: ['issn', 'nata'],
      },
      {
        time: 'Last hour',
        title: 'No solid food, warm up',
        detail: 'Small sips only. Warm up fully.',
        sources: ['mw'],
      },
    );
    warnings.push("Don't chug or stuff yourself. Spread fluids and food out so your stomach stays settled.");
  } else {
    const heavy = typeof input.heavyDepletion === 'boolean' ? input.heavyDepletion : cutPct > 4;
    const range = heavy ? LIMITS.carbsGPerKgHeavy : LIMITS.carbsGPerKgModest;
    const carbsLo = roundTo(range[0] * weightKg, 5);
    const carbsHi = roundTo(range[1] * weightKg, 5);
    fluidTotal = fluid(Math.max(replaceMl, 1000));
    const hour1 = fluid(Math.min(fluidTotal.ml, LIMITS.orsLPerHourMin * 1000));
    const later = fluid(Math.max(0, fluidTotal.ml - hour1.ml));
    steps.push(
      {
        time: 'First hour',
        title: 'Electrolyte drink first',
        detail: `About ${hour1.oz} oz (${hour1.ml} mL) of an ORS or salty electrolyte drink over the first hour.`,
        fluid: hour1,
        sources: ['issn'],
      },
      {
        time: 'Hours 1 to 3',
        title: 'Fast carbs, a little at a time',
        detail: 'Up to 60 g of carbs per hour. Pick snacks like these every hour.',
        foods: foodOptions(LIMITS.maxCarbsGPerHour, 'fast'),
        carbsG: LIMITS.maxCarbsGPerHour,
        sources: ['issn'],
      },
      {
        time: 'Evening',
        title: 'Normal low-fiber meals',
        detail: `Across today and competition morning, aim for about ${carbsLo} to ${carbsHi} g of carbs total (${range[0]} to ${range[1]} g per kg${heavy ? ', because you cut carbs hard' : ''}). Think rice, pasta, potatoes without skin, bagels, plus lean protein. Mix and match:`,
        foods: foodOptions(LIMITS.maxCarbsGPerHour * 2, 'meal'),
        carbsG: carbsHi,
        sources: ['issn'],
      },
      {
        time: 'All evening',
        title: 'Keep sipping',
        detail: `About ${later.oz} more oz (${later.ml} mL) with meals, until your pee is pale yellow. Don't force down huge amounts.`,
        fluid: later,
        sources: ['issn', 'nata'],
      },
      {
        time: 'Night',
        title: 'Sleep',
        detail: 'A full night of sleep is part of recovery. Screens off early.',
        sources: ['mw'],
      },
      {
        time: 'Competition morning',
        title: 'Familiar breakfast',
        detail: 'A normal, low-fiber breakfast you have eaten before, about 3 to 4 hours before you compete.',
        sources: ['mw'],
      },
    );
    warnings.push("Don't binge. Spread carbs over several meals; one giant meal causes stomach trouble.");
  }

  const betweenMatches = input.tournament
    ? [
        { when: 'Right after each match', what: 'Sip 6 to 10 oz of an electrolyte drink.', sources: ['issn', 'mw'] },
        { when: '30 to 60 min until your next match', what: 'A small fast-carb snack:', foods: foodOptions(25, 'fast', 2), sources: ['issn', 'mw'] },
        { when: 'More than 2 hours until your next match', what: 'A small low-fiber meal (like half a turkey sandwich on white bread), finished at least 1 hour before you wrestle.', sources: ['issn', 'mw'] },
        { when: 'All day', what: "Don't stuff yourself between matches. Stay warm and off your feet when you can.", sources: ['mw'] },
      ]
    : [];

  return {
    window,
    label: WINDOWS[window].label,
    weightLb,
    cutLb,
    cutPct: round(cutPct, 1),
    fluidTotal,
    steps,
    warnings,
    betweenMatches,
  };
}
