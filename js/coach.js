// Browser side of the AI coach: builds the numbers-only context, decides
// when the daily briefing needs refreshing, calls /api/coach, and writes a
// rules-based briefing when the AI is unavailable.

import { daysBetween } from './dates.js';
import { round } from './limits.js';
import { MAX_HISTORY, MAX_QUESTION_CHARS } from './coach-shared.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Builds the context sent to the coach. Only numbers and app-generated labels;
 * the profile (age, sex, height) and any free text are never included.
 */
export function buildCoachContext({ state, plan, alertsResult, today, todayPlan }) {
  const ctx = {};
  const a = plan?.assessment;
  if (plan && a && a.status !== 'invalid') {
    Object.assign(ctx, {
      cutType: plan.cutType,
      status: a.status,
      strategy: plan.strategy,
      recoveryWindow: plan.recoveryWindow,
      daysToWeighIn: daysBetween(today, plan.weighInDate),
      dayOfPlan: Math.max(0, daysBetween(plan.startDate, today)),
      startWeightLb: plan.startWeightLb,
      targetWeightLb: a.targetLb,
      planTargetLb: plan.planTargetLb,
      safestWeightLb: a.safestWeightLb,
      waterCutPct: round(plan.waterLossPct, 1),
      requiredFatRatePctPerWeek: isNum(a.requiredFatRatePctPerWeek) ? round(a.requiredFatRatePctPerWeek, 2) : undefined,
    });
  }
  const latest = alertsResult?.latest;
  if (latest && isNum(latest.weightLb)) ctx.currentWeightLb = latest.weightLb;
  if (isNum(alertsResult?.baseline?.value)) ctx.baselineRestingHr = alertsResult.baseline.value;

  if (todayPlan) {
    const n = todayPlan.nutrition;
    ctx.today = {
      phase: todayPlan.phase,
      targetWeightLb: todayPlan.targetWeightLb,
      ...(n ? { calories: n.calories, proteinG: n.proteinG, carbsG: n.carbsG, fatG: n.fatG } : {}),
      ...(isNum(todayPlan.fluidsOz) ? { fluidsOz: todayPlan.fluidsOz } : {}),
      sodium: todayPlan.sodium,
      fiber: todayPlan.fiber,
      cardio: todayPlan.cardio,
      waterLoading: Boolean(todayPlan.waterLoading),
      adjusted: Boolean(todayPlan.adjusted),
    };
  }

  const entries = (state?.entries || []).filter((e) => e.date <= today).slice(-7);
  ctx.recent = entries.map((e) => {
    const r = { daysAgo: daysBetween(e.date, today) };
    for (const k of ['weightLb', 'recoveryScore', 'restingHr', 'hrv', 'sleepPerformance', 'sleepHours', 'strain']) {
      if (isNum(e[k])) r[k] = e[k];
    }
    return r;
  });
  ctx.alerts = (alertsResult?.alerts || []).slice(0, 12).map((x) => ({ level: x.level, title: x.title }));

  // Drop undefined values so the payload stays clean.
  for (const k of Object.keys(ctx)) if (ctx[k] === undefined) delete ctx[k];
  return ctx;
}

/** The briefing refreshes when there's new data or a new day; just opening the app reuses the cache. */
export function shouldRefreshBriefing(briefing, dataVersion, today) {
  if (!briefing || typeof briefing.text !== 'string') return true;
  if (briefing.date !== today) return true;
  return briefing.dataVersion !== dataVersion;
}

/** A plain briefing built from the rules engine, used when the AI is unavailable. */
export function rulesBriefing(ctx) {
  const lines = [];
  if (isNum(ctx.daysToWeighIn) && ctx.daysToWeighIn >= 0) {
    const d = ctx.daysToWeighIn;
    const where = isNum(ctx.currentWeightLb) && isNum(ctx.today?.targetWeightLb)
      ? `You're at ${ctx.currentWeightLb} lb; today's target is ${ctx.today.targetWeightLb} lb. `
      : '';
    lines.push(`${where}${d === 0 ? 'Weigh-in is today.' : `${d} day${d === 1 ? '' : 's'} to weigh-in.`}`);
  } else {
    lines.push('Set up your cut on the Plan tab to get daily targets.');
  }
  const red = (ctx.alerts || []).filter((a) => a.level === 'red');
  const yellow = (ctx.alerts || []).filter((a) => a.level === 'yellow');
  if (red.length) lines.push(`Heads up: ${red.map((a) => a.title.toLowerCase()).join('; ')}.${ctx.today?.adjusted ? " Today's plan was eased: no extra cardio, and get to bed early." : ''}`);
  else if (yellow.length) lines.push(`Watch: ${yellow[0].title.toLowerCase()}.`);
  const t = ctx.today;
  if (t && t.phase !== 'weighin') {
    const food = isNum(t.calories) ? `about ${t.calories} kcal (${t.proteinG} g protein, ${t.carbsG} g carbs)` : '';
    const fluids = isNum(t.fluidsOz) ? `${t.fluidsOz} oz of fluids${t.waterLoading ? ' (water loading, keep salt normal)' : ''}` : '';
    lines.push(`Today: ${[food, fluids].filter(Boolean).join(', ')}. ${t.cardio}`);
  } else if (t?.phase === 'weighin') {
    lines.push('After you make weight, open the Recovery tab and follow it step by step.');
  }
  lines.push('Stay on plan. You have got this.');
  return lines.join(' ');
}

export class CoachError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Calls the server. Resolves to the reply text or throws CoachError. */
export async function askCoach({ mode, context, question, history = [] }, fetchImpl = globalThis.fetch) {
  const body = { mode, context };
  if (mode === 'chat') {
    body.question = String(question || '').slice(0, MAX_QUESTION_CHARS);
    body.history = history.slice(-MAX_HISTORY).map((m) => ({ role: m.role, text: String(m.text).slice(0, 800) }));
  }
  let res;
  try {
    res = await fetchImpl('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CoachError("Can't reach the coach (are you offline?).", 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || typeof data?.text !== 'string') {
    throw new CoachError(data?.error || 'The coach is unavailable right now.', res.status);
  }
  return data.text;
}
