/**
 * wivo-update (wivoUpdate.ts) against the real migrations in PGlite, with
 * made-up keys signing made-up releases and a stand-in for the network.
 *
 * - The list: accepted and recorded with the key's certificate; refused when
 *   unsigned, revoked, rolled back, or nowhere to be found.
 * - An install: only an approver with a fresh code; only a listed, signed,
 *   newer package; every migration and its ledger row in one transaction,
 *   so a failing migration leaves nothing behind; then the read-only checks;
 *   every attempt recorded.
 * - transactionSafe() passes every migration in sql/ and refuses what would
 *   end the transaction.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, grant, type Tenant } from '../../../sql/test/harness'
import * as release from './generated/release.ts'
import { checkList, install, handleUpdateRequest, transactionSafe, limitedFetcher, type Db, type Updater } from './wivoUpdate.ts'

const SOURCE = 'https://updates.test/wivo'
const enc = new TextEncoder()
const sha = (s: string) => release.sha256Hex(enc.encode(s))
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

interface Key { id: string; publicKey: string; sign: release.Signer }
async function key(id: string): Promise<Key> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  return {
    id,
    publicKey: release.b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    sign: async b => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new Uint8Array(b))),
  }
}

let pg: PGlite
let A: Tenant
let installer: string
let rootA: Key, rootB: Key, signing: Key, stranger: Key
let cert: string
const files = new Map<string, Uint8Array>()
let serial = 0

const asDb = (p: { query: PGlite['query']; exec: PGlite['exec']; transaction?: PGlite['transaction'] }): Db => ({
  query: async (text, params) => ({ rows: (await p.query(text, params)).rows as never[] }),
  exec: async text => { await p.exec(text) },
  transaction: fn => (p as PGlite).transaction(tx => fn(asDb(tx as never))),
})

const updater = (over: Partial<Updater> = {}): Updater => ({
  db: asDb(pg),
  fetch: async (url, max) => { const b = files.get(url); return b && b.length <= max ? b : null },
  pinned: [{ id: rootA.id, publicKey: rootA.publicKey }, { id: rootB.id, publicKey: rootB.publicKey }],
  sources: [SOURCE],
  ...over,
})

/** A package: its manifest signed by `by`, and its files. Published under its name; returns its list entry. */
async function publishPackage(version: string, contents: Record<string, string>, by = signing, over: Partial<release.Manifest> = {}) {
  const manifestFiles = await Promise.all(Object.entries(contents).map(async ([path, text]) =>
    ({ path, sha256: await sha(text), size: enc.encode(text).length })))
  const manifest = await release.encode('manifest', {
    v: 1, key_id: by.id, channel: 'stable', version, from_min: '2.0.0', created_at: day(-1),
    manual_only: false, auto_after: day(-1), files: manifestFiles, ...over,
  }, by.sign)
  const pkg: release.UpdatePackage = {
    manifest, certificates: [cert],
    files: Object.fromEntries(Object.entries(contents).map(([p, t]) => [p, btoa(String.fromCharCode(...enc.encode(t)))])),
  }
  const bytes = enc.encode(JSON.stringify(pkg))
  const name = `wivo-update-${version}.json`
  files.set(release.packageAddress(SOURCE, 'stable', name), bytes)
  return { version, package: name, sha256: await release.sha256Hex(bytes), size: bytes.length, manual_only: false, auto_after: day(-1) }
}

/** Publishes a new list (a higher serial each time) naming these entries. */
async function publishList(versions: release.Index['versions'], over: Partial<release.Index> = {}, by = signing) {
  const index = await release.encode('index', {
    v: 1, key_id: by.id, channel: 'stable', serial: ++serial, generated_at: day(0), expires: day(14),
    versions, withdrawn: [], revocations: [], ...over,
  }, by.sign)
  files.set(release.listAddress(SOURCE, 'stable'), enc.encode(JSON.stringify({ index, certificates: [cert] })))
}

