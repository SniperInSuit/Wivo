/**
 * Signed releases (docs/ARCHITECTURE-INSTANCES.md §5): what Wivo signs, and
 * the checks every clinic runs before it installs anything.
 *
 * One file, no imports: the desktop app (Node), the clinic's `wivo-update`
 * (Deno, through a generated copy) and the release tool must agree on it byte
 * for byte, and Ed25519 comes from WebCrypto, which all three have.
 *
 * THE CHAIN
 *   Two ROOT keys are pinned in the app and in `wivo-update`. A root signs only
 *   certificates (a key, its purpose, its validity) and revocations. Everything
 *   else is signed by a CERTIFIED key: update packages and the index by an
 *   `update` key, desktop releases by an `app` key. So a new signing key never
 *   needs the pinned roots to change.
 *
 * THE FORMAT (as `shared/license`)
 *   <PREFIX>.<payload>.<signature>
 *   payload   = base64url(JSON)
 *   signature = base64url(Ed25519 over the ASCII bytes of "<PREFIX>.<payload>")
 *   Each kind has its own PREFIX, so a signature on one kind can never be
 *   passed off as another: a certificate's signature is not a package's.
 *
 * Verification reads the exact bytes that were signed and only then parses
 * them, so no JSON canonicalisation is needed to check anything. `encode()`
 * still writes sorted keys, so the same content always gives the same bytes.
 */

export const PREFIX = {
  certificate: 'WIVOCERT1',
  revocation: 'WIVOREV1',
  manifest: 'WIVOMAN1',
  index: 'WIVOIDX1',
  app: 'WIVOAPP1',
} as const

export type Kind = keyof typeof PREFIX

/** What a certified key may sign. */
export type KeyPurpose = 'update' | 'app'

export interface RootKey {
  id: string
  /** base64url of the 32-byte Ed25519 public key. */
  publicKey: string
}

/** Signed by a root: this key may sign `purpose` between the two dates. */
export interface Certificate {
  v: 1
  key_id: string
  public_key: string
  purpose: KeyPurpose
  not_before: string
  not_after: string
  root_id: string
}

/**
 * Signed by a root. Anything signed by `key_id` is refused from now on,
 * except the signed texts whose sha256 is in `genuine`: what the key signed
 * before it leaked. A root may revoke the other root; then only the remaining
 * one is trusted (and if both are revoked, nothing is: it fails closed).
 */
export interface Revocation {
  v: 1
  key_id: string
  genuine: string[]
  reason: string
  issued_at: string
  root_id: string
}

export interface ManifestFile {
  path: string
  sha256: string
  size: number
}

/** An update package: what it contains, and from which version it updates. */
export interface Manifest {
  v: 1
  key_id: string
  version: string
  /** The oldest version this package updates from. */
  from_min: string
  created_at: string
  /** Never installed automatically (5b). */
  manual_only: boolean
  /** The earliest an automatic install may take it (5b). */
  auto_after: string
  files: ManifestFile[]
}

/** The published list of packages, and what was withdrawn. */
export interface Index {
  v: 1
  key_id: string
  generated_at: string
  versions: { version: string; package: string; sha256: string; manual_only: boolean; auto_after: string }[]
  withdrawn: { version: string; reason: string }[]
}

/** A desktop release: the installer the app may install (5e). */
export interface AppRelease {
  v: 1
  key_id: string
  version: string
  file: string
  sha512: string
  size: number
  created_at: string
}

type Payloads = { certificate: Certificate; revocation: Revocation; manifest: Manifest; index: Index; app: AppRelease }

// ─── Bytes ────────────────────────────────────────────────────────────────────

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

/** Strict: anything but the base64url alphabet makes it null, never "cleaned". */
export function b64urlDecode(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9\-_]*$/.test(s) || s.length % 4 === 1) return null
  const out: number[] = []
  let buf = 0, bits = 0
  for (const ch of s) {
    buf = (buf << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true })

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

/** A plain copy for WebCrypto, whose types refuse a view that might be over shared memory. */
const plain = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes)

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', plain(bytes)))
}

