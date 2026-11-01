/** Audit coverage (sql/078): every stage move and every job opened is logged. */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, makeRow, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
}, 120_000)

describe('audit coverage', () => {
  it('a stage move from the board (a direct update) is logged', async () => {
    const job = await makeRow(db, 'jobs', A)
    await rowsAs(db, { id: A.ownerId }, `update public.jobs set status = 'print' where id = $1 returning 1`, [job.id])
    const rows = await rowsAs<{ action: string; job_code: string }>(db, { id: A.ownerId },
      `select action, job_code from public.audit_entries(10, 'stage_move')`)
    expect(rows[0]).toMatchObject({ action: 'stage_move', job_code: job.job_code })
  })

  it('opening a job is logged; opening another clinic\'s logs nothing anywhere', async () => {
    const job = await makeRow(db, 'jobs', A)
    await rowsAs(db, { id: A.ownerId }, `select public.log_job_view($1)`, [job.id])
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.audit_entries(10, 'view') where object = $1`, ['job:' + job.id])).toHaveLength(1)
    await rowsAs(db, { id: B.ownerId }, `select public.log_job_view($1)`, [job.id])
    const { rows } = await db.query(`select 1 from public.audit_log where org_id = $1 and action = 'view'`, [B.clinicId])
    expect(rows).toEqual([])
  })

  it('only admins read it, and only their own organisation\'s', async () => {
    expect(await errorAs(db, { id: A.workerId }, `select * from public.audit_entries()`)).toMatch(/admin/)
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.audit_entries() where object like 'job:%'`)).toEqual([])
  })
})
