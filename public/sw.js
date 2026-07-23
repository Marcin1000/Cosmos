/* Cosmos — service worker (PWA)
   Statyczne pliki: cache-first (działa offline).
   API: zawsze sieć — czat wymaga połączenia z modelem. */

const CACHE = 'cosmos-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/fonts/fonts.css',
  '/fonts/IBMPlexSans-400-latin.woff2',
  '/fonts/IBMPlexSans-400-latin-ext.woff2',
  '/fonts/IBMPlexSans-500-latin.woff2',
  '/fonts/IBMPlexSans-500-latin-ext.woff2',
  '/fonts/IBMPlexSans-600-latin.woff2',
  '/fonts/IBMPlexSans-600-latin-ext.woff2',
  '/fonts/IBMPlexMono-400-latin.woff2',
  '/fonts/IBMPlexMono-400-latin-ext.woff2',
  '/fonts/IBMPlexMono-500-latin.woff2',
  '/fonts/IBMPlexMono-500-latin-ext.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API i streaming — zawsze przez sieć
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchAndUpdate = fetch(event.request).then((res) => {
        if (res.ok && url.origin === location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchAndUpdate;
    })
  );
});
