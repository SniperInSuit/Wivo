/*
 * Wivo phone app service worker.
 *
 * Caches only the app's own files (this origin), never an API answer: patient
 * and job data come from Supabase under RLS, every time, and are not kept on
 * the phone by this worker.
 *
 * A push carries a title and a short hint and nothing else (sql/103):
 * "Work assigned" / "Open Wivo to see the job", or "3 new notifications" —
 * never a job code, patient or name, because it shows on the lock screen. The
 * sender writes them in the person's language and encrypts them for this
 * browser. A push without them (an older sender) shows one line in the
 * user's language, which the app leaves in the TEXT cache (mobile/main.tsx)
 * because a worker cannot load the i18n catalog. The title never repeats
 * "Wivo": the phone already shows the app's name beside it.
 *
 * Tapping it opens the bell list: an open window is told to, otherwise the
 * app opens on /?notifications=1 (NotificationBell).
 */
const CACHE = 'wivo-shell-v1'
const TEXT = 'wivo-text'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE && key !== TEXT) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    // The page: network first, the cached shell when offline.
    event.respondWith(fetch(req).then(res => {
      const copy = res.clone()
      caches.open(CACHE).then(c => c.put('/index.html', copy))
      return res
    }).catch(() => caches.match('/index.html')))
    return
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/sounds/') || url.pathname === '/icon-256.png') {
    // Hashed or static files: cache first. Never keep the index.html that the
    // catch-all rewrite (_redirects) serves for a file that no longer exists.
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(req, copy))
      }
      return res
    })))
  }
})

/** The title and hint inside a push, or null. Short, whatever arrives. */
function pushWords(data) {
  try {
    const d = data ? data.json() : null
    if (d && typeof d.title === 'string' && d.title.trim()) {
      return { title: d.title.trim().slice(0, 80), body: typeof d.body === 'string' ? d.body.trim().slice(0, 120) : '' }
    }
  } catch { /* not ours, or no text: the generic line */ }
  return null
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let words = pushWords(event.data)
    if (!words) {
      const saved = await caches.open(TEXT).then(c => c.match('/push-text')).catch(() => undefined)
      words = { title: (saved && (await saved.text()).trim()) || 'New notification', body: '' }
    }
    await self.registration.showNotification(words.title, {
      body: words.body,
      icon: '/icon-256.png',
      badge: '/icon-256.png',
      tag: 'wivo',
      renotify: true,
    })
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (open.length) {
      open[0].postMessage({ type: 'wivo:open-notifications' })
      return open[0].focus()
    }
    return self.clients.openWindow('/?notifications=1')
  })())
})
