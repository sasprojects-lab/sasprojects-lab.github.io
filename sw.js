// SAS Player Service Worker
// Caches the app shell for fast load and offline UI

const CACHE_NAME = 'sas-player-v2';
const SHELL_ASSETS = [
  './index.html',
  './sas-player-styles.css',
  './sas-player-script.js',
  './sas-icon.jpg',
  './sas-player-logo-1.png',
  './sas-player-logo-light.png',
  './manifest.json'
];

// ─── Install: cache all shell assets ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

// ─── Activate: purge old caches ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch: shell-first, network fallback ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  // Only handle same-origin GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Let YouTube API / Firebase / CDN requests go straight to network
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Return cached version immediately, then update cache in background
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached); // If network fails, use cache

      return cached || networkFetch;
    })
  );
});
