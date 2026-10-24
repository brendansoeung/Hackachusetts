// Quick check that the local server serves every app file and blocks secrets.
// Run with: node scripts/check-server.mjs (while npm run dev is running)
const base = process.argv[2] || 'http://localhost:5173';
const must200 = ['/', '/index.html', '/css/styles.css', '/js/app.js', '/js/rules.js', '/data/learn.json', '/data/sample-athlete.json', '/manifest.webmanifest', '/sw.js', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];
const must404 = ['/.env', '/.git/config', '/tests/ui.test.js', '/scripts/serve.mjs', '/%2e%2e/%2e%2e/Windows/win.ini', '/%2e%2e%2fpackage.json'];
let ok = true;
for (const p of must200) {
  const r = await fetch(base + p);
  if (r.status !== 200) { ok = false; console.log(`FAIL ${p} -> ${r.status}`); }
}
for (const p of must404) {
  const r = await fetch(base + p);
  if (r.status !== 404) { ok = false; console.log(`FAIL (should be blocked) ${p} -> ${r.status}`); }
}
const coach = await fetch(base + '/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'briefing', context: { status: 'green' } }) });
console.log(`/api/coach -> ${coach.status} ${JSON.stringify(await coach.json())}`);
const bad = await fetch(base + '/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'briefing', context: { name: 'Sam' } }) });
console.log(`/api/coach with a name -> ${bad.status}`);
console.log(ok ? 'ALL FILE CHECKS PASSED' : 'SOME CHECKS FAILED');
