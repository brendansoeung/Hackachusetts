import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecoveryPlan, foodOptions, FOODS } from '../js/recovery.js';
import { LIMITS, lbToKg } from '../js/limits.js';

const totalFluid = (plan) => plan.steps.reduce((s, st) => s + (st.fluid?.ml || 0), 0);

test('under 1 hour: 4 steps, capped fluid, small snack, overeating warning', () => {
  const p = buildRecoveryPlan({ window: 'under1h', weightLb: 106, cutLb: 4 });
  assert.equal(p.steps.length, 4);
  assert.ok(p.fluidTotal.ml >= LIMITS.under1hFluidMinMl && p.fluidTotal.ml <= LIMITS.under1hFluidMaxMl);
  assert.ok(Math.abs(totalFluid(p) - p.fluidTotal.ml) <= 10);
  const snack = p.steps.find((s) => s.foods);
  assert.ok(snack.carbsG <= LIMITS.maxCarbsGPerHour);
  assert.ok(snack.foods.length >= 1);
  assert.ok(p.warnings.some((w) => /overeat/i.test(w)));
  assert.match(p.steps.at(-1).title, /Stop eating/);
});

test('under 1 hour fluid stays capped even after a big cut', () => {
  const p = buildRecoveryPlan({ window: 'under1h', weightLb: 220, cutLb: 12 });
  assert.equal(p.fluidTotal.ml, LIMITS.under1hFluidMaxMl);
  assert.ok(p.warnings.some((w) => /won't fully rehydrate/.test(w)));
});

test('amounts scale with body weight and pounds cut', () => {
  const light = buildRecoveryPlan({ window: 'under1h', weightLb: 106, cutLb: 1 });
  const heavy = buildRecoveryPlan({ window: 'under1h', weightLb: 170, cutLb: 1 });
  const snackG = (p) => p.steps.find((s) => s.foods).carbsG;
  assert.ok(snackG(heavy) > snackG(light));
  const small = buildRecoveryPlan({ window: '1to6h', weightLb: 150, cutLb: 1 });
  const big = buildRecoveryPlan({ window: '1to6h', weightLb: 150, cutLb: 5 });
  assert.ok(big.fluidTotal.ml > small.fluidTotal.ml);
});

test('1 to 6 hours: first-hour fluid within the ISSN range, carbs <= 60 g per hour', () => {
  const p = buildRecoveryPlan({ window: '1to6h', weightLb: 150, cutLb: 5 });
  assert.ok(p.steps[0].fluid.ml <= LIMITS.orsLPerHourMax * 1000);
  for (const s of p.steps.filter((x) => x.carbsG)) assert.ok(s.carbsG <= LIMITS.maxCarbsGPerHour);
  assert.ok(p.steps.every((s) => s.sources.length > 0));
});

test('12+ hours: 4-7 g/kg carbs after a modest cut, 8-12 g/kg after heavy depletion', () => {
  const kg = lbToKg(150);
  const modest = buildRecoveryPlan({ window: '12plus', weightLb: 150, cutLb: 4, heavyDepletion: false });
  const heavy = buildRecoveryPlan({ window: '12plus', weightLb: 150, cutLb: 4, heavyDepletion: true });
  const meal = (p) => p.steps.find((s) => s.title === 'Normal low-fiber meals');
  assert.ok(Math.abs(meal(modest).carbsG - 7 * kg) <= 5);
  assert.match(meal(modest).detail, /4 to 7 g per kg/);
  assert.match(meal(heavy).detail, /8 to 12 g per kg/);
  assert.ok(modest.steps.some((s) => s.title === 'Sleep'));
});

test('every window always shows food examples', () => {
  for (const window of ['under1h', '1to6h', '12plus']) {
    const p = buildRecoveryPlan({ window, weightLb: 130, cutLb: 3 });
    assert.ok(p.steps.some((s) => Array.isArray(s.foods) && s.foods.length > 0), window);
  }
});

test('tournament mode adds a between-match plan', () => {
  const p = buildRecoveryPlan({ window: 'under1h', weightLb: 106, cutLb: 3, tournament: true });
  assert.ok(p.betweenMatches.length >= 3);
  assert.equal(buildRecoveryPlan({ window: 'under1h', weightLb: 106, cutLb: 3 }).betweenMatches.length, 0);
});

test('food options land near the target and use real foods', () => {
  for (const target of [20, 30, 45, 60]) {
    for (const opt of foodOptions(target, 'fast')) {
      assert.ok(Math.abs(opt.carbsG - target) <= 12, `target ${target} got ${opt.carbsG}`);
      assert.ok(opt.items.every((name) => FOODS.some((f) => f.name === name)));
    }
  }
});

test('invalid recovery inputs are rejected', () => {
  assert.ok(buildRecoveryPlan({ window: 'soon', weightLb: 106, cutLb: 3 }).errors.length);
  assert.ok(buildRecoveryPlan({ window: 'under1h', weightLb: 20, cutLb: 3 }).errors.length);
  assert.ok(buildRecoveryPlan({ window: 'under1h', weightLb: 106, cutLb: -1 }).errors.length);
});
