/**
 * Checking a YubiKey's PIV attestation and an Ed25519 signature
 * (docs/YUBIKEYS.md), in Node alone: nothing from Yubico's software decides
 * whether a key passes.
 *
 * THE CHAIN, for firmware 5.7.4 and later:
 *   Yubico Attestation Root 1 (pinned here by its SHA-256)
 *     → Yubico Attestation Intermediate A 1 or B 1
 *       → Yubico PIV Attestation A 1, B 1 or B2 1
 *         → the key's own factory certificate (slot f9)
 *           → the attestation of the key just made (signed by f9)
 *
 * WHAT THE KEY SAYS ABOUT ITSELF, inside the signed attestation, under
 * Yubico's OID 1.3.6.1.4.1.41482.3 (developers.yubico.com/PIV/Introduction/PIV_attestation.html):
 *   .3  firmware: 3 bytes        .7  serial: an integer
 *   .8  PIN and touch policy     .9  form factor: 1 byte
 *
 * Pure functions: the command (arrival-test.mjs) reads the files, and the
 * tests feed a made-up chain.
 */
import { X509Certificate, createPublicKey, verify as nodeVerify, webcrypto } from 'node:crypto'

/** Yubico Attestation Root 1, https://developers.yubico.com/PKI/yubico-ca-1.pem (fetched 2026-11-06). */
export const YUBICO_ROOT_SHA256 =
  '62:76:0C:6A:6E:F9:16:79:F4:54:C8:90:2B:80:FD:00:98:25:B3:F2:5D:A9:0F:1F:BA:CE:2E:C6:58:6C:D5:A8'

export const PIN_POLICY = { 1: 'never', 2: 'once', 3: 'always' }
export const TOUCH_POLICY = { 1: 'never', 2: 'always', 3: 'cached' }
export const FORM_FACTOR = { 1: 'USB-A keychain', 2: 'USB-A nano', 3: 'USB-C keychain', 4: 'USB-C nano', 5: 'USB-C and Lightning' }

export const splitPem = text =>
  text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []

// ─── A minimal DER reader: enough to find a certificate's extensions ─────────

function tlv(buf, pos) {
  let len = buf[pos + 1]
  let start = pos + 2
  if (len & 0x80) {
    const n = len & 0x7f
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[start + i]
    start += n
  }
  if (start + len > buf.length) throw new Error('Malformed DER')
  return { tag: buf[pos], start, end: start + len }
}

function children(buf, node) {
  const out = []
  for (let p = node.start; p < node.end; ) {
    const c = tlv(buf, p)
    out.push(c)
    p = c.end
  }
  return out
}

const YUBICO_ARC = Buffer.from([0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0xc4, 0x0a, 0x03]) // 1.3.6.1.4.1.41482.3

/** Yubico's extensions in a certificate, keyed by the last number of the OID (3, 7, 8, 9…). */
export function yubicoExtensions(der) {
  const tbs = children(der, tlv(der, 0))[0]
  const wrapper = children(der, tbs).find(c => c.tag === 0xa3) // [3] extensions
  if (!wrapper) return {}
  const out = {}
  for (const ext of children(der, children(der, wrapper)[0])) {
    const parts = children(der, ext)
    const oid = der.subarray(parts[0].start, parts[0].end)
    if (oid.length !== YUBICO_ARC.length + 1 || !oid.subarray(0, YUBICO_ARC.length).equals(YUBICO_ARC)) continue
    const value = parts[parts.length - 1] // extnValue, after the optional "critical"
    out[oid[oid.length - 1]] = Buffer.from(der.subarray(value.start, value.end))
  }
  return out
}

const uint = bytes => bytes.reduce((n, b) => n * 256 + b, 0)

/** The serial: a DER INTEGER, or the bare bytes if a key ever writes it that way. */
export const serialOf = b => (b.length >= 3 && b[0] === 0x02 && b[1] === b.length - 2 ? uint(b.subarray(2)) : uint(b))

