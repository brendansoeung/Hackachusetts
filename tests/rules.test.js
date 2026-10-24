import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCut, safeBudget, assessGoal, maxStartWeight, minDaysNeeded, validateGoalInputs } from '../js/rules.js';

test('cut type boundaries: 7/8 and 35/36 days', () => {
  assert.equal(classifyCut(1), 'short');
  assert.equal(classifyCut(7), 'short');
  assert.equal(classifyCut(8), 'mid');
  assert.equal(classifyCut(35), 'mid');
  assert.equal(classifyCut(36), 'long');
  assert.throws(() => classifyCut(0));
  assert.throws(() => classifyCut(Number.NaN));
});

test('safe budget: fat loss only counts the days before the 4-day water phase', () => {
  const b = safeBudget(100, 3);
  assert.equal(b.fatDays, 0);
  assert.equal(b.waterDays, 3);
  assert.equal(b.totalPct, 5);
  const b2 = safeBudget(100, 11);
  assert.equal(b2.fatDays, 7);
  assert.ok(Math.abs(b2.fatPct - 1) < 1e-9);
  assert.ok(Math.abs(b2.totalPct - 6) < 1e-9);
});

test('106-lb wrestler with 3 days can start from about 111.5 lb at most', () => {
  const max = maxStartWeight(106, 3);
  assert.ok(Math.abs(max - 111.58) < 0.01, `max start was ${max}`);
  assert.equal(assessGoal(111.5, 106, 3).status, 'green');
  const tooMuch = assessGoal(112, 106, 3);
  assert.equal(tooMuch.status, 'red');
  assert.equal(tooMuch.safestWeightLb, 106.4);
  assert.match(tooMuch.reason, /Not safe/);
});

test("founder's old 115 -> 106 in 3 days is red, but passes with 4+ weeks", () => {
  assert.equal(assessGoal(115, 106, 3).status, 'red');
  assert.equal(assessGoal(115, 106, 32).status, 'green');
});

test('215+ wrestler with 12 weeks is green and needs no water cut', () => {
  const r = assessGoal(235, 215, 84);
  assert.equal(r.status, 'green');
  assert.equal(r.cutType, 'long');
  assert.ok(r.waterPct < 0.01);
  assert.ok(r.requiredFatRatePctPerWeek <= 1);
});

test('demo scenario 113 -> 106 in 10 days is yellow (tight)', () => {
  // 6.19% total: 5% water cap leaves ~1.2% fat over 6 fat-loss days = ~1.39%/week.
  const r = assessGoal(113, 106, 10);
  assert.equal(r.status, 'yellow');
  assert.equal(r.cutType, 'mid');
  assert.ok(Math.abs(r.requiredFatRatePctPerWeek - 1.394) < 0.01);
  assert.ok(Math.abs(r.waterPct - 5) < 1e-9);
  assert.equal(r.safestWeightLb, 106.4);
  assert.equal(r.minDaysNeeded, 13);
  assert.equal(r.planTargetLb, 106);
});

test('needing more than 3%/week of fat loss is red', () => {
  // 10% in 14 days: 5% water + 5% fat over 10 fat days = 3.5%/week.
  const r = assessGoal(150, 135, 14);
  assert.equal(r.status, 'red');
  assert.ok(r.requiredFatRatePctPerWeek > 3);
  assert.ok(r.planTargetLb > 135);
});

test('water need over 5% with no fat-loss days is red', () => {
  const r = assessGoal(120, 113, 2);
  assert.equal(r.status, 'red');
  assert.equal(r.safestWeightLb, 114);
});

test('just under the 3%/week line is yellow, just over is red', () => {
  // 21 days: 17 fat days = 2.4286 weeks; 3%/week -> 7.2857% fat + 5% water = 12.2857% total.
  const start = 200;
  const okTarget = start * (1 - 0.1225);
  const badTarget = start * (1 - 0.1235);
  assert.equal(assessGoal(start, okTarget, 21).status, 'yellow');
  assert.equal(assessGoal(start, badTarget, 21).status, 'red');
});

test('minDaysNeeded returns the earliest safe start', () => {
  assert.equal(minDaysNeeded(110, 106), 1); // under 5%: water alone covers it
  const days = minDaysNeeded(113, 106);
  assert.notEqual(assessGoal(113, 106, days).status, 'red');
  assert.equal(assessGoal(113, 106, days).status, 'green');
  assert.notEqual(assessGoal(113, 106, days - 1).status, 'green');
});

test('the plain-language reason matches the kind of cut', () => {
  assert.match(assessGoal(111.5, 106, 3).reason, /lb of water \(4\.9% of body weight\) in the final days, under the 5% cap/);
  assert.doesNotMatch(assessGoal(111.5, 106, 3).reason, /0 lb from fat/);
  assert.match(assessGoal(235, 215, 84).reason, /all 20 lb from fat loss/);
  assert.match(assessGoal(113, 109, 20).reason, /lb from fat .* and .* lb of water/);
});

test('invalid inputs are rejected with friendly messages', () => {
  assert.equal(assessGoal(106, 106, 10).status, 'invalid');
  assert.equal(assessGoal(100, 110, 10).status, 'invalid');
  assert.equal(assessGoal(113, 106, 0).status, 'invalid');
  assert.equal(assessGoal(113, 106, 2.5).status, 'invalid');
  assert.equal(assessGoal(30, 25, 10).status, 'invalid');
  assert.equal(assessGoal(Number.NaN, 106, 10).status, 'invalid');
  assert.equal(assessGoal(113, 106, 400).status, 'invalid');
  assert.ok(validateGoalInputs(100, 110, 10).some((e) => /below your current weight/.test(e)));
});
