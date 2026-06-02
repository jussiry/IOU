/*
Tally service worker — gives the app an installable, offline-capable shell.

Strategy: precache + cache-first. At build time scripts/build-client.cjs writes
dist/precache-manifest.js, listing every static asset (templates, styles, built
JS, vendor libs, icons) tagged with a content hash plus a combined version hash.
This worker pulls that list in via importScripts and, on install, fetches every
asset fresh into a versioned cache. Once activated it serves those assets from
the cache, so the app boots instantly and works with no network.

Updates: because precache-manifest.js changes bytes whenever any cached file
changes, the browser's byte-for-byte worker comparison detects an update and
installs the new worker in the "waiting" state. It does NOT auto-activate — the
page keeps running the old version until the user accepts the update (the app
posts a SKIP_WAITING message), so a refresh never happens mid-interaction. This
is the worker's own content-hash versioning, separate from data/version.json
(which gates data-model migrations).
*/

importScripts("dist/precache-manifest.js");

const VERSION = self.__PRECACHE_VERSION || "dev";
const CACHE_NAME = `tally-precache-${VERSION}`;
const PRECACHE = Array.isArray(self.__PRECACHE) ? self.__PRECACHE : [];

// Absolute URLs (origin + path, no query/hash) of everything we precache, used
// to decide in the fetch handler whether a request can be served from cache.
const toAbsolute = (url) => new URL(url, self.location.href).href;
const PRECACHED_URLS = new Set(PRECACHE.map((entry) => toAbsolute(entry.url)));
const INDEX_URL = toAbsolute("index.html");

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Fetch each asset bypassing the HTTP cache so the install always grabs
      // the freshly deployed bytes. Done individually so one bad URL cannot
      // abort the whole precache (cache.addAll is all-or-nothing).
      await Promise.all(
        PRECACHE.map(async (entry) => {
          try {
            const request = new Request(toAbsolute(entry.url), { cache: "reload" });
            const response = await fetch(request);
            if (response.ok) await cache.put(toAbsolute(entry.url), response.clone());
          } catch {
            // A single asset failing to precache should not fail the install;
            // the fetch handler falls back to the network for it at runtime.
          }
        }),
      );
      // Stay in "waiting" — the app decides when to apply the update.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("tally-precache-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// The app posts this when the user accepts an update; we activate immediately so
// the next controllerchange can reload the page onto the new version.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

const cacheFirst = async (cacheKey, request) => {
  const cached = await caches.match(cacheKey);
  if (cached) return cached;
  return fetch(request);
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin go to network

  const normalized = url.origin + url.pathname;

  if (PRECACHED_URLS.has(normalized)) {
    event.respondWith(cacheFirst(normalized, request));
    return;
  }

  // App-shell fallback: any in-scope navigation (e.g. "/") serves index.html.
  if (request.mode === "navigate") {
    event.respondWith(cacheFirst(INDEX_URL, request));
    return;
  }

  // Everything else (signaling, runtime data) goes straight to the network.
});
