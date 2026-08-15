// Lake Breath service worker — cache-first for the app shell so the lake
// opens instantly and works offline. Network-only for Supabase calls.
// Bump VERSION on every deploy; the new worker waits (no skipWaiting) so
// an update can never swap files out from under a running session.
const VERSION = 'lake-breath-v1';
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
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // supabase, nav.js: network
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
