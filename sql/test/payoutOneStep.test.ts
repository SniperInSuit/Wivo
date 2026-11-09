/**
 * sql/121: a payout saved in one step (create_payout).
 *
 * - The payout and its lines in one call: a bad line leaves no payout behind.
 * - The rules as before (sql/027): the caller's own clinic and Manage payroll;
 *   and now also a person of the caller's own clinic.
 * - The total is the lines' sum, computed by the database.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, grant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let payroll: string

const line = (over: Record<string, unknown> = {}) => ({
  job_id: null, revision_id: null, work_hours_id: null, kind: 'too', description: 'Crown · test',
  qty: 1, rate: 40, amount: 40, line_key: `job:${crypto.randomUUID()}`, ...over,
})
const create = (actor: string, profile: string, lines: unknown, note: string | null = null) =>
  rowsAs<{ id: string }>(db, { id: actor },
    `select public.create_payout($1, '2026-10-01', '2026-10-31', $2, $3::jsonb) as id`, [profile, note, JSON.stringify(lines)])
const payoutsOf = async (profile: string) =>
  (await db.query<{ id: string; total: string; created_by: string }>(
    `select id, total, created_by from public.worker_payouts where profile_id = $1 order by created_at`, [profile])).rows

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Riga')
  B = await createTenant(db, 'Tallinn')
  payroll = await createUser(db, 'Pia Payroll')
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, payroll])
  await grant(db, A, payroll, ['payroll.manage'])
}, 120_000)

describe('a payout in one step', () => {
  it('the payout and every line together; the total is the lines\' sum', async () => {
    const [{ id }] = await create(A.ownerId, A.workerId, [line(), line({ kind: 'tund', qty: 2.5, rate: 12, amount: 30 }), line({ amount: 15.555 })], 'October')
    const [p] = await payoutsOf(A.workerId)
    expect(p).toMatchObject({ id, total: '85.56', created_by: A.ownerId })
    const lines = (await db.query(`select kind, qty, amount, line_key from public.worker_payout_lines where payout_id = $1`, [id])).rows
    expect(lines).toHaveLength(3)
  })

  it('a bad line leaves nothing behind: no payout, no lines', async () => {
    const before = (await payoutsOf(A.workerId)).length
    expect(await errorAs(db, { id: A.ownerId }, `select public.create_payout($1, '2026-10-01', '2026-10-31', null, $2::jsonb)`,
      [A.workerId, JSON.stringify([line(), line({ amount: null })])])).toMatch(/null value/)
    expect(await payoutsOf(A.workerId)).toHaveLength(before)
  })

  it('nothing to pay out, or not a list: refused', async () => {
    for (const bad of [[], {}, 'x']) {
      expect(await errorAs(db, { id: A.ownerId }, `select public.create_payout($1, '2026-10-01', '2026-10-31', null, $2::jsonb)`,
        [A.workerId, JSON.stringify(bad)]), JSON.stringify(bad)).toMatch(/nothing to pay out/)
    }
  })

  it('a member with Manage payroll may; a worker without it may not, and leaves nothing', async () => {
    expect(await create(payroll, A.workerId, [line()])).toHaveLength(1)
    const before = (await payoutsOf(A.workerId)).length
    expect(await errorAs(db, { id: A.workerId }, `select public.create_payout($1, '2026-10-01', '2026-10-31', null, $2::jsonb)`,
      [A.workerId, JSON.stringify([line()])])).toMatch(/row-level security/)
    expect(await payoutsOf(A.workerId)).toHaveLength(before)
  })

  it('a person of another clinic: refused, before anything is written', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.create_payout($1, '2026-10-01', '2026-10-31', null, $2::jsonb)`,
      [B.workerId, JSON.stringify([line()])])).toMatch(/Not a member of this clinic/)
    expect(await payoutsOf(B.workerId)).toEqual([])
  })

  it('anon may not call it', async () => {
    expect(await errorAs(db, 'anon', `select public.create_payout($1, '2026-10-01', '2026-10-31', null, '[]'::jsonb)`, [A.workerId]))
      .toMatch(/permission denied/)
  })
})
