/**
 * Web Push for the phone app (Phase 1b), the payloadless kind: the push says
 * only "something happened" and carries no data (sql/090), so there is
 * nothing to encrypt — just the VAPID token (RFC 8292) that proves the push
 * comes from Wivo's server.
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

/** One empty push. `gone`: the subscription no longer exists (unsubscribed, phone reset). */
export async function sendEmptyPush(
  endpoint: string, authorization: string, doFetch: typeof fetch = fetch,
): Promise<PushResult> {
  try {
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: { Authorization: authorization, TTL: '86400', Urgency: 'normal' },
    })
    if (res.status === 404 || res.status === 410) return 'gone'
    return res.ok ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}
