/**
 * The licence token format.
 *
 * Lives in `shared/` because two programs have to agree on it byte for byte:
 * the signing script that issues a key, and the app that verifies it. A format
 * described in two places is a format that will eventually disagree with itself.
 *
 * SHAPE
 *   WIVO1.<payload>.<signature>
 *   payload   = base64url(JSON)
 *   signature = base64url(Ed25519 over the ASCII bytes of "WIVO1.<payload>")
 *
 * WHY SIGNED AND NOT CHECKED ONLINE
 *   A laboratory must not stop working because its internet did. The expiry is
 *   inside the payload and the signature proves nobody edited it, so the whole
 *   check is local and offline. The cost is that a key cannot be revoked before
 *   it expires — which is why terms are annual and the payload is small.
 *
 * THE PRIVATE KEY NEVER SHIPS. Only the public key is compiled into the app;
 * see `scripts/make-license.mjs`.
 */

export type LicencePlan = 'labor' | 'labor_plus'

export const PLAN_LABEL: Record<LicencePlan, string> = {
  labor:      'Labor',
  labor_plus: 'Labor+',
}

export interface LicencePayload {
  /** Format version, so a future change is detectable rather than confusing. */
  v: 1
  /** Who it was issued to — shown in Seaded so the right key is identifiable. */
  name: string
  plan: LicencePlan
  /** Max active users, or null for unlimited (Labor+). Advisory, not enforced. */
  seats: number | null
  /** Issued on, YYYY-MM-DD. */
  iat: string
  /** Valid through, YYYY-MM-DD INCLUSIVE. After this the grace period starts. */
  exp: string
}

export const TOKEN_PREFIX = 'WIVO1'

/**
 * Days after `exp` during which the app still writes, and warns.
 *
 * Not zero, deliberately. A lab that cannot invoice the work it has already
 * finished, because an invoice for the software went unpaid over a holiday,
 * does not renew — it gets angry and looks elsewhere. Fourteen days is long
 * enough to reach a human.
 */
export const GRACE_DAYS = 14

// ─── base64url, without depending on Buffer or atob ──────────────────────────
// `shared/` runs in a browser, in Electron's renderer, in Node and possibly in
// Deno. Only these hand-rolled helpers work in all four unchanged.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function b64urlEncode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    if (b === undefined) break
    out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    if (c === undefined) break
    out += B64[c & 63]
  }
  return out
}

export function b64urlDecode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9\-_]/g, '')
  const out: number[] = []
  let buf = 0, bits = 0
  for (const ch of clean) {
    const v = B64.indexOf(ch)
    if (v < 0) continue
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

const enc = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length * 4)
  let n = 0
  for (const ch of s) {
    let cp = ch.codePointAt(0)!
    if (cp < 0x80) out[n++] = cp
    else if (cp < 0x800) { out[n++] = 0xc0 | (cp >> 6); out[n++] = 0x80 | (cp & 63) }
    else if (cp < 0x10000) {
      out[n++] = 0xe0 | (cp >> 12); out[n++] = 0x80 | ((cp >> 6) & 63); out[n++] = 0x80 | (cp & 63)
    } else {
      out[n++] = 0xf0 | (cp >> 18); out[n++] = 0x80 | ((cp >> 12) & 63)
      out[n++] = 0x80 | ((cp >> 6) & 63); out[n++] = 0x80 | (cp & 63)
    }
  }
  return out.slice(0, n)
}

const dec = (bytes: Uint8Array): string => {
  let s = '', i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) { s += String.fromCodePoint(b); i += 1 }
    else if (b < 0xe0) { s += String.fromCodePoint(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2 }
    else if (b < 0xf0) {
      s += String.fromCodePoint(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3
    } else {
      s += String.fromCodePoint(
        ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63)
      ); i += 4
    }
  }
  return s
}

export const utf8Encode = enc
export const utf8Decode = dec

/** The exact bytes that get signed. Both sides must build them identically. */
export function signingInput(payloadB64: string): Uint8Array {
  return enc(`${TOKEN_PREFIX}.${payloadB64}`)
}

export function encodePayload(p: LicencePayload): string {
  return b64urlEncode(enc(JSON.stringify(p)))
}

export interface ParsedToken {
  payloadB64: string
  payload: LicencePayload
  signature: Uint8Array
}

/** Split and parse a token. Returns null on anything malformed — never throws. */
export function parseToken(token: string): ParsedToken | null {
  const parts = token.trim().split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null
  const [, payloadB64, sigB64] = parts
  try {
    const payload = JSON.parse(dec(b64urlDecode(payloadB64))) as LicencePayload
    if (payload?.v !== 1 || !payload.exp || !payload.plan) return null
    return { payloadB64, payload, signature: b64urlDecode(sigB64) }
  } catch {
    return null
  }
}

export type LicenceState =
  /** No key at all — a fresh install, or the file was removed. */
  | 'missing'
  /** Present but not signed by us, or edited. Treated exactly like missing. */
  | 'invalid'
  | 'active'
  /** Past `exp`, inside the grace window. Writes still work; the app nags. */
  | 'grace'
  /** Past the grace window. Read-only. */
  | 'expired'

export interface LicenceStatus {
  state: LicenceState
  payload: LicencePayload | null
  /** Days until `exp` (negative once past it). Null when there is no key. */
  daysLeft: number | null
  /** Days of grace remaining, once state is 'grace'. */
  graceLeft: number | null
}

const DAY = 86_400_000

/** State from a verified payload and today's date. Pure — hence testable. */
export function licenceStatus(
  payload: LicencePayload | null,
  today: Date
): LicenceStatus {
  if (!payload) return { state: 'missing', payload: null, daysLeft: null, graceLeft: null }

  // Compare whole days in UTC. `exp` is a date, not an instant: a key valid
  // "through 31 December" must not stop working at noon because of a timezone.
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const expDay = Date.parse(`${payload.exp}T00:00:00Z`)
  if (Number.isNaN(expDay)) {
    return { state: 'invalid', payload, daysLeft: null, graceLeft: null }
  }

  const daysLeft = Math.round((expDay - midnight) / DAY)
  if (daysLeft >= 0) return { state: 'active', payload, daysLeft, graceLeft: null }

  const graceLeft = GRACE_DAYS + daysLeft
  return graceLeft >= 0
    ? { state: 'grace', payload, daysLeft, graceLeft }
    : { state: 'expired', payload, daysLeft, graceLeft: 0 }
}

/** Whether the app may write. The single question the rest of the app asks. */
export const licenceAllowsWrites = (s: LicenceStatus): boolean =>
  s.state === 'active' || s.state === 'grace'