const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows
const lastInstall = async () => (await one<Record<string, unknown>>(`select * from public.wivo_update_install order by id desc limit 1`))[0]
const tableExists = async (name: string) => (await one(`select 1 from pg_tables where schemaname = 'public' and tablename = $1`, [name])).length === 1

const BASE = 'create table public.wivo_test_base (id int);'
/** 901, as 2.1.0 installs it; later packages carry it unchanged, as the ledger requires. */
const A901 = 'set lock_timeout = \'10s\';\ncreate table public.wivo_test_a (id int);\ncreate function public.wivo_test_f() returns int language plpgsql as $$ begin return 1; end; $$;'
let pkg1: Awaited<ReturnType<typeof publishPackage>>

beforeAll(async () => {
  pg = await freshDb()
  A = await createTenant(pg, 'Riga')
  installer = await createUser(pg, 'Ilze Installer')
  await pg.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, installer])
  await grant(pg, A, installer, ['updates.install'])
  ;[rootA, rootB, signing, stranger] = await Promise.all(['root-a', 'root-b', 'update-c', 'stranger'].map(key))
  cert = await release.encode('certificate', {
    v: 1, key_id: signing.id, public_key: signing.publicKey, purpose: 'update', not_before: day(-1), not_after: day(365), root_id: rootA.id,
  }, rootA.sign)

  // As setup leaves it: an instance of Riga's clinic, version 2.0.0 installed.
  await pg.query(`select public.wivo_instance_create('stable')`)
  await pg.query(`select public.wivo_instance_claim($1)`, [A.clinicId])
  await pg.exec(BASE)
  await pg.query(`select public.wivo_record_migration('migrations/900_base.sql', $1, '2.0.0', $2, 'setup', null)`, [await sha(BASE), 'a'.repeat(64)])

  pkg1 = await publishPackage('2.1.0', {
    'migrations/900_base.sql': BASE,
    'migrations/901_a.sql': A901,
    'checks/two_rows.sql': '-- read-only\nselect 1 as x union all select 2;',
  })
}, 120_000)

describe('the list', () => {
  it('a signed list is accepted, and the key\'s certificate is kept', async () => {
    await publishList([pkg1])
    const r = await checkList(updater(), null)
    expect(r).toMatchObject({ ok: true, stale: false, index: { serial } })
    expect(await one(`select kind, key_id from public.wivo_trust`)).toEqual([{ kind: 'certificate', key_id: 'update-c' }])
  })

  it('a list signed by a key no root certified is refused, and recorded', async () => {
    await publishList([pkg1], {}, stranger)
    expect(await checkList(updater(), null)).toMatchObject({ ok: false, reason: 'unknown_key' })
    expect((await one(`select result, reason from public.wivo_update_check order by id desc limit 1`))[0]).toEqual({ result: 'refused', reason: 'unknown_key' })
  })

  it('a list older than one already accepted is refused (rollback)', async () => {
    await publishList([pkg1])
    expect((await checkList(updater(), null)).ok).toBe(true)
    const high = serial
    serial = high - 2
    await publishList([pkg1])
    expect(await checkList(updater(), null)).toMatchObject({ ok: false, reason: 'rollback' })
    serial = high
  })

  it('nowhere to fetch from, or nothing there: refused, and the reason says which', async () => {
    expect(await checkList(updater({ sources: [] }), null)).toMatchObject({ ok: false, reason: 'no_source' })
    expect(await checkList(updater({ sources: ['https://elsewhere.test'] }), null)).toMatchObject({ ok: false, reason: 'unreachable' })
  })

  it('with no pinned roots (as before the YubiKey setup), nothing is trusted', async () => {
    await publishList([pkg1])
    expect(await checkList(updater({ pinned: [] }), null)).toMatchObject({ ok: false, reason: 'unknown_key' })
  })

  it('a revocation the list carries is kept, and the revoked key\'s list is refused on that same check', async () => {
    const other = await key('update-d')
    const otherCert = await release.encode('certificate', {
      v: 1, key_id: other.id, public_key: other.publicKey, purpose: 'update', not_before: day(-1), not_after: day(365), root_id: rootA.id,
    }, rootA.sign)
    const revocation = await release.encode('revocation', {
      v: 1, key_id: other.id, genuine: [], reason: 'test', issued_at: day(0), root_id: rootB.id,
    }, rootB.sign)
    const index = await release.encode('index', {
      v: 1, key_id: other.id, channel: 'stable', serial: ++serial, generated_at: day(0), expires: day(14),
      versions: [pkg1], withdrawn: [], revocations: [revocation],
    }, other.sign)
    files.set(release.listAddress(SOURCE, 'stable'), enc.encode(JSON.stringify({ index, certificates: [otherCert] })))
    expect(await checkList(updater(), null)).toMatchObject({ ok: false, reason: 'revoked' })
    expect(await one(`select kind, key_id from public.wivo_trust where kind = 'revocation'`)).toEqual([{ kind: 'revocation', key_id: 'update-d' }])
  })
})

