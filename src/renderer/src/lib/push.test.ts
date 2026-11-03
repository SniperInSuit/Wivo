/**
 * "Notifications on this phone" checked against the server (syncPushWith):
 * after an owner's reset or the last authenticator removed, the server has
 * deleted the subscription while the browser still holds it.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))
const { syncPushWith } = await import('./push')
type PushEnv = import('./push').PushEnv

function env(o: {
  permission?: NotificationPermission
  local?: boolean
  onServer?: boolean | null
  saveError?: unknown
  supported?: boolean
  configured?: boolean
} = {}) {
  const calls = { saved: [] as PushSubscriptionJSON[], unsubscribed: 0, asked: [] as string[] }
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
    }
  })

  it('no subscription in this browser: off, and the server is not asked', async () => {
    const { e, calls } = env({ local: false })
    expect(await syncPushWith(e)).toBe('off')
    expect(calls.asked).toEqual([])
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
