// MakeWeight UI: routing, rendering and event wiring.
// All safety math lives in rules.js / alerts.js / recovery.js; this file only displays it.

import { addDays, daysBetween, formatDate, isDateStr, todayStr } from './dates.js';
import { round } from './limits.js';
import { CUT_TYPES, STRATEGY_INFO, adjustDayForRedFlags, assessGoal, generatePlan, planDayFor } from './rules.js';
import { evaluateAlerts } from './alerts.js';
import { WINDOWS, buildRecoveryPlan } from './recovery.js';
import { SOURCES, sourcesFor } from './sources.js';
import { weightChartSvg } from './chart.js';
import {
  buildDemoState, deleteEntry, emptyState, exportBackup, importBackup, loadState, saveState, setPlanInputs, upsertEntry,
} from './storage.js';
import { askCoach, buildCoachContext, rulesBriefing, shouldRefreshBriefing } from './coach.js';

// ---------- helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
const lb = (v) => `${round(v, 1)} lb`;
const liters = (ml) => `${(ml / 1000).toFixed(1)} L`;

/** Formats AI text safely: escape everything, then allow **bold** only. */
const formatAiText = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

const STATUS = {
  green: { label: 'On track', detail: 'Within safe limits' },
  yellow: { label: 'Tight', detail: 'Faster than 1% a week' },
  red: { label: 'Not safe', detail: 'Not safe in this timeframe' },
};
const PHASE = { fat: 'Fat loss', water: 'Water cut', taper: 'Hold steady', weighin: 'Weigh-in' };
const LEVEL = { red: 'Red flag', yellow: 'Caution', info: 'Note' };

const VIEWS = ['today', 'plan', 'log', 'recovery', 'coach', 'learn', 'setup'];

let state = loadState();
let derived = null;
let learnData = null;
let briefingLoading = false;
let chatLoading = false;
let recoveryInput = null;
let toastTimer = null;

function sourcesHtml(keys) {
  const list = sourcesFor(keys);
  if (!list.length) return '';
  return `<p class="sources">Source: ${list
    .map((s) => (s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.short)}</a>` : esc(s.short)))
    .join(' · ')}</p>`;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------- state ----------

function derive() {
  const today = todayStr();
  const rawPlan = state.profile && state.goal ? generatePlan(state.profile, state.goal) : null;
  const plan = rawPlan && rawPlan.assessment.status !== 'invalid' ? rawPlan : null;
  const alertsResult = evaluateAlerts({ entries: state.entries, plan, profile: state.profile, today });
  const baseDay = plan ? planDayFor(plan, today) : null;
  const todayPlan = baseDay ? adjustDayForRedFlags(baseDay, alertsResult.alerts) : null;
  const context = buildCoachContext({ state, plan, alertsResult, today, todayPlan });
  derived = { today, plan, rawPlan, alertsResult, todayPlan, context };
}

function commit(next, { refreshBriefing = true } = {}) {
  if (next.goal !== state.goal) recoveryInput = null; // recovery defaults come from the plan
  state = next;
  if (!saveState(state)) toast("Couldn't save on this device. Storage may be full or in private mode.");
  derive();
  render();
  if (refreshBriefing) maybeRefreshBriefing();
}

// ---------- coach ----------

async function maybeRefreshBriefing({ force = false } = {}) {
  if (!state.goal || briefingLoading) return;
  const { today, context } = derived;
  if (!force && !shouldRefreshBriefing(state.briefing, state.dataVersion, today)) return;
  const dataVersion = state.dataVersion;
  const saveBriefing = (text, source, note = '') =>
    commit({ ...state, briefing: { text, date: today, dataVersion, source, note } }, { refreshBriefing: false });

  if (!state.privacyAccepted || !navigator.onLine) {
    saveBriefing(rulesBriefing(context), 'rules', state.privacyAccepted ? 'Offline: showing your rules-based plan.' : '');
    return;
  }
  briefingLoading = true;
  renderBriefingSlots();
  try {
    const text = await askCoach({ mode: 'briefing', context });
    briefingLoading = false;
    saveBriefing(text, 'ai');
  } catch (err) {
    briefingLoading = false;
    saveBriefing(rulesBriefing(context), 'rules', `${err.message} Showing your rules-based plan.`);
  }
}

function briefingHtml() {
  const b = state.briefing;
  const aiOff = !state.privacyAccepted;
  let body;
  if (briefingLoading) body = '<p class="loading muted" aria-busy="true">Coach is reading your data</p>';
  else if (b) body = `<p class="briefing-text">${formatAiText(b.text)}</p>${b.note ? `<p class="small muted">${esc(b.note)}</p>` : ''}`;
  else body = `<p class="briefing-text">${esc(rulesBriefing(derived.context))}</p>`;
  const badge = b?.source === 'ai' && !briefingLoading ? '<span class="badge badge-ai">AI coach</span>' : '<span class="badge">Rules-based</span>';
  return `
    <div class="card-head"><h2>Coach briefing</h2>${badge}</div>
    <div data-slot="briefing-body" aria-live="polite">${body}</div>
    <div class="btn-row">
      ${aiOff
        ? '<a class="btn btn-small" href="#coach">Turn on AI coach</a>'
        : `<button class="btn btn-small" type="button" data-action="refresh-briefing" ${briefingLoading ? 'disabled' : ''}>Refresh</button>`}
      <a class="btn btn-small" href="#coach">Ask a question</a>
    </div>
    <p class="small muted">Not medical advice. MakeWeight's coach is not a doctor.</p>`;
}

function renderBriefingSlots() {
  document.querySelectorAll('[data-slot="briefing"]').forEach((el) => {
    el.innerHTML = briefingHtml();
  });
}

