// Vercel serverless function: POST /api/coach
// Holds the Gemini API key (server-side only) and talks to Google Gemini.
// The browser sends numbers only (no names). The rules engine already set
// every target; this function only asks the AI to explain them.
//
// Security notes:
// - This endpoint is public and has no login. It uses best-effort per-IP
//   rate limits, strict input validation and capped output to limit abuse.
// - On the Gemini free tier (no billing attached) there is no cost exposure,
//   but Google may use prompts to improve its products. That's why we send numbers only.

import {
  MAX_BODY_CHARS,
  MAX_QUESTION_CHARS,
  SYSTEM_PROMPT,
  buildInput,
  cleanText,
  sanitizeContext,
  sanitizeHistory,
} from '../js/coach-shared.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-flash-latest';
const FALLBACK_MODEL = 'gemini-2.5-flash';
const ATTEMPT_TIMEOUT_MS = 12_000;
const TOTAL_BUDGET_MS = 26_000; // stays under the 30 s maxDuration in vercel.json
const MAX_REPLY_CHARS = 2000;

const RATE_RULES = [
  { windowMs: 60_000, max: 6 }, // per minute
  { windowMs: 60 * 60_000, max: 60 }, // per hour
];

/** Simple in-memory sliding-window limiter. Best effort: each server instance has its own memory. */
export class RateLimiter {
  constructor(rules = RATE_RULES, maxKeys = 5000) {
    this.rules = rules;
    this.maxKeys = maxKeys;
    this.hits = new Map();
  }

  /** Records a hit and returns { ok, retryAfterSec }. */
  check(key, now = Date.now()) {
    const longest = Math.max(...this.rules.map((r) => r.windowMs));
    const list = (this.hits.get(key) || []).filter((t) => now - t < longest);
    for (const rule of this.rules) {
      const inWindow = list.filter((t) => now - t < rule.windowMs);
      if (inWindow.length >= rule.max) {
        this.hits.set(key, list);
        const retryAfterSec = Math.ceil((rule.windowMs - (now - inWindow[0])) / 1000);
        return { ok: false, retryAfterSec };
      }
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value);
    return { ok: true, retryAfterSec: 0 };
  }
}

const defaultLimiter = new RateLimiter();

/** Pulls the reply text out of a Gemini Interactions API response. */
export function extractText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  return steps
    .filter((s) => s?.type === 'model_output' && Array.isArray(s.content))
    .flatMap((s) => s.content)
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

/** Pulls the reply text out of a classic generateContent response (skipping "thought" parts). */
export function extractGenerateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => typeof p?.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
}

export class GeminiError extends Error {
  constructor(message, status = 0, reasons = []) {
    super(message);
    this.status = status;
    this.reasons = reasons;
  }
}

async function postJson({ url, apiKey, body, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Google's short error code (e.g. NOT_FOUND), never the key or the prompt. */
async function errorCode(res) {
  try {
    const d = await res.json();
    return String(d?.error?.status || d?.error?.code || '').slice(0, 40);
  } catch {
    return '';
  }
}

/** The ways we try to reach Gemini, in order. Later ones are fallbacks. */
function attemptsFor({ model, system, input, maxTokens }) {
  const interactions = (withThinking) => ({
    name: `interactions${withThinking ? '' : '-nothink'}:${model}`,
    url: `${GEMINI_BASE}/interactions`,
    body: {
      model,
      system_instruction: system,
      input,
      store: false,
      generation_config: withThinking
        ? { max_output_tokens: maxTokens, temperature: 0.4, thinking_level: 'low' }
        : { max_output_tokens: maxTokens, temperature: 0.4 },
    },
    extract: extractText,
  });
  const generate = (m) => ({
    name: `generate:${m}`,
    url: `${GEMINI_BASE}/models/${encodeURIComponent(m)}:generateContent`,
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: input }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
    },
    extract: extractGenerateText,
  });
  const list = [interactions(true), interactions(false), generate(model)];
  if (model !== FALLBACK_MODEL) list.push(generate(FALLBACK_MODEL));
  return list;
}

/**
 * Calls Gemini, trying the Interactions API first and falling back to the
 * classic generateContent API (and a second model) if that fails.
 * Stops right away on 429 (quota) so we don't burn the free-tier limit.
 */
