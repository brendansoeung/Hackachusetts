// Checks the demo wearable data and the Learn content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCES } from '../js/sources.js';
import { buildDemoState } from '../js/storage.js';
import { generatePlan } from '../js/rules.js';
import { evaluateAlerts } from '../js/alerts.js';

const readJson = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const sample = readJson('../data/sample-athlete.json');
const learn = readJson('../data/learn.json');

test('demo data uses WHOOP API field names and valid ranges', () => {
  assert.equal(sample.days.length, 14);
  for (const d of sample.days) {
    const rec = d.recovery.score;
    const sleep = d.sleep.score;
    const cycle = d.cycle.score;
    assert.equal(d.recovery.score_state, 'SCORED');
    assert.ok(rec.recovery_score >= 0 && rec.recovery_score <= 100);
    assert.ok(rec.resting_heart_rate > 30 && rec.resting_heart_rate < 100);
    assert.ok(rec.hrv_rmssd_milli > 0);
    assert.equal(typeof rec.user_calibrating, 'boolean');
    assert.ok(sleep.sleep_performance_percentage >= 0 && sleep.sleep_performance_percentage <= 100);
    assert.ok(sleep.stage_summary.total_in_bed_time_milli > sleep.stage_summary.total_awake_time_milli);
    assert.ok(cycle.strain >= 0 && cycle.strain <= 21);
    assert.ok(d.scale.weight_lb > 100 && d.scale.weight_lb < 120);
  }
});

test('demo story: today shows a recovery crash and resting HR spike, and the plan is tight', () => {
  const today = '2026-10-24';
  const s = buildDemoState(sample, today);
  const plan = generatePlan(s.profile, s.goal);
  assert.equal(plan.cutType, 'mid');
  assert.equal(plan.assessment.status, 'yellow');
  const r = evaluateAlerts({ entries: s.entries, plan, profile: s.profile, today });
  const ids = r.alerts.map((a) => a.id);
  for (const id of ['recovery_low', 'rhr_high', 'sleep_low', 'short_window', 'goal_yellow']) assert.ok(ids.includes(id), id);
  assert.equal(r.baseline.value, 52);
  // Yesterday was still fine on heart rate.
  const yesterday = evaluateAlerts({ entries: s.entries, plan, profile: s.profile, today: '2026-10-23' });
  assert.ok(!yesterday.alerts.some((a) => a.id === 'rhr_high'));
});

const allCards = learn.sections.flatMap((s) => s.cards);

test('every Learn card has the required fields and a known source', () => {
  for (const c of allCards) {
    assert.ok(c.id && c.title && c.what, `card ${c.id}`);
    for (const f of ['healthRisk', 'performanceCost', 'saferAlternative']) assert.equal(typeof c[f], 'string', `${c.id}.${f}`);
    assert.ok(Array.isArray(c.sources) && c.sources.length > 0, `${c.id} has no source`);
    for (const k of c.sources) assert.ok(SOURCES[k], `${c.id} cites unknown source ${k}`);
  }
  assert.equal(new Set(allCards.map((c) => c.id)).size, allCards.length, 'card ids are unique');
});

test('every not-recommended method has a card explaining health and performance costs', () => {
  const section = learn.sections.find((s) => s.id === 'not_recommended');
  const ids = section.cards.map((c) => c.id);
  for (const id of ['vomiting', 'salt_bath', 'sauna', 'suits', 'diuretics', 'laxatives', 'spitting', 'no_fluids']) {
    assert.ok(ids.includes(id), id);
  }
  for (const c of section.cards) {
    assert.ok(c.healthRisk.length > 10 && c.performanceCost.length > 10 && c.saferAlternative.length > 10, c.id);
  }
});

test('water loading card warns about hyponatremia, adults-only research and not being medical advice', () => {
  const card = allCards.find((c) => c.id === 'water_loading');
  const text = `${card.what} ${card.healthRisk} ${card.saferAlternative}`;
  assert.match(text, /hyponatremia/i);
  assert.match(text, /adult/i);
  assert.match(text, /not medical professionals/i);
});