describe('an install', () => {
  it('installs the new migrations and their ledger rows, runs the checks, and records it', async () => {
    await publishList([pkg1])
    const r = await install(updater(), '2.1.0', { by: installer, mode: 'manual' })
    expect(r).toEqual({ ok: true, from: '2.0.0', to: '2.1.0', applied: ['migrations/901_a.sql'], checks: { 'checks/two_rows.sql': 2 } })
    expect(await tableExists('wivo_test_a')).toBe(true)
    expect(await one(`select file, package_version, mode, applied_by from public.wivo_schema_migration where file = 'migrations/901_a.sql'`))
      .toEqual([{ file: 'migrations/901_a.sql', package_version: '2.1.0', mode: 'manual', applied_by: installer }])
    expect(await lastInstall()).toMatchObject({ from_version: '2.0.0', to_version: '2.1.0', result: 'installed', by_user: installer, package_sha256: pkg1.sha256 })
  })

  it('the same version again: refused, not newer', async () => {
    expect(await install(updater(), '2.1.0', { by: installer, mode: 'manual' })).toEqual({ ok: false, reason: 'not_newer' })
    expect(await lastInstall()).toMatchObject({ result: 'refused', reason: 'not_newer' })
  })

  it('a version the list doesn\'t name, or names as withdrawn: refused', async () => {
    expect(await install(updater(), '9.9.9', { by: installer, mode: 'manual' })).toEqual({ ok: false, reason: 'not_listed' })
    const p = await publishPackage('2.2.0', { 'migrations/900_base.sql': BASE, 'migrations/901_a.sql': 'x', 'migrations/902_w.sql': 'select 1;' })
    await publishList([pkg1, p], { withdrawn: [{ version: '2.2.0', reason: 'a bad migration' }] })
    expect(await install(updater(), '2.2.0', { by: installer, mode: 'manual' })).toEqual({ ok: false, reason: 'withdrawn' })
  })

  it('a package whose bytes differ from what the list names: refused before it is read', async () => {
    const p = await publishPackage('2.3.0', { 'migrations/900_base.sql': BASE, 'migrations/903_t.sql': 'create table public.wivo_test_t (id int);' })
    await publishList([p])
    const url = release.packageAddress(SOURCE, 'stable', p.package)
    const tampered = new Uint8Array(files.get(url)!)
    tampered[tampered.length - 3] ^= 1
    files.set(url, tampered)
    expect(await install(updater(), '2.3.0', { by: installer, mode: 'manual' })).toEqual({ ok: false, reason: 'not_listed' })
    expect(await tableExists('wivo_test_t')).toBe(false)
  })

  it('a migration that fails leaves nothing behind: not the migrations before it, not their ledger rows', async () => {
    const p = await publishPackage('2.4.0', {
      'migrations/900_base.sql': BASE,
      'migrations/901_a.sql': A901,
      'migrations/904_b.sql': 'create table public.wivo_test_b (id int);',
      'migrations/905_bad.sql': 'insert into public.no_such_table values (1);',
    })
    await publishList([p])
    expect(await install(updater(), '2.4.0', { by: installer, mode: 'manual' })).toEqual({ ok: false, reason: 'migrations/905_bad.sql 42P01' })
    expect(await tableExists('wivo_test_b')).toBe(false)
    expect(await one(`select file from public.wivo_schema_migration where file in ('migrations/904_b.sql', 'migrations/905_bad.sql')`)).toEqual([])
    expect(await lastInstall()).toMatchObject({ result: 'failed', reason: 'migrations/905_bad.sql 42P01' })
  })

  it('a package with Edge Functions waits for the functions token (slice 3)', async () => {
    const p = await publishPackage('2.5.0', { 'migrations/900_base.sql': BASE, 'functions/x/index.ts': 'export {}' })
    await publishList([p])
    expect(await install(updater(), '2.5.0', { by: installer, mode: 'manual' })).toEqual({ ok: false, reason: 'functions_not_yet' })
  })

  it('a migration that would end the transaction is refused before anything runs', async () => {
    const p = await publishPackage('2.6.0', { 'migrations/900_base.sql': BASE, 'migrations/906_c.sql': 'create table public.wivo_test_c (id int);\ncommit;' })
    await publishList([p])
    expect(await install(updater(), '2.6.0', { by: installer, mode: 'manual' })).toEqual({ ok: false, reason: 'not_transaction_safe' })
    expect(await tableExists('wivo_test_c')).toBe(false)
  })
})

