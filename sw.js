/**
 * Service worker.
 *
 * Caches the app shell so the kitchen can open the app on a farm road with no
 * signal. It deliberately never caches Firestore or Auth traffic: the SDK has
 * its own offline layer (IndexedDB) and a stale cached API response would be
 * worse than no response at all.
 */

const VERSION = 'aguila-admin-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/screens.css',
  './assets/icon.svg',
  './js/app.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // addAll fails the whole install if any single file 404s; tolerate that
      // so a missing optional asset can never brick the app.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isApi = /googleapis\.com|firebaseio\.com|firebaseapp\.com|identitytoolkit/.test(url.hostname);
  if (isApi) return;   // let the Firebase SDK handle its own offline behaviour

  // Navigations: serve the shell so a deep link works offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Everything else: cache first, refresh in the background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request).then((response) => {
        if (response.ok && (url.origin === self.location.origin || url.hostname.endsWith('gstatic.com'))) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => hit);
      return hit || network;
    }),
  );
});
