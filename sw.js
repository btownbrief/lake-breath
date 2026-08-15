// Lake Breath service worker — cache-first for the app shell so the lake
// opens instantly and works offline. Network-only for Supabase calls.
// Bump VERSION on every deploy; the new worker waits (no skipWaiting) so
// an update can never swap files out from under a running session.
const VERSION = 'lake-breath-v2';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js', 'js/engine.js', 'js/content.js', 'js/audio.js',
  'js/haptics.js', 'js/net.js', 'js/leaderboard.js',
  'assets/fonts/instrument-serif-latin.woff2',
  'assets/fonts/instrument-serif-italic-latin.woff2',
  'assets/fonts/dm-sans-latin.woff2',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  // caches.keys() is ORIGIN-wide and this app shares play.btownbrief.com
  // with the whole arcade — only ever touch our own prefixed caches.
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys
        .filter((k) => k.startsWith('lake-breath-') && k !== VERSION)
        .map((k) => caches.delete(k)))),
  );
});

const SCOPE_PATH = new URL(self.registration.scope).pathname;

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // supabase etc: network
  // Same-origin but outside our scope path (nav.js, ticker.js, other
  // arcade apps' assets): never intercept — fleet fixes must ship live.
  if (!url.pathname.startsWith(SCOPE_PATH)) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) =>
      hit || fetch(e.request).then((res) => {
        if (res.ok && e.request.method === 'GET') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })),
  );
});
