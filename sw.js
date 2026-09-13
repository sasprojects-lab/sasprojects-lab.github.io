// SAS Player Service Worker v3.1.4
// Network-first for app shell, cache fallback for offline resilience
// Forces immediate activation and notifies clients on update

const CACHE_NAME = 'sas-player-v3.1.4';
const SHELL_ASSETS = [
  './index.html',
  './sas-player-styles.css',
  './sas-player-script.js',
  './sas-player-logo-1.png',
  './sas-player-logo-light.png',
  './manifest.json'
];

// ─── Install: cache all shell assets resiliently, then skip waiting immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of SHELL_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[SW] Asset cached failed (non-fatal):', asset);
        }
      }
    })
  );
  self.skipWaiting();
});

// ─── Activate: purge ALL old caches, claim clients, notify them ──────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => {
      // Notify all open tabs/clients that a new SW version is active
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
        });
      });
    })
  );
  self.clients.claim();
});

// ─── Listen for SKIP_WAITING messages from the page ──────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── Fetch: NETWORK-FIRST for app shell, cache as fallback ───────────────────
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

  // Network-first strategy: always try the network, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache (offline fallback)
        return caches.match(event.request);
      })
  );
});
