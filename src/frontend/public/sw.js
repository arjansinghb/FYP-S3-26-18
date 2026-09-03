// UV07 — Install the Application (PWA). A real service worker is one of
// Chrome/Edge's installability requirements (manifest + HTTPS/localhost +
// a fetch-handling service worker) — this one is intentionally minimal
// (network passthrough, no offline caching strategy) since offline support
// isn't a use case in the URS; it exists so "Add to Home Screen" appears.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
