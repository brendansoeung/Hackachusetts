import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlerts, restingHrBaseline, sleepPerformanceOf, sortAlerts, hasWearableRedFlag } from '../js/alerts.js';
import { generatePlan } from '../js/rules.js';
import { addDays } from '../js/dates.js';

const START = '2026-10-01';
const ids = (r) => r.alerts.map((a) => a.id);

/** 7 baseline days at resting HR 50, then the given latest entry. */
function withBaseline(latest) {
  const entries = [];
  for (let i = 0; i < 7; i++) entries.push({ date: addDays(START, i), weightLb: 150, restingHr: 50 });
  entries.push({ date: addDays(START, 7), weightLb: 150, ...latest });
  return entries;
}

test('recovery below 33% is red, 33% is not', () => {
  assert.ok(ids(evaluateAlerts({ entries: withBaseline({ recoveryScore: 32 }) })).includes('recovery_low'));
  assert.ok(!ids(evaluateAlerts({ entries: withBaseline({ recoveryScore: 33 }) })).includes('recovery_low'));
});

test('resting HR 7+ bpm above baseline is red, +6 is not', () => {
  const hi = evaluateAlerts({ entries: withBaseline({ restingHr: 57 }) });
  assert.ok(ids(hi).includes('rhr_high'));
  assert.equal(hi.metrics.restingHrDelta, 7);
  assert.ok(!ids(evaluateAlerts({ entries: withBaseline({ restingHr: 56 }) })).includes('rhr_high'));
});

test('a manual baseline overrides the automatic one', () => {
  const entries = withBaseline({ restingHr: 57 });
  const r = evaluateAlerts({ entries, profile: { baselineRestingHr: 55 } });
  assert.ok(!ids(r).includes('rhr_high'));
  assert.equal(restingHrBaseline(entries, { baselineRestingHr: 55 }).source, 'manual');
});

test('sleep performance under 70% is red; manual sleep hours are estimated', () => {
  assert.ok(ids(evaluateAlerts({ entries: withBaseline({ sleepPerformance: 69 }) })).includes('sleep_low'));
  assert.ok(!ids(evaluateAlerts({ entries: withBaseline({ sleepPerformance: 70 }) })).includes('sleep_low'));
  assert.deepEqual(sleepPerformanceOf({ sleepHours: 5 }), { value: 63, estimated: true });
  assert.ok(ids(evaluateAlerts({ entries: withBaseline({ sleepHours: 5 }) })).includes('sleep_low'));
  assert.ok(!ids(evaluateAlerts({ entries: withBaseline({ sleepHours: 6 }) })).includes('sleep_low'));
});

test('no baseline yet: no heart-rate alert, an info message instead', () => {
  const entries = [0, 1, 2].map((i) => ({ date: addDays(START, i), weightLb: 150, restingHr: i === 2 ? 70 : 50 }));
  const r = evaluateAlerts({ entries });
  assert.ok(!ids(r).includes('rhr_high'));
  assert.ok(ids(r).includes('baseline_building'));
  assert.equal(r.baseline.value, null);
});

test('weekly rate: >1% yellow, >3% red, under 1% quiet', () => {
  const series = (endWeight) => [
    { date: START, weightLb: 150 },
    { date: addDays(START, 7), weightLb: endWeight },
  ];
  assert.ok(ids(evaluateAlerts({ entries: series(147) })).includes('rate_yellow')); // 2%
  assert.ok(ids(evaluateAlerts({ entries: series(145) })).includes('rate_red')); // 3.33%
  const quiet = evaluateAlerts({ entries: series(148.6) }); // 0.93%
  assert.ok(!ids(quiet).some((id) => id.startsWith('rate_')));
  assert.equal(quiet.metrics.ratePctPerWeek, 0.93);
});

test('too few days of data: no rate alert', () => {
  const r = evaluateAlerts({ entries: [{ date: START, weightLb: 150 }, { date: addDays(START, 2), weightLb: 145 }] });
  assert.ok(!ids(r).some((id) => id.startsWith('rate_')));
});

test('water phase: rate check is skipped, the 5% water cap is enforced', () => {
  const profile = { sex: 'male', age: 17, heightIn: 66, trainingLoad: 'hard' };
  const plan = generatePlan(profile, { startWeightLb: 120, targetWeightLb: 114.5, startDate: START, weighInDate: addDays(START, 10), recoveryWindow: '1to6h' });
  const waterStart = addDays(START, plan.fatDays);
  const entries = [
    { date: START, weightLb: 120 },
    { date: addDays(waterStart, -1), weightLb: 119.5 },
    { date: addDays(waterStart, 2), weightLb: 113 }, // 5.4% since the water cut began
  ];
  const r = evaluateAlerts({ entries, plan });
  assert.ok(ids(r).includes('water_cap'));
  assert.ok(!ids(r).some((id) => id.startsWith('rate_')));
});

test('big water cut with under 1 hour to recover gives a yellow warning', () => {
  const profile = { sex: 'male', age: 17, heightIn: 64, trainingLoad: 'hard' };
  const g = { startWeightLb: 113, targetWeightLb: 106, startDate: START, weighInDate: addDays(START, 10) };
  const short = evaluateAlerts({ entries: [], plan: generatePlan(profile, { ...g, recoveryWindow: 'under1h' }) });
  assert.ok(ids(short).includes('short_window'));
  const long = evaluateAlerts({ entries: [], plan: generatePlan(profile, { ...g, recoveryWindow: '12plus' }) });
  assert.ok(!ids(long).includes('short_window'));
});

test('pace: behind by more than 1% is yellow, ahead is info', () => {
  const profile = { sex: 'male', age: 17, heightIn: 66, trainingLoad: 'hard' };
  const plan = generatePlan(profile, { startWeightLb: 150, targetWeightLb: 145, startDate: START, weighInDate: addDays(START, 40), recoveryWindow: '12plus' });
  const behind = evaluateAlerts({ entries: [{ date: addDays(START, 1), weightLb: 152 }], plan });
  assert.ok(ids(behind).includes('pace_behind'));
  const ahead = evaluateAlerts({ entries: [{ date: addDays(START, 1), weightLb: 147.5 }], plan });
  assert.ok(ids(ahead).includes('pace_ahead'));
});

test('alerts are sorted red, then yellow, then info', () => {
  const entries = withBaseline({ recoveryScore: 20, restingHr: 60, sleepPerformance: 50 });
  entries.unshift({ date: addDays(START, -1), weightLb: 154 }); // fast loss -> rate alert
  const r = evaluateAlerts({ entries });
  const levels = r.alerts.map((a) => a.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => ['red', 'yellow', 'info'].indexOf(a) - ['red', 'yellow', 'info'].indexOf(b)));
  assert.ok(r.alerts.filter((a) => a.level === 'red').length >= 3);
  assert.ok(hasWearableRedFlag(r.alerts));
  assert.deepEqual(sortAlerts([{ level: 'info' }, { level: 'red' }, { level: 'yellow' }]).map((a) => a.level), ['red', 'yellow', 'info']);
});

test('entries after "today" are ignored and an empty log gives an info alert', () => {
  const r = evaluateAlerts({ entries: [{ date: '2026-12-01', weightLb: 150, recoveryScore: 5 }], today: '2026-11-01' });
  assert.ok(ids(r).includes('no_data'));
  assert.ok(!ids(r).includes('recovery_low'));
});
