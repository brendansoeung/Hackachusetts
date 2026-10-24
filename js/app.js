// MakeWeight UI: routing, rendering and event wiring.
// All safety math lives in rules.js / alerts.js / recovery.js; this file only displays it.

import { addDays, daysBetween, formatDate, isDateStr, todayStr } from './dates.js';
import { round } from './limits.js';
import { CUT_TYPES, STRATEGY_INFO, adjustDayForRedFlags, assessGoal, generatePlan, planDayFor } from './rules.js';
import { evaluateAlerts, sleepPerformanceOf } from './alerts.js';
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
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const lb = (v) => `${round(v, 1)} lb`;
const liters = (ml) => `${(ml / 1000).toFixed(1)} L`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Formats AI text safely: escape everything, then allow **bold** only. */
const formatAiText = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

const STATUS = {
  green: { label: 'On track', detail: 'Within safe limits' },
  yellow: { label: 'Tight', detail: 'Faster than 1% a week' },
  red: { label: 'Not safe', detail: 'Not safe in this timeframe' },
};
const PHASE = { fat: 'Fat loss', water: 'Water cut', taper: 'Hold steady', weighin: 'Weigh-in' };

const VIEWS = ['today', 'plan', 'log', 'recovery', 'coach', 'learn', 'setup'];

let state = loadState();
let derived = null;
let learnData = null;
let briefingLoading = false;
let chatLoading = false;
let recoveryInput = null;
let toastTimer = null;
let lastView = null;
const scrollPositions = {};

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
  if (briefingLoading) body = '<p class="briefing-text loading muted" aria-busy="true">Coach is reading your data</p>';
  else if (b) body = `<p class="briefing-text">${formatAiText(b.text)}</p>${b.note ? `<p class="fine">${esc(b.note)}</p>` : ''}`;
  else body = `<p class="briefing-text">${esc(rulesBriefing(derived.context))}</p>`;
  const badge = b?.source === 'ai' && !briefingLoading ? '<span class="badge badge-ai">AI coach</span>' : '<span class="badge">Rules-based</span>';
  return `
    <div class="h-row"><h2 class="cap tan">Coach</h2>${badge}</div>
    <div data-slot="briefing-body" aria-live="polite">${body}</div>
    <div class="linkrow">
      ${aiOff
        ? '<a class="btn btn-small" href="#coach">Turn on AI coach</a>'
        : `<button class="btn btn-small" type="button" data-action="refresh-briefing" ${briefingLoading ? 'disabled' : ''}>Refresh</button>`}
      <a class="btn btn-small" href="#coach">Ask a question</a>
    </div>
    <p class="fine">Not medical advice. MakeWeight's coach is not a doctor.</p>`;
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
  if (!msgs.length) msgs.push('<p class="muted small">Ask anything about your cut, food, fluids, sleep or recovery.</p>');
  el.innerHTML = msgs.join('');
  el.scrollTop = el.scrollHeight;
}

// ---------- shared pieces ----------

function statusPill(status) {
  const s = STATUS[status];
  return s ? `<span class="pill pill-${status}">${esc(s.label)}<span class="visually-hidden">: ${esc(s.detail)}</span></span>` : '';
}

/** Alerts grouped by level. Each one is a single line that opens to show the details. */
function flagsHtml(alerts, { eased = false } = {}) {
  if (!alerts.length) return '';
  const groups = [
    ['red', (n) => `${plural(n, 'red flag')}${eased ? ' · Plan eased' : ''}`],
    ['yellow', (n) => plural(n, 'caution')],
    ['info', () => 'Notes'],
  ];
  const blocks = groups
    .map(([level, heading]) => {
      const list = alerts.filter((a) => a.level === level);
      if (!list.length) return '';
      return `<div class="flagblock lv-${level}">
        <p class="cap">${esc(heading(list.length))}</p>
        ${list.map((a) => `<details class="flag"><summary>${esc(a.title)}</summary><p>${esc(a.message)}</p></details>`).join('')}
      </div>`;
    })
    .join('');
  return `<section class="flags" aria-label="Alerts">${blocks}</section>`;
}

