// MakeWeight rules engine: cut type, safety budget, goal check and the
// day-by-day plan. Pure functions only (no DOM, no network), so every
// safety rule is unit-tested and the AI coach can never override them.

import { LIMITS, TRAINING_FACTORS, lbToKg, mlToOz, round } from './limits.js';
import { addDays, daysBetween, isDateStr } from './dates.js';

const EPS = 1e-9;

export const CUT_TYPES = Object.freeze({
  short: {
    label: 'Short-term cut',
    range: '7 days or less',
    focus: 'Mostly water: lower salt and carbs, low fiber, extra light cardio in normal clothes, and water loading only if there are 4+ days.',
  },
  mid: {
    label: 'Mid-term cut',
    range: '8 to 35 days',
    focus: 'Fat loss first, then a small, capped water cut in the final days.',
  },
  long: {
    label: 'Long-term cut',
    range: 'more than 35 days',
    focus: 'Fat loss and conditioning. Little to no water cut.',
  },
});

/** Picks the cut type from the number of days until weigh-in. */
export function classifyCut(daysOut) {
  if (!Number.isFinite(daysOut) || daysOut < 1) {
    throw new RangeError('daysOut must be a number of at least 1');
  }
  if (daysOut <= LIMITS.shortTermMaxDays) return 'short';
  if (daysOut <= LIMITS.midTermMaxDays) return 'mid';
  return 'long';
}

/** Splits the days before weigh-in into a fat-loss phase and a final water phase. */
export function phaseSplit(daysOut) {
  const waterDays = Math.min(daysOut, LIMITS.waterPhaseDays);
  return { fatDays: daysOut - waterDays, waterDays };
}

/**
 * The most an athlete can safely lose in the time available:
 * about 1% of body weight per week from fat (fat-loss phase only)
 * plus up to 5% from water in the final days.
 */
export function safeBudget(weightLb, daysOut) {
  const { fatDays, waterDays } = phaseSplit(daysOut);
  const fatWeeks = fatDays / 7;
  const fatPct = LIMITS.fatLossTargetPctPerWeek * fatWeeks;
  const waterPct = LIMITS.waterCutMaxPct;
  const totalPct = fatPct + waterPct;
  return {
    fatDays,
    waterDays,
    fatWeeks,
    fatPct,
    waterPct,
    totalPct,
    totalLb: (weightLb * totalPct) / 100,
    safestWeightLb: weightLb * (1 - totalPct / 100),
  };
}

/** Highest starting weight that can safely reach the target in daysOut days. */
export function maxStartWeight(targetLb, daysOut) {
  const { totalPct } = safeBudget(targetLb, daysOut); // totalPct doesn't depend on weight
  return targetLb / (1 - totalPct / 100);
}

/** Days needed to reach the target at the 1%/week pace plus a 5% water cut. */
export function minDaysNeeded(currentLb, targetLb) {
  const totalPct = ((currentLb - targetLb) / currentLb) * 100;
  const fatPctNeeded = Math.max(0, totalPct - LIMITS.waterCutMaxPct);
  if (fatPctNeeded <= EPS) return 1;
  const fatDays = Math.ceil((fatPctNeeded / LIMITS.fatLossTargetPctPerWeek) * 7 - EPS);
  return fatDays + LIMITS.waterPhaseDays;
}

/** Returns a list of plain-language input errors (empty when the input is valid). */
export function validateGoalInputs(currentLb, targetLb, daysOut) {
  const errors = [];
  const inRange = (w) => Number.isFinite(w) && w >= LIMITS.minWeightLb && w <= LIMITS.maxWeightLb;
  if (!inRange(currentLb)) {
    errors.push(`Current weight must be between ${LIMITS.minWeightLb} and ${LIMITS.maxWeightLb} lb.`);
  }
  if (!inRange(targetLb)) {
    errors.push(`Goal weight must be between ${LIMITS.minWeightLb} and ${LIMITS.maxWeightLb} lb.`);
  }
  if (inRange(currentLb) && inRange(targetLb) && targetLb >= currentLb) {
    errors.push('Goal weight must be below your current weight. Already on weight? Just keep logging to maintain.');
  }
  if (!Number.isInteger(daysOut) || daysOut < 1) {
    errors.push('Weigh-in must be at least 1 day away.');
  } else if (daysOut > LIMITS.maxDaysOut) {
    errors.push(`Weigh-in must be within ${LIMITS.maxDaysOut} days.`);
  }
  return errors;
}

