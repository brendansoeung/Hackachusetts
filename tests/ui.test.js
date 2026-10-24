// UI smoke test: loads the real index.html + app.js in a simulated browser (jsdom),
// walks through every screen with the demo athlete, and checks the coach payload.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8').replace(/<script[^>]*src="\/js\/app.js"[^>]*><\/script>/, '');
const dom = new JSDOM(html, { url: 'https://makeweight.test/#today', pretendToBeVisual: true });
const { window } = dom;
const coachCalls = [];

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const $ = (sel) => window.document.querySelector(sel);
const view = (name) => $(`#view-${name}`);
const go = async (hash) => {
  window.location.hash = hash;
  await flush();
};

before(async () => {
  window.scrollTo = () => {};
  window.confirm = () => true;
  for (const name of ['window', 'document', 'location', 'navigator', 'localStorage', 'FormData', 'FileReader', 'HTMLElement']) {
    setGlobal(name, window[name]);
  }
  setGlobal('confirm', () => true);
  setGlobal('fetch', async (url, init) => {
    if (url === '/api/coach') {
      const body = JSON.parse(init.body);
      coachCalls.push(body);
      const text = body.mode === 'briefing' ? '**Recovery is red.** Today is an easy day.' : 'No salt baths. They dehydrate you and sap your strength. Talk to your athletic trainer.';
      return { ok: true, status: 200, json: async () => ({ text, source: 'ai' }) };
    }
    const file = new URL(url.replace(/^\//, ''), root);
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
  });
  await import('../js/app.js');
  await flush();
});

test('first run shows the welcome screen', () => {
  assert.equal(view('today').hidden, false);
  assert.match(view('today').textContent, /Make weight\. Stay strong\./);
  assert.ok($('[data-action="load-demo"]'));
});

test('loading the demo shows red wearable flags, an eased plan and the water loading warning', async () => {
  $('[data-action="load-demo"]').click();
  await flush(12);
  const t = view('today').textContent;
  assert.match(t, /Mid-term cut/);
  assert.match(t, /Tight/);
  assert.match(t, /Recovery is low \(27%\)/);
  assert.match(t, /Resting heart rate is up 9 bpm/);
  assert.match(t, /Plan eased/);
  assert.match(t, /Water loading: read this first/);
  assert.match(t, /not medical professionals/);
  assert.match(t, /Rules-based/, 'AI is off until the privacy note is accepted');
  assert.equal($('#demo-badge').hidden, false);
  assert.equal(coachCalls.length, 0, 'nothing is sent to the AI before the athlete opts in');
});

test('plan screen lists every day and highlights today', async () => {
  await go('#plan');
  assert.equal(view('plan').hidden, false);
  assert.equal(view('plan').querySelectorAll('.day').length, 11);
  assert.ok(view('plan').querySelector('.day[aria-current="date"]'));
  assert.match(view('plan').textContent, /Water loading/);
});

test('log screen shows the chart and saving an entry re-runs alerts', async () => {
  await go('#log');
  assert.ok(view('log').querySelector('svg.chart'));
  assert.equal(view('log').querySelectorAll('.entries li').length, 14);
  const form = $('#log-form');
  form.elements.weightLb.value = '111.2';
  form.requestSubmit();
  await flush();
  assert.match($('#toast').textContent, /Saved\. \d red flag/);
});

test('recovery screen builds the under-1-hour plan with food examples', async () => {
  await go('#recovery');
  const t = view('recovery').textContent;
  assert.match(t, /Under 1 hour: your plan/);
  assert.match(t, /Start sipping an electrolyte drink/);
  assert.match(t, /Option 1:/);
  assert.match(t, /Don't overeat/);
  const radio = view('recovery').querySelector('input[name="window"][value="12plus"]');
  radio.checked = true;
  radio.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flush();
  assert.match(view('recovery').textContent, /Overnight \(12\+ hours\): your plan/);
  assert.ok(view('recovery').querySelector('#rec-heavy'));
});

test('coach: privacy opt-in, AI briefing, chat, and a numbers-only payload', async () => {
  await go('#coach');
  assert.match(view('coach').textContent, /numbers only/);
  $('[data-action="accept-privacy"]').click();
  await flush(12);
  assert.equal(coachCalls[0].mode, 'briefing');
  assert.match(view('coach').textContent, /Today is an easy day/);
  assert.ok(view('coach').querySelector('.badge-ai'));

  const input = $('#chat-input');
  input.value = 'Should I take a salt bath?';
  $('#chat-form').requestSubmit();
  await flush(12);
  const chat = coachCalls.find((c) => c.mode === 'chat');
  assert.equal(chat.question, 'Should I take a salt bath?');
  assert.match($('#chat-log').textContent, /No salt baths/);

  for (const call of coachCalls) {
    const sent = JSON.stringify(call.context);
    for (const k of ['"sex"', '"age"', '"heightIn"', '"name"']) assert.ok(!sent.includes(k), `payload leaked ${k}`);
  }
});

test('learn screen renders every safety card with sources', async () => {
  await go('#learn');
  await flush(6);
  const cards = view('learn').querySelectorAll('.learn-card');
  assert.ok(cards.length >= 12);
  for (const c of cards) assert.ok(c.querySelector('.sources'), 'card has a source line');
  assert.match(view('learn').textContent, /Forced vomiting/);
});

test('setup form previews the safety verdict as you type', async () => {
  await go('#setup');
  const form = $('#setup-form');
  form.elements.current.value = '112';
  form.elements.target.value = '106';
  const d = new Date();
  d.setDate(d.getDate() + 3);
  form.elements.weighIn.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  form.elements.target.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.match($('#setup-preview').textContent, /Not safe in this timeframe/);
  assert.match($('#setup-preview').textContent, /plans to 106\.4 lb/);
});

test('saving the setup builds a new plan and returns to Today', async () => {
  const form = $('#setup-form');
  form.elements.target.value = '107';
  form.requestSubmit();
  await flush(12);
  assert.equal(window.location.hash, '#today');
  assert.match(view('today').textContent, /Short-term cut/);
});
