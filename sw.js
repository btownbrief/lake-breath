// Lake Breath service worker — cache-first for the app shell so the lake
// opens instantly and works offline. Never touches anything outside its
// own path or cache prefix (this origin is shared with the whole arcade).
// Bump VERSION on every deploy; no skipWaiting so an update can never
// swap files out from under a running session.
const VERSION = 'lake-breath-v11';
// mod.html is deliberately absent: the back room never gets installed on
// anybody's phone, and it should always be the live copy.
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js', 'js/engine.js', 'js/content.js', 'js/sound.js',
  'js/haptics.js', 'js/net.js', 'js/leaderboard.js', 'js/town.js',
  'js/scene-gl.js', 'js/bloom.js', 'js/stillness.js', 'js/photos.js',
  'assets/fonts/fraunces-normal-latin.woff2',
  'assets/fonts/fraunces-italic-latin.woff2',
  'assets/fonts/inter-normal-latin.woff2',
  'assets/grain.png',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
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
  if (url.origin !== location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PATH)) return;
  if (url.pathname.endsWith('/mod.html')) return; // the back room stays live
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) =>
      hit || fetch(e.request).then((res) => {
        if (res.ok && e.request.method === 'GET') {
          const copy = res.clone();
          e.waitUntil(caches.open(VERSION).then((c) => c.put(e.request, copy)));
        }
        return res;
      })),
  );
});
