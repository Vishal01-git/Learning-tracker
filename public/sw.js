const CACHE_NAME = 'learning-tracker-v2';
const API_CACHE = 'lt-api-cache-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/icon.png',
  '/manifest.json',
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => {
      // Take control of all open tabs immediately
      return self.clients.claim();
    }).then(() => {
      // Tell all clients to reload so they get the new version
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => client.navigate(client.url));
      });
    })
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET, WebSocket, and cross-origin
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API routes: network-first, fall back to cache
  if (url.pathname.startsWith('/api/state/') || url.pathname === '/api/leaderboard') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return new Response(
              JSON.stringify({ users: [], tasks: [], logs: [], streakFreezes: [], _offline: true }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          })
        )
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      });
    })
  );
});

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Learning Tracker', {
      body: data.body || "Don't forget your daily practice! 🔥",
      icon: '/icon.png',
      badge: '/icon.png',
      tag: 'daily-reminder',
      renotify: true,
      data: { url: '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) {
        clientList[0].focus();
      } else {
        clients.openWindow('/');
      }
    })
  );
});