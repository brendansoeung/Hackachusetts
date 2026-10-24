// Data layer: everything is saved on the athlete's own device (localStorage).
// Nothing is sent to a server except the numbers-only coach request.
// Export/Import gives the athlete a backup file they control.

import { LIMITS, round } from './limits.js';
import { addDays, isDateStr } from './dates.js';
import { validateProfile } from './rules.js';
import { WINDOWS } from './recovery.js';

export const STORAGE_KEY = 'makeweight:v1';
export const BACKUP_APP_ID = 'makeweight';
const MAX_BACKUP_CHARS = 1_000_000;
const MAX_ENTRIES = 2000;
const MAX_CHAT = 40;

export function emptyState() {
  return {
    version: 1,
    profile: null,
    goal: null,
    entries: [],
    dataVersion: 0,
    briefing: null,
    chat: [],
    privacyAccepted: false,
    demo: false,
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;

const ENTRY_FIELDS = {
  weightLb: [LIMITS.minWeightLb, LIMITS.maxWeightLb],
  sleepHours: [0, 16],
  restingHr: [25, 150],
  hrv: [5, 300],
  recoveryScore: [0, 100],
  sleepPerformance: [0, 100],
  strain: [0, 21],
};

/** Validates one daily entry. Weight is required; everything else is optional. */
export function validateEntry(entry) {
  const errors = [];
  if (!entry || typeof entry !== 'object') return ['Entry is missing.'];
  if (!isDateStr(entry.date)) errors.push('Pick a valid date.');
  if (!inRange(entry.weightLb, ...ENTRY_FIELDS.weightLb)) {
    errors.push(`Weight must be between ${LIMITS.minWeightLb} and ${LIMITS.maxWeightLb} lb.`);
  }
  for (const [key, [lo, hi]] of Object.entries(ENTRY_FIELDS)) {
    if (key === 'weightLb' || entry[key] === undefined || entry[key] === null) continue;
    if (!inRange(entry[key], lo, hi)) errors.push(`${key} must be between ${lo} and ${hi}.`);
  }
  if (entry.source !== undefined && !['manual', 'wearable'].includes(entry.source)) errors.push('Unknown entry source.');
  return errors;
}

/** Keeps only known entry fields so stray data never sneaks into storage. */
export function cleanEntry(entry) {
  const out = { date: entry.date, source: entry.source === 'wearable' ? 'wearable' : 'manual' };
  for (const key of Object.keys(ENTRY_FIELDS)) {
    if (isNum(entry[key])) out[key] = entry[key];
  }
  return out;
}

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Adds or replaces the entry for that date. Returns a new state. Throws on invalid input. */
export function upsertEntry(state, entry) {
  const errors = validateEntry(entry);
  if (errors.length) throw new Error(errors.join(' '));
  const clean = cleanEntry(entry);
  const entries = state.entries.filter((e) => e.date !== clean.date).concat(clean).sort(byDate);
  return { ...state, entries, dataVersion: state.dataVersion + 1 };
}

export function deleteEntry(state, date) {
  return { ...state, entries: state.entries.filter((e) => e.date !== date), dataVersion: state.dataVersion + 1 };
}

export function validateGoal(goal) {
  const errors = [];
  if (!goal || typeof goal !== 'object') return ['Goal is missing.'];
  if (!inRange(goal.startWeightLb, LIMITS.minWeightLb, LIMITS.maxWeightLb)) errors.push('Start weight is out of range.');
  if (!inRange(goal.targetWeightLb, LIMITS.minWeightLb, LIMITS.maxWeightLb)) errors.push('Goal weight is out of range.');
  if (!isDateStr(goal.startDate)) errors.push('Start date is invalid.');
  if (!isDateStr(goal.weighInDate)) errors.push('Weigh-in date is invalid.');
  if (!Object.hasOwn(WINDOWS, goal.recoveryWindow)) errors.push('Pick a recovery window.');
  return errors;
}

const cleanProfile = (p) => ({
  sex: p.sex,
  age: p.age,
  heightIn: p.heightIn,
  trainingLoad: p.trainingLoad,
  ...(inRange(p.baselineRestingHr, 25, 150) ? { baselineRestingHr: p.baselineRestingHr } : {}),
});

const cleanGoal = (g) => ({
  startWeightLb: g.startWeightLb,
  targetWeightLb: g.targetWeightLb,
  startDate: g.startDate,
  weighInDate: g.weighInDate,
  recoveryWindow: g.recoveryWindow,
});

/** Sets profile + goal. Returns a new state. Throws on invalid input. */
export function setPlanInputs(state, profile, goal) {
  const errors = [...validateProfile(profile), ...validateGoal(goal)];
  if (errors.length) throw new Error(errors.join(' '));
  return { ...state, profile: cleanProfile(profile), goal: cleanGoal(goal), dataVersion: state.dataVersion + 1 };
}

/** Validates a whole state object (used for loading and imports). Returns errors. */
export function validateState(s) {
  if (!s || typeof s !== 'object') return ['Not a MakeWeight data file.'];
  const errors = [];
  if (s.profile !== null && s.profile !== undefined) errors.push(...validateProfile(s.profile));
  if (s.goal !== null && s.goal !== undefined) errors.push(...validateGoal(s.goal));
  if (!Array.isArray(s.entries)) errors.push('Entries are missing.');
  else {
    if (s.entries.length > MAX_ENTRIES) errors.push('Too many entries.');
    s.entries.forEach((e, i) => {
      const errs = validateEntry(e);
      if (errs.length) errors.push(`Entry ${i + 1}: ${errs.join(' ')}`);
    });
  }
  return errors;
}

/** Rebuilds a state from trusted-shape data, dropping anything unknown. */
function normalizeState(s) {
  const base = emptyState();
  const chat = Array.isArray(s.chat)
    ? s.chat
        .filter((m) => m && ['user', 'coach'].includes(m.role) && typeof m.text === 'string')
        .slice(-MAX_CHAT)
        .map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }))
    : [];
  const briefing =
    s.briefing && typeof s.briefing.text === 'string' && isDateStr(s.briefing.date)
      ? {
          text: s.briefing.text.slice(0, 3000),
          date: s.briefing.date,
          dataVersion: isNum(s.briefing.dataVersion) ? s.briefing.dataVersion : -1,
          source: s.briefing.source === 'ai' ? 'ai' : 'rules',
        }
      : null;
  return {
    ...base,
    profile: s.profile ? cleanProfile(s.profile) : null,
    goal: s.goal ? cleanGoal(s.goal) : null,
    entries: s.entries.map(cleanEntry).sort(byDate),
    dataVersion: isNum(s.dataVersion) ? s.dataVersion : 0,
    briefing,
    chat,
    privacyAccepted: s.privacyAccepted === true,
    demo: s.demo === true,
  };
}

