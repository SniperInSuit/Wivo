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
 *   signature = base64url(Ed25519 over the bytes `signingInput` builds)
 *
 * DOMAIN SEPARATION (v2 and later)
 *   An update's signature must never be valid as a licence, nor the reverse,
 *   even if the same key signed both. A v2 licence therefore signs
 *   "WIVO-LICENCE-1<LF>WIVO1.<payload>" — a prefix no update signature
 *   carries. Separate PIV slots are the second layer; this one holds even if
 *   that separation fails.
 *
 *   v1 tokens keep signing "WIVO1.<payload>", because they were issued before
 *   the prefix existed and must not stop working. The version inside the
 *   payload decides which bytes get verified, so the two cannot be confused.
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

/**
 * The parts of Wivo a licence can switch on, one clinic at a time
 * (docs/MODULES-AND-RATINGS.md part 1).
 *
 * The core — Team, Settings, Licence, the audit log — is NOT a module and is
 * always on. The reason is dependency, not preference: `payroll` and `stock`
 * need people even when `jobs` is off.
 */
export const MODULE_KEYS = [
  'jobs', 'payroll', 'stock', 'invoices', 'patients', 'stats', 'partners', 'ratings',
] as const

export type LicenceModule = (typeof MODULE_KEYS)[number]

const MODULE_SET: ReadonlySet<string> = new Set(MODULE_KEYS)

export const isModuleKey = (s: string): s is LicenceModule => MODULE_SET.has(s)

/**
 * A module that cannot stand alone. A rating is given on a job, so `ratings`
 * without `jobs` is a key promising a page that cannot work. The issuing tool
 * refuses such a set by calling the function below, so the tool and the app
 * cannot disagree about what is issuable.
 */
export const MODULE_REQUIRES: Partial<Record<LicenceModule, readonly LicenceModule[]>> = {
  ratings: ['jobs'],
}

/** Why this set of modules cannot be issued, or null when it is fine. */
export function moduleSetProblem(modules: readonly string[]): string | null {
  const unknown = modules.filter(m => !isModuleKey(m))
  if (unknown.length) return `unknown module: ${unknown.join(', ')}`
  const have = new Set(modules)
  for (const key of Object.keys(MODULE_REQUIRES) as LicenceModule[]) {
    if (!have.has(key)) continue
    const missing = (MODULE_REQUIRES[key] ?? []).filter(n => !have.has(n))
    if (missing.length) return `${key} needs ${missing.join(', ')}`
  }
  return null
}

export interface LicencePayload {
  /** Format version, so a future change is detectable rather than confusing. */
  v: 1 | 2
  /** Who it was issued to — shown in Seaded so the right key is identifiable. */
  name: string
  plan: LicencePlan
  /** Max active users, or null for unlimited (Labor+). Advisory, not enforced. */
  seats: number | null
  /** Issued on, YYYY-MM-DD. */
  iat: string
  /** Valid through, YYYY-MM-DD INCLUSIVE. After this the grace period starts. */
  exp: string
  /**
   * v2: the instance's UUID — the same id the updates and the setup tool use
   * for this clinic. The name is for a human, `org` for a machine: one
   * clinic's licence does not work in another, even if the file is copied.
   */
  org?: string
  /**
   * v2: the API addresses this licence may be used against, as origins
   * ("https://abc.supabase.co"). Not only the organisation, because the app
   * has to know where it may connect BEFORE it connects — and because a
   * clinic may later move to a server of its own, where the address is not
   * *.supabase.co (docs/OWN-SERVER.md).
   *
   * Several are allowed on purpose: during a move the old and the new address
   * are both live for a while. Absent or empty means "no restriction", which
   * is also what every v1 key means.
   */
  api?: string[]
  /** v2: the modules this clinic may run. Absent means all of them. */
  modules?: string[]
}

/**
 * The modules a payload allows. A v1 key — or any key without the field — is
 * read as "everything": those were issued before a module was a thing, and
 * nobody's licence may become narrower because we added a field.
 *
 * An unknown name is ignored rather than fatal. A key signed by a newer tool,
 * naming a module this build has not heard of, must not lock a clinic out of
 * the modules it does know.
 */
