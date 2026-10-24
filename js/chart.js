// Lightweight SVG weight chart (no chart library needed).
// Actual weights vs the plan's target line, with the goal weight marked.

import { daysBetween, formatDate } from './dates.js';

const W = 340;
const H = 200;
const PAD = { top: 14, right: 12, bottom: 26, left: 40 };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Returns an SVG string. entries: [{date, weightLb}], plan: generatePlan output (optional),
 * today: 'YYYY-MM-DD'.
 */
export function weightChartSvg({ entries = [], plan = null, today = null }) {
  const points = entries.filter((e) => Number.isFinite(e.weightLb)).map((e) => ({ date: e.date, w: e.weightLb }));
  const planPts = (plan?.days || []).map((d) => ({ date: d.date, w: d.targetWeightLb }));
  const all = [...points, ...planPts];
  if (all.length < 2) {
    return '<p class="muted">Log at least two days of weight to see your chart.</p>';
  }
  const dates = all.map((p) => p.date).sort();
  const first = dates[0];
  const last = dates.at(-1);
  const spanDays = Math.max(1, daysBetween(first, last));
  const goal = plan?.assessment?.targetLb;
  const ws = all.map((p) => p.w).concat(Number.isFinite(goal) ? [goal] : []);
  const lo = Math.floor(Math.min(...ws) - 0.5);
  const hi = Math.ceil(Math.max(...ws) + 0.5);
  const yRange = Math.max(1, hi - lo);

  const x = (date) => PAD.left + (daysBetween(first, date) / spanDays) * (W - PAD.left - PAD.right);
  const y = (w) => PAD.top + ((hi - w) / yRange) * (H - PAD.top - PAD.bottom);
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');

  const step = yRange > 12 ? 5 : yRange > 6 ? 2 : 1;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);

  const latest = points.at(-1);
  const label = [
    'Weight chart.',
    latest ? `Latest ${latest.w} lb on ${formatDate(latest.date)}.` : '',
    Number.isFinite(goal) ? `Goal ${goal} lb.` : '',
    planPts.length ? `Plan runs ${formatDate(planPts[0].date)} to ${formatDate(planPts.at(-1).date)}.` : '',
  ].join(' ');

  const parts = [];
  parts.push(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`);
  for (const t of ticks) {
    parts.push(`<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`);
    parts.push(`<text class="axis-label" x="${PAD.left - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${t}</text>`);
  }
  parts.push(`<text class="axis-label" x="${PAD.left}" y="${H - 6}">${esc(formatDate(first))}</text>`);
  parts.push(`<text class="axis-label" x="${W - PAD.right}" y="${H - 6}" text-anchor="end">${esc(formatDate(last))}</text>`);
  if (Number.isFinite(goal)) {
    parts.push(`<line class="goal-line" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"/>`);
    // Label sits at the left end of the goal line, where it can't collide with the plan line's last point.
    parts.push(`<text class="goal-label" x="${PAD.left + 4}" y="${(y(goal) - 4).toFixed(1)}" text-anchor="start">Goal ${goal}</text>`);
  }
  if (today && today >= first && today <= last) {
    parts.push(`<line class="today-line" x1="${x(today).toFixed(1)}" x2="${x(today).toFixed(1)}" y1="${PAD.top}" y2="${H - PAD.bottom}"/>`);
  }
  if (planPts.length > 1) parts.push(`<path class="plan-line" d="${path(planPts)}"/>`);
  if (points.length > 1) parts.push(`<path class="actual-line" d="${path(points)}"/>`);
  for (const p of points) parts.push(`<circle class="dot" cx="${x(p.date).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="3"/>`);
  parts.push('</svg>');
  return parts.join('');
}
