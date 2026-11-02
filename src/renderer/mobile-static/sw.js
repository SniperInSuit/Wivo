/*
 * Wivo phone app service worker.
 *
 * Caches only the app's own files (this origin), never an API answer: patient
 * and job data come from Supabase under RLS, every time, and are not kept on
 * the phone by this worker.
 *
 * Push messages carry NO content (sql/090): the push only says "something
 * happened", the notification says "New in Wivo", and tapping it opens the
 * app, which reads the details after sign-in. That one line comes in the
 * user's language: the app leaves it in the TEXT cache (mobile/main.tsx),
 * because a worker cannot load the i18n catalog.
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

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    const saved = await caches.open(TEXT).then(c => c.match('/push-text')).catch(() => undefined)
    const body = (saved && (await saved.text()).trim()) || 'New in Wivo'
    await self.registration.showNotification('Wivo', {
      body,
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
    if (open.length) return open[0].focus()
    return self.clients.openWindow('/')
  })())
})