/** electron-updater's form: base64 of the raw sha512. */
export async function sha512Base64(bytes: Uint8Array): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.digest('SHA-512', plain(bytes)))
  let s = ''
  for (const b of raw) s += String.fromCharCode(b)
  return btoa(s)
}

/** JSON with sorted keys at every level: the same content, the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

// ─── Signing (the release tool) ───────────────────────────────────────────────

/** Signs bytes and returns the 64-byte Ed25519 signature: a hardware key, or a test key in tests. */
export type Signer = (bytes: Uint8Array) => Promise<Uint8Array>

export const signingInput = (kind: Kind, payloadB64: string): Uint8Array => enc.encode(`${PREFIX[kind]}.${payloadB64}`)

export async function encode<K extends Kind>(kind: K, payload: Payloads[K], sign: Signer): Promise<string> {
  const payloadB64 = b64urlEncode(enc.encode(canonicalJson(payload)))
  const sig = await sign(signingInput(kind, payloadB64))
  if (sig.length !== 64) throw new Error('An Ed25519 signature is 64 bytes')
  return `${PREFIX[kind]}.${payloadB64}.${b64urlEncode(sig)}`
}

// ─── Checking ─────────────────────────────────────────────────────────────────

export type Refusal =
  | 'malformed' | 'wrong_kind' | 'bad_signature' | 'unknown_key' | 'unknown_root'
  | 'not_yet_valid' | 'expired' | 'wrong_purpose' | 'revoked' | 'bad_path' | 'bad_version'

export type Checked<T> = { ok: true; payload: T; signedSha256: string } | { ok: false; reason: Refusal }

interface Split { payloadB64: string; payload: unknown; sig: Uint8Array; input: Uint8Array }

function split(kind: Kind, token: string): Split | Refusal {
  const parts = token.split('.')
  if (parts.length !== 3) return 'malformed'
  if (parts[0] !== PREFIX[kind]) return 'wrong_kind'
  const bytes = b64urlDecode(parts[1])
  const sig = b64urlDecode(parts[2])
  if (!bytes || !sig || sig.length !== 64) return 'malformed'
  let payload: unknown
  try { payload = JSON.parse(dec.decode(bytes)) } catch { return 'malformed' }
  if (!payload || typeof payload !== 'object' || (payload as { v?: unknown }).v !== 1) return 'malformed'
  return { payloadB64: parts[1], payload, sig, input: signingInput(kind, parts[1]) }
}

