import { describe, it, expect } from 'vitest'
import { b64url, fromB64url, vapidSigningKey, vapidAuthorization, sendEmptyPush, sendPush, isPushEndpoint, pushToPhone, encryptPushPayload } from './vapid'

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

  it('only known push services; anything else is gone without a request, and nothing throws', async () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/a', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
      expect(isPushEndpoint(ok)).toBe(true)
    }
    for (const bad of ['https://', 'not a url', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x', 'https://evil.example/fcm.googleapis.com', 'https://127.0.0.1/x']) {
      expect(isPushEndpoint(bad)).toBe(false)
    }
    const { pub, priv } = await keyPair()
    const key = await vapidSigningKey(pub, priv)
    let calls = 0
    const counting = (async () => { calls++; return new Response(null, { status: 201 }) }) as typeof fetch
    expect(await pushToPhone('https://', key, pub, 'mailto:a@b.c', counting)).toBe('gone')
    expect(await pushToPhone('http://127.0.0.1:54321/x', key, pub, 'mailto:a@b.c', counting)).toBe('gone')
    expect(calls).toBe(0)
    expect(await pushToPhone('https://fcm.googleapis.com/fcm/send/x', key, pub, 'mailto:a@b.c', counting)).toBe('ok')
    expect(calls).toBe(1)
  })
})

// ── RFC 8291: the encrypted text ────────────────────────────────────────────

/** An ECDH key pair from base64url private scalar and public point, as the RFC's vector gives them. */
async function ecdhPair(priv: string, pub: string): Promise<CryptoKeyPair> {
  const p = fromB64url(pub)
  const jwk = { kty: 'EC', crv: 'P-256', x: b64url(p.slice(1, 33)), y: b64url(p.slice(33)) }
  return {
    privateKey: await crypto.subtle.importKey('jwk', { ...jwk, d: priv }, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
  }
}

/** What the browser does with the body: the other side of RFC 8291, written independently. */
async function browserDecrypt(body: Uint8Array, ua: CryptoKeyPair, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256))
  const derive = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info },
      await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8))
  const te = new TextEncoder()
  const info = new Uint8Array([...te.encode('WebPush: info\0'), ...uaPublic, ...asPublic])
  const ikm = await derive(auth, shared, info, 32)
  const cek = await derive(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await derive(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12)
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce },
    await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), body.slice(21 + idlen)))
  expect(plain[plain.length - 1]).toBe(2)
  return new TextDecoder().decode(plain.slice(0, -1))
}

describe('the push text, encrypted for one browser (RFC 8291)', () => {
  // RFC 8291, Appendix A.
  const V = {
    plaintext: 'When I grow up, I want to be a watermelon',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  }

  it('matches the RFC\'s test vector byte for byte', async () => {
    const body = await encryptPushPayload({ p256dh: V.uaPublic, auth: V.auth }, new TextEncoder().encode(V.plaintext),
      { salt: fromB64url(V.salt), sender: await ecdhPair(V.asPrivate, V.asPublic) })
    expect(b64url(body)).toBe(V.body)
  })

  it('a browser with the keys reads it back; a fresh key and salt every time', async () => {
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const keys = { p256dh: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))), auth: b64url(auth) }
    const text = JSON.stringify({ title: 'Sulle määrati töö', body: 'Ava Wivo, et tööd näha' })
    const a = await encryptPushPayload(keys, new TextEncoder().encode(text))
    const b = await encryptPushPayload(keys, new TextEncoder().encode(text))
    expect(await browserDecrypt(a, ua, auth)).toBe(text)
    expect(b64url(a)).not.toBe(b64url(b))
    expect(new TextDecoder('utf-8', { fatal: false }).decode(a)).not.toContain('Wivo')
  })

  it('refuses keys of the wrong shape', async () => {
    await expect(encryptPushPayload({ p256dh: 'AAAA', auth: V.auth }, new Uint8Array(1))).rejects.toThrow()
    await expect(encryptPushPayload({ p256dh: V.uaPublic, auth: 'AAAA' }, new Uint8Array(1))).rejects.toThrow()
  })

  it('sent as aes128gcm; unusable keys fall back to an empty push rather than none', async () => {
    const calls: RequestInit[] = []
    const fake = (async (_u: unknown, init?: RequestInit) => { calls.push(init!); return new Response(null, { status: 201 }) }) as typeof fetch
    expect(await sendPush('https://push.example/x', 'v', fake, new Uint8Array([1, 2]))).toBe('ok')
    expect((calls[0].headers as Record<string, string>)['Content-Encoding']).toBe('aes128gcm')
    const { pub, priv } = await keyPair()
    const key = await vapidSigningKey(pub, priv)
    expect(await pushToPhone('https://web.push.apple.com/a', key, pub, 'mailto:a@b.c', fake,
      { keys: { p256dh: V.uaPublic, auth: V.auth }, text: '{"title":"x"}' })).toBe('ok')
    expect(calls[1].body).toBeInstanceOf(Uint8Array)
    expect(await pushToPhone('https://web.push.apple.com/a', key, pub, 'mailto:a@b.c', fake,
      { keys: { p256dh: 'broken', auth: 'broken' }, text: '{"title":"x"}' })).toBe('ok')
    expect(calls[2].body).toBeUndefined()
  })
})