const ceil1 = (x) => Math.ceil(x * 10 - EPS) / 10;

/**
 * Checks a goal against the universal safety limits.
 * status: 'green' (within limits), 'yellow' (reachable only by losing fat faster
 * than 1%/week, up to 3%/week), 'red' (not safe in this timeframe), or 'invalid'.
 */
export function assessGoal(currentLb, targetLb, daysOut) {
  const errors = validateGoalInputs(currentLb, targetLb, daysOut);
  if (errors.length) return { status: 'invalid', errors };

  const cutType = classifyCut(daysOut);
  const budget = safeBudget(currentLb, daysOut);
  const totalLossLb = currentLb - targetLb;
  const totalLossPct = (totalLossLb / currentLb) * 100;
  const safestWeightLb = ceil1(budget.safestWeightLb);

  // Fat first (up to the 1%/week budget), water covers the rest.
  let fatPct = Math.min(totalLossPct, budget.fatPct);
  let waterPct = totalLossPct - fatPct;
  let status = 'green';
  let requiredFatRate = budget.fatWeeks > 0 ? fatPct / budget.fatWeeks : 0;
  let planTargetLb = targetLb;

  if (waterPct > LIMITS.waterCutMaxPct + EPS) {
    const neededFatPct = totalLossPct - LIMITS.waterCutMaxPct;
    const rate = budget.fatWeeks > 0 ? neededFatPct / budget.fatWeeks : Infinity;
    requiredFatRate = rate;
    if (rate <= LIMITS.fatLossRedPctPerWeek + EPS) {
      status = 'yellow';
      fatPct = neededFatPct;
      waterPct = LIMITS.waterCutMaxPct;
    } else {
      status = 'red';
      fatPct = budget.fatPct;
      waterPct = LIMITS.waterCutMaxPct;
      planTargetLb = safestWeightLb;
    }
  }

  const fatLossLb = (currentLb * fatPct) / 100;
  const waterLossLb = (currentLb * waterPct) / 100;
  const daysNeeded = minDaysNeeded(currentLb, targetLb);
  const rateTxt = Number.isFinite(requiredFatRate) ? `${round(requiredFatRate, 1)}%/week` : 'no time for fat loss';

  let reason;
  if (status === 'green') {
    if (waterPct < 0.05) {
      reason = `Doable within MakeWeight's limits: all ${round(totalLossLb)} lb from fat loss at about ${rateTxt}. No water cut needed.`;
    } else if (fatLossLb < 0.05) {
      reason = `Doable within MakeWeight's limits: ${round(waterLossLb)} lb of water (${round(waterPct)}% of body weight) in the final days, under the 5% cap.`;
    } else {
      reason = `Doable within MakeWeight's limits: about ${round(fatLossLb)} lb from fat (${rateTxt}) and ${round(waterLossLb)} lb of water (${round(waterPct)}% of body weight) in the final days.`;
    }
  } else if (status === 'yellow') {
    reason =
      `Reachable only by losing fat at about ${rateTxt}, faster than the 1%/week guideline. ` +
      `That pace usually means losing water or muscle, not fat. You may be cutting wrong. ` +
      `Safer options: a goal of ${safestWeightLb} lb, or start at least ${daysNeeded} days before weigh-in.`;
  } else {
    reason =
      budget.fatWeeks > 0
        ? `Not safe in this timeframe: it would take fat loss of about ${rateTxt} on top of a full 5% water cut. That is mostly water, not fat. `
        : `Not safe in this timeframe: with only ${daysOut} day${daysOut === 1 ? '' : 's'}, the most you can safely cut is about 5% of body weight (${round(budget.totalLb)} lb). `;
    reason += `The safest weight you can reach by weigh-in is ${safestWeightLb} lb. Consider a higher goal weight or starting at least ${daysNeeded} days out.`;
  }

  return {
    status,
    cutType,
    daysOut,
    currentLb,
    targetLb,
    planTargetLb,
    totalLossLb,
    totalLossPct,
    fatPct,
    waterPct,
    fatLossLb,
    waterLossLb,
    fatDays: budget.fatDays,
    waterDays: budget.waterDays,
    requiredFatRatePctPerWeek: requiredFatRate,
    budgetPct: budget.totalPct,
    safestWeightLb,
    minDaysNeeded: daysNeeded,
    reason,
  };
}