/** Loads the saved state, or a fresh one if nothing is saved or the data is damaged. */
export function loadState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (validateState(parsed).length) return emptyState();
    return normalizeState(parsed);
  } catch {
    return emptyState();
  }
}

/** Saves the state. Returns false if the browser refused (for example, storage full). */
export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Creates the text of a backup file. */
export function exportBackup(state, now = new Date()) {
  return JSON.stringify({ app: BACKUP_APP_ID, version: 1, exportedAt: now.toISOString(), state }, null, 2);
}

/** Reads a backup file. Returns the restored state, or throws an Error with a friendly message. */
export function importBackup(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('That file is empty.');
  if (text.length > MAX_BACKUP_CHARS) throw new Error('That file is too big to be a MakeWeight backup.');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a MakeWeight backup (it isn't valid JSON).");
  }
  if (!parsed || parsed.app !== BACKUP_APP_ID || !parsed.state) {
    throw new Error("That file isn't a MakeWeight backup.");
  }
  const errors = validateState(parsed.state);
  if (errors.length) throw new Error(`The backup has problems: ${errors.slice(0, 3).join(' ')}`);
  const restored = normalizeState(parsed.state);
  return { ...restored, dataVersion: restored.dataVersion + 1 };
}

// ---------- WHOOP-format wearable data ----------

/** Converts one WHOOP-style day (recovery, sleep, cycle + scale weight) into a MakeWeight entry. */
export function fromWhoopDay(day, date) {
  const entry = { date, source: 'wearable' };
  if (isNum(day?.scale?.weight_lb)) entry.weightLb = day.scale.weight_lb;
  const rec = day?.recovery?.score_state === 'SCORED' ? day.recovery.score : null;
  if (rec && !rec.user_calibrating) {
    if (isNum(rec.recovery_score)) entry.recoveryScore = rec.recovery_score;
    if (isNum(rec.resting_heart_rate)) entry.restingHr = rec.resting_heart_rate;
    if (isNum(rec.hrv_rmssd_milli)) entry.hrv = round(rec.hrv_rmssd_milli, 1);
  }
  const sleep = day?.sleep?.score_state === 'SCORED' ? day.sleep.score : null;
  if (sleep) {
    if (isNum(sleep.sleep_performance_percentage)) entry.sleepPerformance = sleep.sleep_performance_percentage;
    const st = sleep.stage_summary;
    if (st) {
      const asleepMs = (st.total_light_sleep_time_milli || 0) + (st.total_slow_wave_sleep_time_milli || 0) + (st.total_rem_sleep_time_milli || 0);
      if (asleepMs > 0) entry.sleepHours = round(asleepMs / 3_600_000, 1);
    }
  }
  const cycle = day?.cycle?.score_state === 'SCORED' ? day.cycle.score : null;
  if (cycle && isNum(cycle.strain)) entry.strain = round(cycle.strain, 1);
  return entry;
}

/** Builds a full demo state from data/sample-athlete.json, with dates relative to today. */
export function buildDemoState(sample, today) {
  if (!sample || !Array.isArray(sample.days)) throw new Error('Demo data is missing.');
  let state = emptyState();
  const goal = {
    startWeightLb: sample.goal.startWeightLb,
    targetWeightLb: sample.goal.targetWeightLb,
    startDate: addDays(today, sample.goal.startOffsetDays),
    weighInDate: addDays(today, sample.goal.weighInOffsetDays),
    recoveryWindow: sample.goal.recoveryWindow,
  };
  state = setPlanInputs(state, sample.profile, goal);
  for (const day of sample.days) {
    state = upsertEntry(state, fromWhoopDay(day, addDays(today, day.dayOffset)));
  }
  return { ...state, demo: true };
}
