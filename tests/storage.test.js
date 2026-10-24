import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptyState, loadState, saveState, upsertEntry, deleteEntry, setPlanInputs,
  exportBackup, importBackup, fromWhoopDay, buildDemoState, validateEntry, STORAGE_KEY,
} from '../js/storage.js';

/** Minimal stand-in for the browser's localStorage. */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

const sample = JSON.parse(readFileSync(new URL('../data/sample-athlete.json', import.meta.url), 'utf8'));
const profile = { sex: 'male', age: 17, heightIn: 64, trainingLoad: 'hard' };
const goal = { startWeightLb: 113, targetWeightLb: 106, startDate: '2026-10-17', weighInDate: '2026-10-27', recoveryWindow: 'under1h' };

test('save and load round-trip', () => {
  const storage = new MemoryStorage();
  let s = setPlanInputs(emptyState(), profile, goal);
  s = upsertEntry(s, { date: '2026-10-17', weightLb: 113, sleepHours: 8, restingHr: 52 });
  assert.equal(saveState(s, storage), true);
  const loaded = loadState(storage);
  assert.deepEqual(loaded.profile, s.profile);
  assert.deepEqual(loaded.goal, s.goal);
  assert.deepEqual(loaded.entries, s.entries);
  assert.equal(loaded.dataVersion, s.dataVersion);
});

test('missing or damaged saved data falls back to a fresh state', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadState(storage), emptyState());
  storage.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(loadState(storage), emptyState());
  storage.setItem(STORAGE_KEY, JSON.stringify({ entries: [{ date: 'x', weightLb: 9999 }] }));
  assert.deepEqual(loadState(storage), emptyState());
});

test('saveState reports failure instead of crashing (e.g. storage full)', () => {
  const full = { setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(saveState(emptyState(), full), false);
});

test('one entry per date: saving the same date replaces it; entries stay sorted', () => {
  let s = emptyState();
  s = upsertEntry(s, { date: '2026-10-18', weightLb: 112 });
  s = upsertEntry(s, { date: '2026-10-17', weightLb: 113 });
  s = upsertEntry(s, { date: '2026-10-18', weightLb: 111.8, restingHr: 54 });
  assert.deepEqual(s.entries.map((e) => [e.date, e.weightLb]), [['2026-10-17', 113], ['2026-10-18', 111.8]]);
  assert.equal(s.dataVersion, 3);
  s = deleteEntry(s, '2026-10-17');
  assert.equal(s.entries.length, 1);
});

test('entries are validated and stray fields are dropped', () => {
  assert.throws(() => upsertEntry(emptyState(), { date: '2026-10-18' }), /Weight/);
  assert.throws(() => upsertEntry(emptyState(), { date: '2026-13-40', weightLb: 120 }), /date/);
  assert.ok(validateEntry({ date: '2026-10-18', weightLb: 120, recoveryScore: 140 }).length);
  const s = upsertEntry(emptyState(), { date: '2026-10-18', weightLb: 120, name: 'someone', notes: '<script>' });
  assert.deepEqual(Object.keys(s.entries[0]).sort(), ['date', 'source', 'weightLb']);
});

test('export then import restores the same data', () => {
  let s = setPlanInputs(emptyState(), profile, goal);
  s = upsertEntry(s, { date: '2026-10-17', weightLb: 113, recoveryScore: 60 });
  const restored = importBackup(exportBackup(s));
  assert.deepEqual(restored.entries, s.entries);
  assert.deepEqual(restored.goal, s.goal);
  assert.ok(restored.dataVersion > s.dataVersion, 'import counts as new data');
});

test('bad import files are rejected with friendly messages', () => {
  assert.throws(() => importBackup(''), /empty/);
  assert.throws(() => importBackup('hello'), /valid JSON/);
  assert.throws(() => importBackup(JSON.stringify({ app: 'other', state: {} })), /isn't a MakeWeight backup/);
  const bad = JSON.stringify({ app: 'makeweight', state: { ...emptyState(), entries: [{ date: '2026-10-17', weightLb: 5 }] } });
  assert.throws(() => importBackup(bad), /problems/);
  assert.throws(() => importBackup('x'.repeat(1_000_001)), /too big/);
});

test('WHOOP-format day converts to a MakeWeight entry', () => {
  const day = sample.days.at(-1);
  const e = fromWhoopDay(day, '2026-10-24');
  assert.equal(e.source, 'wearable');
  assert.equal(e.weightLb, day.scale.weight_lb);
  assert.equal(e.recoveryScore, day.recovery.score.recovery_score);
  assert.equal(e.restingHr, day.recovery.score.resting_heart_rate);
  assert.equal(e.sleepPerformance, day.sleep.score.sleep_performance_percentage);
  assert.ok(e.sleepHours > 5 && e.sleepHours < 7);
  assert.deepEqual(validateEntry(e), []);
  const calibrating = fromWhoopDay({ ...day, recovery: { score_state: 'SCORED', score: { ...day.recovery.score, user_calibrating: true } } }, '2026-10-24');
  assert.equal(calibrating.recoveryScore, undefined, 'calibrating scores are not trusted');
});

test('demo state: 14 days ending today, plan starts 7 days ago, weigh-in in 3 days', () => {
  const s = buildDemoState(sample, '2026-10-24');
  assert.equal(s.demo, true);
  assert.equal(s.entries.length, 14);
  assert.equal(s.entries.at(-1).date, '2026-10-24');
  assert.equal(s.entries[0].date, '2026-10-11');
  assert.equal(s.goal.startDate, '2026-10-17');
  assert.equal(s.goal.weighInDate, '2026-10-27');
  assert.equal(s.goal.targetWeightLb, 106);
});
