// Minimal service worker — exists so the browser's install-prompt criteria
// are met (manifest + a service worker with a fetch handler). Deliberately
// simple: cache-first for the app shell (index.html + this file), everything
// else (including all API calls) goes straight to the network — this is NOT
// a full offline-first strategy, just enough for UV07 (Install the
// Application) installability. A real offline strategy (e.g. caching the
// static JS/CSS bundle, handling API failures gracefully) is a follow-up,
// not attempted here.
const CACHE_NAME = 'storybuddy-shell-v1'
const SHELL_URLS = ['/', '/chat']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // Never cache API calls — always hit the network for anything not same-
  // origin static navigation.
  if (event.request.method !== 'GET' || !SHELL_URLS.includes(url.pathname)) {
    return
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  )
})

// PA20/PA22 real push delivery — dev-session 2026-08-17. The backend's
// app/services/push_service.py sends `{title, body}` as the push message
// payload (see that module's docstring for the VAPID/no-FCM decision) —
// this just displays it as a native OS notification. Clicking it focuses
// an already-open StoryBuddy tab if one exists, otherwise opens one at
// /dashboard (parent-facing content only — push is a parent-side feature,
// per §2.2's "distinct surfaces" rule, never shown to the child).
self.addEventListener('push', (event) => {
  let payload = { title: 'StoryBuddy', body: 'You have a new notification.' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    // Non-JSON payload (shouldn't happen from our own backend) — fall back
    // to the default text above rather than throwing.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      return self.clients.openWindow('/dashboard')
    })
  )
})
