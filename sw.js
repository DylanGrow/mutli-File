/*
  FileBeam Service Worker
  Version: filebeam-v2
  
  Instructions:
  1. Save this file as 'sw.js' in the root directory.
  2. Ensure 'manifest.json' exists in the same directory.
  3. The browser will automatically update this cache when the VERSION string changes.
*/

const VERSION = 'filebeam-v2';

// List of assets to cache for offline use
const CACHE_FILES = [
  './',
  './index.html',
  './manifest.json'
];

// Install Event: Cache all assets
self.addEventListener('install', function(e) {
  console.log('[SW] Installing version:', VERSION);
  e.waitUntil(
    caches.open(VERSION)
      .then(function(cache) {
        console.log('[SW] Caching core files');
        return cache.addAll(CACHE_FILES);
      })
      .catch(function(err) {
        console.error('[SW] Cache installation failed:', err);
        // Fail the install if critical files aren't cached
        throw err; 
      })
  );
  // Skip waiting so the new worker activates immediately
  self.skipWaiting();
});

// Activate Event: Clean up old caches
self.addEventListener('activate', function(e) {
  console.log('[SW] Activating version:', VERSION);
  e.waitUntil(
    caches.keys().then(function(keyList) {
      return Promise.all(keyList.map(function(key) {
        if (key !== VERSION) {
          console.log('[SW] Removing old cache:', key);
          return caches.delete(key);
        }
      }));
    }).then(() => {
      // Claim all clients immediately so pages update without refresh
      return self.clients.claim();
    })
  );
});

// Fetch Event: Serve from cache, fallback to network
self.addEventListener('fetch', function(e) {
  // Only handle GET requests from our origin
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    caches.match(e.request).then(function(cachedResponse) {
      if (cachedResponse) {
        // Return cached version if found
        return cachedResponse;
      }

      // If not in cache, fetch from network
      return fetch(e.request).then(function(networkResponse) {
        // Don't cache non-200 responses
        if (networkResponse.status !== 200) {
          return networkResponse;
        }

        // Clone the response because streams can only be consumed once
        var responseClone = networkResponse.clone();
        
        // Update cache with the new response (Network First strategy)
        caches.open(VERSION).then(function(cache) {
          cache.put(e.request, responseClone);
        });

        return networkResponse;
      }).catch(function(error) {
        // If offline and not in cache, you could return a custom offline page here
        console.error('[SW] Fetch failed and no cache hit:', e.request.url);
        return new Response('Offline - FileBeam is unavailable without internet.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({
            'Content-Type': 'text/plain'
          })
        });
      });
    })
  );
});