export async function callGemini({ apiKey, model, system, input, maxTokens, fetchImpl = fetch, now = Date.now }) {
  const deadline = now() + TOTAL_BUDGET_MS;
  const reasons = [];
  for (const attempt of attemptsFor({ model, system, input, maxTokens })) {
    const remaining = deadline - now();
    if (remaining < 2000) {
      reasons.push('out of time');
      break;
    }
    let res;
    try {
      res = await postJson({ url: attempt.url, apiKey, body: attempt.body, fetchImpl, timeoutMs: Math.min(ATTEMPT_TIMEOUT_MS, remaining) });
    } catch (err) {
      reasons.push(`${attempt.name}=${err?.name === 'AbortError' ? 'timeout' : 'network'}`);
      continue;
    }
    if (!res.ok) {
      const code = await errorCode(res);
      reasons.push(`${attempt.name}=${res.status}${code ? ` ${code}` : ''}`);
      if (res.status === 429) throw new GeminiError('Gemini quota or rate limit reached', 429, reasons);
      if (res.status === 401 || res.status === 403) {
        // A bad key won't work on any endpoint; stop instead of retrying.
        throw new GeminiError('Gemini rejected the API key', res.status, reasons);
      }
      continue;
    }
    let data;
    try {
      data = await res.json();
    } catch {
      reasons.push(`${attempt.name}=bad-json`);
      continue;
    }
    const text = attempt.extract(data);
    if (text) return text.slice(0, MAX_REPLY_CHARS);
    reasons.push(`${attempt.name}=empty${data?.status ? `(${data.status})` : ''}`);
  }
  throw new GeminiError('All Gemini attempts failed', 502, reasons);
}

const json = (status, body, headers = {}) => ({ status, body, headers });

/**
 * Core handler, separated from Vercel's req/res so it's easy to test.
 * Returns { status, body, headers }.
 */
export async function handleCoach({ method, body, ip = 'unknown', env = process.env, fetchImpl = fetch, limiter = defaultLimiter, now = Date.now() }) {
  if (method !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });

  let payload = body;
  if (typeof payload === 'string') {
    if (payload.length > MAX_BODY_CHARS) return json(413, { error: 'Request is too large.' });
    try {
      payload = JSON.parse(payload);
    } catch {
      return json(400, { error: 'Request must be JSON.' });
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json(400, { error: 'Request must be a JSON object.' });
  if (JSON.stringify(payload).length > MAX_BODY_CHARS) return json(413, { error: 'Request is too large.' });

  const mode = payload.mode;
  if (mode !== 'briefing' && mode !== 'chat') return json(400, { error: 'mode must be "briefing" or "chat".' });

  const { context, errors } = sanitizeContext(payload.context);
  if (!context) return json(400, { error: 'Invalid context.', details: errors.slice(0, 5) });

  let question = '';
  let history = [];
  if (mode === 'chat') {
    if (typeof payload.question !== 'string' || payload.question.length > MAX_QUESTION_CHARS) {
      return json(400, { error: `question must be text up to ${MAX_QUESTION_CHARS} characters.` });
    }
    question = cleanText(payload.question, MAX_QUESTION_CHARS);
    if (!question) return json(400, { error: 'question is empty.' });
    const h = sanitizeHistory(payload.history);
    if (!h.history) return json(400, { error: 'Invalid history.', details: h.errors.slice(0, 5) });
    history = h.history;
  }

  const rate = limiter.check(ip, now);
  if (!rate.ok) {
    return json(429, { error: 'The coach needs a breather. Try again in a minute.' }, { 'Retry-After': String(rate.retryAfterSec) });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json(503, { error: 'The AI coach is not set up yet (missing API key).' });

  try {
    const text = await callGemini({
      apiKey,
      model: env.GEMINI_MODEL || DEFAULT_MODEL,
      system: SYSTEM_PROMPT,
      input: buildInput(mode, context, question, history),
      // Gemini counts its hidden "thinking" toward this cap, so leave room for it.
      // Replies are still kept short by the prompt and trimmed to 2000 characters.
      maxTokens: 2048,
      fetchImpl,
    });
    return json(200, { text, source: 'ai' });
  } catch (err) {
    // Log Google's status codes for debugging (visible in Vercel's function logs). Never the key or the prompt.
    console.error('coach: gemini failed', err?.status, (err?.reasons || []).join(' | '));
    const status = err?.status === 429 ? 503 : 502;
    const reason =
      err?.status === 429 ? 'quota'
        : err?.status === 401 || err?.status === 403 ? 'key'
          : 'upstream';
    return json(status, { error: 'The AI coach is unavailable right now. Showing the rules-based plan instead.', reason });
  }
}

function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/** Vercel entry point. */
export default async function handler(req, res) {
  const result = await handleCoach({ method: req.method, body: req.body, ip: clientIp(req) });
  for (const [k, v] of Object.entries(result.headers || {})) res.setHeader(k, v);
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status).json(result.body);
}