/** Mifflin-St Jeor resting energy estimate (kcal/day). */
export function mifflinStJeor({ sex, age, heightIn }, weightKg) {
  const cm = heightIn * 2.54;
  const base = 10 * weightKg + 6.25 * cm - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}

/** Returns a list of profile errors (empty when valid). */
export function validateProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') return ['Profile is missing.'];
  if (!['male', 'female'].includes(profile.sex)) errors.push('Choose male or female for the calorie estimate.');
  if (!Number.isFinite(profile.age) || profile.age < 12 || profile.age > 70) errors.push('Age must be between 12 and 70.');
  if (!Number.isFinite(profile.heightIn) || profile.heightIn < 48 || profile.heightIn > 90) {
    errors.push('Height must be between 4 ft and 7 ft 6 in.');
  }
  if (!Object.hasOwn(TRAINING_FACTORS, profile.trainingLoad)) errors.push('Choose a training load.');
  return errors;
}

/** Splits calories into protein/fat/carbs, never going below the ISSN floors. */
export function macrosFor(calories, weightKg) {
  const protein = LIMITS.macroTargetGPerKg.protein * weightKg;
  const fat = LIMITS.macroTargetGPerKg.fat * weightKg;
  const minCarbs = LIMITS.macroMinGPerKg.carbs * weightKg;
  let carbs = (calories - protein * 4 - fat * 9) / 4;
  let floorApplied = false;
  if (carbs < minCarbs) {
    carbs = minCarbs;
    floorApplied = true;
  }
  const kcal = protein * 4 + fat * 9 + carbs * 4;
  return {
    calories: Math.round(kcal / 10) * 10,
    proteinG: Math.round(protein),
    fatG: Math.round(fat),
    carbsG: Math.round(carbs),
    floorApplied,
  };
}

function pickWaterStrategy(waterPct, waterDays) {
  if (waterPct < 0.05) return 'none';
  if (waterPct <= LIMITS.lightWaterCutMaxPct + EPS) return 'light';
  if (waterDays >= LIMITS.waterPhaseDays && waterPct >= LIMITS.waterLoadingMinPct) return 'loading';
  return 'taper';
}

export const STRATEGY_INFO = Object.freeze({
  none: 'No water cut needed. The final days hold weight steady so you stay strong.',
  light: 'Light finish: low fiber, lower salt and carbs in the final days. Normal fluids.',
  loading: 'Water loading: drink extra water for 3 days, then cut back the day before weigh-in. Low fiber, lower carbs.',
  taper: 'Fluid taper: normal fluids, then cut back the day before weigh-in. Low fiber, lower salt and carbs.',
});

function cardioFor(cutType, phase, isLastWaterDay) {
  if (phase === 'weighin') return 'After you refuel, a normal warm-up. Follow the Recovery tab.';
  if (phase === 'taper') return 'Normal practice, keep it sharp. No extra cardio needed.';
  if (phase === 'water') {
    return isLastWaterDay
      ? 'Light movement only (15 to 20 min). Save your energy.'
      : '20 to 30 min of extra light cardio in normal practice clothes. No rubber suits or saunas.';
  }
  return cutType === 'long'
    ? 'Conditioning: 30 to 45 min steady cardio 3 to 4 times a week, plus 2 to 3 strength sessions to keep muscle.'
    : '20 to 30 min of easy cardio after practice (conversation pace).';
}

