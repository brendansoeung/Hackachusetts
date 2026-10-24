import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan, adjustDayForRedFlags, macrosFor, planDayFor } from '../js/rules.js';
import { LIMITS, lbToKg } from '../js/limits.js';
import { addDays } from '../js/dates.js';

const profile = { sex: 'male', age: 17, heightIn: 64, trainingLoad: 'hard' };
const goal = (startWeightLb, targetWeightLb, days, recoveryWindow = 'under1h') => ({
  startWeightLb,
  targetWeightLb,
  startDate: '2026-10-17',
  weighInDate: addDays('2026-10-17', days),
  recoveryWindow,
});

test('demo plan (113 -> 106, 10 days): phases, water loading and weigh-in day', () => {
  const plan = generatePlan(profile, goal(113, 106, 10));
  assert.equal(plan.assessment.status, 'yellow');
  assert.equal(plan.cutType, 'mid');
  assert.equal(plan.strategy, 'loading');
  assert.equal(plan.days.length, 11);
  assert.deepEqual(plan.days.map((d) => d.phase), ['fat', 'fat', 'fat', 'fat', 'fat', 'fat', 'water', 'water', 'water', 'water', 'weighin']);
  assert.deepEqual(plan.days.map((d) => d.waterLoading), [false, false, false, false, false, false, true, true, true, false, false]);
  assert.equal(plan.days.at(-1).targetWeightLb, 106);
  assert.ok(plan.warnings.includes('water_loading'));
});

test('water loading uses 100 mL/kg for 3 days, then 15 mL/kg the day before weigh-in', () => {
  const plan = generatePlan(profile, goal(113, 106, 10));
  for (const d of plan.days.filter((x) => x.waterLoading)) {
    const expected = LIMITS.waterLoadingMlPerKg * lbToKg(d.targetWeightLb);
    assert.ok(Math.abs(d.fluidsMl - expected) <= 10, `day ${d.dayIndex}: ${d.fluidsMl} vs ${expected}`);
    assert.equal(d.sodium, 'normal'); // never cut salt while drinking this much
    assert.ok(d.sources.includes('reale'));
  }
  const cutBack = plan.days[9];
  assert.ok(Math.abs(cutBack.fluidsMl - LIMITS.restrictionDayMlPerKg * lbToKg(cutBack.targetWeightLb)) <= 10);
  assert.ok(cutBack.fluidsMl > 0, 'fluids never go to zero');
  assert.equal(cutBack.sodium, 'lower');
});

test('daily targets add up to the goal and never go up', () => {
  const plan = generatePlan(profile, goal(113, 106, 10));
  const weights = plan.days.map((d) => d.targetWeightLb);
  assert.equal(weights[0], 113);
  for (let i = 1; i < weights.length; i++) assert.ok(weights[i] <= weights[i - 1], `day ${i} went up`);
  assert.ok(Math.abs(plan.fatLossLb + plan.waterLossLb - (113 - 106)) < 1e-9);
});

test('water portion never exceeds the 5% cap', () => {
  for (const [s, t, d] of [[113, 106, 10], [120, 113, 2], [150, 135, 14], [160, 150, 6], [235, 215, 84]]) {
    const plan = generatePlan(profile, goal(s, t, d));
    assert.ok(plan.waterLossPct <= LIMITS.waterCutMaxPct + 1e-9, `${s}->${t} in ${d}`);
    assert.ok(plan.waterLossLb / s <= LIMITS.waterCutMaxPct / 100 + 1e-9);
  }
});

test('nutrition never drops below the ISSN macro floors', () => {
  for (const [s, t, d] of [[113, 106, 10], [180, 165, 40], [130, 124, 5]]) {
    const plan = generatePlan({ ...profile, trainingLoad: 'moderate' }, goal(s, t, d));
    for (const day of plan.days.filter((x) => x.nutrition)) {
      const kg = lbToKg(day.targetWeightLb);
      assert.ok(day.nutrition.carbsG >= LIMITS.macroMinGPerKg.carbs * kg - 1, `carbs day ${day.dayIndex}`);
      assert.ok(day.nutrition.proteinG >= LIMITS.macroMinGPerKg.protein * kg - 1, `protein day ${day.dayIndex}`);
      assert.ok(day.nutrition.fatG >= LIMITS.macroMinGPerKg.fat * kg - 1, `fat day ${day.dayIndex}`);
    }
  }
  const m = macrosFor(0, 50);
  assert.equal(m.floorApplied, true);
  assert.equal(m.carbsG, 150);
});

test('water loading only appears with 4+ water days and a real water cut', () => {
  const short = generatePlan(profile, goal(111, 106, 3)); // 3 days: no room for the 4-day protocol
  assert.equal(short.cutType, 'short');
  assert.equal(short.strategy, 'taper');
  assert.ok(short.days.every((d) => !d.waterLoading));
  assert.ok(!short.warnings.includes('water_loading'));
  assert.equal(short.days.at(-2).fluidsMl, Math.round((LIMITS.restrictionDayMlPerKg * lbToKg(short.days.at(-2).targetWeightLb)) / 10) * 10);

  const light = generatePlan(profile, goal(113, 111, 10)); // small cut: fat + light finish
  assert.ok(['none', 'light'].includes(light.strategy));
  assert.ok(light.days.every((d) => !d.waterLoading));
});

test('the warning flag is present whenever water loading is', () => {
  for (const [s, t, d] of [[113, 106, 10], [130, 123, 12], [111, 106, 3], [235, 215, 84]]) {
    const plan = generatePlan(profile, goal(s, t, d));
    const loads = plan.days.some((x) => x.waterLoading);
    assert.equal(plan.warnings.includes('water_loading'), loads, `${s}->${t} in ${d}`);
  }
});

test('long-term plan focuses on fat loss and conditioning, no water cut', () => {
  const plan = generatePlan(profile, goal(235, 215, 84, '12plus'));
  assert.equal(plan.cutType, 'long');
  assert.equal(plan.strategy, 'none');
  assert.ok(plan.days.filter((d) => d.phase === 'fat').every((d) => /Conditioning/.test(d.cardio)));
  assert.ok(plan.days.every((d) => d.phase !== 'water'));
});

test('a red goal plans to the safest weight instead of the unsafe target', () => {
  const plan = generatePlan(profile, goal(120, 113, 2));
  assert.equal(plan.assessment.status, 'red');
  assert.equal(plan.days.at(-1).targetWeightLb, 114);
});

test('invalid profile or dates return errors and no days', () => {
  const bad = generatePlan({ ...profile, age: 5 }, goal(113, 106, 10));
  assert.equal(bad.assessment.status, 'invalid');
  assert.equal(bad.days.length, 0);
  const badDate = generatePlan(profile, { ...goal(113, 106, 10), weighInDate: 'soon' });
  assert.equal(badDate.assessment.status, 'invalid');
});

test('red wearable flags ease the day; other alerts do not', () => {
  const plan = generatePlan(profile, goal(113, 106, 10));
  const fatDay = planDayFor(plan, '2026-10-19');
  const eased = adjustDayForRedFlags(fatDay, [{ level: 'red', kind: 'wearable', id: 'recovery_low' }]);
  assert.equal(eased.adjusted, true);
  assert.match(eased.cardio, /no extra cardio/i);
  assert.equal(eased.nutrition.calories, fatDay.nutrition.calories + 250);
  assert.notEqual(fatDay.cardio, eased.cardio, 'original day is not mutated');

  const same = adjustDayForRedFlags(fatDay, [{ level: 'yellow', kind: 'pace' }]);
  assert.equal(same.adjusted, false);
});
