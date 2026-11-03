/**
 * sql/106: every CSV export leaves an audit entry — who, when, which export,
 * how many rows and the filters — never the rows' content; and it cannot be
 * used to write anything else into the log.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
}, 120_000)

const record = (who: string, kind: string, rows: number, filters: unknown = {}, mfa = true) =>
  rowsAs<{ id: number }>(db, { id: who, mfa }, `select public.audit_export($1, $2, $3::jsonb) as id`, [kind, rows, JSON.stringify(filters)])

describe('an export is recorded', () => {
  it('who, when, which export, how many rows and the filters, in the exporter\'s organisation', async () => {
    const before = new Date()
    const [{ id }] = await record(A.workerId, 'jobs', 120, { stage: 'print', period: 'month', search: true, workTypes: ['Kroon'] })
    const { rows } = await db.query<{ org_id: string; user_id: string; action: string; object: string; detail: unknown; at: Date }>(
      `select org_id, user_id, action, object, detail, at from public.audit_log where id = $1`, [id])
    expect(rows[0]).toMatchObject({
      org_id: A.clinicId, user_id: A.workerId, action: 'export', object: 'csv:jobs',
      detail: { kind: 'jobs', rows: 120, filters: { stage: 'print', period: 'month', search: true, workTypes: ['Kroon'] } },
    })
    expect(rows[0].at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
  })

  it('every export the app has', async () => {
    for (const kind of ['audit_log', 'jobs', 'customers', 'invoices', 'patient_contacts', 'payouts', 'payout_lines', 'revision_repricing']) {
      expect(await errorAs(db, { id: A.ownerId }, `select public.audit_export($1, 0)`, [kind]), kind).toBeNull()
    }
  })

  it('the owner and admins see it in the audit log search; nobody in another organisation does', async () => {
    await record(A.ownerId, 'audit_log', 42, { action: 'download', from: '2026-01-01', to: '2026-03-31' })
    const found = await rowsAs<{ object: string; detail: { rows: number } }>(db, { id: A.ownerId },
      `select object, detail from public.audit_search(p_action => 'export', p_limit => 100)`)
    expect(found.map(r => r.object)).toContain('csv:audit_log')
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.audit_search(p_action => 'export')`)).toEqual([])
  })
})

describe('it cannot carry anything else', () => {
  it('an unknown kind, a bad row count or no second factor: refused, nothing written', async () => {
    const count = async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log`)).rows[0].n
    const n = await count()
    expect(await errorAs(db, { id: A.ownerId }, `select public.audit_export('everything', 1)`)).toMatch(/Unknown export/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.audit_export('jobs', -1)`)).toMatch(/row count/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.audit_export('jobs', null)`)).toMatch(/row count/)
    expect(await errorAs(db, { id: A.ownerId, mfa: false }, `select public.audit_export('jobs', 1)`)).toMatch(/second factor/)
    expect(await errorAs(db, 'anon', `select public.audit_export('jobs', 1)`)).toMatch(/permission denied/)
    expect(await count()).toBe(n)
  })

  it('filters must be a small object of plain values: no rows smuggled in', async () => {
    const bad = [
      [], 'text', { rows: [{ patsient: 'Mari Maasikas', hind: 100 }] }, { nested: { a: 1 } },
      { big: 'x'.repeat(2100) }, Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i])),
      { list: Array.from({ length: 21 }, (_, i) => String(i)) },
    ]
    for (const f of bad) {
      expect(await errorAs(db, { id: A.ownerId }, `select public.audit_export('jobs', 1, $1::jsonb)`, [JSON.stringify(f)]), JSON.stringify(f).slice(0, 40))
        .toMatch(/small object/)
    }
  })

  it('a member writes only their own export, in their own organisation, and no other kind of entry', async () => {
    await record(B.workerId, 'customers', 3)
    const { rows } = await db.query<{ org_id: string; user_id: string; action: string }>(
      `select org_id, user_id, action from public.audit_log where object = 'csv:customers' and user_id = $1`, [B.workerId])
    expect(rows).toEqual([{ org_id: B.clinicId, user_id: B.workerId, action: 'export' }])
  })

  it('it writes, so it is volatile: a build below the minimum version is told to update (sql/104)', async () => {
    const { rows } = await db.query<{ v: string }>(`select provolatile as v from pg_proc where proname = 'audit_export'`)
    expect(rows[0].v).toBe('v')
  })
})
