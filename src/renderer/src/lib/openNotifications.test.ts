import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { takeOpenNotificationsRequest, OPEN_NOTIFICATIONS_MESSAGE } from './openNotifications'

describe('opening the bell list from a tapped push', () => {
  it('the app started on /?notifications=1: open, and the marker leaves the address', () => {
    const urls: string[] = []
    expect(takeOpenNotificationsRequest({ pathname: '/', search: '?notifications=1', hash: '' }, u => urls.push(u))).toBe(true)
    expect(urls).toEqual(['/'])
    expect(takeOpenNotificationsRequest({ pathname: '/job/x', search: '?a=b&notifications=1', hash: '#h' }, u => urls.push(u))).toBe(true)
    expect(urls[1]).toBe('/job/x?a=b#h')
  })

  it('otherwise nothing', () => {
    const urls: string[] = []
    expect(takeOpenNotificationsRequest({ pathname: '/', search: '', hash: '' }, u => urls.push(u))).toBe(false)
    expect(takeOpenNotificationsRequest({ pathname: '/', search: '?notifications=0', hash: '' }, u => urls.push(u))).toBe(false)
    expect(urls).toEqual([])
  })
})

/** The phone's service worker, run against stand-ins for the browser. */
function loadWorker(opts: { windows?: number; cachedTitle?: string } = {}) {
  const listeners: Record<string, (e: unknown) => void> = {}
  const shown: { title: string; options: Record<string, unknown> }[] = []
  const posted: unknown[] = []
  const opened: string[] = []
  let focused = 0
  const windows = Array.from({ length: opts.windows ?? 0 }, () => ({
    postMessage: (m: unknown) => posted.push(m), focus: async () => { focused++ },
  }))
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }) } },
    clients: { matchAll: async () => windows, openWindow: async (url: string) => { opened.push(url) }, claim: async () => {} },
    location: { origin: 'https://app.wivodent.com' },
    skipWaiting: () => {},
  }
  const caches = {
    open: async () => ({ match: async () => (opts.cachedTitle ? new Response(opts.cachedTitle) : undefined), put: async () => {} }),
    keys: async () => [], delete: async () => true, match: async () => undefined,
  }
  const src = readFileSync(join(__dirname, '../../mobile-static/sw.js'), 'utf8')
  new Function('self', 'caches', src)(self, caches)
  const fire = async (type: string, event: Record<string, unknown>) => {
    let done: Promise<unknown> = Promise.resolve()
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => { done = p } })
    await done
  }
  return { fire, shown, posted, opened, focused: () => focused }
}

const pushOf = (payload: unknown) => ({ data: payload === undefined ? null : { json: () => payload } })

describe('the phone\'s service worker (sw.js)', () => {
  it('shows the push\'s own title and hint, never "Wivo" as the title', async () => {
    const w = loadWorker()
    await w.fire('push', pushOf({ title: 'Sulle määrati töö', body: 'Ava Wivo, et tööd näha' }))
    expect(w.shown).toHaveLength(1)
    expect(w.shown[0].title).toBe('Sulle määrati töö')
    expect(w.shown[0].options).toMatchObject({ body: 'Ava Wivo, et tööd näha', tag: 'wivo', renotify: true })
  })

  it('a push without words (an older sender): the cached line in the user\'s language as the title', async () => {
    const w = loadWorker({ cachedTitle: 'Uus teavitus' })
    await w.fire('push', pushOf(undefined))
    expect(w.shown[0]).toMatchObject({ title: 'Uus teavitus', options: { body: '' } })
    const bare = loadWorker()
    await bare.fire('push', { data: { json: () => { throw new Error('not json') } } })
    expect(bare.shown[0].title).toBe('New notification')
  })

  it('keeps whatever arrives short', async () => {
    const w = loadWorker()
    await w.fire('push', pushOf({ title: 'x'.repeat(500), body: 'y'.repeat(500) }))
    expect(w.shown[0].title).toHaveLength(80)
    expect((w.shown[0].options.body as string)).toHaveLength(120)
  })

  it('a tap with the app open: that window is told to open the bell list, and comes forward', async () => {
    const w = loadWorker({ windows: 1 })
    await w.fire('notificationclick', { notification: { close: () => {} } })
    expect(w.posted).toEqual([{ type: OPEN_NOTIFICATIONS_MESSAGE }])
    expect(w.focused()).toBe(1)
    expect(w.opened).toEqual([])
  })

  it('a tap with the app closed: it opens on the bell list', async () => {
    const w = loadWorker()
    await w.fire('notificationclick', { notification: { close: () => {} } })
    expect(w.opened).toEqual(['/?notifications=1'])
  })
})
