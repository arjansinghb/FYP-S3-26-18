// PA20/PA22 real push delivery — dev-session 2026-08-17. Browser-side half
// of app/services/push_service.py (backend). Requests Notification
// permission, subscribes via the W3C Push API using the backend's VAPID
// public key, and registers the resulting subscription so the backend can
// actually send to it. Requires the service worker (public/sw.js) to be
// registered first — see main.tsx; that only happens in production builds
// (`vite build && vite preview`), not `vite dev`, so this silently no-ops
// there rather than throwing.
import * as parentApi from '../api/parentClient'

// PushManager.subscribe wants the VAPID key as a raw Uint8Array, not the
// base64url string the backend hands back — standard conversion boilerplate
// for the Web Push API.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export async function subscribeToPush(token: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const { public_key, configured } = await parentApi.getPushPublicKey()
  if (!configured) return false

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // TS's lib.dom currently mistypes Uint8Array as not satisfying
      // BufferSource (SharedArrayBuffer-related overload noise) — the value
      // itself is correct per the Push API spec, hence the cast.
      applicationServerKey: urlBase64ToUint8Array(public_key) as BufferSource,
    }))

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false

  await parentApi.subscribeToPush(token, {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  })
  return true
}

export async function unsubscribeFromPush(token: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await parentApi.unsubscribeFromPush(token, endpoint)
}
