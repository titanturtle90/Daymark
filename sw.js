const CACHE_NAME = "daymark-v10";
const PRECACHE_URLS = [
  "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
  "./css/app.css?v=8",
  "./js/config.js?v=2", "./js/core.js?v=2", "./js/photos.js?v=1", "./js/store.js?v=2", "./js/lock.js?v=1",
  "./js/editor.js?v=2", "./js/calendar.js?v=2", "./js/day.js?v=2", "./js/query.js?v=3", "./js/search.js?v=4", "./js/onthisday.js?v=1",
  "./js/backup.js?v=2", "./js/import.js?v=1", "./js/settings.js?v=2", "./js/app.js?v=2"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Firebase's sign-in helper pages must always come from the network.
  if (url.pathname.startsWith("/__/")) return;

  // The page itself: network-first so updates land on the next open; cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req, { cache: "no-store" }).catch(() => caches.match("./index.html")));
    return;
  }

  // Same-origin assets: cache-first, refreshed in the background.
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req, { cache: "reload" }).then(res => {
          if (res && res.ok) caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Fonts and the Firebase SDK: cache-first. Everything else (Firestore, Storage, maps) goes to the network.
  if (url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com" || (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"))) {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        if (res && (res.ok || res.type === "opaque")) caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
        return res;
      }))
    );
  }
});