async function sendChat(question) {
  const q = question.trim();
  if (!q || chatLoading) return;
  const history = state.chat.slice(-6);
  commit({ ...state, chat: [...state.chat, { role: 'user', text: q }].slice(-40) }, { refreshBriefing: false });
  chatLoading = true;
  renderChatLog();
  let reply;
  try {
    reply = await askCoach({ mode: 'chat', context: derived.context, question: q, history });
  } catch (err) {
    reply = `${err.message} Here's what your plan says for now: ${rulesBriefing(derived.context)}`;
  }
  chatLoading = false;
  commit({ ...state, chat: [...state.chat, { role: 'coach', text: reply }].slice(-40) }, { refreshBriefing: false });
  $('#chat-input')?.focus();
}

function renderChatLog() {
  const el = $('#chat-log');
  if (!el) return;
  const msgs = state.chat.map(
    (m) => `<div class="msg msg-${m.role}"><span class="msg-meta">${m.role === 'user' ? 'You' : 'Coach'}</span>${m.role === 'coach' ? formatAiText(m.text) : esc(m.text)}</div>`,
  );
  if (chatLoading) msgs.push('<div class="msg msg-coach"><span class="msg-meta">Coach</span><span class="loading">Thinking</span></div>');
  if (!msgs.length) msgs.push('<p class="muted">Ask anything about your cut, food, fluids, sleep or recovery.</p>');
  el.innerHTML = msgs.join('');
  el.scrollTop = el.scrollHeight;
}

// ---------- shared pieces ----------

function statusPill(status) {
  const s = STATUS[status];
  return s ? `<span class="pill pill-${status}">${esc(s.label)}<span class="visually-hidden">: ${esc(s.detail)}</span></span>` : '';
}

function alertsHtml(alerts, { limit = 99 } = {}) {
  if (!alerts.length) return '';
  return `<ul class="alerts" aria-label="Alerts">${alerts
    .slice(0, limit)
    .map((a) => `<li class="alert alert-${a.level}"><span class="level">${LEVEL[a.level]}</span><strong>${esc(a.title)}</strong><span>${esc(a.message)}</span></li>`)
    .join('')}</ul>`;
}

function waterLoadingWarningHtml() {
  return `
  <div class="card warn-card" role="note" aria-labelledby="wl-h">
    <h2 id="wl-h">Water loading: read this first</h2>
    <ul>
      <li>Drinking this much water while cutting salt can drop your blood sodium too low (hyponatremia), which is dangerous. Keep salt normal on loading days and spread the water across the whole day.</li>
      <li>The research was done on adult athletes, not high schoolers. NFHS's sports medicine committee warns against intentional dehydration for high school wrestlers.</li>
      <li>Never go to zero fluids. Stop and get help if you feel dizzy, confused or faint.</li>
      <li><strong>MakeWeight and its AI coach are not medical professionals.</strong> Talk to your athletic trainer or doctor before water loading.</li>
    </ul>
    ${sourcesHtml(['reale', 'issn', 'nfhs', 'nata'])}
  </div>`;
}

function fluidsText(day) {
  if (!Number.isFinite(day.fluidsMl)) return esc(day.fluidNote || '');
  return `${day.fluidsOz} oz <small>(${liters(day.fluidsMl)})</small>`;
}

