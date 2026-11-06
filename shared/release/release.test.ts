/**
 * shared/release: what Wivo signs and what every clinic checks before it
 * installs (docs/ARCHITECTURE-INSTANCES.md §5a, §5e). Test keys only; the real
 * ones never leave the hardware keys.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  encode, prepare, assemble, trustFrom, checkCertificate, checkSigned, checkPackage, checkIndex, checkListed, isStale, planInstall, compareVersions, isPackagePath, canonicalJson,
  b64urlEncode, b64urlDecode, sha256Hex, signedText, statement, PREFIX, MAX_PACKAGE_BYTES,
  type Certificate, type Manifest, type Index, type RootKey, type Signer, type Revocation,
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
  v: 1, key_id: 'signing-1', channel: 'stable', version: '2.3.0', from_min: '2.2.0', created_at: '2026-11-05T10:00:00Z',
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
    expect(r.ok && r.signedSha256).toBe(await sha256Hex(signedText('manifest', payloadB64)))
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

describe('what the key signs: a short statement, whatever the size (docs/YUBIKEYS.md §2)', () => {
  /** As key A measured: 3,000 bytes signed, 4,096 refused. */
  const asYubiKey = (k: TestKey, seen: Uint8Array[]): Signer => async bytes => {
    if (bytes.length > 3000) throw new Error('NotSupportedError: APDU length exceeds YubiKey capability')
    seen.push(bytes)
    return k.sign(bytes)
  }

  it('a version list far beyond what a YubiKey signs: the key sees only the kind and the hash', async () => {
    const seen: Uint8Array[] = []
    const versions = Array.from({ length: 500 }, (_, i) => ({
      version: `2.${i}.0`, package: `wivo-update-2.${i}.0.json`, sha256: 'a'.repeat(64), size: 1234, manual_only: false, auto_after: '2026-11-08T10:00:00Z',
    }))
    const token = await encode('index', {
      v: 1, key_id: 'signing-1', channel: 'stable', serial: 7, generated_at: '2026-11-05T10:00:00Z',
      expires: '2026-11-19T10:00:00Z', versions, withdrawn: [], revocations: [],
    }, asYubiKey(signing, seen))
    expect(token.length).toBeGreaterThan(60_000)
    const r = await checkIndex(token, [signingCert], await trustFrom(pinned, []), NOW, 'stable', {})
    expect(r.ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(new TextDecoder().decode(seen[0])).toBe(`WIVOIDX1.sha256.${r.ok && r.signedSha256}`)
  })

  it('in two steps, for a key in another process: the same token as in one', async () => {
    const payload = manifest()
    const p = await prepare('manifest', payload)
    expect(assemble('manifest', p.payloadB64, await signing.sign(p.statement))).toBe(await encode('manifest', payload, signing.sign))
    expect(() => assemble('manifest', p.payloadB64, new Uint8Array(63))).toThrow()
  })

  it('every kind fits: at most 81 bytes', () => {
    for (const kind of Object.keys(PREFIX) as (keyof typeof PREFIX)[]) {
      expect(statement(kind, 'f'.repeat(64)).length).toBeLessThanOrEqual(81)
    }
  })

  it('a signature over the whole text instead of the statement: refused', async () => {
    const [p, payloadB64] = (await encode('manifest', manifest(), signing.sign)).split('.')
    const whole = await signing.sign(signedText('manifest', payloadB64))
    expect(await checkSigned('manifest', `${p}.${payloadB64}.${b64urlEncode(whole)}`, [signingCert], await trustFrom(pinned, []), NOW))
      .toEqual({ ok: false, reason: 'bad_signature' })
  })

  it("a statement signed for one kind is not another kind's", async () => {
    const [, payloadB64] = (await encode('manifest', manifest(), signing.sign)).split('.')
    const asIndex = await signing.sign(statement('index', await sha256Hex(signedText('manifest', payloadB64))))
    expect(await checkSigned('manifest', `${PREFIX.manifest}.${payloadB64}.${b64urlEncode(asIndex)}`, [signingCert], await trustFrom(pinned, []), NOW))
      .toEqual({ ok: false, reason: 'bad_signature' })
  })
})

