/* Haze Tracker SG service worker: offline app shell + background alert checks. */
importScripts('core.js');

const CACHE = 'haze-tracker-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'core.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

// Stale-while-revalidate for the app's own files. PSI API calls are never cached here.
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (cached) {
    const network = fetch(req).then(function (res) {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return cached || (req.mode === 'navigate' ? caches.match('./') : Response.error());
    });
    if (cached) e.waitUntil(network.catch(function () {}));
    return cached || network;
  }));
});

// Background check (Chromium on Android, when installed and allowed by the browser).
self.addEventListener('periodicsync', function (e) {
  if (e.tag !== 'haze-check') return;
  e.waitUntil(
    HazeCore.fetchLatest()
      .then(function (data) { return HazeCore.processData(data, self.registration); })
      .catch(function () {})
  );
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow('./');
    })
  );
});
