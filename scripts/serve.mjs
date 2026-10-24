// Local dev server: serves the site and runs /api/coach just like Vercel does.
// Reads GEMINI_API_KEY from .env if present. Only listens on this computer (127.0.0.1).
// Run with: npm run dev   then open http://localhost:5173

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleCoach } from '../api/coach.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;

// Load .env (simple KEY=VALUE lines) without printing any values.
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const BLOCKED = /(^|[\\/])(\.|node_modules|tests|scripts)/; // dotfiles (.env, .git), deps, dev-only folders

async function readBody(req, limit = 20_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/coach') {
    let body = null;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(413, { 'Content-Type': 'application/json' }).end('{"error":"Request is too large."}');
      return;
    }
    const result = await handleCoach({ method: req.method, body, ip: req.socket.remoteAddress });
    res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...result.headers });
    res.end(JSON.stringify(result.body));
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT + sep) || BLOCKED.test(file.slice(ROOT.length))) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`MakeWeight running at http://localhost:${PORT}`);
  console.log(process.env.GEMINI_API_KEY ? 'AI coach: key found in .env' : 'AI coach: no GEMINI_API_KEY yet (rules-based briefings only)');
});