function waterLoadingWarningHtml() {
  return `
  <section class="warn" role="note" aria-labelledby="wl-h">
    <h2 id="wl-h">Water loading: read this first</h2>
    <ul class="bullets">
      <li>Drinking this much water while cutting salt can drop your blood sodium too low (hyponatremia), which is dangerous. Keep salt normal on loading days and spread the water across the whole day.</li>
      <li>The research was done on adult athletes, not high schoolers. NFHS's sports medicine committee warns against intentional dehydration for high school wrestlers.</li>
      <li>Never go to zero fluids. Stop and get help if you feel dizzy, confused or faint.</li>
      <li><strong>MakeWeight and its AI coach are not medical professionals.</strong> Talk to your athletic trainer or doctor before water loading.</li>
    </ul>
    ${sourcesHtml(['reale', 'issn', 'nfhs', 'nata'])}
  </section>`;
}

function fluidsShort(day) {
  return isNum(day.fluidsOz) ? `${day.fluidsOz} oz` : '';
}

const isCutBackDay = (day) => day.notes.some((x) => x.startsWith('Cut-back day'));

function fluidLabel(day) {
  if (day.waterLoading) return 'water loading';
  if (isCutBackDay(day)) return 'cut-back day';
  return '';
}

function targetsHtml(day) {
  if (day.phase === 'weighin') {
    return `
      <section class="sec">
        <div class="h-row"><h2>Today: weigh-in</h2><span class="chip chip-weighin">Weigh-in</span></div>
        <p class="small muted">Target ${lb(day.targetWeightLb)}. Small sips only until you step on the scale.</p>
        <a class="btn btn-primary btn-block" href="#recovery">Open my recovery plan</a>
      </section>`;
  }
  const n = day.nutrition;
  const fl = fluidLabel(day);
  return `
    <section class="sec">
      <div class="h-row"><h2>Today's targets</h2><span class="chip chip-${day.phase}">${PHASE[day.phase]}</span></div>
      <div class="rows">
        <div class="r"><span class="k">Morning target</span><span class="v">${lb(day.targetWeightLb)}</span></div>
        <div class="r"><span class="k">Fluids${fl ? ` <small>${fl}</small>` : ''}</span><span class="v">${fluidsShort(day)} <small class="muted">${liters(day.fluidsMl)}</small></span></div>
        <div class="r"><span class="k">Food <small>${n.proteinG} P · ${n.carbsG} C · ${n.fatG} F</small></span><span class="v">${n.calories.toLocaleString('en-US')} kcal</span></div>
        <div class="r"><span class="k">Salt</span><span class="v">${day.sodium === 'lower' ? 'Lower' : 'Normal'}</span></div>
        <div class="r"><span class="k">Fiber</span><span class="v">${day.fiber === 'low' ? 'Under 10 g' : 'Normal'}</span></div>
        <div class="r stack"><span class="k">Cardio</span><span class="v">${esc(day.cardio)}</span></div>
      </div>
      ${day.adjusted ? `<div class="flagblock lv-red mt"><p class="cap">Eased today because of your wearable</p><ul class="bullets">${day.adjustments.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
      ${day.notes.length ? `<ul class="bullets mt">${day.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${day.fluidNote ? `<p class="fine">${esc(day.fluidNote)}</p>` : ''}
      ${sourcesHtml(day.sources)}
    </section>
    ${day.waterLoading ? waterLoadingWarningHtml() : ''}`;
}

/** WHOOP-style row: recovery, resting HR, sleep, HRV from the latest entry. */
function metricsHtml(latest, alertsResult) {
  if (!latest) return '';
  const ids = new Set(alertsResult.alerts.map((a) => a.id));
  const sleep = sleepPerformanceOf(latest);
  const delta = alertsResult.metrics.restingHrDelta;
  const cell = (value, label, red) =>
    `<div class="metric"><b class="${value === '—' ? 'none' : red ? 'rust' : ''}">${value}</b><span class="cap">${label}</span></div>`;
  const has = [latest.recoveryScore, latest.restingHr, sleep.value, latest.hrv].some(isNum);
  if (!has) return '';
  return `<div class="metrics" aria-label="Latest wearable numbers">
    ${cell(isNum(latest.recoveryScore) ? `${Math.round(latest.recoveryScore)}%` : '—', 'Recovery', ids.has('recovery_low'))}
    ${cell(isNum(latest.restingHr) ? Math.round(latest.restingHr) : '—', isNum(delta) && delta > 0 ? `RHR +${Math.round(delta)}` : 'RHR', ids.has('rhr_high'))}
    ${cell(isNum(sleep.value) ? `${sleep.value}%` : '—', sleep.estimated ? 'Sleep est.' : 'Sleep', ids.has('sleep_low'))}
    ${cell(isNum(latest.hrv) ? Math.round(latest.hrv) : '—', 'HRV ms', false)}
  </div>`;
}

function installHtml() {
  return `
    <section class="sec">
      <h2>Put MakeWeight on your phone</h2>
      <div class="rows">
        <div class="r stack"><span class="k">iPhone (Safari)</span><span class="v">Tap Share, then "Add to Home Screen".</span></div>
        <div class="r stack"><span class="k">Android (Chrome)</span><span class="v">Tap the menu (three dots), then "Install app" or "Add to Home screen".</span></div>
      </div>
      <p class="fine">It opens full-screen like an app, and your plan works offline.</p>
    </section>`;
}

// ---------- views ----------

function welcomeHtml() {
  return `
    <div class="welcome">
      <h1 id="h-today">Make weight. Stay strong.</h1>
      <p class="lead">A safe weight-cut plan, red flags from your wearable, and exactly how to refuel after weigh-ins.</p>
      <div class="btn-row">
        <a class="btn btn-primary" href="#setup">Set up my cut</a>
        <button class="btn" type="button" data-action="load-demo">Try the demo athlete</button>
      </div>
    </div>
    <section class="sec">
      <h2>How it keeps you safe</h2>
      <div class="rows">
        <div class="r"><span class="k">Fat loss</span><span class="v">~1% / week</span></div>
        <div class="r"><span class="k">Water cut, final days only</span><span class="v">5% max</span></div>
        <div class="r stack"><span class="k">Wearable red flags</span><span class="v">Low recovery, a high resting heart rate or bad sleep slow your plan down.</span></div>
        <div class="r stack"><span class="k">Never suggested</span><span class="v">Saunas, rubber suits, vomiting, diuretics or laxatives. <a href="#learn">See why</a>.</span></div>
      </div>
      <p class="fine">Your data stays on this device. No account, no coach view.</p>
    </section>
    ${installHtml()}`;
}

function renderToday() {
  if (!state.goal) return welcomeHtml();
  const { plan, rawPlan, alertsResult, todayPlan, today } = derived;
  if (!plan) {
    return `<h1 id="h-today">Today</h1><div class="flagblock lv-red"><p class="cap">Your goal needs fixing</p><p class="plain">${esc((rawPlan?.assessment?.errors || []).join(' '))}</p></div><a class="btn btn-primary btn-block" href="#setup">Edit goal</a>`;
  }
  const a = plan.assessment;
  const daysLeft = daysBetween(today, plan.weighInDate);
  const dayNum = daysBetween(plan.startDate, today) + 1;
  const totalDays = plan.daysOut + 1;
  let when;
  if (daysLeft < 0) when = `Weigh-in was ${formatDate(plan.weighInDate)}`;
  else if (dayNum < 1) when = `Starts ${formatDate(plan.startDate)}`;
  else when = `Day ${dayNum} of ${totalDays}`;

  const latest = alertsResult.latest;
  const current = latest?.weightLb ?? plan.startWeightLb;
  const toGo = Math.max(0, current - a.targetLb);
  const span = plan.startWeightLb - a.targetLb;
  const fillPct = clamp01((plan.startWeightLb - current) / span) * 100;
  const expected = todayPlan ? clamp01((plan.startWeightLb - todayPlan.targetWeightLb) / span) * 100 : null;

  let statusText = 'Within safe limits.';
  if (a.status === 'yellow') statusText = `Faster than 1% a week. Safer goal: ${lb(a.safestWeightLb)}.`;
  else if (a.status === 'red') statusText = `Not safe in this timeframe. Plan capped at ${lb(plan.planTargetLb)}.`;

  let todayBlock;
  if (todayPlan) todayBlock = targetsHtml(todayPlan);
  else if (daysLeft < 0) todayBlock = '<section class="sec"><h2>Cut complete</h2><p class="small muted">Nice work. Set up your next goal when you are ready.</p><a class="btn btn-primary btn-block" href="#setup">New goal</a></section>';
  else todayBlock = `<section class="sec"><p class="small muted">Your plan starts ${formatDate(plan.startDate)}.</p></section>`;

  return `
    <h1 id="h-today" class="visually-hidden">Today</h1>
    <section class="hero-t" aria-label="Where you stand">
      <p class="cap">${esc(CUT_TYPES[plan.cutType].label)} · ${esc(when)}</p>
      <div class="hero-row">
        <div class="big">${round(current, 1)}<small>lb</small></div>
        <div class="days-left"><b>${Math.max(0, daysLeft)}</b><span class="cap">${daysLeft === 0 ? 'Weigh-in today' : daysLeft === 1 ? 'Day to weigh-in' : 'Days to weigh-in'}</span></div>
      </div>
      <div class="track" role="img" aria-label="${esc(`${round(plan.startWeightLb - current, 1)} of ${round(span, 1)} lb lost${expected !== null ? '; the line marks where the plan expects you today' : ''}`)}">
        <span class="fill" style="width:${fillPct.toFixed(1)}%"></span>
        ${expected !== null ? `<span class="tick" style="left:${expected.toFixed(1)}%"></span>` : ''}
      </div>
      <div class="trackcap"><span class="cap">${round(plan.startWeightLb, 1)} start</span><span class="cap">Goal ${round(a.targetLb, 1)} · ${round(toGo, 1)} to go</span></div>
      <p class="status-line">${statusPill(a.status)}${esc(statusText)}</p>
    </section>
    ${metricsHtml(latest, alertsResult)}
    ${flagsHtml(alertsResult.alerts, { eased: Boolean(todayPlan?.adjusted) })}
    <section class="coachbox" data-slot="briefing">${briefingHtml()}</section>
    ${todayBlock}
    <a class="btn btn-primary btn-block" href="#log">Log today's numbers</a>`;
}

function phaseBarHtml(plan, today) {
  const segs = [];
  if (plan.fatDays > 0) segs.push(`<div class="ph-fat" style="flex:${plan.fatDays}">Fat loss · ${plural(plan.fatDays, 'day')}</div>`);
  if (plan.waterDays > 0) {
    const cls = plan.strategy === 'none' ? 'ph-hold' : 'ph-water';
    const name = plan.strategy === 'none' ? 'Hold' : 'Water';
    segs.push(`<div class="${cls}" style="flex:${plan.waterDays}">${name} · ${plan.waterDays}</div>`);
  }
  segs.push('<div class="ph-weigh" style="flex:1.3">Weigh</div>');
  const totalFlex = plan.fatDays + plan.waterDays + 1.3;
  const idx = daysBetween(plan.startDate, today);
  let mark = '';
  if (idx >= 0 && idx <= plan.daysOut) {
    const left = idx === plan.daysOut ? (plan.daysOut + 0.65) / totalFlex : (idx + 0.5) / totalFlex;
    mark = `<div class="todaymark" aria-hidden="true"><span style="left:${(left * 100).toFixed(1)}%">Today</span></div>`;
  }
  return `<div class="phases" role="img" aria-label="${esc(`${plural(plan.fatDays, 'day')} of fat loss, ${plural(plan.waterDays, 'day')} of ${plan.strategy === 'none' ? 'holding steady' : 'water cut'}, then weigh-in`)}">${segs.join('')}</div>${mark}`;
}

function renderPlan() {
  if (!state.goal) {
    return `<h1 id="h-plan">Plan</h1><p class="small muted">No plan yet.</p><div class="btn-row"><a class="btn btn-primary" href="#setup">Set up my cut</a><button class="btn" type="button" data-action="load-demo">Try the demo</button></div>`;
  }
  const { plan, rawPlan, today } = derived;
  if (!plan) return `<h1 id="h-plan">Plan</h1><div class="flagblock lv-red"><p class="plain">${esc((rawPlan?.assessment?.errors || []).join(' '))}</p></div><a class="btn btn-primary btn-block" href="#setup">Edit goal</a>`;
  const a = plan.assessment;
  const ct = CUT_TYPES[plan.cutType];
  const days = plan.days
    .map((d) => {
      const isToday = d.date === today;
      const n = d.nutrition;
      const kind = d.waterLoading ? 'Water loading' : isCutBackDay(d) ? 'Cut-back day' : PHASE[d.phase];
      const meta = n
        ? [kind, fluidsShort(d), `${n.calories.toLocaleString('en-US')} kcal`, d.fiber === 'low' ? 'low fiber' : ''].filter(Boolean).join(' · ')
        : `${kind} · then open Recovery`;
      return `<li class="day" ${isToday ? 'aria-current="date"' : ''}>
        <div class="day-head"><span class="day-date">${esc(formatDate(d.date))}</span><span class="day-weight">${round(d.targetWeightLb, 1).toFixed(1)}</span></div>
        <p class="day-meta">${esc(meta)}</p>
        <details><summary>Details</summary>
          ${n ? `<p>${n.proteinG} g protein · ${n.carbsG} g carbs · ${n.fatG} g fat · ${liters(d.fluidsMl)} fluids</p>` : `<p>${esc(d.fluidNote)}</p>`}
          <p>${esc(d.cardio)}</p>
          ${d.notes.length ? `<ul class="bullets">${d.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        </details>
      </li>`;
    })
    .join('');

  return `
    <h1 id="h-plan">Your plan</h1>
    <p class="cap">${round(plan.startWeightLb, 1)} → ${round(a.targetLb, 1)} lb · ${esc(formatDate(plan.startDate))} → ${esc(formatDate(plan.weighInDate))}</p>
    ${phaseBarHtml(plan, today)}
    <section class="panel verdict">
      <div class="h-row m0"><span class="cap">${esc(ct.label)} · ${esc(ct.range)}</span>${statusPill(a.status)}</div>
      <p>${esc(a.reason)}</p>
    </section>
    <div class="split">
      <div><span class="cap">From fat</span><b>${lb(plan.fatLossLb)}</b></div>
      <div><span class="cap">From water</span><b>${lb(plan.waterLossLb)} <small>${round(plan.waterLossPct)}%</small></b></div>
    </div>
    <p class="small muted mt">${esc(ct.focus)} ${esc(STRATEGY_INFO[plan.strategy])}</p>
    <div class="btn-row"><a class="btn btn-small" href="#setup">Edit goal</a></div>
    ${sourcesHtml(['mw', 'issn', 'reale'])}
    ${plan.warnings.includes('water_loading') ? waterLoadingWarningHtml() : ''}
    <section class="sec">
      <h2>Day by day</h2>
      <ol class="days" aria-label="Day-by-day plan">${days}</ol>
    </section>`;
}

function renderLog() {
  const { today, plan } = derived;
  const existing = state.entries.find((e) => e.date === today) || {};
  const recent = [...state.entries].reverse().slice(0, 30);
  const v = (k) => ((existing[k] ?? '') === '' ? '' : esc(existing[k]));
  return `
    <h1 id="h-log">Log</h1>
    <p class="small muted">Weigh in the morning, after using the bathroom, before eating or drinking.</p>
    <form id="log-form" novalidate>
      <div class="row">
        <div class="field">
          <label for="log-date">Date</label>
          <input id="log-date" name="date" type="date" value="${esc(today)}" max="${esc(addDays(today, 0))}" required>
        </div>
        <div class="field">
          <label for="log-weight">Weight (lb)</label>
          <input id="log-weight" name="weightLb" type="number" inputmode="decimal" step="0.1" min="60" max="450" value="${v('weightLb')}" required>
        </div>
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
      <details class="more">
        <summary>+ Wearable numbers (optional)</summary>
        <p class="fine m0">From WHOOP, Garmin, Apple Watch or similar.</p>
        <div class="row">
          <div class="field"><label for="log-rec">Recovery (%)</label><input id="log-rec" name="recoveryScore" type="number" inputmode="numeric" min="0" max="100" value="${v('recoveryScore')}"></div>
          <div class="field"><label for="log-hrv">HRV (ms)</label><input id="log-hrv" name="hrv" type="number" inputmode="decimal" min="5" max="300" value="${v('hrv')}"></div>
        </div>
        <div class="field"><label for="log-perf">Sleep performance (%)</label><input id="log-perf" name="sleepPerformance" type="number" inputmode="numeric" min="0" max="100" value="${v('sleepPerformance')}"></div>
      </details>
      <p class="form-errors" id="log-errors" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">Save</button>
    </form>

    <section class="sec">
      <h2>Weight trend</h2>
      ${weightChartSvg({ entries: state.entries, plan, today })}
      <div class="legend" aria-hidden="true"><span class="l-actual">Actual</span><span class="l-plan">Plan</span><span class="l-goal">Goal</span></div>
    </section>

    <section class="sec">
      <h2>History</h2>
      ${recent.length ? `<ul class="entries">${recent.map((e) => `
        <li>
          <div>
            <div class="entry-main">${esc(formatDate(e.date))} · <span class="num">${lb(e.weightLb)}</span></div>
            <div class="entry-meta">${[
              e.source === 'wearable' ? 'Wearable' : 'Manual',
              isNum(e.recoveryScore) ? `Recovery ${e.recoveryScore}%` : '',
              isNum(e.restingHr) ? `RHR ${e.restingHr}` : '',
              isNum(e.hrv) ? `HRV ${e.hrv}` : '',
              isNum(e.sleepHours) ? `Sleep ${e.sleepHours} h` : '',
            ].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
          <button class="btn btn-small btn-danger" type="button" data-action="delete-entry" data-date="${esc(e.date)}" aria-label="Delete entry for ${esc(formatDate(e.date))}">Delete</button>
        </li>`).join('')}</ul>` : '<p class="small muted">No entries yet.</p>'}
    </section>

    <section class="sec">
      <h2>Your data</h2>
      <p class="small muted">Everything is saved only on this device. Clearing your browser data erases it, so export a backup now and then.</p>
      <div class="btn-row">
        <button class="btn btn-small" type="button" data-action="export">Export backup</button>
        <label class="btn btn-small" for="import-file">Import backup</label>
        <input id="import-file" class="visually-hidden" type="file" accept="application/json,.json">
        <button class="btn btn-small" type="button" data-action="load-demo">Load demo athlete</button>
        <button class="btn btn-small btn-danger" type="button" data-action="erase">Erase all data</button>
      </div>
    </section>
    ${installHtml()}`;
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
    return '<p class="small muted">Enter your weigh-in weight to see your plan.</p>';
  }
  const p = buildRecoveryPlan({
    window: input.window,
    weightLb: Number(input.weightLb),
    cutLb: Number(input.cutLb),
    tournament: input.tournament,
    heavyDepletion: input.heavyDepletion === 'auto' ? undefined : input.heavyDepletion === 'yes',
  });
  if (p.errors) return `<p class="form-errors" role="alert">${esc(p.errors.join(' '))}</p>`;
  const foods = (opts) => `<ul class="foods">${opts.map((o, i) => `<li>${opts.length > 1 ? `<strong>Option ${i + 1}:</strong> ` : ''}${esc(o.items.join(' + '))} <span class="grams">about ${o.carbsG} g carbs</span></li>`).join('')}</ul>`;
  return `
    <section class="sec">
      <h2>${esc(p.label)}: your plan</h2>
      <p class="small muted mt-s">Total fluids about ${p.fluidTotal.oz} oz (${liters(p.fluidTotal.ml)}) after cutting ${lb(p.cutLb)}${p.cutPct ? ` (${p.cutPct}%)` : ''}.</p>
      ${p.warnings.length ? `<div class="flagblock lv-yellow mt"><p class="cap">${plural(p.warnings.length, 'caution')}</p>${p.warnings.map((w) => `<p class="plain">${esc(w)}</p>`).join('')}</div>` : ''}
      <ol class="tl">${p.steps.map((s) => `
        <li class="st">
          <p class="cap">${esc(s.time)}</p>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.detail)}</p>
          ${s.foods ? foods(s.foods) : ''}
          ${sourcesHtml(s.sources)}
        </li>`).join('')}</ol>
    </section>
    ${p.betweenMatches.length ? `
    <section class="sec">
      <h2>Between matches</h2>
      <ol class="tl">${p.betweenMatches.map((s) => `<li class="st"><p class="cap">${esc(s.when)}</p><p>${esc(s.what)}</p>${s.foods ? foods(s.foods) : ''}</li>`).join('')}</ol>
      ${sourcesHtml(['issn', 'mw'])}
    </section>` : ''}
    <p class="fine">Feeling dizzy, confused or faint after weigh-in? Stop and tell your athletic trainer or call 911.</p>`;
}

const WINDOW_SHORT = { under1h: '< 1 hr', '1to6h': '1–6 hr', '12plus': '12+ hr' };

function renderRecovery() {
  if (!recoveryInput) recoveryInput = defaultRecoveryInput();
  const r = recoveryInput;
  return `
    <h1 id="h-recovery">After weigh-in</h1>
    <form id="recovery-form" novalidate>
      <fieldset>
        <legend>How long until you compete?</legend>
        <div class="seg">
          ${Object.keys(WINDOWS).map((k) => `<label><input type="radio" name="window" value="${k}" ${r.window === k ? 'checked' : ''} aria-label="${esc(WINDOWS[k].label)}">${esc(WINDOW_SHORT[k])}</label>`).join('')}
        </div>
        <p class="seg-hint">${esc(WINDOWS[r.window]?.label || '')}: ${esc(WINDOWS[r.window]?.hint || '')}</p>
      </fieldset>
      <div class="row">
        <div class="field"><label for="rec-weight">Weigh-in weight (lb)</label><input id="rec-weight" name="weightLb" type="number" inputmode="decimal" step="0.1" min="60" max="450" value="${esc(r.weightLb)}"></div>
        <div class="field"><label for="rec-cut">Lb cut, final days</label><input id="rec-cut" name="cutLb" type="number" inputmode="decimal" step="0.1" min="0" max="40" value="${esc(r.cutLb)}"></div>
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
      <section class="sec">
        <h2>Before you turn it on</h2>
        <ul class="bullets mt-s">
          <li>The coach runs on Google Gemini's free tier. Google may use what's sent to improve its products.</li>
          <li>MakeWeight sends <strong>numbers only</strong>: your weights, sleep, heart rate and plan targets, plus your question. Never your name or profile.</li>
          <li>Don't type names, your school or other personal details into the chat.</li>
          <li>The coach explains your plan; it can't change the safety limits. It is <strong>not a doctor</strong>.</li>
        </ul>
        <button class="btn btn-primary btn-block" type="button" data-action="accept-privacy">Turn on AI coach</button>
        <p class="fine">Without the AI, you still get a rules-based briefing on the Today tab.</p>
      </section>`;
  }
  const suggestions = ['What should I eat tonight?', 'My recovery is red. Should I still run?', 'Should I take a salt bath?', 'How do I water load safely?'];
  return `
    <h1 id="h-coach">AI coach</h1>
    ${state.goal ? `<section class="coachbox" data-slot="briefing">${briefingHtml()}</section>` : '<p class="small muted">Set up your cut first so the coach knows your plan.</p><a class="btn btn-primary" href="#setup">Set up my cut</a>'}
    <section class="sec">
      <div class="h-row"><h2>Chat</h2>${state.chat.length ? '<button class="btn btn-small" type="button" data-action="clear-chat">Clear</button>' : ''}</div>
      <div id="chat-log" class="chat-log" role="log" aria-live="polite" aria-label="Chat with the coach"></div>
      <div class="suggestions">${suggestions.map((s) => `<button class="btn btn-small" type="button" data-action="suggest" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <form id="chat-form" novalidate>
        <label for="chat-input" class="visually-hidden">Your question</label>
        <textarea id="chat-input" name="q" maxlength="500" placeholder="Ask about food, fluids, sleep or recovery" required></textarea>
        <button class="btn btn-primary btn-block" type="submit">Send</button>
      </form>
      <p class="fine">The coach is not a doctor. Dizzy, confused or fainting? Stop and get help: athletic trainer, doctor or 911.</p>
    </section>`;
}

function renderLearn() {
  if (!learnData) {
    loadLearn();
    return '<h1 id="h-learn">Safety</h1><p class="loading muted">Loading</p>';
  }
  const cls = { not_recommended: 'no', safety: 'safety', story: 'story' };
  const sections = learnData.sections.map((s) => `
    <section class="sec">
      <h2>${esc(s.title)}</h2>
      ${s.intro ? `<p class="intro">${esc(s.intro)}</p>` : ''}
      ${s.cards.map((c) => `
        <article class="learn-card ${cls[s.id] || ''}" aria-labelledby="lc-${esc(c.id)}">
          <h3 id="lc-${esc(c.id)}">${esc(c.title)}</h3>
          <p>${esc(c.what)}</p>
          <dl>
            ${c.healthRisk ? `<dt>Health risk</dt><dd>${esc(c.healthRisk)}</dd>` : ''}
            ${c.performanceCost ? `<dt>${s.id === 'not_recommended' ? 'Why it hurts performance' : 'Performance'}</dt><dd>${esc(c.performanceCost)}</dd>` : ''}
            ${c.saferAlternative ? `<dt>${s.id === 'not_recommended' ? 'Do this instead' : 'What to do'}</dt><dd>${esc(c.saferAlternative)}</dd>` : ''}
          </dl>
          ${sourcesHtml(c.sources)}
        </article>`).join('')}
    </section>`).join('');
  return `
    <h1 id="h-learn">Safety</h1>
    ${sections}
    <section class="sec">
      <h2>About the data</h2>
      <p class="small muted mt-s">MakeWeight reads the same metrics WHOOP's developer API provides: recovery score, resting heart rate, HRV, sleep performance and strain. The demo athlete uses that exact format. No wearable? Type in your weight, sleep and resting heart rate.</p>
      ${sourcesHtml(['whoop'])}
    </section>
    <section class="sec">
      <h2>All sources</h2>
      <ol class="source-list mt-s">${Object.values(SOURCES).map((s) => `<li>${esc(s.full)}${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Link</a>` : ''}</li>`).join('')}</ol>
    </section>`;
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
  const ft = isNum(p.heightIn) ? Math.floor(p.heightIn / 12) : '';
  const inch = isNum(p.heightIn) ? p.heightIn % 12 : '';
  const weighIn = g.weighInDate && g.weighInDate > derived.today ? g.weighInDate : '';
  const radio = (name, value, label, checked, hint = '') =>
    `<label class="choice"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span>${esc(label)}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</span></label>`;
  return `
    <h1 id="h-setup">${state.goal ? 'Edit your goal' : 'Set up your cut'}</h1>
    <form id="setup-form" novalidate>
      <section class="sec">
        <h2 class="mb">Your goal</h2>
        <div class="row">
          <div class="field"><label for="s-current">Current weight (lb)</label><input id="s-current" name="current" type="number" inputmode="decimal" step="0.1" min="60" max="450" value="${esc(current)}" required></div>
          <div class="field"><label for="s-target">Goal weight (lb)</label><input id="s-target" name="target" type="number" inputmode="decimal" step="0.1" min="60" max="450" value="${esc(g.targetWeightLb ?? '')}" required></div>
        </div>
        <p class="hint field-note">Goal = your weight class plus any allowance.</p>
        <div class="field"><label for="s-date">Weigh-in date</label><input id="s-date" name="weighIn" type="date" min="${esc(addDays(derived.today, 1))}" value="${esc(weighIn)}" required></div>
        <div id="setup-preview" aria-live="polite"></div>
      </section>
      <fieldset class="sec">
        <legend>Time from weigh-in to competing</legend>
        <div class="choices">
          ${Object.entries(WINDOWS).map(([k, w]) => radio('recoveryWindow', k, w.label, (g.recoveryWindow || 'under1h') === k, w.hint)).join('')}
        </div>
      </fieldset>
      <section class="sec">
        <h2>About you</h2>
        <p class="hint mb">Used only on this device to estimate calories. Never sent to the AI coach.</p>
        <fieldset>
          <legend>Sex (for the calorie formula)</legend>
          <div class="row">${radio('sex', 'male', 'Male', p.sex !== 'female')}${radio('sex', 'female', 'Female', p.sex === 'female')}</div>
        </fieldset>
        <div class="row">
          <div class="field"><label for="s-age">Age</label><input id="s-age" name="age" type="number" inputmode="numeric" min="12" max="70" value="${esc(p.age ?? '')}" required></div>
          <div class="field">
            <label for="s-ft">Height (ft / in)</label>
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
      </section>
      <p class="form-errors" id="setup-errors" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">Build my plan</button>
      <p class="fine">Saving starts your plan today from your current weight.</p>
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
      heightIn: isNum(ft) ? ft * 12 + inch : undefined,
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
  if (!isNum(v.current) || !isNum(v.target) || !isDateStr(v.weighIn)) {
    el.innerHTML = '';
    return;
  }
  const days = daysBetween(derived.today, v.weighIn);
  const a = assessGoal(v.current, v.target, days);
  if (a.status === 'invalid') {
    el.innerHTML = `<p class="form-errors">${esc(a.errors.join(' '))}</p>`;
    return;
  }
  const level = a.status === 'green' ? 'info' : a.status;
  el.innerHTML = `
    <div class="flagblock lv-${level}${a.status === 'green' ? ' lv-green' : ''}">
      <p class="cap">${esc(CUT_TYPES[a.cutType].label)} · ${days} days &nbsp; ${statusPill(a.status)}</p>
      <p class="plain">${esc(a.reason)}</p>
      ${a.status === 'red' ? `<p class="plain">If you save, MakeWeight plans to ${lb(a.safestWeightLb)} instead.</p>` : ''}
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
    else if (el.innerHTML) el.innerHTML = ''; // keep only the visible screen in the page
  }
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('#demo-badge').hidden = !state.demo;
  if (view === 'coach') renderChatLog();
  if (view === 'setup') updateSetupPreview();
  lastView = view;
}

function onRoute() {
  const view = currentView();
  // Remember how far down the previous tab was scrolled, so coming back feels seamless.
  if (lastView && lastView !== view) scrollPositions[lastView] = window.scrollY;
  if (view === 'recovery') recoveryInput = null; // fresh defaults from the latest plan
  render();
  const el = $(`#view-${view}`);
  el.classList.remove('view-enter');
  void el.offsetWidth; // restart the fade-in
  el.classList.add('view-enter');
  window.scrollTo(0, view === 'setup' ? 0 : scrollPositions[view] || 0);
  const h = $(`#view-${view} h1`);
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
    if (prev && isNum(prev.strain)) entry.strain = prev.strain;
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
      const y = window.scrollY;
      render(); // the hint and the 12+ hour question change with the window
      window.scrollTo(0, y);
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