async function ed25519Verify(publicKeyB64: string, sig: Uint8Array, data: Uint8Array): Promise<boolean> {
  const raw = b64urlDecode(publicKeyB64)
  if (!raw || raw.length !== 32) return false
  try {
    const key = await crypto.subtle.importKey('raw', plain(raw), { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, plain(sig), plain(data))
  } catch {
    return false
  }
}

/** What a clinic trusts: the pinned roots, minus revoked ones, and the revocations that check out. */
export interface Trust {
  roots: RootKey[]
  revocations: Revocation[]
}

/**
 * The pinned roots and the revocations, each checked against them. A
 * revocation that isn't signed by a pinned root is ignored, not trusted. A
 * root is dropped if the other root revoked it.
 */
export async function trustFrom(pinned: RootKey[], revocationTokens: string[]): Promise<Trust> {
  const revocations: Revocation[] = []
  for (const token of revocationTokens) {
    const s = split('revocation', token)
    if (typeof s === 'string') continue
    const r = s.payload as Revocation
    const root = pinned.find(k => k.id === r.root_id)
    if (!root || r.key_id === root.id) continue
    if (!Array.isArray(r.genuine) || !(await ed25519Verify(root.publicKey, s.sig, s.input))) continue
    revocations.push(r)
  }
  const roots = pinned.filter(k => !revocations.some(r => r.key_id === k.id))
  // A revocation signed by a root that is itself revoked no longer counts.
  return { roots, revocations: revocations.filter(r => roots.some(k => k.id === r.root_id)) }
}

const isRevoked = (trust: Trust, keyId: string, signedSha: string): boolean =>
  trust.revocations.some(r => r.key_id === keyId && !r.genuine.includes(signedSha))

/** A certificate, against the trusted roots, for `purpose`, at `now`. */
export async function checkCertificate(token: string, trust: Trust, purpose: KeyPurpose, now: Date): Promise<Checked<Certificate>> {
  const s = split('certificate', token)
  if (typeof s === 'string') return { ok: false, reason: s }
  const c = s.payload as Certificate
  const root = trust.roots.find(k => k.id === c.root_id)
  if (!root) return { ok: false, reason: 'unknown_root' }
  if (!(await ed25519Verify(root.publicKey, s.sig, s.input))) return { ok: false, reason: 'bad_signature' }
  if (c.purpose !== purpose) return { ok: false, reason: 'wrong_purpose' }
  if (!(Date.parse(c.not_before) <= now.getTime())) return { ok: false, reason: 'not_yet_valid' }
  if (!(now.getTime() < Date.parse(c.not_after))) return { ok: false, reason: 'expired' }
  // A revocation covers what the key SIGNED (checkSigned), not the root's
  // certificate for it: its genuine earlier releases must still check out.
  return { ok: true, payload: c, signedSha256: await sha256Hex(s.input) }
}

/**
 * Something signed by a certified key: a manifest or the index (`update`), a
 * desktop release (`app`). Its signer must hold a valid certificate for that
 * purpose among `certificates`, and must not be revoked, unless this exact
 * signed text is on the revocation's genuine list.
 */
export async function checkSigned<K extends 'manifest' | 'index' | 'app'>(
  kind: K, token: string, certificates: string[], trust: Trust, now: Date,
): Promise<Checked<Payloads[K]>> {
  const s = split(kind, token)
  if (typeof s === 'string') return { ok: false, reason: s }
  const keyId = (s.payload as { key_id?: unknown }).key_id
  if (typeof keyId !== 'string') return { ok: false, reason: 'malformed' }
  const purpose: KeyPurpose = kind === 'app' ? 'app' : 'update'
  let cert: Certificate | null = null
  for (const token of certificates) {
    const c = await checkCertificate(token, trust, purpose, now)
    if (c.ok && c.payload.key_id === keyId) { cert = c.payload; break }
  }
  if (!cert) return { ok: false, reason: 'unknown_key' }
  if (!(await ed25519Verify(cert.public_key, s.sig, s.input))) return { ok: false, reason: 'bad_signature' }
  const signedSha256 = await sha256Hex(s.input)
  if (isRevoked(trust, keyId, signedSha256)) return { ok: false, reason: 'revoked' }
  if (kind === 'manifest') {
    const m = s.payload as Manifest
    if (!isVersion(m.version) || !isVersion(m.from_min)) return { ok: false, reason: 'bad_version' }
    if (!Array.isArray(m.files) || !m.files.every(f => isPackagePath(f.path) && /^[0-9a-f]{64}$/.test(f.sha256))) {
      return { ok: false, reason: 'bad_path' }
    }
  }
  if (kind === 'app' && !isVersion((s.payload as AppRelease).version)) return { ok: false, reason: 'bad_version' }
  return { ok: true, payload: s.payload as Payloads[K], signedSha256 }
}

// ─── Versions and paths ───────────────────────────────────────────────────────

export const isVersion = (v: unknown): v is string => typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,5}$/.test(v)

/** -1, 0 or 1. Both must be `x.y.z`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  return 0
}

/**
 * A file a package may contain: under migrations/, functions/ or checks/, in
 * plain segments. No absolute path, no `..`, no backslash, no hidden file:
 * nothing that could land outside where it belongs.
 */
export function isPackagePath(path: unknown): boolean {
  if (typeof path !== 'string' || path.length > 200) return false
  if (!/^(migrations|functions|checks)\/[A-Za-z0-9_\-./]+$/.test(path)) return false
  return path.split('/').every(seg => seg.length > 0 && seg !== '.' && seg !== '..' && !seg.startsWith('.'))
}