/** What the attestation says about the key, read from the signed certificate. */
export function attestedFacts(attestationPem) {
  const cert = new X509Certificate(attestationPem)
  const ext = yubicoExtensions(cert.raw)
  const jwk = cert.publicKey.asymmetricKeyType === 'ed25519' ? cert.publicKey.export({ format: 'jwk' }) : null
  return {
    firmware: ext[3]?.length === 3 ? [...ext[3]] : null,
    serial: ext[7] ? serialOf(ext[7]) : null,
    pinPolicy: ext[8]?.length === 2 ? PIN_POLICY[ext[8][0]] ?? `0x${ext[8][0].toString(16)}` : null,
    touchPolicy: ext[8]?.length === 2 ? TOUCH_POLICY[ext[8][1]] ?? `0x${ext[8][1].toString(16)}` : null,
    formFactor: ext[9]?.length === 1 ? FORM_FACTOR[ext[9][0] & 0x7f] ?? `0x${ext[9][0].toString(16)}` : null,
    fips: ext[9]?.length === 1 ? (ext[9][0] & 0x80) !== 0 : null,
    keyType: cert.publicKey.asymmetricKeyType,
    publicKeyHex: jwk ? Buffer.from(jwk.x, 'base64url').toString('hex') : null,
    subject: cert.subject,
  }
}

const valid = (cert, now) => new Date(cert.validFrom) <= now && now <= new Date(cert.validTo)

/**
 * The attestation, up through the key's f9 certificate and Yubico's
 * intermediates, to the pinned root. Every link is a checked signature.
 */
export function checkChain({ attestationPem, f9Pem, intermediatesPem, rootPem, rootSha256 = YUBICO_ROOT_SHA256, now = new Date() }) {
  const problems = []
  const att = new X509Certificate(attestationPem)
  const f9 = new X509Certificate(f9Pem)
  const root = new X509Certificate(rootPem)
  const intermediates = splitPem(intermediatesPem).map(p => new X509Certificate(p))

  if (root.fingerprint256 !== rootSha256) problems.push(`the root is not Yubico's: its SHA-256 is ${root.fingerprint256}`)
  if (root.subject !== root.issuer || !root.verify(root.publicKey)) problems.push('the root does not sign itself')
  if (!att.checkIssued(f9) || !att.verify(f9.publicKey)) problems.push("the attestation is not signed by the key's own factory certificate (f9)")

  const path = [att, f9]
  let cur = f9
  while (cur !== root && path.length < 8) {
    const issuer = cur.issuer === root.subject ? root : intermediates.find(c => c.subject === cur.issuer)
    if (!issuer) { problems.push(`no certificate named "${cur.issuer}" among Yubico's`); break }
    if (!cur.checkIssued(issuer) || !cur.verify(issuer.publicKey)) { problems.push(`"${cur.subject}" is not signed by "${issuer.subject}"`); break }
    path.push(issuer)
    cur = issuer
  }
  if (cur !== root) problems.push("the chain does not reach Yubico's root")
  if (!/^CN=Yubico PIV Attestation /.test(f9.issuer)) problems.push(`the f9 certificate is issued by "${f9.issuer}", not one of Yubico's PIV attestation CAs`)
  for (const c of path) if (!valid(c, now)) problems.push(`"${c.subject}" is outside its dates (${c.validFrom} – ${c.validTo})`)

  return { ok: problems.length === 0, problems, path: path.map(c => c.subject.replace(/\n/g, ', ')), f9Sha256: f9.fingerprint256 }
}

/** An Ed25519 signature, checked as the release code checks it (WebCrypto) and by Node's own call. */
export async function checkSignature(publicKeyHex, messageHex, signatureHex) {
  const raw = Buffer.from(publicKeyHex, 'hex')
  const message = Buffer.from(messageHex, 'hex')
  const sig = Buffer.from(signatureHex, 'hex')
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' })
  const changed = Buffer.from(message)
  changed[changed.length - 1] ^= 1
  const web = await webcrypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify'])
  return {
    node: sig.length === 64 && nodeVerify(null, message, key, sig),
    webcrypto: sig.length === 64 && (await webcrypto.subtle.verify({ name: 'Ed25519' }, web, sig, message)),
    changedRefused: !(sig.length === 64 && nodeVerify(null, changed, key, sig)),
  }
}

export const atLeast = (v, min) => v[0] !== min[0] ? v[0] > min[0] : v[1] !== min[1] ? v[1] > min[1] : v[2] >= min[2]