describe('the request', () => {
  const approval = (a: Record<string, unknown> | null) => async () => ({ data: a, error: null })
  const deps = (asUser: () => Promise<{ data: unknown; error: unknown }>, service = false) =>
    ({ updater: updater(), isService: () => service, asUser })

  it('an install by an approver with a code under 5 minutes old goes ahead', async () => {
    const p = await publishPackage('2.7.0', { 'migrations/900_base.sql': BASE, 'migrations/901_a.sql': A901, 'migrations/907_d.sql': 'create table public.wivo_test_d (id int);' })
    await publishList([p])
    const r = await handleUpdateRequest('Bearer x', { action: 'install', version: '2.7.0' },
      deps(approval({ user_id: installer, approver: true, fresh: true })))
    expect(r).toMatchObject({ status: 200, body: { ok: true, from: '2.1.0', to: '2.7.0', applied: ['migrations/907_d.sql'] } })
  })

  it('not an approver, or a code too old: refused, and recorded', async () => {
    expect(await handleUpdateRequest('Bearer x', { action: 'install', version: '2.8.0' }, deps(approval({ user_id: A.workerId, approver: false, fresh: true }))))
      .toEqual({ status: 403, body: { ok: false, error: 'not_approver' } })
    expect(await lastInstall()).toMatchObject({ result: 'refused', reason: 'not_approver', by_user: A.workerId, to_version: '2.8.0' })
    expect(await handleUpdateRequest('Bearer x', { action: 'install', version: '2.8.0' }, deps(approval({ user_id: installer, approver: true, fresh: false }))))
      .toEqual({ status: 403, body: { ok: false, error: 'not_fresh' } })
  })

  it('no second factor, a bad request, or the service key asking to install: refused', async () => {
    expect(await handleUpdateRequest('Bearer x', { action: 'install', version: '2.8.0' }, deps(approval(null)))).toEqual({ status: 401, body: { ok: false, error: 'sign_in' } })
    expect(await handleUpdateRequest('Bearer x', { action: 'install', version: 'latest' }, deps(approval(null)))).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } })
    expect(await handleUpdateRequest('Bearer x', { action: 'drop' }, deps(approval(null)))).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } })
    expect(await handleUpdateRequest('Bearer k', { action: 'install', version: '2.8.0' }, deps(approval(null), true))).toEqual({ status: 403, body: { ok: false, error: 'not_approver' } })
  })

  it('a check: the scheduled job with the service key, or an approver', async () => {
    await publishList([pkg1])
    expect(await handleUpdateRequest('Bearer k', { action: 'check' }, deps(approval(null), true))).toMatchObject({ status: 200, body: { ok: true, serial } })
    expect(await handleUpdateRequest('Bearer x', { action: 'check' }, deps(approval({ user_id: A.workerId, approver: false, fresh: false })))).toMatchObject({ status: 403 })
  })
})

