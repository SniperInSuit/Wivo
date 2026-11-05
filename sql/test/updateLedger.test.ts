/**
 * sql/119: the update ledger and what a clinic's project trusts
 * (docs/ARCHITECTURE-INSTANCES.md 5b, 5e, 5g).
 *
 * - Nothing changes until a project is an instance: update_status() is null.
 * - The five tables are out of every app role's reach, append-only for
 *   everyone (the instance's clinic is set once), and only the database's
 *   own connection — `wivo-update` — runs the functions that write them.
 * - Approvers: the instance clinic's owner, or a member granted
 *   'updates.install'. Not an admin without the grant, not another clinic.
 * - The list: a lower or re-used serial is refused (unless its key is
 *   revoked), an expired list is never accepted, and when no fresh list
 *   remains the approvers are told once (the freeze warning).
 * - Installs: in the audit log, and told to the other approvers.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, grant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let installer: string
let admin: string

const TABLES = ['wivo_instance', 'wivo_schema_migration', 'wivo_trust', 'wivo_update_check', 'wivo_update_install']
const SHA = (c: string) => c.repeat(64)
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Riga')
  B = await createTenant(db, 'Tallinn')
  installer = await createUser(db, 'Ilze Installer')
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, installer])
  await grant(db, A, installer, ['updates.install'])
  admin = await createUser(db, 'Anna Admin')
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'admin' where id = $2`, [A.clinicId, admin])
}, 120_000)

const status = async (id: string) =>
  (await rowsAs<{ s: Record<string, any> | null }>(db, { id }, `select public.update_status() as s`))[0].s

const check = (result: string, reason: string | null, key?: string, serial?: number, sha?: string, expires?: string, list?: unknown) =>
  db.query<{ stale: boolean }>(`select public.wivo_record_check(null, $1, $2, $3, $4, $5, $6, $7) as stale`,
    [result, reason, key ?? null, serial ?? null, sha ?? null, expires ?? null, list === undefined ? null : JSON.stringify(list)])

const notes = async (user: string, kind: string) =>
  (await db.query(`select detail from public.notification where user_id = $1 and kind = $2`, [user, kind])).rows

const updateEntries = async () =>
  (await db.query<{ object: string; detail: Record<string, unknown>; user_id: string | null; actor_name: string | null }>(
    `select object, detail, user_id, actor_name from public.audit_log where action = 'update' order by id`)).rows

describe('before a project is an instance', () => {
  it('nobody sees anything new, and the owner\'s status is null', async () => {
    expect(await status(A.ownerId)).toBeNull()
    expect(await status(installer)).toBeNull()
  })

  it('a check can\'t even be recorded', async () => {
    await expect(check('refused', 'unreachable')).rejects.toThrow(/not an instance/)
  })
})

describe('out of every app role\'s reach', () => {
  it('owners and workers, of any clinic, read and write none of the five tables', async () => {
    for (const actor of [{ id: A.ownerId }, { id: installer }, { id: B.ownerId }, 'anon' as const]) {
      for (const t of TABLES) {
        expect(await errorAs(db, actor, `select 1 from public.${t}`)).toMatch(/permission denied/)
        expect(await errorAs(db, actor, `delete from public.${t}`)).toMatch(/permission denied/)
      }
    }
  })

  it('only the database\'s own connection runs the functions that write them', async () => {
    const calls = [
      `select public.wivo_instance_create('stable')`,
      `select public.wivo_instance_claim('${A.clinicId}')`,
      `select public.wivo_record_check(null, 'refused', 'x')`,
      `select public.wivo_record_install(null, '2.3.0', null, 'manual', null, 'installed')`,
      `select public.wivo_record_trust('certificate', 'k', 't')`,
      `select public.wivo_record_migration('migrations/1.sql', '${SHA('a')}', '2.3.0', '${SHA('b')}', 'manual', null)`,
      `select public.wivo_update_floor()`,
      `select public.is_update_approver()`,
    ]
    for (const sql of calls) {
      expect(await errorAs(db, { id: A.ownerId }, sql)).toMatch(/permission denied/)
      await db.exec('set role service_role')
      try {
        await expect(db.query(sql)).rejects.toThrow(/permission denied/)
      } finally {
        await db.exec('reset role')
      }
    }
  })
})

describe('the first install, then setup gives the instance its clinic', () => {
  it('a setup install before there is a clinic is recorded, with no audit entry yet', async () => {
    await db.query(`select public.wivo_instance_create('stable')`)
    await expect(db.query(`select public.wivo_instance_create('test')`)).rejects.toThrow(/already an instance/)
    await db.query(`select public.wivo_record_migration('migrations/20261103000000_baseline.sql', $1, '2.3.0', $2, 'setup', null)`, [SHA('a'), SHA('b')])
    await db.query(`select public.wivo_record_install(null, '2.3.0', $1, 'setup', null, 'installed')`, [SHA('b')])
    expect(await updateEntries()).toEqual([])
  })

  it('the ledger takes a migration once, by its path', async () => {
    await expect(db.query(`select public.wivo_record_migration('migrations/20261103000000_baseline.sql', $1, '2.4.0', $2, 'manual', null)`, [SHA('c'), SHA('d')]))
      .rejects.toThrow(/duplicate key/)
    await expect(db.query(`select public.wivo_record_migration('../etc/x.sql', $1, '2.4.0', $2, 'manual', null)`, [SHA('c'), SHA('d')]))
      .rejects.toThrow(/check constraint/)
  })

  it('the clinic is set once; nothing else about the instance changes, and it is never deleted', async () => {
    await db.query(`select public.wivo_instance_claim($1)`, [A.clinicId])
    await expect(db.query(`select public.wivo_instance_claim($1)`, [B.clinicId])).rejects.toThrow(/already set/)
    await expect(db.query(`update public.wivo_instance set channel = 'test'`)).rejects.toThrow(/set once/)
    await expect(db.query(`update public.wivo_instance set org_id = $1`, [B.clinicId])).rejects.toThrow(/set once/)
    await expect(db.query(`delete from public.wivo_instance`)).rejects.toThrow(/set once/)
    await expect(db.query(`truncate public.wivo_instance`)).rejects.toThrow(/append-only/)
  })
})

describe('who approves', () => {
  it('the owner, and a member granted Install updates; not an admin without it, nor another clinic', async () => {
    expect(await status(A.ownerId)).toMatchObject({ channel: 'stable', installed: { version: '2.3.0' } })
    expect(await status(installer)).toMatchObject({ channel: 'stable' })
    expect(await status(admin)).toBeNull()
    expect(await status(A.workerId)).toBeNull()
    expect(await status(B.ownerId)).toBeNull()
  })

  it('an approver signed in with the password alone is refused before the call (sql/098)', async () => {
    const err = await errorAs(db, { id: A.ownerId, mfa: false },
      `select set_config('request.method', 'POST', false), set_config('request.path', '/rpc/update_status', false), public.require_mfa_for_api()`)
    expect(err).toMatch(/second factor first/)
  })
})

describe('the signed list: freshness, rollback, and the owner\'s warning (5g)', () => {
  const content = { versions: [{ version: '2.4.0', package: 'wivo-update-2.4.0.json', sha256: SHA('e'), size: 10, manual_only: false, auto_after: days(3) }], withdrawn: [] }

  it('no list yet: stale; the approvers are told once, and the audit log says so', async () => {
    expect((await check('refused', 'unreachable')).rows[0].stale).toBe(true)
    expect((await check('refused', 'expired')).rows[0].stale).toBe(true)
    expect(await notes(A.ownerId, 'update_stale')).toHaveLength(1)
    expect(await notes(installer, 'update_stale')).toHaveLength(1)
    expect(await notes(admin, 'update_stale')).toHaveLength(0)
    expect(await notes(A.workerId, 'update_stale')).toHaveLength(0)
    expect((await updateEntries()).map(e => e.detail.kind)).toEqual(['stale'])
    expect(await status(A.ownerId)).toMatchObject({ stale: true, list: null, last_check: { result: 'refused', reason: 'expired' } })
  })

  it('a fresh list: no longer stale, its content kept once, and the floor moves', async () => {
    expect((await check('accepted', null, 'signing-1', 5, SHA('1'), days(14), content)).rows[0].stale).toBe(false)
    expect((await check('accepted', null, 'signing-1', 5, SHA('1'), days(14), content)).rows[0].stale).toBe(false)
    const { rows } = await db.query(`select 1 from public.wivo_update_check where serial = 5 and list is not null`)
    expect(rows).toHaveLength(1)
    expect((await updateEntries()).map(e => e.detail.kind)).toEqual(['stale', 'fresh'])
    expect(await status(A.ownerId)).toMatchObject({ stale: false, list: { key_id: 'signing-1', serial: 5, content } })
    expect((await db.query<{ f: unknown }>(`select public.wivo_update_floor() as f`)).rows[0].f)
      .toEqual({ 'signing-1': { serial: 5, sha256: SHA('1') } })
  })

  it('the backstop: a lower serial, a re-used one, or an expired list is never accepted', async () => {
    await expect(check('accepted', null, 'signing-1', 4, SHA('2'), days(14))).rejects.toThrow(/older or re-used/)
    await expect(check('accepted', null, 'signing-1', 5, SHA('3'), days(14))).rejects.toThrow(/older or re-used/)
    await expect(check('accepted', null, 'signing-1', 6, SHA('4'), days(-1))).rejects.toThrow(/expired list/)
  })

  it('a revoked key: its lists stop counting, so the list is stale again, and its floor no longer blocks', async () => {
    expect((await db.query<{ n: boolean }>(`select public.wivo_record_trust('revocation', 'signing-1', 'WIVOREV1.x.y') as n`)).rows[0].n).toBe(true)
    expect((await check('refused', 'revoked')).rows[0].stale).toBe(true)
    expect(await notes(A.ownerId, 'update_stale')).toHaveLength(2)
    await check('accepted', null, 'signing-1', 1, SHA('5'), days(14))
    expect((await check('accepted', null, 'signing-2', 1, SHA('6'), days(14), content)).rows[0].stale).toBe(false)
    expect(await status(A.ownerId)).toMatchObject({ stale: false, list: { key_id: 'signing-2', serial: 1 } })
  })
})

describe('keys and installs, in the audit log', () => {
  it('a new update key is recorded once, and shown to approvers', async () => {
    expect((await db.query<{ n: boolean }>(`select public.wivo_record_trust('certificate', 'signing-2', 'WIVOCERT1.a.b') as n`)).rows[0].n).toBe(true)
    expect((await db.query<{ n: boolean }>(`select public.wivo_record_trust('certificate', 'signing-2', 'WIVOCERT1.a.b') as n`)).rows[0].n).toBe(false)
    expect((await updateEntries()).filter(e => e.object === 'update:key').map(e => e.detail))
      .toEqual([{ kind: 'key_revoked', key_id: 'signing-1' }, { kind: 'key_accepted', key_id: 'signing-2' }])
    expect((await status(installer))?.keys).toEqual([expect.objectContaining({ key_id: 'signing-2' })])
  })

  it('installed by a member: their name in the log, the owner told, the member not', async () => {
    await db.query(`select public.wivo_record_install('2.3.0', '2.4.0', $1, 'manual', $2, 'installed', null, '{"schema_check": 0}')`, [SHA('e'), installer])
    const entry = (await updateEntries()).at(-1)!
    expect(entry).toMatchObject({ object: 'update:2.4.0', user_id: installer, actor_name: 'Ilze Installer',
      detail: { kind: 'installed', from: '2.3.0', to: '2.4.0', sha256: SHA('e'), mode: 'manual' } })
    expect(await notes(A.ownerId, 'update_installed')).toEqual([{ detail: { from: '2.3.0', to: '2.4.0' } }])
    expect(await notes(installer, 'update_installed')).toEqual([])
    expect(await status(A.ownerId)).toMatchObject({ installed: { version: '2.4.0' }, installs: [{ to: '2.4.0', by: 'Ilze Installer', result: 'installed' }, { to: '2.3.0', mode: 'setup' }] })
  })

  it('a failure tells every approver; a refusal is only in the log', async () => {
    await db.query(`select public.wivo_record_install('2.4.0', '2.5.0', $1, 'manual', $2, 'failed', 'migrations/125_x.sql 23505')`, [SHA('f'), A.ownerId])
    expect(await notes(installer, 'update_failed')).toEqual([{ detail: { to: '2.5.0' } }])
    expect(await notes(A.ownerId, 'update_failed')).toEqual([])
    await db.query(`select public.wivo_record_install('2.4.0', '2.5.0', $1, 'manual', $2, 'refused', 'bad_signature')`, [SHA('f'), A.ownerId])
    expect((await updateEntries()).at(-1)).toMatchObject({ detail: { kind: 'refused', reason: 'bad_signature' } })
    expect((await status(A.ownerId))?.installed).toMatchObject({ version: '2.4.0' })
  })

  it('admins read the update entries in the audit log, as every other entry', async () => {
    const seen = await rowsAs(db, { id: admin }, `select object from public.audit_log where action = 'update'`)
    expect(seen.length).toBeGreaterThan(0)
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.audit_log where action = 'update'`)).toEqual([])
  })
})

describe('append-only, once every table has rows', () => {
  it('the other four are append-only, for the database\'s own connection too', async () => {
    for (const t of TABLES.slice(1)) {
      const col = { wivo_schema_migration: 'mode', wivo_trust: 'accepted_at' }[t] ?? 'at'
      await expect(db.query(`update public.${t} set ${col} = ${col}`)).rejects.toThrow(/append-only/)
      await expect(db.query(`delete from public.${t}`)).rejects.toThrow(/append-only/)
      await expect(db.query(`truncate public.${t}`)).rejects.toThrow(/append-only/)
    }
  })
})
