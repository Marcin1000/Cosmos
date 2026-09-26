/* Cosmos — service worker (PWA)
   Statyczne pliki: cache-first (działa offline).
   API: zawsze sieć — czat wymaga połączenia z modelem. */

const CACHE = 'cosmos-v124';

const STATIC_ASSETS = [
  '/app',
  '/index.html',
  '/style.css',
  '/app.js',
  '/nasluch.js',
  '/i18n.js',
  '/models.js',
  '/narzedzia.js',
  '/widoki.js',
  '/tekst.js',
  '/protokol.js',
  '/plener.js',
  '/mowa.js',
  '/konta.js',
  '/manifest.webmanifest',
  '/icons/cosmos.svg',
  '/icons/cosmos-192.png',
  '/icons/cosmos-512.png',
  '/icons/cosmos-apple-touch.png',
  '/icons/cosmos-maska.svg',
  '/icons/cosmos-maskable-192.png',
  '/icons/cosmos-maskable-512.png',
  '/fonts/fonts.css',
  '/fonts/Onest-latin.woff2',
  '/fonts/Onest-latin-ext.woff2',
  '/fonts/MartianMono-latin.woff2',
  '/fonts/MartianMono-latin-ext.woff2',
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
  /* Strona produktowa (/ i /strona/) nie jest częścią aplikacji offline:
     ma przychodzić świeża, a nie z pamięci telefonu sprzed tygodnia. */
  if (url.origin === location.origin && (url.pathname === '/' || url.pathname.startsWith('/strona/'))) return;

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