describe('the function itself (wivo-update/index.ts)', () => {
  const source = readFileSync(join(__dirname, '..', 'wivo-update', 'index.ts'), 'utf8')
  const config = readFileSync(join(__dirname, '..', '..', 'config.toml'), 'utf8')

  it('pins the roots and the addresses from shared/release, in its own code', () => {
    expect(source).toContain("import { PINNED_ROOTS, UPDATE_SOURCES } from '../_shared/generated/release.ts'")
    expect(source).toContain('pinned: PINNED_ROOTS, sources: UPDATE_SOURCES')
  })

  it('has the gateway\'s JWT check off, checks the token through the database, and passes the version on', () => {
    expect(config).toMatch(/\[functions\.wivo-update\]\s*\nverify_jwt = false/)
    expect(source).toContain("'Access-Control-Allow-Headers': APP_ALLOWED_HEADERS")
    expect(source).toContain('callerVersionHeaders(req)')
  })
})

describe('transactionSafe', () => {
  it('passes every migration in sql/', () => {
    const dir = join(__dirname, '..', '..', '..', 'sql')
    const unsafe = readdirSync(dir).filter(f => /^\d{3}_.*\.sql$/.test(f)).filter(f => !transactionSafe(readFileSync(join(dir, f), 'utf8')))
    expect(unsafe).toEqual([])
  })

  it('refuses what ends or escapes the transaction, and not PL/pgSQL\'s own BEGIN', () => {
    for (const bad of ['commit;', 'COMMIT', 'rollback;', 'begin;', 'BEGIN TRANSACTION;', 'start transaction;', 'vacuum;',
                       'create index concurrently i on t (x);', 'savepoint a;', 'alter system set x = 1;']) {
      expect(transactionSafe(`create table t (x int);\n${bad}`), bad).toBe(false)
    }
    expect(transactionSafe('do $$ begin perform 1; end $$;')).toBe(true)
    expect(transactionSafe("create function f() returns void language plpgsql as $body$ begin commit; end $body$;")).toBe(true)
    expect(transactionSafe("-- commit later\nselect 'commit';")).toBe(true)
  })
})

describe('fetching', () => {
  const body = (bytes: number, headers: Record<string, string> = {}) => async () =>
    new Response(new Uint8Array(bytes), { status: 200, headers })

  it('reads a file up to its limit, over HTTPS only', async () => {
    expect((await limitedFetcher(body(10) as never)('https://x.test/a', 10))?.length).toBe(10)
    expect(await limitedFetcher(body(10) as never)('http://x.test/a', 10)).toBeNull()
  })

  it('refuses more than the limit, by its header or by what arrives', async () => {
    expect(await limitedFetcher(body(11) as never)('https://x.test/a', 10)).toBeNull()
    expect(await limitedFetcher(body(5, { 'content-length': '999' }) as never)('https://x.test/a', 10)).toBeNull()
  })

  it('a failed request or a network error is null', async () => {
    expect(await limitedFetcher((async () => new Response('', { status: 404 })) as never)('https://x.test/a', 10)).toBeNull()
    expect(await limitedFetcher((async () => { throw new Error('down') }) as never)('https://x.test/a', 10)).toBeNull()
  })
})
