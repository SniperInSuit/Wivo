import { describe, it, expect } from 'vitest'
import { b64url, fromB64url, vapidSigningKey, vapidAuthorization, sendEmptyPush } from './vapid'

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const pub = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
  const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d as string
  return { pair, pub, priv }
}

describe('vapid', () => {
  it('base64url round-trips every length', () => {
    for (let n = 0; n < 8; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => 250 - i)
      expect(Array.from(fromB64url(b64url(bytes)))).toEqual(Array.from(bytes))
      expect(b64url(bytes)).not.toMatch(/[+/=]/)
    }
  })

  it('signs a token the public key verifies, for the push service origin, 12 hours', async () => {
    const { pair, pub, priv } = await keyPair()
    const key = await vapidSigningKey(pub, priv)
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', key, pub, 'mailto:ops@example.com', 1_000_000)
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
    expect(m).not.toBeNull()
    const [, h, c, s, k] = m!
    expect(k).toBe(pub)
    expect(JSON.parse(new TextDecoder().decode(fromB64url(h)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(new TextDecoder().decode(fromB64url(c))))
      .toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 43_200, sub: 'mailto:ops@example.com' })
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, fromB64url(s), new TextEncoder().encode(`${h}.${c}`))
    expect(ok).toBe(true)
  })

  it('refuses keys of the wrong shape', async () => {
    const { pub, priv } = await keyPair()
    await expect(vapidSigningKey(pub.slice(4), priv)).rejects.toThrow()
    await expect(vapidSigningKey(pub, priv.slice(4))).rejects.toThrow()
  })

  it('an empty push: no body; 404/410 mean the subscription is gone; errors are failures', async () => {
    const calls: RequestInit[] = []
    const fake = (status: number) => (async (_u: unknown, init?: RequestInit) => { calls.push(init!); return new Response(null, { status }) }) as typeof fetch
    expect(await sendEmptyPush('https://push.example/x', 'vapid t=a, k=b', fake(201))).toBe('ok')
    expect(calls[0].body).toBeUndefined()
    expect((calls[0].headers as Record<string, string>).TTL).toBe('86400')
    expect(await sendEmptyPush('https://push.example/x', 'v', fake(410))).toBe('gone')
    expect(await sendEmptyPush('https://push.example/x', 'v', fake(404))).toBe('gone')
    expect(await sendEmptyPush('https://push.example/x', 'v', fake(500))).toBe('failed')
    expect(await sendEmptyPush('https://push.example/x', 'v', (async () => { throw new Error('offline') }) as typeof fetch)).toBe('failed')
  })
})