/**
 * Builds the day-by-day plan.
 * profile: { sex, age, heightIn, trainingLoad }
 * goal: { startWeightLb, targetWeightLb, startDate, weighInDate, recoveryWindow }
 */
export function generatePlan(profile, goal) {
  const profileErrors = validateProfile(profile);
  if (!goal || !isDateStr(goal.startDate) || !isDateStr(goal.weighInDate)) {
    return { assessment: { status: 'invalid', errors: [...profileErrors, 'Pick a valid weigh-in date.'] }, days: [] };
  }
  const daysOut = daysBetween(goal.startDate, goal.weighInDate);
  const assessment = assessGoal(goal.startWeightLb, goal.targetWeightLb, daysOut);
  if (profileErrors.length || assessment.status === 'invalid') {
    return {
      assessment: { status: 'invalid', errors: [...profileErrors, ...(assessment.errors || [])] },
      days: [],
    };
  }

  const { cutType, fatDays, waterDays, fatLossLb, waterLossLb, waterPct, planTargetLb } = assessment;
  const startWeightLb = goal.startWeightLb;
  const fatEndLb = startWeightLb - fatLossLb;
  const strategy = pickWaterStrategy(waterPct, waterDays);
  const factor = TRAINING_FACTORS[profile.trainingLoad];
  const fatWeeks = fatDays / 7;
  const weeklyFatLb = fatWeeks > 0 ? fatLossLb / fatWeeks : 0;
  const dailyDeficit = (weeklyFatLb * LIMITS.kcalPerLbFat) / 7;

  const days = [];
  for (let i = 0; i <= daysOut; i++) {
    const date = addDays(goal.startDate, i);
    let phase;
    if (i === daysOut) phase = 'weighin';
    else if (i < fatDays) phase = 'fat';
    else phase = strategy === 'none' ? 'taper' : 'water';

    // Expected morning weight on this date.
    let targetWeightLb;
    if (i <= fatDays) {
      targetWeightLb = fatDays > 0 ? startWeightLb - fatLossLb * (i / fatDays) : startWeightLb;
    } else {
      const progress = (i - fatDays) / waterDays;
      targetWeightLb = fatEndLb - waterLossLb * progress * progress; // most water comes off at the end
    }
    if (i === daysOut) targetWeightLb = planTargetLb;

    const weightKg = lbToKg(targetWeightLb);
    const tdee = mifflinStJeor(profile, weightKg) * factor;
    const waterDayNum = i - fatDays + 1; // 1..waterDays during the water phase
    const isLastWaterDay = phase === 'water' && i === daysOut - 1;

    const day = {
      date,
      dayIndex: i,
      phase,
      targetWeightLb: round(targetWeightLb, 1),
      cardio: cardioFor(cutType, phase, isLastWaterDay),
      sodium: 'normal',
      fiber: 'normal',
      waterLoading: false,
      notes: [],
      sources: ['mw'],
    };

    if (phase === 'weighin') {
      day.nutrition = null;
      day.fluidsMl = null;
      day.fluidNote = 'Small sips only until weigh-in. Then follow your Recovery plan.';
      day.notes.push('Weigh-in day. Right after you make weight, open the Recovery tab.');
      days.push(day);
      continue;
    }

    // Nutrition.
    let kcalTarget;
    if (phase === 'fat') {
      kcalTarget = tdee - dailyDeficit;
      day.sources.push('issn');
    } else if (phase === 'taper') {
      kcalTarget = tdee; // hold weight
    } else {
      kcalTarget = 0; // water phase: carbs drop to the 3 g/kg floor (glycogen depletion)
      day.notes.push('Carbs drop to the safe minimum (3 g per kg) to lower stored water.');
      day.sources.push('issn');
    }
    day.nutrition = macrosFor(kcalTarget, weightKg);
    if (phase === 'fat' && day.nutrition.floorApplied) {
      day.notes.push('Calories are held at the safe minimum. MakeWeight never plans below the ISSN floors.');
    }

    // Fluids, salt, fiber.
    let mlPerKg = LIMITS.normalFluidMlPerKg;
    if (phase === 'water') {
      day.fiber = 'low';
      if (strategy === 'loading') {
        if (waterDayNum <= 3) {
          mlPerKg = LIMITS.waterLoadingMlPerKg;
          day.waterLoading = true;
          day.sodium = 'normal';
          day.notes.push("Water loading day. Spread it across the whole day and don't cut salt while drinking this much.");
        } else {
          mlPerKg = LIMITS.restrictionDayMlPerKg;
          day.sodium = 'lower';
          day.notes.push('Cut-back day: sip your fluids through the day. Never zero fluids.');
        }
        day.sources.push('reale');
      } else if (strategy === 'taper') {
        day.sodium = 'lower';
        if (isLastWaterDay) {
          mlPerKg = LIMITS.restrictionDayMlPerKg;
          day.notes.push('Cut-back day: sip your fluids through the day. Never zero fluids.');
        }
        day.sources.push('reale');
      } else {
        day.sodium = 'lower'; // light
      }
      day.notes.push(`Low fiber (under ${LIMITS.lowFiberGPerDay} g): white rice, white bread, lean protein. Skip beans, veggies, whole grains for now.`);
    }
    day.fluidsMl = Math.round((mlPerKg * weightKg) / 10) * 10;
    day.fluidsOz = Math.round(mlToOz(day.fluidsMl));
    day.fluidNote = phase === 'fat' || phase === 'taper' ? 'At least this much, plus what you sweat out at practice.' : '';
    days.push(day);
  }

  const warnings = [];
  if (strategy === 'loading') warnings.push('water_loading');

  return {
    assessment,
    cutType,
    strategy,
    startDate: goal.startDate,
    weighInDate: goal.weighInDate,
    daysOut,
    startWeightLb,
    planTargetLb,
    fatLossLb,
    waterLossLb,
    waterLossPct: waterPct,
    fatDays,
    waterDays,
    recoveryWindow: goal.recoveryWindow,
    days,
    warnings,
  };
}