describe('revocations', () => {
  it('a revoked signing key: refused, except what it signed before (the genuine list)', async () => {
    const before = await encode('manifest', manifest({ version: '2.2.0', from_min: '2.1.0' }), signing.sign)
    const after = await encode('manifest', manifest(), signing.sign)
    const beforeSha = await sha256Hex(signedText('manifest', before.split('.')[1]))
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

describe('an update package', () => {
  const b64 = (s: string) => btoa(s)
  const SQL = 'create table x (id int);'
  async function pkg(over: { files?: Record<string, string>; listed?: { path: string; content: string }[] } = {}) {
    const listed = over.listed ?? [{ path: 'migrations/119_x.sql', content: SQL }]
    const files = await Promise.all(listed.map(async f => ({
      path: f.path, size: new TextEncoder().encode(f.content).length, sha256: await sha256Hex(new TextEncoder().encode(f.content)) })))
    const token = await encode('manifest', manifest({ files }), signing.sign)
    return { manifest: token, certificates: [signingCert], files: over.files ?? Object.fromEntries(listed.map(f => [f.path, b64(f.content)])) }
  }

  it('passes when every file is exactly as listed, and hands out the files', async () => {
    const r = await checkPackage(await pkg(), await trustFrom(pinned, []), NOW, 'stable')
    expect(r.ok).toBe(true)
    expect(r.ok && new TextDecoder().decode(r.files.get('migrations/119_x.sql'))).toBe(SQL)
  })

  it('a changed file, a missing one, or an extra one: refused', async () => {
    const trust = await trustFrom(pinned, [])
    expect(await checkPackage(await pkg({ files: { 'migrations/119_x.sql': b64(SQL + ' drop table jobs;') } }), trust, NOW, 'stable'))
      .toEqual({ ok: false, reason: 'file_mismatch' })
    expect(await checkPackage(await pkg({ files: {} }), trust, NOW, 'stable')).toEqual({ ok: false, reason: 'file_missing' })
    expect(await checkPackage(await pkg({ files: { 'migrations/119_x.sql': b64(SQL), 'migrations/120_extra.sql': b64('x') } }), trust, NOW, 'stable'))
      .toEqual({ ok: false, reason: 'file_unlisted' })
    // A test package never installs on a clinic that follows stable.
    expect(await checkPackage(await pkg(), trust, NOW, 'test')).toEqual({ ok: false, reason: 'wrong_channel' })
  })

  it('a package that is not even shaped like one, or too large: refused before anything else', async () => {
    const trust = await trustFrom(pinned, [])
    for (const bad of [null, {}, { manifest: 1, certificates: [], files: {} }, 'x']) {
      expect((await checkPackage(bad, trust, NOW, 'stable')).ok).toBe(false)
    }
    expect(await checkPackage(await pkg(), trust, NOW, 'stable', MAX_PACKAGE_BYTES + 1)).toEqual({ ok: false, reason: 'too_large' })
  })

  it('an unsigned or wrongly signed manifest: refused, whatever the files say', async () => {
    const good = await pkg()
    const forged = await encode('manifest', manifest({ key_id: 'stranger' }), stranger.sign)
    expect((await checkPackage({ ...good, manifest: forged }, await trustFrom(pinned, []), NOW, 'stable')).ok).toBe(false)
  })
})

describe('the version list (TUF: freeze, rollback, fast-forward, channel)', () => {
  const list = (over: Partial<Index> = {}): Index => ({
    v: 1, key_id: 'signing-1', channel: 'stable', serial: 7, generated_at: '2026-11-05T10:00:00Z',
    expires: '2026-11-19T10:00:00Z', versions: [], withdrawn: [], revocations: [], ...over,
  })

  it('a fresh list for this channel passes', async () => {
    const token = await encode('index', list(), signing.sign)
    expect(await checkIndex(token, [signingCert], await trustFrom(pinned, []), NOW, 'stable', {})).toMatchObject({ ok: true, index: { serial: 7 } })
  })

  it('freeze: a validly signed list past its expiry is refused, and the owner is warned', async () => {
    const old = await encode('index', list({ expires: '2026-11-01T00:00:00Z' }), signing.sign)
    expect(await checkIndex(old, [signingCert], await trustFrom(pinned, []), NOW, 'stable', {})).toEqual({ ok: false, reason: 'expired' })
    expect(isStale('2026-11-01T00:00:00Z', NOW)).toBe(true)
    expect(isStale(null, NOW)).toBe(true)
    expect(isStale('2026-11-19T10:00:00Z', NOW)).toBe(false)
  })

  it('rollback: a lower serial than one already accepted is refused; the same serial with other content too', async () => {
    const trust = await trustFrom(pinned, [])
    const seen = await encode('index', list({ serial: 9 }), signing.sign)
    const r = await checkIndex(seen, [signingCert], trust, NOW, 'stable', {})
    const floor = { 'signing-1': { serial: 9, sha256: r.ok ? r.signedSha256 : '' } }
    const older = await encode('index', list({ serial: 8 }), signing.sign)
    expect(await checkIndex(older, [signingCert], trust, NOW, 'stable', floor)).toEqual({ ok: false, reason: 'rollback' })
    const sameSerial = await encode('index', list({ serial: 9, withdrawn: [{ version: '2.3.0', reason: 'x' }] }), signing.sign)
    expect(await checkIndex(sameSerial, [signingCert], trust, NOW, 'stable', floor)).toEqual({ ok: false, reason: 'serial_reuse' })
    expect(await checkIndex(seen, [signingCert], trust, NOW, 'stable', floor)).toMatchObject({ ok: true })
  })

  it('fast-forward: once a key is revoked, its high serial no longer blocks the next honest key', async () => {
    const next = await testKey('signing-2')
    const nextCert = await cert(next, rootA)
    const trust = await trustFrom(pinned, [await revoke(rootB, { key_id: 'signing-1' })])
    const floor = { 'signing-1': { serial: 2 ** 40, sha256: 'x' } }
    const honest = await encode('index', list({ key_id: 'signing-2', serial: 1 }), next.sign)
    expect(await checkIndex(honest, [nextCert], trust, NOW, 'stable', floor)).toMatchObject({ ok: true })
  })

  it('a test list is refused by a stable clinic; a huge one unread', async () => {
    const trust = await trustFrom(pinned, [])
    const testList = await encode('index', list({ channel: 'test' }), signing.sign)
    expect(await checkIndex(testList, [signingCert], trust, NOW, 'stable', {})).toEqual({ ok: false, reason: 'wrong_channel' })
    expect(await checkIndex('x'.repeat(3 * 1024 * 1024), [signingCert], trust, NOW, 'stable', {})).toEqual({ ok: false, reason: 'too_large' })
  })
})

describe('what the list names, and nothing else (TUF: endless data, mix-and-match)', () => {
  const entry = { version: '2.3.0', package: 'wivo-update-2.3.0.json', sha256: 'a'.repeat(64), size: 1234, manual_only: false, auto_after: '2026-11-08T10:00:00Z' }
  const list = (over: Partial<Index> = {}): Index => ({
    v: 1, key_id: 'signing-1', channel: 'stable', serial: 7, generated_at: '2026-11-05T10:00:00Z',
    expires: '2026-11-19T10:00:00Z', versions: [entry], withdrawn: [], revocations: [], ...over,
  })

  it('an entry without an exact size, with a path for a name, or listed twice makes the whole list malformed', async () => {
    const trust = await trustFrom(pinned, [])
    for (const bad of [
      list({ versions: [{ ...entry, size: 0 }] }),
      list({ versions: [{ ...entry, size: 51 * 1024 * 1024 }] }),
      list({ versions: [{ ...entry, package: '../../etc/passwd' }] }),
      list({ versions: [{ ...entry, package: 'https://elsewhere.example/x.json' }] }),
      list({ versions: [{ ...entry, sha256: 'A'.repeat(64) }] }),
      list({ versions: [entry, entry] }),
      list({ withdrawn: [{ version: 'latest', reason: 'x' }] }),
      list({ app: { version: '2.3.0', file: 'Wivo Setup 2.3.0.exe', sha512: 'x', size: 600 * 1024 * 1024 } }),
    ]) {
      expect(await checkIndex(await encode('index', bad, signing.sign), [signingCert], trust, NOW, 'stable', {}))
        .toEqual({ ok: false, reason: 'malformed' })
    }
    expect(await checkIndex(await encode('index', list({ app: { version: '2.3.0', file: 'Wivo Setup 2.3.0.exe', sha512: 'x', size: 120 * 1024 * 1024 } }), signing.sign),
      [signingCert], trust, NOW, 'stable', {})).toMatchObject({ ok: true })
  })

  it('a package must be in the fresh list with exactly its bytes, and not withdrawn', () => {
    expect(checkListed(list(), '2.3.0', 'a'.repeat(64), 1234)).toMatchObject({ ok: true, entry: { package: 'wivo-update-2.3.0.json' } })
    expect(checkListed(list(), '2.3.0', 'b'.repeat(64), 1234)).toEqual({ ok: false, reason: 'not_listed' })
    expect(checkListed(list(), '2.3.0', 'a'.repeat(64), 1235)).toEqual({ ok: false, reason: 'not_listed' })
    expect(checkListed(list(), '2.2.0', 'a'.repeat(64), 1234)).toEqual({ ok: false, reason: 'not_listed' })
    expect(checkListed(list({ withdrawn: [{ version: '2.3.0', reason: 'a bad migration' }] }), '2.3.0', 'a'.repeat(64), 1234))
      .toEqual({ ok: false, reason: 'withdrawn' })
  })
})

describe('planning an install against what the database has', () => {
  const f = (path: string, sha = 'a'.repeat(64)) => ({ path, sha256: sha, size: 1 })
  const m = (files: ReturnType<typeof f>[], over: Partial<Manifest> = {}): Manifest => ({
    v: 1, key_id: 'signing-1', channel: 'stable', version: '2.4.0', from_min: '2.2.0', created_at: '2026-11-05T10:00:00Z',
    manual_only: false, auto_after: '2026-11-08T10:00:00Z', files, ...over,
  })
  const files = [f('migrations/001_base.sql'), f('migrations/002_ledger.sql'), f('migrations/003_more.sql'), f('functions/wivo-update.js'), f('checks/schema_check.sql')]
  const ledger = (paths: string[]) => paths.map(file => ({ file, sha256: 'a'.repeat(64) }))

  it('a first install: every migration, in the package\'s order; functions and checks apart', () => {
    expect(planInstall(m(files), null, [])).toEqual({ ok: true, migrations: files.slice(0, 3), functions: [files[3]], checks: [files[4]] })
  })

  it('an update: only what the ledger lacks', () => {
    const plan = planInstall(m(files), '2.3.0', ledger(['migrations/001_base.sql', 'migrations/002_ledger.sql']))
    expect(plan).toMatchObject({ ok: true, migrations: [files[2]] })
  })

  it('only newer, and only from a version the package updates from', () => {
    expect(planInstall(m(files), '2.4.0', [])).toEqual({ ok: false, reason: 'not_newer' })
    expect(planInstall(m(files), '2.5.0', [])).toEqual({ ok: false, reason: 'not_newer' })
    expect(planInstall(m(files), '2.1.9', [])).toEqual({ ok: false, reason: 'too_old' })
  })

  it('an applied migration edited, dropped, or a new one slipped in before it: refused', () => {
    expect(planInstall(m([f('migrations/001_base.sql', 'b'.repeat(64)), ...files.slice(1)]), '2.3.0', ledger(['migrations/001_base.sql'])))
      .toEqual({ ok: false, reason: 'ledger_changed' })
    expect(planInstall(m(files.slice(1)), '2.3.0', ledger(['migrations/001_base.sql']))).toEqual({ ok: false, reason: 'ledger_missing' })
    expect(planInstall(m(files), '2.3.0', ledger(['migrations/001_base.sql', 'migrations/003_more.sql'])))
      .toEqual({ ok: false, reason: 'out_of_order' })
  })
})
