// Alerts engine: turns logged data (manual or wearable) plus the plan into
// plain-language alerts. Runs every time new data is saved.

import { LIMITS, round } from './limits.js';
import { addDays, daysBetween } from './dates.js';
import { planDayFor } from './rules.js';

const LEVEL_ORDER = { red: 0, yellow: 1, info: 2 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Resting HR baseline: the athlete's own value, else the average of the first 7 days logged. */
export function restingHrBaseline(entries, profile) {
  if (isNum(profile?.baselineRestingHr)) return { value: profile.baselineRestingHr, source: 'manual', count: 0 };
  const withHr = (entries || []).filter((e) => isNum(e.restingHr));
  if (withHr.length < LIMITS.baselineDays) return { value: null, source: 'building', count: withHr.length };
  const first = withHr.slice(0, LIMITS.baselineDays);
  const avg = first.reduce((s, e) => s + e.restingHr, 0) / first.length;
  return { value: round(avg, 1), source: 'auto', count: first.length };
}

/** Sleep performance %: the wearable's value, else an estimate from hours slept vs an 8-hour need. */
export function sleepPerformanceOf(entry) {
  if (isNum(entry?.sleepPerformance)) return { value: entry.sleepPerformance, estimated: false };
  if (isNum(entry?.sleepHours)) {
    return { value: Math.min(100, Math.round((entry.sleepHours / LIMITS.defaultSleepNeedHours) * 100)), estimated: true };
  }
  return { value: null, estimated: false };
}

/** First date of the plan's water phase, or null if the plan has none. */
export function waterPhaseStart(plan) {
  if (!plan?.startDate || !Number.isInteger(plan.fatDays) || plan.strategy === 'none') return null;
  return addDays(plan.startDate, plan.fatDays);
}

/**
 * Evaluates all alerts.
 * input: { entries (sorted or not), plan (from generatePlan, optional), profile, today ('YYYY-MM-DD') }
 * returns { alerts (sorted red > yellow > info), latest, baseline, metrics }
 */
export function evaluateAlerts({ entries = [], plan = null, profile = null, today } = {}) {
  const sorted = [...entries]
    .filter((e) => e && typeof e.date === 'string' && (!today || e.date <= today))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const alerts = [];
  const latest = sorted.at(-1) ?? null;
  const baseline = restingHrBaseline(sorted, profile);
  const metrics = { ratePctPerWeek: null, waterCutSoFarPct: null, restingHrDelta: null, sleepPerformance: null };

  // Goal verdict from the rules engine.
  const status = plan?.assessment?.status;
  if (status === 'red') {
    alerts.push({
      id: 'goal_red', level: 'red', kind: 'goal',
      title: 'Goal is not safe in this timeframe',
      message: `Your plan is capped at ${plan.assessment.safestWeightLb} lb, the safest weight you can reach by weigh-in.`,
    });
  } else if (status === 'yellow') {
    alerts.push({
      id: 'goal_yellow', level: 'yellow', kind: 'goal',
      title: 'Tight cut: faster than 1% a week',
      message: plan.assessment.reason,
    });
  }

  // Big water cut + short recovery window.
  if (plan && plan.recoveryWindow === 'under1h' && plan.waterLossPct > LIMITS.shortWindowWaterWarnPct) {
    alerts.push({
      id: 'short_window', level: 'yellow', kind: 'recovery',
      title: 'Big water cut, short recovery window',
      message: `Your plan cuts about ${round(plan.waterLossPct)}% as water, and you'll have under 1 hour after weigh-in. You won't fully rehydrate in time. A smaller water cut will help you wrestle better.`,
    });
  }

  if (!latest) {
    alerts.push({ id: 'no_data', level: 'info', kind: 'data', title: 'No data yet', message: 'Log your weight (and sleep and resting heart rate if you have them) to get alerts.' });
    return { alerts: sortAlerts(alerts), latest, baseline, metrics };
  }

  // Wearable red flags on the latest day.
  if (isNum(latest.recoveryScore) && latest.recoveryScore < LIMITS.recoveryRedBelow) {
    alerts.push({
      id: 'recovery_low', level: 'red', kind: 'wearable',
      title: `Recovery is low (${Math.round(latest.recoveryScore)}%)`,
      message: `Below ${LIMITS.recoveryRedBelow}% means your body hasn't bounced back. Today's plan was eased: no extra cardio, more sleep.`,
    });
  }
  if (isNum(latest.restingHr) && isNum(baseline.value)) {
    const delta = latest.restingHr - baseline.value;
    metrics.restingHrDelta = round(delta, 1);
    if (delta >= LIMITS.restingHrRedAboveBaselineBpm) {
      alerts.push({
        id: 'rhr_high', level: 'red', kind: 'wearable',
        title: `Resting heart rate is up ${Math.round(delta)} bpm`,
        message: `${Math.round(latest.restingHr)} bpm vs your baseline of ${Math.round(baseline.value)}. This often means dehydration, stress or poor recovery. Ease off today and keep fluids on plan.`,
      });
    }
  }
  const sleep = sleepPerformanceOf(latest);
  metrics.sleepPerformance = sleep.value;
  if (isNum(sleep.value) && sleep.value < LIMITS.sleepPerformanceRedBelow) {
    alerts.push({
      id: 'sleep_low', level: 'red', kind: 'wearable',
      title: `Poor sleep (${sleep.value}%${sleep.estimated ? ', estimated' : ''})`,
      message: 'Short sleep makes cutting harder and hurts performance. Aim for 9+ hours tonight; skip extra cardio today.',
    });
  }
  if (baseline.value === null && isNum(latest.restingHr)) {
    alerts.push({
      id: 'baseline_building', level: 'info', kind: 'baseline',
      title: `Building your heart-rate baseline (${baseline.count}/${LIMITS.baselineDays} days)`,
      message: 'Keep logging resting heart rate, or enter your usual resting HR in your profile.',
    });
  }

  // Rate of loss (fat phase) or water-cut cap (water phase).
  const waterStart = waterPhaseStart(plan);
  const inWaterPhase = waterStart !== null && latest.date >= waterStart;
  if (inWaterPhase) {
    const before = sorted.filter((e) => e.date < waterStart && isNum(e.weightLb)).at(-1);
    if (before && isNum(latest.weightLb)) {
      const pct = ((before.weightLb - latest.weightLb) / before.weightLb) * 100;
      metrics.waterCutSoFarPct = round(pct, 1);
      if (pct > LIMITS.waterCutMaxPct) {
        alerts.push({
          id: 'water_cap', level: 'red', kind: 'rate',
          title: `Water cut is over the ${LIMITS.waterCutMaxPct}% cap`,
          message: `You've dropped ${round(pct)}% since your water cut started. Stop cutting, drink an electrolyte drink, and talk to your athletic trainer.`,
        });
      }
    }
  } else if (isNum(latest.weightLb)) {
    const windowStart = addDays(latest.date, -LIMITS.rateWindowDays);
    const inWindow = sorted.filter((e) => e.date >= windowStart && isNum(e.weightLb));
    const earliest = inWindow[0];
    const span = earliest ? daysBetween(earliest.date, latest.date) : 0;
    if (span >= LIMITS.rateMinSpanDays) {
      const rate = ((earliest.weightLb - latest.weightLb) / earliest.weightLb) * 100 * (7 / span);
      metrics.ratePctPerWeek = round(rate, 2);
      if (rate > LIMITS.fatLossRedPctPerWeek) {
        alerts.push({
          id: 'rate_red', level: 'red', kind: 'rate',
          title: `Losing ${round(rate)}% a week`,
          message: "Over 3% a week is mostly water, not fat. You're likely dehydrating too early. Eat and drink to plan and slow down.",
        });
      } else if (rate > LIMITS.fatLossYellowPctPerWeek) {
        alerts.push({
          id: 'rate_yellow', level: 'yellow', kind: 'rate',
          title: `Losing ${round(rate)}% a week`,
          message: "That's faster than the 1% a week guideline. You may be cutting wrong (losing water or muscle). Make sure you're eating your targets.",
        });
      }
    }
  }

  // Pace against the plan line.
  const day = planDayFor(plan, latest.date);
  if (day && isNum(latest.weightLb) && isNum(plan.startWeightLb)) {
    const diff = latest.weightLb - day.targetWeightLb;
    const tol = (plan.startWeightLb * LIMITS.paceTolerancePct) / 100;
    if (diff > tol) {
      alerts.push({
        id: 'pace_behind', level: 'yellow', kind: 'pace',
        title: `${round(diff)} lb above today's target`,
        message: "Don't try to catch up with extra sweating or skipping water. Stick to the plan; if you stay behind, raise your goal or give yourself more time.",
      });
    } else if (diff < -tol) {
      alerts.push({
        id: 'pace_ahead', level: 'info', kind: 'pace',
        title: `${round(-diff)} lb ahead of plan`,
        message: "No need to go faster. Eat your targets so you stay strong; you don't want to dehydrate early.",
      });
    }
  }

  return { alerts: sortAlerts(alerts), latest, baseline, metrics };
}

/** Sorts alerts red, then yellow, then info (stable). */
export function sortAlerts(alerts) {
  return alerts
    .map((a, i) => ({ a, i }))
    .sort((x, y) => LEVEL_ORDER[x.a.level] - LEVEL_ORDER[y.a.level] || x.i - y.i)
    .map(({ a }) => a);
}

/** True if any wearable red flag is present (used to ease the plan). */
export function hasWearableRedFlag(alerts) {
  return (alerts || []).some((a) => a.level === 'red' && a.kind === 'wearable');
}
