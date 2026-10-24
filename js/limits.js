// MakeWeight safety limits. ONE universal set for every athlete.
// Every safety number in the app comes from here, so changing a rule means
// changing it in exactly one place. The AI coach is told these limits too,
// but it never calculates targets itself.
//
// Sources (see data/sources.js for full citations):
//   issn   = ISSN position stand on combat-sport weight cutting (Ricci et al., 2025)
//   reale  = Water loading study in combat athletes (Reale et al., 2018)
//   mw     = MakeWeight guideline set by the founder (former state-placing wrestler)

export const LIMITS = Object.freeze({
  // Cut types, based on days from plan start to weigh-in.
  shortTermMaxDays: 7, // 7 days or less = short-term (mw)
  midTermMaxDays: 35, // 8-35 days = mid-term, more than 35 = long-term (mw)
  maxDaysOut: 365,

  // Fat loss, in % of body weight per week (mw, user-set).
  fatLossTargetPctPerWeek: 1, // planned pace
  fatLossYellowPctPerWeek: 1, // above this: "you may be cutting wrong"
  fatLossRedPctPerWeek: 3, // above this: "this is mostly water, not fat"

  // Water cut (acute loss in the final days), % of body weight.
  waterCutMaxPct: 5, // hard cap (mw; within ISSN "suitable" ranges of 4.4-6.7%)
  waterPhaseDays: 4, // final days before weigh-in (matches the 4-day Reale protocol)
  waterLoadingMinPct: 2, // only use water loading when the water portion is at least this
  lightWaterCutMaxPct: 2, // low fiber + lower salt + lower carbs covers about 1-2% (issn)
  shortWindowWaterWarnPct: 3, // water cut above this + <1 h recovery = yellow alert

  // Wearable red flags (WHOOP-style metrics).
  recoveryRedBelow: 33, // recovery_score %
  restingHrRedAboveBaselineBpm: 7, // resting HR this far above baseline
  sleepPerformanceRedBelow: 70, // sleep_performance_percentage
  baselineDays: 7, // first N days with resting HR form the baseline
  defaultSleepNeedHours: 8, // used to estimate sleep performance from manual sleep hours

  // Pace and rate-of-loss checks.
  paceTolerancePct: 1, // % of start weight off the plan line before we alert
  rateWindowDays: 7,
  rateMinSpanDays: 5, // need at least this many days of data to judge weekly rate

  // Input sanity checks.
  minWeightLb: 60,
  maxWeightLb: 450,

  // Nutrition floors and targets, g per kg of body weight per day (issn).
  macroMinGPerKg: Object.freeze({ carbs: 3, protein: 1.2, fat: 0.5 }),
  macroTargetGPerKg: Object.freeze({ protein: 2.0, fat: 0.8 }),
  kcalPerLbFat: 3500,
  lowFiberGPerDay: 10,

  // Daily fluids, mL per kg (reale).
  normalFluidMlPerKg: 40,
  waterLoadingMlPerKg: 100,
  restrictionDayMlPerKg: 15,

  // Post-weigh-in recovery (issn: ORS 1-1.5 L/h first, carbs <= 60 g/h).
  orsLPerHourMin: 1.0,
  orsLPerHourMax: 1.5,
  maxCarbsGPerHour: 60,
  under1hFluidMinMl: 300,
  under1hFluidMaxMl: 750, // MakeWeight cap so the stomach can handle it before wrestling
  carbsGPerKgModest: Object.freeze([4, 7]), // 12+ h window after a modest cut (issn)
  carbsGPerKgHeavy: Object.freeze([8, 12]), // 12+ h window after heavy glycogen depletion (issn)
});

export const TRAINING_FACTORS = Object.freeze({
  moderate: 1.55, // practice most days
  hard: 1.725, // daily hard practice (typical in-season wrestler)
  very_hard: 1.9, // two-a-days
});

export const KG_PER_LB = 0.45359237;
export const ML_PER_OZ = 29.5735;

export const lbToKg = (lb) => lb * KG_PER_LB;
export const kgToLb = (kg) => kg / KG_PER_LB;
export const mlToOz = (ml) => ml / ML_PER_OZ;

/** Rounds to a fixed number of decimals (default 1). */
export function round(value, decimals = 1) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
