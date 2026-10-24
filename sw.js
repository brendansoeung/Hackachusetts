// MakeWeight service worker: lets the app open offline.
// Network first (so new deploys show up right away), falling back to the cache.
// The AI coach endpoint is never cached.

const CACHE = 'makeweight-v1';
const SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/js/app.js',
  '/js/alerts.js',
  '/js/chart.js',
  '/js/coach.js',
  '/js/coach-shared.js',
  '/js/dates.js',
  '/js/limits.js',
  '/js/recovery.js',
  '/js/rules.js',
  '/js/sources.js',
  '/js/storage.js',
  '/data/learn.json',
  '/data/sample-athlete.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html'))),
  );
});
