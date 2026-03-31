const CACHE_NAME = 'mlaude-v1';

// install: no precaching (auth-protected pages must not be cached)
self.addEventListener('install', () => {
  self.skipWaiting();
});

// activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

// fetch: cache-first for static assets only, network-only for everything else
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API requests or navigation (auth-protected pages)
  if (url.pathname.startsWith('/api/') || event.request.mode === 'navigate') return;

  // Cache-first for static assets
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }
});
