/**
 * "Notifications on this phone" checked against the server (syncPushWith):
 * after an owner's reset, the last authenticator removed or a sign-out here,
 * the server has deleted the subscription while the browser still holds it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const deleted: string[] = []
vi.mock('./supabase', () => ({
  supabase: { from: () => ({ delete: () => ({ eq: async (_: string, endpoint: string) => { deleted.push(endpoint); return { error: null } } }) }) },
}))
const { syncPushWith, forgetPushBeforeSignOut } = await import('./push')
type PushEnv = import('./push').PushEnv

const ME = 'user-me'
const OTHER = 'user-other'

function env(o: {
  permission?: NotificationPermission
  local?: boolean
  onServer?: boolean | null
  saveError?: unknown
  supported?: boolean
  configured?: boolean
  /** Whose this browser's subscription was, as the phone remembers it. */
  owner?: string | null
} = {}) {
  const calls = { saved: [] as PushSubscriptionJSON[], unsubscribed: 0, asked: [] as string[], owner: o.owner === undefined ? ME : o.owner }
  const sub = {
    endpoint: 'https://web.push.apple.com/abc',
    toJSON: () => ({ endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: async () => { calls.unsubscribed++; return true },
  }
  const e: PushEnv = {
    supported: o.supported ?? true,
    configured: o.configured ?? true,
    permission: () => o.permission ?? 'granted',
    subscription: async () => (o.local === false ? null : sub),
    onServer: async endpoint => { calls.asked.push(endpoint); return o.onServer === undefined ? true : o.onServer },
    save: async json => { calls.saved.push(json); return { error: o.saveError ?? null } },
    user: async () => ME,
    owner: () => calls.owner,
    setOwner: user => { calls.owner = user },
  }
  return { e, calls }
}

describe('the push switch, checked against the server', () => {
  it('still registered on the server: on, nothing changes', async () => {
    const { e, calls } = env({ onServer: true })
    expect(await syncPushWith(e)).toBe('on')
    expect(calls.saved).toEqual([])
    expect(calls.unsubscribed).toBe(0)
  })

  it('deleted on the server (an owner\'s reset), permission granted: registered again, on', async () => {
    const { e, calls } = env({ onServer: false })
    expect(await syncPushWith(e)).toBe('on')
    expect(calls.saved).toEqual([{ endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'p', auth: 'a' } }])
  })

  it('deleted on the server and the server refuses it again: off, and the browser\'s subscription is left alone', async () => {
    const { e, calls } = env({ onServer: false, saveError: { message: 'This endpoint belongs to another account' } })
    expect(await syncPushWith(e)).toBe('off')
    expect(calls.unsubscribed).toBe(0)
  })

  it('permission taken away in the browser: off (or denied), and the useless subscription is dropped', async () => {
    for (const permission of ['default', 'denied'] as const) {
      const { e, calls } = env({ permission, onServer: false })
      expect(await syncPushWith(e)).toBe(permission === 'denied' ? 'denied' : 'off')
      expect(calls.unsubscribed).toBe(1)
      expect(calls.saved).toEqual([])
      expect(calls.owner).toBeNull()
    }
  })

  it('no subscription in this browser, nobody\'s or someone else\'s: off, and the server is not asked', async () => {
    for (const owner of [null, OTHER]) {
      const { e, calls } = env({ local: false, owner })
      expect(await syncPushWith(e)).toBe('off')
      expect(calls.asked).toEqual([])
    }
  })

  it('theirs, on, and gone from the browser all the same: lost, so the app offers the one tap a new one needs', async () => {
    const { e, calls } = env({ local: false, owner: ME })
    expect(await syncPushWith(e)).toBe('lost')
    expect(calls.asked).toEqual([])
    expect(await syncPushWith(env({ local: false, owner: ME, permission: 'denied' }).e)).toBe('denied')
  })

  it('signed out and back in (the server row went with the sign-out): theirs, so registered again by itself', async () => {
    const { e, calls } = env({ onServer: false, owner: ME })
    expect(await syncPushWith(e)).toBe('on')
    expect(calls.saved).toHaveLength(1)
    expect(calls.owner).toBe(ME)
  })

  it('someone else\'s, left on this phone: not handed to whoever signs in next; off, and left alone', async () => {
    const { e, calls } = env({ onServer: false, owner: OTHER })
    expect(await syncPushWith(e)).toBe('off')
    expect(calls.saved).toEqual([])
    expect(calls.unsubscribed).toBe(0)
    expect(calls.owner).toBe(OTHER)
  })

  it('from a build that did not remember whose: registered again as before, and remembered from now on', async () => {
    const { e, calls } = env({ onServer: false, owner: null })
    expect(await syncPushWith(e)).toBe('on')
    expect(calls.saved).toHaveLength(1)
    expect(calls.owner).toBe(ME)
    const found = env({ onServer: true, owner: null })
    expect(await syncPushWith(found.e)).toBe('on')
    expect(found.calls.owner).toBe(ME)
  })

  it('the server cannot be asked (offline, second factor not given yet): nothing changes', async () => {
    const { e, calls } = env({ onServer: null })
    expect(await syncPushWith(e)).toBe('on')
    expect(calls.saved).toEqual([])
    expect(calls.unsubscribed).toBe(0)
  })

  it('no push in this browser, or no key configured', async () => {
    expect(await syncPushWith(env({ supported: false }).e)).toBe('unsupported')
    expect(await syncPushWith(env({ configured: false }).e)).toBe('not-configured')
  })
})

describe('signing out on the phone', () => {
  afterEach(() => { vi.unstubAllGlobals(); deleted.length = 0 })

  it('the server row goes; the browser keeps its subscription for the next sign-in', async () => {
    const unsubscribe = vi.fn(async () => true)
    const sub = { endpoint: 'https://web.push.apple.com/abc', unsubscribe }
    vi.stubGlobal('window', { PushManager: class {}, Notification: class {} })
    vi.stubGlobal('Notification', class {})
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) } })
    await forgetPushBeforeSignOut()
    expect(deleted).toEqual(['https://web.push.apple.com/abc'])
    expect(unsubscribe).not.toHaveBeenCalled()
  })
})