function targetsHtml(day) {
  if (day.phase === 'weighin') {
    return `
      <div class="card">
        <div class="card-head"><h2>Today: weigh-in</h2><span class="chip chip-weighin">Weigh-in</span></div>
        <p>Target: <strong>${lb(day.targetWeightLb)}</strong>. Small sips only until you step on the scale.</p>
        <a class="btn btn-primary btn-block" href="#recovery">Open my recovery plan</a>
      </div>`;
  }
  const n = day.nutrition;
  return `
    <div class="card">
      <div class="card-head"><h2>Today's targets</h2><span class="chip chip-${day.phase}">${PHASE[day.phase]}</span></div>
      ${day.adjusted ? `<div class="alert alert-red" role="note"><span class="level">Plan eased</span><strong>Your wearable flagged poor recovery</strong><ul>${day.adjustments.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
      <dl class="stats">
        <div class="stat"><dt>Morning weight target</dt><dd>${lb(day.targetWeightLb)}</dd></div>
        <div class="stat"><dt>Fluids</dt><dd>${fluidsText(day)}</dd></div>
        <div class="stat"><dt>Food</dt><dd>${n.calories} kcal</dd></div>
        <div class="stat"><dt>Protein · Carbs · Fat</dt><dd>${n.proteinG} · ${n.carbsG} · ${n.fatG} <small>g</small></dd></div>
        <div class="stat"><dt>Salt</dt><dd>${day.sodium === 'lower' ? 'Lower' : 'Normal'}</dd></div>
        <div class="stat"><dt>Fiber</dt><dd>${day.fiber === 'low' ? 'Under 10 g' : 'Normal'}</dd></div>
        <div class="stat stat-wide"><dt>Cardio</dt><dd><small>${esc(day.cardio)}</small></dd></div>
      </dl>
      ${day.notes.length ? `<ul class="small">${day.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${day.fluidNote ? `<p class="small muted">${esc(day.fluidNote)}</p>` : ''}
      ${sourcesHtml(day.sources)}
    </div>
    ${day.waterLoading ? waterLoadingWarningHtml() : ''}`;
}

// ---------- views ----------

function welcomeHtml() {
  return `
    <div class="card hero">
      <h1 id="h-today">Make weight. Stay strong.</h1>
      <p>MakeWeight plans a safe weight cut, watches your wearable data for warning signs, and tells you exactly how to refuel after weigh-ins.</p>
      <div class="btn-row">
        <a class="btn btn-primary" href="#setup">Set up my cut</a>
        <button class="btn" type="button" data-action="load-demo">Try the demo athlete</button>
      </div>
    </div>
    <div class="card">
      <h2>How it keeps you safe</h2>
      <ul>
        <li>Fat loss capped near 1% of body weight a week.</li>
        <li>Water cut capped at 5%, final days only.</li>
        <li>Red flags from low recovery, a high resting heart rate or bad sleep slow your plan down.</li>
        <li>Never suggests saunas, rubber suits, vomiting, diuretics or laxatives. <a href="#learn">See why</a>.</li>
      </ul>
      <p class="small muted">Your data stays on this device. No account, no coach view.</p>
    </div>
    ${installCardHtml()}`;
}

function renderToday() {
  if (!state.goal) return welcomeHtml();
  const { plan, rawPlan, alertsResult, todayPlan, today } = derived;
  if (!plan) {
    return `<h1 id="h-today">Today</h1><div class="card danger-card"><h2>Your goal needs fixing</h2><p>${esc((rawPlan?.assessment?.errors || []).join(' '))}</p><a class="btn btn-primary" href="#setup">Edit goal</a></div>`;
  }
  const a = plan.assessment;
  const daysLeft = daysBetween(today, plan.weighInDate);
  const dayNum = daysBetween(plan.startDate, today) + 1;
  let when;
  if (daysLeft < 0) when = `Weigh-in was ${formatDate(plan.weighInDate)}.`;
  else if (dayNum < 1) when = `Plan starts ${formatDate(plan.startDate)}.`;
  else when = daysLeft === 0 ? 'Weigh-in is today.' : `Day ${dayNum} · ${daysLeft} day${daysLeft === 1 ? '' : 's'} to weigh-in`;
  const latest = alertsResult.latest;

  let todayBlock;
  if (todayPlan) todayBlock = targetsHtml(todayPlan);
  else if (daysLeft < 0) todayBlock = '<div class="card"><h2>Cut complete</h2><p>Nice work. Set up your next goal when you are ready.</p><a class="btn btn-primary" href="#setup">New goal</a></div>';
  else todayBlock = `<div class="card"><p>Your plan starts ${formatDate(plan.startDate)}.</p></div>`;

  return `
    <h1 id="h-today">Today</h1>
    <div class="card">
      <div class="card-head"><h2>${esc(CUT_TYPES[plan.cutType].label)}</h2>${statusPill(a.status)}</div>
      <p class="muted">${esc(when)}</p>
      <dl class="stats">
        <div class="stat"><dt>Now</dt><dd>${latest ? lb(latest.weightLb) : '<small>Log today</small>'}</dd></div>
        <div class="stat"><dt>Goal</dt><dd>${lb(a.targetLb)}${a.status === 'red' ? `<br><small>Safe cap: ${lb(plan.planTargetLb)}</small>` : ''}</dd></div>
      </dl>
    </div>
    <div class="card" data-slot="briefing">${briefingHtml()}</div>
    ${alertsHtml(alertsResult.alerts)}
    ${todayBlock}
    <a class="btn btn-primary btn-block" href="#log">Log today's numbers</a>`;
}

function renderPlan() {
  if (!state.goal) {
    return `<h1 id="h-plan">Plan</h1><div class="card"><p>No plan yet.</p><div class="btn-row"><a class="btn btn-primary" href="#setup">Set up my cut</a><button class="btn" type="button" data-action="load-demo">Try the demo</button></div></div>`;
  }
  const { plan, rawPlan, today } = derived;
  if (!plan) return `<h1 id="h-plan">Plan</h1><div class="card danger-card"><p>${esc((rawPlan?.assessment?.errors || []).join(' '))}</p><a class="btn btn-primary" href="#setup">Edit goal</a></div>`;
  const a = plan.assessment;
  const ct = CUT_TYPES[plan.cutType];
  const days = plan.days
    .map((d) => {
      const isToday = d.date === today;
      const n = d.nutrition;
      return `<li class="day" ${isToday ? 'aria-current="date"' : ''}>
        <div class="day-head">
          <strong>${isToday ? '<span class="chip chip-today">Today</span>' : ''}${esc(formatDate(d.date))}</strong>
          <span class="day-weight">${lb(d.targetWeightLb)}</span>
        </div>
        <p><span class="chip chip-${d.phase}">${PHASE[d.phase]}</span>${d.waterLoading ? '<span class="chip chip-water">Water loading</span>' : ''}</p>
        ${n ? `<p>${n.calories} kcal · ${n.proteinG} g protein · ${n.carbsG} g carbs · ${fluidsText(d)} fluids</p>` : `<p>${esc(d.fluidNote)}</p>`}
        <p class="muted">${esc(d.cardio)}</p>
        ${d.notes.length ? `<ul>${d.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </li>`;
    })
    .join('');

  return `
    <h1 id="h-plan">Your plan</h1>
    <div class="card">
      <div class="card-head"><h2>${esc(ct.label)} <span class="muted small">(${esc(ct.range)})</span></h2>${statusPill(a.status)}</div>
      <p>${esc(ct.focus)}</p>
      <p><strong>${esc(a.reason)}</strong></p>
      <dl class="stats">
        <div class="stat"><dt>Start</dt><dd>${lb(plan.startWeightLb)}<br><small>${esc(formatDate(plan.startDate))}</small></dd></div>
        <div class="stat"><dt>Goal</dt><dd>${lb(a.targetLb)}<br><small>Weigh-in ${esc(formatDate(plan.weighInDate))}</small></dd></div>
        <div class="stat"><dt>From fat</dt><dd>${lb(plan.fatLossLb)}</dd></div>
        <div class="stat"><dt>From water</dt><dd>${lb(plan.waterLossLb)} <small>(${round(plan.waterLossPct)}%)</small></dd></div>
        <div class="stat stat-wide"><dt>Final days</dt><dd><small>${esc(STRATEGY_INFO[plan.strategy])}</small></dd></div>
      </dl>
      <div class="btn-row"><a class="btn" href="#setup">Edit goal</a></div>
      ${sourcesHtml(['mw', 'issn', 'reale'])}
    </div>
    ${plan.warnings.includes('water_loading') ? waterLoadingWarningHtml() : ''}
    <h2>Day by day</h2>
    <ol class="days" aria-label="Day-by-day plan">${days}</ol>`;
}

function installCardHtml() {
  return `
    <div class="card">
      <h2>Put MakeWeight on your phone</h2>
      <ul>
        <li><strong>iPhone (Safari):</strong> tap Share, then "Add to Home Screen".</li>
        <li><strong>Android (Chrome):</strong> tap the menu (three dots), then "Install app" or "Add to Home screen".</li>
      </ul>
      <p class="small muted">It opens full-screen like an app, and your plan works offline.</p>
    </div>`;
}

function renderLog() {
  const { today, plan } = derived;
  const existing = state.entries.find((e) => e.date === today) || {};
  const recent = [...state.entries].reverse().slice(0, 30);
  const v = (k) => (existing[k] ?? '') === '' ? '' : esc(existing[k]);
  return `
    <h1 id="h-log">Log</h1>
    <form class="card" id="log-form" novalidate>
      <h2>Daily check-in</h2>
      <p class="small muted">Weigh in the morning, after using the bathroom, before eating or drinking.</p>
      <div class="field">
        <label for="log-date">Date</label>
        <input id="log-date" name="date" type="date" value="${esc(today)}" max="${esc(addDays(today, 0))}" required>
      </div>
      <div class="field">
        <label for="log-weight">Weight (lb)</label>
        <input id="log-weight" name="weightLb" type="number" inputmode="decimal" step="0.1" min="60" max="450" value="${v('weightLb')}" required>
      </div>
      <div class="row">
        <div class="field">
          <label for="log-sleep">Sleep (hours)</label>
          <input id="log-sleep" name="sleepHours" type="number" inputmode="decimal" step="0.1" min="0" max="16" value="${v('sleepHours')}">
        </div>
        <div class="field">
          <label for="log-rhr">Resting HR (bpm)</label>
          <input id="log-rhr" name="restingHr" type="number" inputmode="numeric" min="25" max="150" value="${v('restingHr')}">
        </div>
      </div>
      <details>
        <summary>Wearable numbers (optional)</summary>
        <p class="small muted">From WHOOP, Garmin, Apple Watch or similar.</p>
        <div class="row">
          <div class="field"><label for="log-rec">Recovery (%)</label><input id="log-rec" name="recoveryScore" type="number" inputmode="numeric" min="0" max="100" value="${v('recoveryScore')}"></div>
          <div class="field"><label for="log-hrv">HRV (ms)</label><input id="log-hrv" name="hrv" type="number" inputmode="decimal" min="5" max="300" value="${v('hrv')}"></div>
        </div>
        <div class="field"><label for="log-perf">Sleep performance (%)</label><input id="log-perf" name="sleepPerformance" type="number" inputmode="numeric" min="0" max="100" value="${v('sleepPerformance')}"></div>
      </details>
      <p class="form-errors" id="log-errors" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">Save</button>
    </form>

    <div class="card">
      <h2>Weight trend</h2>
      ${weightChartSvg({ entries: state.entries, plan, today })}
      <div class="legend" aria-hidden="true"><span class="l-actual">Actual</span><span class="l-plan">Plan</span><span class="l-goal">Goal</span></div>
    </div>

    <div class="card">
      <h2>History</h2>
      ${recent.length ? `<ul class="entries">${recent.map((e) => `
        <li>
          <div>
            <strong>${esc(formatDate(e.date))}: ${lb(e.weightLb)}</strong>
            <div class="entry-meta">${[
              e.source === 'wearable' ? 'Wearable' : 'Manual',
              Number.isFinite(e.recoveryScore) ? `Recovery ${e.recoveryScore}%` : '',
              Number.isFinite(e.restingHr) ? `RHR ${e.restingHr}` : '',
              Number.isFinite(e.hrv) ? `HRV ${e.hrv}` : '',
              Number.isFinite(e.sleepHours) ? `Sleep ${e.sleepHours} h` : '',
            ].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
          <button class="btn btn-small btn-danger" type="button" data-action="delete-entry" data-date="${esc(e.date)}" aria-label="Delete entry for ${esc(formatDate(e.date))}">Delete</button>
        </li>`).join('')}</ul>` : '<p class="muted">No entries yet.</p>'}
    </div>

    <div class="card">
      <h2>Your data</h2>
      <p class="small muted">Everything is saved only on this device. Clearing your browser data erases it, so export a backup now and then.</p>
      <div class="btn-row">
        <button class="btn" type="button" data-action="export">Export backup</button>
        <label class="btn" for="import-file">Import backup</label>
        <input id="import-file" class="visually-hidden" type="file" accept="application/json,.json">
      </div>
      <div class="btn-row">
        <button class="btn" type="button" data-action="load-demo">Load demo athlete</button>
        <button class="btn btn-danger" type="button" data-action="erase">Erase all data</button>
      </div>
    </div>
    ${installCardHtml()}`;
}

function defaultRecoveryInput() {
  const { plan, alertsResult } = derived;
  return {
    window: plan?.recoveryWindow || 'under1h',
    weightLb: plan ? round(plan.planTargetLb, 1) : alertsResult.latest?.weightLb || '',
    cutLb: plan ? round(plan.waterLossLb, 1) : 3,
    tournament: false,
    heavyDepletion: 'auto',
  };
}

function recoveryResultHtml(input) {
  if (input.weightLb === '' || input.weightLb === null || input.weightLb === undefined) {
    return '<p class="muted">Enter your weigh-in weight to see your plan.</p>';
  }
  const p = buildRecoveryPlan({
    window: input.window,
    weightLb: Number(input.weightLb),
    cutLb: Number(input.cutLb),
    tournament: input.tournament,
    heavyDepletion: input.heavyDepletion === 'auto' ? undefined : input.heavyDepletion === 'yes',
  });
  if (p.errors) return `<p class="form-errors" role="alert">${esc(p.errors.join(' '))}</p>`;
  const foods = (opts) => `<ul class="foods">${opts.map((o, i) => `<li>${opts.length > 1 ? `<strong>Option ${i + 1}:</strong> ` : ''}${esc(o.items.join(' + '))} <span class="grams">(about ${o.carbsG} g carbs)</span></li>`).join('')}</ul>`;
  return `
    <div class="card">
      <div class="card-head"><h2>${esc(p.label)}: your plan</h2></div>
      <p class="muted">Total fluids: about ${p.fluidTotal.oz} oz (${liters(p.fluidTotal.ml)}) after cutting ${lb(p.cutLb)}${p.cutPct ? ` (${p.cutPct}%)` : ''}.</p>
      ${p.warnings.length ? `<ul class="alerts">${p.warnings.map((w) => `<li class="alert alert-yellow"><span class="level">Caution</span>${esc(w)}</li>`).join('')}</ul>` : ''}
      <ol class="timeline">${p.steps.map((s) => `
        <li>
          <span class="time">${esc(s.time)}</span>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.detail)}</p>
          ${s.foods ? foods(s.foods) : ''}
          ${sourcesHtml(s.sources)}
        </li>`).join('')}</ol>
    </div>
    ${p.betweenMatches.length ? `
    <div class="card">
      <h2>Between matches</h2>
      <ol class="timeline">${p.betweenMatches.map((s) => `<li><span class="time">${esc(s.when)}</span><p>${esc(s.what)}</p>${s.foods ? foods(s.foods) : ''}</li>`).join('')}</ol>
      ${sourcesHtml(['issn', 'mw'])}
    </div>` : ''}
    <p class="small muted">Feeling dizzy, confused or faint after weigh-in? Stop and tell your athletic trainer or call 911.</p>`;
}

function renderRecovery() {
  if (!recoveryInput) recoveryInput = defaultRecoveryInput();
  const r = recoveryInput;
  return `
    <h1 id="h-recovery">After weigh-in</h1>
    <form class="card" id="recovery-form" novalidate>
      <fieldset>
        <legend>How long until you compete?</legend>
        <div class="choices">
          ${Object.entries(WINDOWS).map(([k, w]) => `
            <label class="choice"><input type="radio" name="window" value="${k}" ${r.window === k ? 'checked' : ''}>
              <span>${esc(w.label)}<span class="hint">${esc(w.hint)}</span></span></label>`).join('')}
        </div>
      </fieldset>
      <div class="row">
        <div class="field"><label for="rec-weight">Weigh-in weight (lb)</label><input id="rec-weight" name="weightLb" type="number" inputmode="decimal" step="0.1" min="60" max="450" value="${esc(r.weightLb)}"></div>
        <div class="field"><label for="rec-cut">Pounds cut in the final days</label><input id="rec-cut" name="cutLb" type="number" inputmode="decimal" step="0.1" min="0" max="40" value="${esc(r.cutLb)}"></div>
      </div>
      <div class="field"><label class="check"><input type="checkbox" name="tournament" ${r.tournament ? 'checked' : ''}> Tournament (more than one match)</label></div>
      ${r.window === '12plus' ? `
      <div class="field">
        <label for="rec-heavy">Did you cut carbs hard this week?</label>
        <select id="rec-heavy" name="heavyDepletion">
          <option value="auto" ${r.heavyDepletion === 'auto' ? 'selected' : ''}>Not sure (decide from my cut)</option>
          <option value="yes" ${r.heavyDepletion === 'yes' ? 'selected' : ''}>Yes</option>
          <option value="no" ${r.heavyDepletion === 'no' ? 'selected' : ''}>No</option>
        </select>
      </div>` : ''}
    </form>
    <div id="recovery-result" aria-live="polite">${recoveryResultHtml(r)}</div>`;
}

function renderCoach() {
  if (!state.privacyAccepted) {
    return `
      <h1 id="h-coach">AI coach</h1>
      <div class="card">
        <h2>Before you turn on the AI coach</h2>
        <ul>
          <li>The coach runs on Google Gemini's free tier. Google may use what's sent to improve its products.</li>
          <li>MakeWeight sends <strong>numbers only</strong>: your weights, sleep, heart rate and plan targets, plus your question. Never your name or profile.</li>
          <li>Don't type names, your school or other personal details into the chat.</li>
          <li>The coach explains your plan; it can't change the safety limits. It is <strong>not a doctor</strong>.</li>
        </ul>
        <div class="btn-row"><button class="btn btn-primary" type="button" data-action="accept-privacy">Turn on AI coach</button></div>
        <p class="small muted">Without the AI, you still get a rules-based briefing on the Today tab.</p>
      </div>`;
  }
  const suggestions = ['What should I eat tonight?', 'My recovery is red. Should I still run?', 'Should I take a salt bath?', 'How do I water load safely?'];
  return `
    <h1 id="h-coach">AI coach</h1>
    ${state.goal ? `<div class="card" data-slot="briefing">${briefingHtml()}</div>` : '<div class="card"><p>Set up your cut first so the coach knows your plan.</p><a class="btn btn-primary" href="#setup">Set up my cut</a></div>'}
    <div class="card">
      <div class="card-head"><h2>Chat</h2>${state.chat.length ? '<button class="btn btn-small" type="button" data-action="clear-chat">Clear</button>' : ''}</div>
      <div id="chat-log" class="chat-log" role="log" aria-live="polite" aria-label="Chat with the coach"></div>
      <div class="suggestions">${suggestions.map((s) => `<button class="btn btn-small" type="button" data-action="suggest" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <form id="chat-form" novalidate>
        <label for="chat-input" class="visually-hidden">Your question</label>
        <textarea id="chat-input" name="q" maxlength="500" placeholder="Ask about food, fluids, sleep or recovery" required></textarea>
        <button class="btn btn-primary btn-block" type="submit">Send</button>
      </form>
      <p class="small muted">The coach is not a doctor. Dizzy, confused or fainting? Stop and get help: athletic trainer, doctor or 911.</p>
    </div>`;
}

function renderLearn() {
  if (!learnData) {
    loadLearn();
    return '<h1 id="h-learn">Safety</h1><p class="loading muted">Loading</p>';
  }
  const cls = { not_recommended: 'no', safety: 'safety', story: 'story' };
  const sections = learnData.sections.map((s) => `
    <h2>${esc(s.title)}</h2>
    ${s.intro ? `<p class="muted">${esc(s.intro)}</p>` : ''}
    ${s.cards.map((c) => `
      <article class="card learn-card ${cls[s.id] || ''}" aria-labelledby="lc-${esc(c.id)}">
        <h3 id="lc-${esc(c.id)}">${esc(c.title)}</h3>
        <p>${esc(c.what)}</p>
        <dl>
          ${c.healthRisk ? `<dt>Health risk</dt><dd>${esc(c.healthRisk)}</dd>` : ''}
          ${c.performanceCost ? `<dt>${s.id === 'not_recommended' ? 'Why it hurts performance' : 'Performance'}</dt><dd>${esc(c.performanceCost)}</dd>` : ''}
          ${c.saferAlternative ? `<dt>${s.id === 'not_recommended' ? 'Do this instead' : 'What to do'}</dt><dd>${esc(c.saferAlternative)}</dd>` : ''}
        </dl>
        ${sourcesHtml(c.sources)}
      </article>`).join('')}`).join('');
  return `
    <h1 id="h-learn">Safety</h1>
    ${sections}
    <div class="card">
      <h2>About the data</h2>
      <p>MakeWeight reads the same metrics WHOOP's developer API provides: recovery score, resting heart rate, HRV, sleep performance and strain. The demo athlete uses that exact format. No wearable? Type in your weight, sleep and resting heart rate.</p>
      ${sourcesHtml(['whoop'])}
    </div>
    <div class="card">
      <h2>All sources</h2>
      <ol class="source-list">${Object.values(SOURCES).map((s) => `<li>${esc(s.full)}${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Link</a>` : ''}</li>`).join('')}</ol>
    </div>`;
}

async function loadLearn() {
  try {
    const res = await fetch('/data/learn.json');
    learnData = await res.json();
  } catch {
    learnData = { sections: [] };
    toast("Couldn't load the safety cards. Check your connection.");
  }
  if (currentView() === 'learn') render();
}

function renderSetup() {
  const p = state.profile || {};
  const g = state.goal || {};
  const latest = derived.alertsResult.latest;
  const current = latest?.weightLb ?? g.startWeightLb ?? '';
  const ft = Number.isFinite(p.heightIn) ? Math.floor(p.heightIn / 12) : '';
  const inch = Number.isFinite(p.heightIn) ? p.heightIn % 12 : '';
  const weighIn = g.weighInDate && g.weighInDate > derived.today ? g.weighInDate : '';
  const radio = (name, value, label, checked, hint = '') =>
    `<label class="choice"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span>${esc(label)}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</span></label>`;
  return `
    <h1 id="h-setup">${state.goal ? 'Edit your goal' : 'Set up your cut'}</h1>
    <form class="card" id="setup-form" novalidate>
      <h2>Your goal</h2>
      <div class="row">
        <div class="field"><label for="s-current">Current weight (lb)</label><input id="s-current" name="current" type="number" inputmode="decimal" step="0.1" min="60" max="450" value="${esc(current)}" required></div>
        <div class="field"><label for="s-target">Goal weight (lb)</label><input id="s-target" name="target" type="number" inputmode="decimal" step="0.1" min="60" max="450" value="${esc(g.targetWeightLb ?? '')}" required>
          <span class="hint">Your weight class plus any allowance.</span></div>
      </div>
      <div class="field"><label for="s-date">Weigh-in date</label><input id="s-date" name="weighIn" type="date" min="${esc(addDays(derived.today, 1))}" value="${esc(weighIn)}" required></div>
      <div id="setup-preview" aria-live="polite"></div>
      <fieldset>
        <legend>Time from weigh-in to competing</legend>
        <div class="choices">
          ${Object.entries(WINDOWS).map(([k, w]) => radio('recoveryWindow', k, w.label, (g.recoveryWindow || 'under1h') === k, w.hint)).join('')}
        </div>
      </fieldset>
      <h2>About you</h2>
      <p class="small muted">Used only on this device to estimate calories. Never sent to the AI coach.</p>
      <fieldset>
        <legend>Sex (for the calorie formula)</legend>
        <div class="row">${radio('sex', 'male', 'Male', p.sex !== 'female')}${radio('sex', 'female', 'Female', p.sex === 'female')}</div>
      </fieldset>
      <div class="row">
        <div class="field"><label for="s-age">Age</label><input id="s-age" name="age" type="number" inputmode="numeric" min="12" max="70" value="${esc(p.age ?? '')}" required></div>
        <div class="field">
          <label for="s-ft">Height</label>
          <div class="row">
            <input id="s-ft" name="ft" type="number" inputmode="numeric" min="4" max="7" value="${esc(ft)}" aria-label="Height feet" placeholder="ft" required>
            <input id="s-in" name="in" type="number" inputmode="numeric" min="0" max="11" value="${esc(inch)}" aria-label="Height inches" placeholder="in" required>
          </div>
        </div>
      </div>
      <div class="field">
        <label for="s-load">Training load</label>
        <select id="s-load" name="trainingLoad">
          <option value="moderate" ${p.trainingLoad === 'moderate' ? 'selected' : ''}>Moderate: practice most days</option>
          <option value="hard" ${!p.trainingLoad || p.trainingLoad === 'hard' ? 'selected' : ''}>Hard: daily practice (in season)</option>
          <option value="very_hard" ${p.trainingLoad === 'very_hard' ? 'selected' : ''}>Very hard: two-a-days</option>
        </select>
      </div>
      <div class="field">
        <label for="s-rhr">Usual resting heart rate (optional)</label>
        <input id="s-rhr" name="baselineRestingHr" type="number" inputmode="numeric" min="25" max="150" value="${esc(p.baselineRestingHr ?? '')}">
        <span class="hint">Leave blank and MakeWeight learns it from your first 7 days.</span>
      </div>
      <p class="form-errors" id="setup-errors" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">Build my plan</button>
      <p class="small muted">Saving starts your plan today from your current weight.</p>
    </form>`;
}

function readSetupForm(form) {
  const f = new FormData(form);
  const ft = num(f.get('ft'));
  const inch = num(f.get('in')) ?? 0;
  return {
    current: num(f.get('current')),
    target: num(f.get('target')),
    weighIn: f.get('weighIn'),
    recoveryWindow: f.get('recoveryWindow'),
    profile: {
      sex: f.get('sex'),
      age: num(f.get('age')),
      heightIn: Number.isFinite(ft) ? ft * 12 + inch : undefined,
      trainingLoad: f.get('trainingLoad'),
      baselineRestingHr: num(f.get('baselineRestingHr')),
    },
  };
}

function updateSetupPreview() {
  const form = $('#setup-form');
  const el = $('#setup-preview');
  if (!form || !el) return;
  const v = readSetupForm(form);
  if (!Number.isFinite(v.current) || !Number.isFinite(v.target) || !isDateStr(v.weighIn)) {
    el.innerHTML = '';
    return;
  }
  const days = daysBetween(derived.today, v.weighIn);
  const a = assessGoal(v.current, v.target, days);
  if (a.status === 'invalid') {
    el.innerHTML = `<p class="form-errors">${esc(a.errors.join(' '))}</p>`;
    return;
  }
  el.innerHTML = `
    <div class="alert alert-${a.status === 'green' ? 'info' : a.status}">
      <span class="level">${esc(CUT_TYPES[a.cutType].label)} · ${days} days</span>
      <strong>${statusPill(a.status)}</strong>
      <span>${esc(a.reason)}</span>
      ${a.status === 'red' ? `<span><br>If you save, MakeWeight plans to ${lb(a.safestWeightLb)} instead.</span>` : ''}
    </div>`;
}

// ---------- routing & render ----------

function currentView() {
  const v = location.hash.replace('#', '');
  return VIEWS.includes(v) ? v : 'today';
}

const RENDERERS = { today: renderToday, plan: renderPlan, log: renderLog, recovery: renderRecovery, coach: renderCoach, learn: renderLearn, setup: renderSetup };

function render() {
  const view = currentView();
  for (const name of VIEWS) {
    const el = $(`#view-${name}`);
    el.hidden = name !== view;
    if (name === view) el.innerHTML = RENDERERS[name]();
  }
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('#demo-badge').hidden = !state.demo;
  if (view === 'coach') renderChatLog();
  if (view === 'setup') updateSetupPreview();
}

function onRoute() {
  if (currentView() === 'recovery') recoveryInput = null; // fresh defaults from the latest plan
  render();
  window.scrollTo(0, 0);
  const h = $(`#view-${currentView()} h1`);
  if (h) {
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }
}

// ---------- actions ----------

async function loadDemo({ goToday = true } = {}) {
  if (state.entries.length && !state.demo && !confirm('Load the demo athlete? This replaces the data on this device. Export a backup first if you want to keep it.')) return;
  try {
    const res = await fetch('/data/sample-athlete.json');
    const sample = await res.json();
    const demo = buildDemoState(sample, todayStr());
    commit({ ...demo, privacyAccepted: state.privacyAccepted, briefing: null, chat: [] });
    if (goToday) location.hash = '#today';
    toast('Demo athlete loaded: 113 lb wrestler cutting to 106 for states.');
  } catch {
    toast("Couldn't load the demo. Check your connection.");
  }
}

function exportData() {
  const blob = new Blob([exportBackup(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `makeweight-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup saved to your downloads.');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const restored = importBackup(String(reader.result));
      if (!confirm('Replace the data on this device with this backup?')) return;
      commit({ ...restored, privacyAccepted: state.privacyAccepted || restored.privacyAccepted });
      toast('Backup restored.');
    } catch (err) {
      toast(err.message);
    }
  };
  reader.onerror = () => toast("Couldn't read that file.");
  reader.readAsText(file);
}

function handleClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'load-demo') loadDemo();
  else if (action === 'refresh-briefing') maybeRefreshBriefing({ force: true });
  else if (action === 'accept-privacy') {
    commit({ ...state, privacyAccepted: true, briefing: null });
  } else if (action === 'suggest') {
    sendChat(btn.dataset.q);
  } else if (action === 'clear-chat') {
    commit({ ...state, chat: [] }, { refreshBriefing: false });
  } else if (action === 'delete-entry') {
    if (confirm(`Delete the entry for ${formatDate(btn.dataset.date)}?`)) commit(deleteEntry(state, btn.dataset.date));
  } else if (action === 'export') exportData();
  else if (action === 'erase') {
    if (confirm('Erase all MakeWeight data on this device? This cannot be undone unless you have a backup.')) {
      commit(emptyState(), { refreshBriefing: false });
      location.hash = '#today';
      toast('All data erased.');
    }
  }
}

function handleSubmit(e) {
  const form = e.target;
  if (form.id === 'log-form') {
    e.preventDefault();
    const f = new FormData(form);
    const entry = { date: f.get('date'), source: 'manual' };
    for (const k of ['weightLb', 'sleepHours', 'restingHr', 'hrv', 'recoveryScore', 'sleepPerformance']) {
      const v = num(f.get(k));
      if (v !== undefined) entry[k] = v;
    }
    const prev = state.entries.find((x) => x.date === entry.date);
    if (prev && Number.isFinite(prev.strain)) entry.strain = prev.strain;
    try {
      commit(upsertEntry(state, entry));
      const reds = derived.alertsResult.alerts.filter((a) => a.level === 'red').length;
      toast(reds ? `Saved. ${reds} red flag${reds > 1 ? 's' : ''} on Today.` : 'Saved. No red flags.');
    } catch (err) {
      $('#log-errors').textContent = err.message;
    }
  } else if (form.id === 'setup-form') {
    e.preventDefault();
    const v = readSetupForm(form);
    const errorsEl = $('#setup-errors');
    if (!isDateStr(v.weighIn)) {
      errorsEl.textContent = 'Pick your weigh-in date.';
      return;
    }
    const days = daysBetween(derived.today, v.weighIn);
    const a = assessGoal(v.current, v.target, days);
    if (a.status === 'invalid') {
      errorsEl.textContent = a.errors.join(' ');
      return;
    }
    const goal = { startWeightLb: v.current, targetWeightLb: v.target, startDate: derived.today, weighInDate: v.weighIn, recoveryWindow: v.recoveryWindow };
    try {
      let next = setPlanInputs(state, v.profile, goal);
      const prev = state.entries.find((x) => x.date === derived.today);
      next = upsertEntry(next, { ...(prev || {}), date: derived.today, weightLb: v.current, source: prev?.source || 'manual' });
      if (!state.goal) next = { ...next, demo: false };
      commit({ ...next, briefing: null });
      location.hash = '#today';
      toast('Plan built.');
    } catch (err) {
      errorsEl.textContent = err.message;
    }
  } else if (form.id === 'chat-form') {
    e.preventDefault();
    const input = $('#chat-input');
    const q = input.value;
    input.value = '';
    sendChat(q);
  }
}

function handleInput(e) {
  const form = e.target.form;
  if (!form) return;
  if (form.id === 'setup-form') updateSetupPreview();
  else if (form.id === 'recovery-form') {
    const f = new FormData(form);
    const prevWindow = recoveryInput.window;
    recoveryInput = {
      window: f.get('window'),
      weightLb: f.get('weightLb'),
      cutLb: f.get('cutLb'),
      tournament: f.get('tournament') === 'on',
      heavyDepletion: f.get('heavyDepletion') || recoveryInput.heavyDepletion,
    };
    if (prevWindow !== recoveryInput.window) {
      render(); // the 12+ hour window shows an extra question
      $(`#view-recovery input[name="window"][value="${recoveryInput.window}"]`)?.focus();
    } else {
      $('#recovery-result').innerHTML = recoveryResultHtml(recoveryInput);
    }
  } else if (form.id === 'log-form' && e.target.name === 'date' && isDateStr(e.target.value)) {
    // Load the saved numbers for the chosen date so editing is easy.
    const existing = state.entries.find((x) => x.date === e.target.value) || {};
    for (const k of ['weightLb', 'sleepHours', 'restingHr', 'hrv', 'recoveryScore', 'sleepPerformance']) {
      const input = form.elements[k];
      if (input) input.value = existing[k] ?? '';
    }
  }
}

function handleKeydown(e) {
  // Enter sends a chat message; Shift+Enter makes a new line.
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
}

// ---------- start ----------

function init() {
  derive();
  const main = $('#main');
  main.addEventListener('click', handleClick);
  main.addEventListener('submit', handleSubmit);
  main.addEventListener('input', (e) => {
    // Radios, checkboxes and selects are handled by 'change' so they don't fire twice.
    if (e.target.type === 'radio' || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return;
    handleInput(e);
  });
  main.addEventListener('change', (e) => {
    if (e.target.id === 'import-file' && e.target.files?.[0]) {
      importData(e.target.files[0]);
      e.target.value = '';
    } else if (e.target.type === 'radio' || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') {
      handleInput(e);
    }
  });
  main.addEventListener('keydown', handleKeydown);
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('online', () => maybeRefreshBriefing());
  render();
  // Shareable demo link for judges: https://<site>/?demo
  if (new URLSearchParams(location.search).has('demo') && !state.goal) loadDemo({ goToday: false });
  else maybeRefreshBriefing();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}

init();
