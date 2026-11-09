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
 * THE FORMAT (as `shared/license`, except for what the key signs)
 *   <PREFIX>.<payload>.<signature>
 *   payload     = base64url(JSON)
 *   signed text = the ASCII bytes of "<PREFIX>.<payload>"
 *   signature   = base64url(Ed25519 over the ASCII bytes of "<PREFIX>.sha256.<hex>"),
 *                 <hex> being the sha256 of the signed text
 *   The key signs that short statement, at most 81 bytes whatever the payload's
 *   size: a YubiKey takes at most 3,062 bytes in one command, so it signs no
 *   message much over 3 KB (docs/YUBIKEYS.md §2), and a manifest is already
 *   about 30 KB. The signature then rests on SHA-256 as well, as the files a
 *   manifest lists already do.
 *   Each kind has its own PREFIX, in the signed text and in the statement, so
 *   a signature on one kind can never be passed off as another: a
 *   certificate's signature is not a package's.
 *
 * Verification hashes the exact bytes that were signed and only then parses
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

/**
 * Which clinics a package or list is for. A `test` package (the two test
 * projects, §8) never installs on a clinic that follows `stable`.
 */
export type Channel = 'stable' | 'test'

/** An update package: what it contains, and from which version it updates. */
export interface Manifest {
  v: 1
  key_id: string
  channel: Channel
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

/**
 * The published list of packages, what was withdrawn, and the latest desktop
 * release, with the defences TUF names (docs/ARCHITECTURE-INSTANCES.md §5g):
 *   - `expires`: a list past its expiry is refused, so an attacker who keeps
 *     serving an old, validly signed list (a freeze attack) is noticed, and
 *     the owner is warned; it is re-signed weekly and at every release.
 *   - `serial`: grows with every list; a lower one is refused (rollback).
 *   - `revocations`: every revocation so far, so withholding a newer one
 *     doesn't work; a clinic also keeps every revocation it has seen.
 */
export interface Index {
  v: 1
  key_id: string
  channel: Channel
  serial: number
  generated_at: string
  expires: string
  /** `package` is a file name next to the list; `size` is exact, so a download stops there (TUF: endless data). */
  versions: { version: string; package: string; sha256: string; size: number; manual_only: boolean; auto_after: string }[]
  withdrawn: { version: string; reason: string }[]
  revocations: string[]
  /** The latest desktop release for this channel, so app updates share the list's freshness. */
  app?: { version: string; file: string; sha512: string; size: number }
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

/**
 * Signs bytes and returns the 64-byte Ed25519 signature: a hardware key, or a
 * test key in tests. It is only ever handed a `statement`.
 */
export type Signer = (bytes: Uint8Array) => Promise<Uint8Array>

/** What a signature covers. Revocations and the serial floor name it by its sha256 (`signedSha256`). */
export const signedText = (kind: Kind, payloadB64: string): Uint8Array => enc.encode(`${PREFIX[kind]}.${payloadB64}`)

/** What the key itself signs: the kind and the sha256 of the signed text, at most 81 bytes. */
export const statement = (kind: Kind, signedSha256: string): Uint8Array => enc.encode(`${PREFIX[kind]}.sha256.${signedSha256}`)

export async function encode<K extends Kind>(kind: K, payload: Payloads[K], sign: Signer): Promise<string> {
  const p = await prepare(kind, payload)
  return assemble(kind, p.payloadB64, await sign(p.statement))
}

/**
 * `encode` in two steps, for a signer that can't be called back: a YubiKey
 * driven by another process (scripts/yubikey/setup-key.mjs). First the
 * statement to sign, then the token once it is signed.
 */
export async function prepare<K extends Kind>(kind: K, payload: Payloads[K]): Promise<{ payloadB64: string; statement: Uint8Array }> {
  const payloadB64 = b64urlEncode(enc.encode(canonicalJson(payload)))
  return { payloadB64, statement: statement(kind, await sha256Hex(signedText(kind, payloadB64))) }
}

export function assemble(kind: Kind, payloadB64: string, sig: Uint8Array): string {
  if (sig.length !== 64) throw new Error('An Ed25519 signature is 64 bytes')
  return `${PREFIX[kind]}.${payloadB64}.${b64urlEncode(sig)}`
}

// ─── Checking ─────────────────────────────────────────────────────────────────

export type Refusal =
  | 'malformed' | 'wrong_kind' | 'bad_signature' | 'unknown_key' | 'unknown_root'
  | 'not_yet_valid' | 'expired' | 'wrong_purpose' | 'revoked' | 'bad_path' | 'bad_version'
  | 'wrong_channel' | 'rollback' | 'serial_reuse' | 'not_listed' | 'withdrawn'

export type Checked<T> = { ok: true; payload: T; signedSha256: string } | { ok: false; reason: Refusal }

interface Split { payload: unknown; sig: Uint8Array; signedSha256: string; statement: Uint8Array }

async function split(kind: Kind, token: string): Promise<Split | Refusal> {
  const parts = token.split('.')
  if (parts.length !== 3) return 'malformed'
  if (parts[0] !== PREFIX[kind]) return 'wrong_kind'
  const bytes = b64urlDecode(parts[1])
  const sig = b64urlDecode(parts[2])
  if (!bytes || !sig || sig.length !== 64) return 'malformed'
  let payload: unknown
  try { payload = JSON.parse(dec.decode(bytes)) } catch { return 'malformed' }
  if (!payload || typeof payload !== 'object' || (payload as { v?: unknown }).v !== 1) return 'malformed'
  const signedSha256 = await sha256Hex(signedText(kind, parts[1]))
  return { payload, sig, signedSha256, statement: statement(kind, signedSha256) }
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
    const s = await split('revocation', token)
    if (typeof s === 'string') continue
    const r = s.payload as Revocation
    const root = pinned.find(k => k.id === r.root_id)
    if (!root || r.key_id === root.id) continue
    if (!Array.isArray(r.genuine) || !(await ed25519Verify(root.publicKey, s.sig, s.statement))) continue
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
  const s = await split('certificate', token)
  if (typeof s === 'string') return { ok: false, reason: s }
  const c = s.payload as Certificate
  const root = trust.roots.find(k => k.id === c.root_id)
  if (!root) return { ok: false, reason: 'unknown_root' }
  if (!(await ed25519Verify(root.publicKey, s.sig, s.statement))) return { ok: false, reason: 'bad_signature' }
  if (c.purpose !== purpose) return { ok: false, reason: 'wrong_purpose' }
  if (!(Date.parse(c.not_before) <= now.getTime())) return { ok: false, reason: 'not_yet_valid' }
  if (!(now.getTime() < Date.parse(c.not_after))) return { ok: false, reason: 'expired' }
  // A revocation covers what the key SIGNED (checkSigned), not the root's
  // certificate for it: its genuine earlier releases must still check out.
  return { ok: true, payload: c, signedSha256: s.signedSha256 }
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
  const s = await split(kind, token)
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
  if (!(await ed25519Verify(cert.public_key, s.sig, s.statement))) return { ok: false, reason: 'bad_signature' }
  const { signedSha256 } = s
  if (isRevoked(trust, keyId, signedSha256)) return { ok: false, reason: 'revoked' }
  if (kind === 'manifest') {
    const m = s.payload as Manifest
    if (m.channel !== 'stable' && m.channel !== 'test') return { ok: false, reason: 'malformed' }
    if (!isVersion(m.version) || !isVersion(m.from_min)) return { ok: false, reason: 'bad_version' }
    if (!Array.isArray(m.files) || !m.files.every(f => isPackagePath(f.path) && /^[0-9a-f]{64}$/.test(f.sha256))) {
      return { ok: false, reason: 'bad_path' }
    }
  }
  if (kind === 'app' && !isVersion((s.payload as AppRelease).version)) return { ok: false, reason: 'bad_version' }
  return { ok: true, payload: s.payload as Payloads[K], signedSha256 }
}

// ─── What is pinned, and where releases are published ─────────────────────────

/**
 * The two root keys (5e), pinned here, and so in the app and in `wivo-update`
 * (its generated copy). Filled from the YubiKey setup (docs/YUBIKEYS.md §3,
 * step 5). Empty until then: with no root, nothing is trusted.
 */
export const PINNED_ROOTS: RootKey[] = []

/**
 * Where the signed list and the packages are published (5a, 5g). Each
 * address holds `<channel>/updates.json` and, next to it, the packages that
 * list names. Set when the release tool first publishes (phase 1, slice 1).
 * Empty until then: nothing can be fetched, so nothing installs.
 */
export const UPDATE_SOURCES: string[] = []

/** The published list: the signed index, and the certificates that vouch for the key that signed it. */
export interface PublishedList {
  index: string
  certificates: string[]
}

const base = (source: string): string => source.replace(/\/+$/, '')
export const listAddress = (source: string, channel: Channel): string => `${base(source)}/${channel}/updates.json`
/** `file` must be a plain name (`isFileName`): a checked index's entries are. */
export const packageAddress = (source: string, channel: Channel, file: string): string => `${base(source)}/${channel}/${file}`

/** The list file's shape, or null. What it says is checked by `checkIndex`, not here. */
export function parsePublishedList(bytes: Uint8Array): PublishedList | null {
  if (bytes.length > MAX_INDEX_BYTES * 2) return null
  try {
    const v = JSON.parse(dec.decode(bytes)) as Partial<PublishedList> | null
    if (!v || typeof v.index !== 'string' || !Array.isArray(v.certificates) || v.certificates.length > 50) return null
    if (!v.certificates.every(c => typeof c === 'string' && c.length <= 4096)) return null
    return { index: v.index, certificates: v.certificates }
  } catch {
    return null
  }
}

/**
 * The revocations a list carries, read BEFORE the list is trusted: each one
 * is checked against the pinned roots on its own (`trustFrom`), so the list
 * that carries it vouches for nothing. A revocation of the very key that
 * signed the list then takes effect on that same check.
 */
export function listedRevocations(indexToken: string): string[] {
  const bytes = b64urlDecode(indexToken.split('.')[1] ?? '')
  if (!bytes) return []
  try {
    const revocations = (JSON.parse(dec.decode(bytes)) as { revocations?: unknown }).revocations
    return Array.isArray(revocations) ? revocations.filter((t): t is string => typeof t === 'string').slice(0, 100) : []
  } catch {
    return []
  }
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

// ─── The update package ───────────────────────────────────────────────────────

/**
 * One JSON file: the signed manifest, the certificates that vouch for its
 * signer, and every file the manifest lists, as base64. No archive to unpack,
 * so there are no archive paths to escape through. Packages are cumulative:
 * every migration is in every package, and `wivo-update` applies those its
 * ledger doesn't have yet.
 */
export interface UpdatePackage {
  manifest: string
  certificates: string[]
  files: Record<string, string>
}

/** The most a package may hold: far above today's few megabytes of SQL and function code. */
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024

export type CheckedPackage =
  | { ok: true; manifest: Manifest; signedSha256: string; files: Map<string, Uint8Array> }
  | { ok: false; reason: Refusal | 'too_large' | 'file_missing' | 'file_unlisted' | 'file_mismatch' }

function base64Decode(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return null
  try {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * A package, checked end to end: its manifest signed by a certified update
 * key (and not revoked), then every file exactly as listed (size and sha256),
 * none missing and none extra. Only then are the files handed out.
 */
export async function checkPackage(
  pkg: unknown, trust: Trust, now: Date, channel: Channel, totalBytes?: number,
): Promise<CheckedPackage> {
  if (totalBytes !== undefined && totalBytes > MAX_PACKAGE_BYTES) return { ok: false, reason: 'too_large' }
  const p = pkg as Partial<UpdatePackage> | null
  if (!p || typeof p.manifest !== 'string' || !Array.isArray(p.certificates) || !p.files || typeof p.files !== 'object') {
    return { ok: false, reason: 'malformed' }
  }
  const m = await checkSigned('manifest', p.manifest, p.certificates.filter((c): c is string => typeof c === 'string'), trust, now)
  if (!m.ok) return m
  if (m.payload.channel !== channel) return { ok: false, reason: 'wrong_channel' }
  const listed = new Set(m.payload.files.map(f => f.path))
  if (Object.keys(p.files).some(path => !listed.has(path))) return { ok: false, reason: 'file_unlisted' }
  const files = new Map<string, Uint8Array>()
  for (const f of m.payload.files) {
    const b64 = p.files[f.path]
    if (typeof b64 !== 'string') return { ok: false, reason: 'file_missing' }
    const bytes = base64Decode(b64)
    if (!bytes || bytes.length !== f.size || (await sha256Hex(bytes)) !== f.sha256) return { ok: false, reason: 'file_mismatch' }
    files.set(f.path, bytes)
  }
  return { ok: true, manifest: m.payload, signedSha256: m.signedSha256, files }
}

// ─── The version list: freshness, rollback and channel ────────────────────────

/** The most a version list may weigh. It is fetched often; anything bigger is refused unread. */
export const MAX_INDEX_BYTES = 1024 * 1024
/** The most a desktop installer may weigh: today's is about a tenth of this. */
export const MAX_APP_BYTES = 500 * 1024 * 1024

/** A file published next to the list: a plain name, never a path or an address. */
export const isFileName = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/.test(v) && !v.includes('..')

const isSize = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= max
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

function wellFormedIndex(i: Index): boolean {
  if (!Number.isSafeInteger(i.serial) || i.serial < 1 || !isTime(i.expires) || !isTime(i.generated_at)) return false
  if (!Array.isArray(i.versions) || !Array.isArray(i.withdrawn) || !Array.isArray(i.revocations)) return false
  if (!i.versions.every(e => e && isVersion(e.version) && isFileName(e.package) && /^[0-9a-f]{64}$/.test(e.sha256)
      && isSize(e.size, MAX_PACKAGE_BYTES) && typeof e.manual_only === 'boolean' && isTime(e.auto_after))) return false
  if (new Set(i.versions.map(e => e.version)).size !== i.versions.length) return false
  if (!i.withdrawn.every(w => w && isVersion(w.version) && typeof w.reason === 'string' && w.reason.length <= 500)) return false
  if (!i.revocations.every(t => typeof t === 'string')) return false
  if (i.app !== undefined && !(i.app && isVersion(i.app.version) && isFileName(i.app.file)
      && typeof i.app.sha512 === 'string' && isSize(i.app.size, MAX_APP_BYTES))) return false
  return true
}

/**
 * What a clinic remembers about the lists it has accepted, per signing key:
 * the highest serial and the hash of that list. A key's floor stops counting
 * once the key is revoked, so a key that leaked can't push the floor out of
 * reach of the next, honest key (TUF's fast-forward attack).
 */
export type SerialFloor = Record<string, { serial: number; sha256: string }>

export type CheckedIndex =
  | { ok: true; index: Index; signedSha256: string }
  | { ok: false; reason: Refusal | 'too_large' }

/**
 * The version list, as a clinic must check it before trusting anything in
 * it: signed by a certified update key, for this clinic's channel, not past
 * its expiry (a frozen list is refused), and not older than one already seen
 * (a rolled-back list is refused). `now` is the database's clock in
 * `wivo-update`, not a desktop's.
 */
export async function checkIndex(
  token: string, certificates: string[], trust: Trust, now: Date, channel: Channel, floor: SerialFloor,
): Promise<CheckedIndex> {
  if (token.length > MAX_INDEX_BYTES * 2) return { ok: false, reason: 'too_large' }
  const r = await checkSigned('index', token, certificates, trust, now)
  if (!r.ok) return r
  const i = r.payload
  if (i.channel !== channel) return { ok: false, reason: 'wrong_channel' }
  if (!wellFormedIndex(i)) return { ok: false, reason: 'malformed' }
  if (!(now.getTime() < Date.parse(i.expires))) return { ok: false, reason: 'expired' }
  const seen = floor[i.key_id]
  if (seen && !trust.revocations.some(x => x.key_id === i.key_id)) {
    if (i.serial < seen.serial) return { ok: false, reason: 'rollback' }
    if (i.serial === seen.serial && r.signedSha256 !== seen.sha256) return { ok: false, reason: 'serial_reuse' }
  }
  return { ok: true, index: i, signedSha256: r.signedSha256 }
}

/**
 * Whether to warn the owner: no list accepted at all, or the freshest one
 * accepted has expired. Then nothing new can be confirmed, which is what a
 * freeze attack, or a long outage, looks like from inside the clinic.
 */
export function isStale(freshestExpires: string | null, now: Date): boolean {
  return freshestExpires === null || !(now.getTime() < Date.parse(freshestExpires))
}

/**
 * A downloaded package, against the fresh list it came through: listed with
 * exactly these bytes, and not withdrawn. A validly signed package that the
 * current list doesn't name (an old one, or one paired with another list:
 * TUF's mix-and-match) is refused before it is even parsed.
 */
export function checkListed(
  index: Index, version: string, packageSha256: string, size: number,
): { ok: true; entry: Index['versions'][number] } | { ok: false; reason: 'not_listed' | 'withdrawn' } {
  const entry = index.versions.find(e => e.version === version)
  if (!entry || entry.sha256 !== packageSha256 || entry.size !== size) return { ok: false, reason: 'not_listed' }
  if (index.withdrawn.some(w => w.version === version)) return { ok: false, reason: 'withdrawn' }
  return { ok: true, entry }
}

// ─── Planning an install ──────────────────────────────────────────────────────

/** A migration this database has applied (sql/119 wivo_schema_migration). */
export interface LedgerRow { file: string; sha256: string }

export type InstallPlan =
  | { ok: true; migrations: ManifestFile[]; functions: ManifestFile[]; checks: ManifestFile[] }
  | { ok: false; reason: 'not_newer' | 'too_old' | 'ledger_changed' | 'ledger_missing' | 'out_of_order' }

/**
 * What installing a checked package would do here. Packages are cumulative
 * and list their migrations in the order they run, so:
 *   - it must be newer than the installed version, and the installed
 *     version no older than its `from_min` (a first install has none);
 *   - every migration the ledger has must be in it with the same sha256: a
 *     migration is never edited or dropped once applied;
 *   - the ones still to run must all come after the last one applied: one
 *     slipped in earlier means a package built from another history.
 */
export function planInstall(manifest: Manifest, installed: string | null, ledger: LedgerRow[]): InstallPlan {
  if (installed !== null) {
    if (compareVersions(manifest.version, installed) <= 0) return { ok: false, reason: 'not_newer' }
    if (compareVersions(installed, manifest.from_min) < 0) return { ok: false, reason: 'too_old' }
  }
  const migrations = manifest.files.filter(f => f.path.startsWith('migrations/'))
  const applied = new Map(ledger.map(r => [r.file, r.sha256]))
  for (const [file, sha] of applied) {
    const inPackage = migrations.find(f => f.path === file)
    if (!inPackage) return { ok: false, reason: 'ledger_missing' }
    if (inPackage.sha256 !== sha) return { ok: false, reason: 'ledger_changed' }
  }
  const lastApplied = migrations.reduce((last, f, i) => (applied.has(f.path) ? i : last), -1)
  if (migrations.some((f, i) => i < lastApplied && !applied.has(f.path))) return { ok: false, reason: 'out_of_order' }
  return {
    ok: true,
    migrations: migrations.filter(f => !applied.has(f.path)),
    functions: manifest.files.filter(f => f.path.startsWith('functions/')),
    checks: manifest.files.filter(f => f.path.startsWith('checks/')),
  }
}
