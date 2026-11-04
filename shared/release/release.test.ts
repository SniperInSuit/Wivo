/**
 * shared/release: what Wivo signs and what every clinic checks before it
 * installs (docs/ARCHITECTURE-INSTANCES.md §5a, §5e). Test keys only; the real
 * ones never leave the hardware keys.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  encode, trustFrom, checkCertificate, checkSigned, compareVersions, isPackagePath, canonicalJson,
  b64urlEncode, b64urlDecode, sha256Hex, signingInput, PREFIX,
  type Certificate, type Manifest, type RootKey, type Signer, type Revocation,
} from './release'

interface TestKey { id: string; publicKey: string; sign: Signer }

async function testKey(id: string): Promise<TestKey> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return {
    id,
    publicKey: b64urlEncode(raw),
    sign: async bytes => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new Uint8Array(bytes))),
  }
}

const NOW = new Date('2026-11-05T12:00:00Z')
let rootA: TestKey, rootB: TestKey, stranger: TestKey, signing: TestKey, appKey: TestKey
let pinned: RootKey[]
let signingCert: string, appCert: string

const cert = (k: TestKey, root: TestKey, over: Partial<Certificate> = {}) => encode('certificate', {
  v: 1, key_id: k.id, public_key: k.publicKey, purpose: 'update',
  not_before: '2026-01-01T00:00:00Z', not_after: '2028-01-01T00:00:00Z', root_id: root.id, ...over,
}, root.sign)

const manifest = (over: Partial<Manifest> = {}): Manifest => ({
  v: 1, key_id: 'signing-1', version: '2.3.0', from_min: '2.2.0', created_at: '2026-11-05T10:00:00Z',
  manual_only: false, auto_after: '2026-11-08T10:00:00Z',
  files: [{ path: 'migrations/119_ledger.sql', sha256: 'a'.repeat(64), size: 10 }], ...over,
})

const revoke = (root: TestKey, r: Partial<Revocation>) => encode('revocation', {
  v: 1, key_id: 'signing-1', genuine: [], reason: 'test', issued_at: '2026-11-05T11:00:00Z', root_id: root.id, ...r,
}, root.sign)

beforeAll(async () => {
  rootA = await testKey('root-a')
  rootB = await testKey('root-b')
  stranger = await testKey('stranger')
  signing = await testKey('signing-1')
  appKey = await testKey('app-1')
  pinned = [{ id: rootA.id, publicKey: rootA.publicKey }, { id: rootB.id, publicKey: rootB.publicKey }]
  signingCert = await cert(signing, rootA)
  appCert = await cert(appKey, rootB, { purpose: 'app' })
})

describe('a package signed by a certified key', () => {
  it('passes, with the hash of exactly what was signed', async () => {
    const token = await encode('manifest', manifest(), signing.sign)
    const r = await checkSigned('manifest', token, [signingCert], await trustFrom(pinned, []), NOW)
    expect(r).toMatchObject({ ok: true, payload: { version: '2.3.0' } })
    const [, payloadB64] = token.split('.')
    expect(r.ok && r.signedSha256).toBe(await sha256Hex(signingInput('manifest', payloadB64)))
  })

  it('one changed byte: refused', async () => {
    const token = await encode('manifest', manifest(), signing.sign)
    const [p, payload, sig] = token.split('.')
    const bytes = b64urlDecode(payload)!
    bytes[10] ^= 1
    const r = await checkSigned('manifest', `${p}.${b64urlEncode(bytes)}.${sig}`, [signingCert], await trustFrom(pinned, []), NOW)
    expect(r.ok).toBe(false)
  })

  it('signed by a key without a certificate, or certified by an unknown root: refused', async () => {
    const trust = await trustFrom(pinned, [])
    const bySelf = await encode('manifest', manifest({ key_id: 'stranger' }), stranger.sign)
    expect(await checkSigned('manifest', bySelf, [signingCert], trust, NOW)).toEqual({ ok: false, reason: 'unknown_key' })
    const selfCert = await cert(stranger, stranger)
    expect(await checkSigned('manifest', bySelf, [selfCert], trust, NOW)).toEqual({ ok: false, reason: 'unknown_key' })
    expect(await checkCertificate(selfCert, trust, 'update', NOW)).toEqual({ ok: false, reason: 'unknown_root' })
  })

  it('a certificate for app releases does not sign packages, and the other way round', async () => {
    const trust = await trustFrom(pinned, [])
    const byAppKey = await encode('manifest', manifest({ key_id: 'app-1' }), appKey.sign)
    expect(await checkSigned('manifest', byAppKey, [appCert], trust, NOW)).toEqual({ ok: false, reason: 'unknown_key' })
    const release = await encode('app', {
      v: 1, key_id: 'app-1', version: '2.3.0', file: 'Wivo Setup 2.3.0.exe', sha512: 'x', size: 1, created_at: '2026-11-05T10:00:00Z',
    }, appKey.sign)
    expect(await checkSigned('app', release, [appCert], trust, NOW)).toMatchObject({ ok: true })
    expect(await checkSigned('app', release, [signingCert], trust, NOW)).toEqual({ ok: false, reason: 'unknown_key' })
  })

  it('a certificate not yet valid or expired: refused', async () => {
    const trust = await trustFrom(pinned, [])
    const token = await encode('manifest', manifest(), signing.sign)
    const future = await cert(signing, rootA, { not_before: '2027-01-01T00:00:00Z' })
    const past = await cert(signing, rootA, { not_after: '2026-11-01T00:00:00Z' })
    expect(await checkCertificate(future, trust, 'update', NOW)).toEqual({ ok: false, reason: 'not_yet_valid' })
    expect(await checkCertificate(past, trust, 'update', NOW)).toEqual({ ok: false, reason: 'expired' })
    expect(await checkSigned('manifest', token, [future, past], trust, NOW)).toEqual({ ok: false, reason: 'unknown_key' })
  })

  it('a signature of one kind is never accepted as another (the prefix is signed)', async () => {
    const trust = await trustFrom(pinned, [])
    // The certificate's own signature, relabelled as a manifest.
    const [, payload, sig] = signingCert.split('.')
    expect(await checkSigned('manifest', `${PREFIX.manifest}.${payload}.${sig}`, [signingCert], trust, NOW)).toMatchObject({ ok: false })
    expect(await checkSigned('manifest', signingCert, [signingCert], trust, NOW)).toEqual({ ok: false, reason: 'wrong_kind' })
  })
})

describe('revocations', () => {
  it('a revoked signing key: refused, except what it signed before (the genuine list)', async () => {
    const before = await encode('manifest', manifest({ version: '2.2.0', from_min: '2.1.0' }), signing.sign)
    const after = await encode('manifest', manifest(), signing.sign)
    const beforeSha = await sha256Hex(signingInput('manifest', before.split('.')[1]))
    const trust = await trustFrom(pinned, [await revoke(rootB, { genuine: [beforeSha] })])
    expect(await checkSigned('manifest', before, [signingCert], trust, NOW)).toMatchObject({ ok: true })
    expect(await checkSigned('manifest', after, [signingCert], trust, NOW)).toEqual({ ok: false, reason: 'revoked' })
  })

  it('a revocation not signed by a pinned root is ignored', async () => {
    const forged = await encode('revocation', {
      v: 1, key_id: 'signing-1', genuine: [], reason: 'x', issued_at: '2026-11-05T11:00:00Z', root_id: 'stranger',
    }, stranger.sign)
    const trust = await trustFrom(pinned, [forged])
    expect(trust.revocations).toEqual([])
    const token = await encode('manifest', manifest(), signing.sign)
    expect(await checkSigned('manifest', token, [signingCert], trust, NOW)).toMatchObject({ ok: true })
  })

  it('a root revoked by the other root: what it certified is no longer trusted', async () => {
    const trust = await trustFrom(pinned, [await revoke(rootB, { key_id: 'root-a' })])
    expect(trust.roots.map(r => r.id)).toEqual(['root-b'])
    const token = await encode('manifest', manifest(), signing.sign)
    expect(await checkSigned('manifest', token, [signingCert], trust, NOW)).toEqual({ ok: false, reason: 'unknown_key' })
    // A new certificate from the remaining root works.
    expect(await checkSigned('manifest', token, [await cert(signing, rootB)], trust, NOW)).toMatchObject({ ok: true })
  })

  it('both roots revoked: nothing is trusted (it fails closed)', async () => {
    const trust = await trustFrom(pinned, [await revoke(rootB, { key_id: 'root-a' }), await revoke(rootA, { key_id: 'root-b' })])
    expect(trust.roots).toEqual([])
  })

  it('a root cannot revoke itself', async () => {
    const trust = await trustFrom(pinned, [await revoke(rootA, { key_id: 'root-a' })])
    expect(trust.roots).toHaveLength(2)
  })
})

describe('what a package may contain', () => {
  it('paths only under migrations/, functions/ or checks/, in plain segments', () => {
    for (const ok of ['migrations/119_ledger.sql', 'functions/bridge/index.ts', 'checks/schema_check.sql']) expect(isPackagePath(ok), ok).toBe(true)
    for (const bad of ['../etc/passwd', '/migrations/x.sql', 'migrations/../../x', 'migrations\\x.sql', 'other/x.sql',
                       'migrations/.hidden', 'migrations//x.sql', 'migrations/./x.sql', '', 'migrations/']) {
      expect(isPackagePath(bad), bad).toBe(false)
    }
  })

  it('a manifest with a bad path or version is refused even when signed', async () => {
    const trust = await trustFrom(pinned, [])
    const badPath = await encode('manifest', manifest({ files: [{ path: 'migrations/../x.sql', sha256: 'a'.repeat(64), size: 1 }] }), signing.sign)
    expect(await checkSigned('manifest', badPath, [signingCert], trust, NOW)).toEqual({ ok: false, reason: 'bad_path' })
    const badVersion = await encode('manifest', manifest({ version: '2.3' }), signing.sign)
    expect(await checkSigned('manifest', badVersion, [signingCert], trust, NOW)).toEqual({ ok: false, reason: 'bad_version' })
  })

  it('versions compare by number', () => {
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1)
    expect(compareVersions('2.3.0', '2.3.0')).toBe(0)
    expect(compareVersions('1.99.99', '2.0.0')).toBe(-1)
  })
})

describe('encoding', () => {
  it('the same content gives the same bytes, whatever the key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}')
  })

  it('malformed tokens are refused, not repaired', async () => {
    const trust = await trustFrom(pinned, [])
    for (const t of ['', 'WIVOMAN1', 'WIVOMAN1.a.b.c', 'WIVOMAN1.@@@.' + 'A'.repeat(86), 'WIVOMAN1.e30.short']) {
      expect((await checkSigned('manifest', t, [signingCert], trust, NOW)).ok, t).toBe(false)
    }
    expect(b64urlDecode('ab=c')).toBeNull()
  })
})
