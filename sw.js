/*
 * Offline support for the installed web app.
 * Network first so updates show up right away; the cache is only a fallback
 * for when there is no connection.
 */
const CACHE = 'loadlens-v1';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/calc.js',
  'js/app.js',
  'manifest.webmanifest',
  'assets/fonts/barlow-condensed-600.woff2',
  'assets/icons/icon.svg',
  'assets/icons/icon-32.png',
  'assets/icons/icon-180.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
