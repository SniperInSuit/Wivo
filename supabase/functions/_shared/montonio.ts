/**
 * Montonio Orders API — the only file that holds the secret key.
 *
 * The key signs the order we send and verifies the token that comes back. It
 * must never reach the browser, which is why the widget asks THIS function for
 * a payment URL rather than talking to Montonio itself.
 *
 * API shape per https://docs.montonio.com/api/stargate/guides/orders :
 *   POST {base}/api/orders   body: { data: <JWT signed HS256 with Secret Key> }
 *   → { paymentUrl, uuid, paymentStatus }
 * The return redirect and the webhook both carry `order-token`, the same JWT
 * shape, signed with the same key.
 *
 * WHAT THIS FILE DOES NOT DECIDE
 * Whether a verified token means "paid" — that is `@shared/portal/montonioClaims`,
 * kept separate because it is the part worth testing and it needs no crypto.
 * Here: signatures and HTTP. There: what a signature entitles you to.
 */
import { acceptPayment, refusalStatus } from '@shared/portal/montonioClaims.ts'
import type { MontonioClaims, PaymentVerdict } from '@shared/portal/montonioClaims.ts'

const enc = new TextEncoder()

/** Sandbox until MONTONIO_ENV is exactly 'live'. Wrong-way-safe on purpose. */
function baseUrl(): string {
  return (Deno.env.get('MONTONIO_ENV') ?? '').trim().toLowerCase() === 'live'
    ? 'https://stargate.montonio.com'
    : 'https://sandbox-stargate.montonio.com'
}

export function montonioConfigured(): boolean {
  return !!Deno.env.get('MONTONIO_ACCESS_KEY') && !!Deno.env.get('MONTONIO_SECRET_KEY')
}

export function accessKey(): string {
  return Deno.env.get('MONTONIO_ACCESS_KEY') ?? ''
}

function secretKey(): string {
  const k = Deno.env.get('MONTONIO_SECRET_KEY')
  if (!k) throw new Error('MONTONIO_SECRET_KEY puudub')
  return k
}

// ── base64url, because JWT ───────────────────────────────────────────────────
const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4)
  const raw = atob(padded)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function hmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw', enc.encode(secretKey()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  )
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64url(enc.encode(JSON.stringify(payload)))
  const data = `${header}.${body}`
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(data))
  return `${data}.${b64url(new Uint8Array(sig))}`
}

/**
 * Claims from a token whose signature checks out. Null on ANY doubt — a bad
 * signature, a malformed token, an expired one.
 *
 * `crypto.subtle.verify` is constant-time, which is why the comparison is done
 * there rather than by re-signing and comparing strings ourselves.
 */
export async function verifyJwt(token: string): Promise<MontonioClaims | null> {
  try {
    const parts = (token ?? '').split('.')
    if (parts.length !== 3) return null
    const [header, body, sig] = parts

    const okSig = await crypto.subtle.verify(
      'HMAC', await hmacKey(), b64urlDecode(sig), enc.encode(`${header}.${body}`),
    )
    if (!okSig) return null

    const head = JSON.parse(new TextDecoder().decode(b64urlDecode(header)))
    // Refuse anything but HS256. `alg: none` is the oldest JWT hole there is,
    // and a verifier that trusts the header's choice of algorithm has it.
    if (head?.alg !== 'HS256') return null

    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as
      MontonioClaims & { exp?: number }
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null
    return claims
  } catch {
    return null
  }
}

export interface CreatedOrder {
  paymentUrl: string
  uuid: string
}

/**
 * Create a payment order and get the URL to send the patient to.
 *
 * `grandTotal` comes from the caller, which reads it from clinic settings —
 * NEVER from the browser. A public form that could name its own price is a form
 * where everyone pays one cent.
 */
export async function createOrder(input: {
  merchantReference: string
  summa: number
  valuuta: string
  returnUrl: string
  notificationUrl: string
  /** Shown to the patient on the bank page. */
  kirjeldus: string
  locale?: string
}): Promise<CreatedOrder> {
  const total = Math.round(input.summa * 100) / 100
  const payload = {
    accessKey: accessKey(),
    merchantReference: input.merchantReference,
    returnUrl: input.returnUrl,
    notificationUrl: input.notificationUrl,
    currency: input.valuuta,
    grandTotal: total,
    locale: input.locale ?? 'et',
    // 10 minutes, as the docs recommend. This bounds how long a signed request
    // to charge somebody stays usable if it leaks in a log.
    exp: Math.floor(Date.now() / 1000) + 600,
    payment: {
      method: 'paymentInitiation',
      methodDisplay: input.kirjeldus,
      amount: total,
      currency: input.valuuta,
      methodOptions: { preferredCountry: 'EE' },
    },
  }

  const res = await fetch(`${baseUrl()}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: await signJwt(payload) }),
  })

  if (!res.ok) {
    // Never let Montonio's body reach the patient's page: it can echo the
    // reference and the amount. Logged for the clinic, generic to the visitor.
    console.error('montonio order failed', res.status, await res.text().catch(() => ''))
    throw new Error(`Montonio vastas ${res.status}`)
  }

  const body = await res.json() as { paymentUrl?: string; uuid?: string }
  if (!body.paymentUrl || !body.uuid) {
    throw new Error('Montonio vastus ei sisaldanud paymentUrl/uuid')
  }
  return { paymentUrl: body.paymentUrl, uuid: body.uuid }
}

/**
 * The whole check, in the order that matters: signature, then meaning.
 *
 * Returns the same verdict shape as `acceptPayment`, so the caller has one
 * thing to branch on and cannot accidentally act on a token that only got
 * halfway through.
 */
export async function verifyOrderToken(
  token: string,
  expected: { uuid: string; summa: number; valuuta: string },
): Promise<{ verdict: PaymentVerdict; staatus: 'makstud' | 'ootel' | 'ebaonnestus' | 'tuhistatud' }> {
  const claims = await verifyJwt(token)
  if (!claims) {
    return {
      verdict: { ok: false, reason: 'puudulik', selgitus: 'Allkiri ei klapi või token on aegunud.' },
      staatus: 'ebaonnestus',
    }
  }
  const verdict = acceptPayment(claims, { ...expected, accessKey: accessKey() })
  return {
    verdict,
    staatus: verdict.ok ? 'makstud' : refusalStatus(verdict.reason, claims.paymentStatus),
  }
}
