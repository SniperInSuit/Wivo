/**
 * Web Push for the phone app (Phase 1b): the VAPID token (RFC 8292) that
 * proves the push comes from Wivo's server, and since sql/103 a short text —
 * a title and a hint in the person's language, never a job code, patient or
 * name (pushText.ts) — encrypted for that one browser (RFC 8291, aes128gcm),
 * so the push service carries it without being able to read it. The lock
 * screen shows it, which is why it says so little.
 *
 * WebCrypto only and no imports, so the same file runs in the Edge Function
 * (Deno) and in the tests (vapid.test.ts, run by vitest).
 *
 * Keys: `node scripts/vapid-keys.mjs` prints a pair. The public key is the
 * app's VITE_VAPID_PUBLIC_KEY and the function's VAPID_PUBLIC_KEY; the
 * private key is the function's VAPID_PRIVATE_KEY secret and nowhere else.
 */
const enc = new TextEncoder()

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** The signing key from the base64url public point (65 bytes) and private scalar (32 bytes). */
export async function vapidSigningKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const pub = fromB64url(publicKey)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be an uncompressed P-256 point')
  if (fromB64url(privateKey).length !== 32) throw new Error('VAPID private key must be 32 bytes')
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)), d: privateKey, ext: false },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

/** The Authorization header for one push service (the token's audience is its origin). */
export async function vapidAuthorization(
  endpoint: string, key: CryptoKey, publicKey: string, subject: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const part = (o: unknown) => b64url(enc.encode(JSON.stringify(o)))
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: subject })}`
  // WebCrypto's ECDSA signature is already r‖s, the form a JWT wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)))
  return `vapid t=${unsigned}.${b64url(sig)}, k=${publicKey}`
}

export type PushResult = 'ok' | 'gone' | 'failed'

/** A browser's subscription keys, as the browser gives them (base64url). */
export interface PushKeys { p256dh: string; auth: string }

/** What goes inside one push: the text, and the keys to encrypt it for this browser. */
export interface PushMessage { keys: PushKeys; text: string }

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

/**
 * RFC 8291: the body of one push carrying `plaintext`, readable only by the
 * browser with these keys. One record (a push holds 4 KB at most, and this
 * text is a few dozen bytes). `salt` and `sender` are for the RFC's test
 * vector only; normally both are new for every push.
 */
export async function encryptPushPayload(
  keys: PushKeys, plaintext: Uint8Array,
  test: { salt?: Uint8Array<ArrayBuffer>; sender?: CryptoKeyPair } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64url(keys.p256dh)
  const authSecret = fromB64url(keys.auth)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('p256dh must be an uncompressed P-256 point')
  if (authSecret.length !== 16) throw new Error('auth must be 16 bytes')
  if (plaintext.length > 3000) throw new Error('push text too long')

  const sender = test.sender
    ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256))

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = test.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // The last (and only) record ends with the delimiter 0x02.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))))

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, cipher)
}

/** The push services Wivo talks to — the same list as public.is_push_endpoint (sql/091). */
export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && endpoint.length <= 1000
      && /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/i.test(u.hostname)
  } catch {
    return false
  }
}

/**
 * One push, with an encrypted body or without one. `gone`: the subscription
 * no longer exists (unsubscribed, phone reset).
 */
export async function sendPush(
  endpoint: string, authorization: string, doFetch: typeof fetch = fetch, body: Uint8Array<ArrayBuffer> | null = null,
): Promise<PushResult> {
  try {
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization, TTL: '86400', Urgency: 'normal',
        ...(body ? { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' } : {}),
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404 || res.status === 410) return 'gone'
    return res.ok ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}

/** One empty push (the phone shows its generic line). */
export const sendEmptyPush = (endpoint: string, authorization: string, doFetch: typeof fetch = fetch): Promise<PushResult> =>
  sendPush(endpoint, authorization, doFetch, null)

/**
 * One phone, never throwing: a bad row must not stop the others. An endpoint
 * that is not a known push service counts as gone, so the sender removes it.
 * With a message, its text goes encrypted; keys that cannot be used (a row
 * saved before the keys were checked) send an empty push instead, which the
 * phone shows as its generic line.
 */
export async function pushToPhone(
  endpoint: string, key: CryptoKey, publicKey: string, subject: string, doFetch: typeof fetch = fetch,
  message: PushMessage | null = null,
): Promise<PushResult> {
  if (!isPushEndpoint(endpoint)) return 'gone'
  try {
    let body: Uint8Array<ArrayBuffer> | null = null
    if (message) {
      try { body = await encryptPushPayload(message.keys, enc.encode(message.text)) } catch { body = null }
    }
    return await sendPush(endpoint, await vapidAuthorization(endpoint, key, publicKey, subject), doFetch, body)
  } catch {
    return 'failed'
  }
}