/** Finds the plan day for a date, or null. */
export function planDayFor(plan, date) {
  return plan?.days?.find((d) => d.date === date) ?? null;
}

/**
 * Eases a day's plan when the wearable shows red flags (low recovery,
 * high resting HR, poor sleep). Returns a new object; the original is untouched.
 */
export function adjustDayForRedFlags(day, alerts) {
  if (!day) return day;
  const red = (alerts || []).filter((a) => a.level === 'red' && a.kind === 'wearable');
  if (!red.length || day.phase === 'weighin') return { ...day, adjusted: false, adjustments: [] };
  const adjusted = { ...day, nutrition: day.nutrition ? { ...day.nutrition } : null, notes: [...day.notes] };
  const adjustments = [
    'Recovery day: skip the extra cardio. Keep practice easy if your coach or trainer okays it.',
    'Aim for 9+ hours of sleep tonight.',
  ];
  adjusted.cardio = 'Recovery day: no extra cardio. Light stretching or a 15-minute walk only.';
  if (day.phase === 'fat' && day.nutrition) {
    // Ease today's deficit so the cut slows down while the body recovers.
    adjustments.push('Eat a little more today (about 250 kcal extra, mostly carbs) so your body can recover.');
    adjusted.nutrition.calories += 250;
    adjusted.nutrition.carbsG += Math.round(250 / 4);
  }
  if (day.waterLoading) {
    adjustments.push('Keep your water loading going today, it helps recovery too. Keep salt normal.');
  }
  return { ...adjusted, adjusted: true, adjustments };
}
