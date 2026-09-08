// Strategy: network-first for the app shell, scripts, and stylesheets.
//
// This app is deployed to GitHub Pages, where a service worker is the only
// mechanism a client has for getting a new build at all -- there is no
// server to bust a cache. A cache-first strategy means the FIRST bundle a
// browser ever fetches is served forever after, silently, with no signal to
// the user or a way to force an update short of clearing site data. That is
// strictly worse than having no cache: it has already caused a real device
// to keep running a build several commits stale, missing UI and still using
// the old localStorage persistence instead of IndexedDB + Supabase sync.
//
// So: always try the network first for navigations and same-origin
// scripts/styles, and only fall back to the cache when the network is
// actually unavailable (offline, in an auction yard with no signal). The
// cache exists purely for that offline fallback -- never as the primary
// source of truth for the app shell. Do NOT "optimise" this back to
// cache-first; that reintroduces the stale-bundle defect.
//
// Supabase (or any other cross-origin) requests are never touched by this
// worker at all -- stale API data is far more dangerous than a slow load,
// since it could show an inspector another user's superseded values as if
// they were current.

const CACHE = 'ehs-auction-inspector-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

function isSameOrigin(url) {
  try {
    return new URL(url, self.location.href).origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;
  if (!isSameOrigin(request.url)) return; // never touch Supabase or other cross-origin requests

  const isNavigation = request.mode === 'navigate';
  const dest = request.destination;
  const shouldNetworkFirst = isNavigation || dest === 'script' || dest === 'style';

  if (!shouldNetworkFirst) {
    // Other same-origin same-origin assets (images, fonts, etc.) can use a
    // cache-first approach safely since they're rarely the source of a
    // stale-app problem, but still fall back to network if not cached.
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      }))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached => {
          if (cached) return cached;
          if (isNavigation) return caches.match('./index.html');
          return Promise.reject(new Error('offline and not cached'));
        })
      )
  );
});