export function licenceModules(payload: LicencePayload | null): ReadonlySet<LicenceModule> {
  if (!payload || !Array.isArray(payload.modules)) return new Set(MODULE_KEYS)
  return new Set(payload.modules.filter(isModuleKey))
}

// ─── The allowed API address ─────────────────────────────────────────────────

/**
 * An address reduced to what two of them have to agree on: scheme, host and
 * port. A path, a query or a trailing slash is not part of an API's identity,
 * and a default port is not written down.
 *
 * Exact origins only, no wildcards. "*.supabase.co" would make one leaked key
 * usable against every project we host, which is the one thing `org` and this
 * field exist to prevent.
 */
export function normaliseOrigin(url: string): string | null {
  const raw = (url ?? '').trim()
  if (!raw) return null
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)/.exec(raw)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  const authority = m[2]
  // Credentials in an API address are not something we carry around.
  const hostPort = authority.includes('@')
    ? authority.slice(authority.lastIndexOf('@') + 1)
    : authority
  const lastColon = hostPort.lastIndexOf(':')
  // An IPv6 host is written [::1]; a colon inside the brackets is not a port.
  const hasPort = lastColon > hostPort.lastIndexOf(']')
  const host = (hasPort ? hostPort.slice(0, lastColon) : hostPort).toLowerCase()
  const port = hasPort ? hostPort.slice(lastColon + 1) : ''
  if (!host) return null
  if (port && !/^[0-9]+$/.test(port)) return null
  const isDefault = (scheme === 'https' && port === '443') || (scheme === 'http' && port === '80')
  return port && !isDefault ? `${scheme}://${host}:${port}` : `${scheme}://${host}`
}

/** The origins a licence allows, already normalised. Empty = no restriction. */
export function licenceApiOrigins(payload: LicencePayload | null): string[] {
  if (!payload || !Array.isArray(payload.api)) return []
  const out: string[] = []
  for (const a of payload.api) {
    const o = typeof a === 'string' ? normaliseOrigin(a) : null
    if (o && !out.includes(o)) out.push(o)
  }
  return out
}

/**
 * Whether this licence may be used against this API address.
 *
 * Open by default, in three ways, each deliberate: no licence at all (an
 * unlicensed build), a v1 key, and an empty list all mean yes. A clinic must
 * never be cut off from its own database because we added a field to a format.
 */
export function licenceAllowsApi(payload: LicencePayload | null, url: string): boolean {
  const allowed = licenceApiOrigins(payload)
  if (allowed.length === 0) return true
  const asked = normaliseOrigin(url)
  return asked !== null && allowed.includes(asked)
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

/**
 * The prefix a licence signature covers from v2 on. An update signature never
 * carries it, so one signature cannot serve in both roles.
 */
export const LICENCE_SIGNING_DOMAIN = 'WIVO-LICENCE-1'

/**
 * The exact bytes that get signed. Both sides must build them identically, and
 * the version decides the shape: v1 as it always was, v2 with the domain
 * prefix. Asking for the wrong version produces bytes that do not verify,
 * which is the point.
 */
export function signingInput(payloadB64: string, v: number = 1): Uint8Array {
  const body = `${TOKEN_PREFIX}.${payloadB64}`
  return enc(v >= 2 ? `${LICENCE_SIGNING_DOMAIN}\n${body}` : body)
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
    if (payload?.v !== 1 && payload?.v !== 2) return null
    if (!payload.exp || !payload.plan) return null
    // v2 exists to carry `org` and `modules`. One without them is not a v2
    // key but a malformed one, and reading it as "all modules" would turn a
    // broken file into a full licence.
    if (payload.v === 2
        && (typeof payload.org !== 'string' || !payload.org || !Array.isArray(payload.modules))) {
      return null
    }
    if (payload.api !== undefined && !Array.isArray(payload.api)) return null
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
