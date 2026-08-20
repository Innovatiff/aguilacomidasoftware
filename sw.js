/**
 * Service worker.
 *
 * Caches the app shell so it opens on a farm road with no signal. Two rules
 * keep that from turning into a stale app:
 *
 *   - Application code is network-first, so a deployed fix is live on the next
 *     load rather than the one after it. The cache is the offline fallback.
 *   - Firestore and Auth traffic is never touched. The SDK has its own offline
 *     layer, and a stale cached API response is worse than no response.
 *
 * Bump VERSION when the shell list changes; `activate` drops every older cache.
 */

const VERSION = 'aguila-admin-v2';
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

  const sameOrigin = url.origin === self.location.origin;
  const isAppCode = sameOrigin
    && (request.mode === 'navigate' || /\.(?:html|js|css|webmanifest)$/.test(url.pathname));

  /*
   * Application code is network-first.
   *
   * Cache-first was wrong here: a released fix would sit behind the old copy
   * until the *next* load, so people kept using a version that had already
   * been replaced — and a stale bundle is far worse than a slow one. The cache
   * is still the fallback, so the app opens on a farm road with no signal; it
   * is just no longer the preferred answer when the network can reply.
   */
  if (isAppCode) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }

  // Fonts, icons and other static assets: cache first, refresh behind it.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request).then((response) => {
        if (response.ok && (sameOrigin || url.hostname.endsWith('gstatic.com'))) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => hit);
      return hit || network;
    }),
  );
});
