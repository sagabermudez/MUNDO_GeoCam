const CACHE_NAME = 'mundo-geocam-v2'; // Increment this version number whenever you release an update
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json'
];

// Instantly activate new service worker and download fresh assets
self.addEventListener('install', (event) => {
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Force network fetch (cache: 'reload') so it doesn't cache stale HTTP files
      const cachePromises = ASSETS_TO_CACHE.map((url) => {
        return fetch(new Request(url, { cache: 'reload' })).then((response) => {
          if (!response.ok) throw new Error(`Failed to fetch ${url}`);
          return cache.put(url, response);
        });
      });
      return Promise.all(cachePromises);
    })
  );
});

// Clean up old caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch strategy: Network first, fall back to cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});