/** Deleting a job keeps it (sql/089). */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, makeRow, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  await db.query(`insert into public.partnership (org_a, org_b, status, roles) values ($1, $2, 'active', array['design'])`, [A.clinicId, B.clinicId])
  await grant(db, B, B.workerId, ['jobs.read'])
}, 120_000)

async function jobWithFileAndShare(): Promise<string> {
  const job = await makeRow(db, 'jobs', A)
  await db.query(`insert into public.job_file (job_id, org_id, type, sha256, size, file_name, storage_path)
                  values ($1, $2, 'scan', $3, 1, 'x.stl', $4)`, [job.id, A.clinicId, 'a'.repeat(64), `${A.clinicId}/${job.id}/f`])
  await rowsAs(db, { id: A.ownerId }, `select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [job.id, B.clinicId])
  return job.id as string
}

describe('deleting a job from the app', () => {
  it('keeps the row and its files; the job is gone from every view', async () => {
    const id = await jobWithFileAndShare()
    // The app's own call: a plain DELETE.
    expect(await errorAs(db, { id: A.ownerId }, `delete from public.jobs where id = $1`, [id])).toBeNull()
    const { rows } = await db.query<{ deleted_at: string | null; deleted_by: string }>(`select deleted_at, deleted_by from public.jobs where id = $1`, [id])
    expect(rows[0].deleted_at).not.toBeNull()
    expect(rows[0].deleted_by).toBe(A.ownerId)
    expect((await db.query(`select 1 from public.job_file where job_id = $1`, [id])).rows).toHaveLength(1)
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.jobs where id = $1`, [id])).toEqual([])
    expect(await rowsAs(db, { id: B.workerId }, `select 1 from public.partner_job_view where job_id = $1`, [id])).toEqual([])
  })

  it('ends sharing with an unshare row on both sides, and logs the delete', async () => {
    const id = await jobWithFileAndShare()
    await rowsAs(db, { id: A.ownerId }, `delete from public.jobs where id = $1 returning 1`, [id])
    for (const org of [A.clinicId, B.clinicId]) {
      const { rows } = await db.query(`select 1 from public.audit_log where org_id = $1 and action = 'unshare' and object = $2`, [org, 'job:' + id])
      expect(rows).toHaveLength(1)
    }
    const { rows } = await db.query(`select 1 from public.audit_log where org_id = $1 and action = 'delete' and object = $2`, [A.clinicId, 'job:' + id])
    expect(rows).toHaveLength(1)
  })

  it('an owner restores it', async () => {
    const id = await jobWithFileAndShare()
    await rowsAs(db, { id: A.ownerId }, `delete from public.jobs where id = $1 returning 1`, [id])
    expect((await rowsAs<{ id: string }>(db, { id: A.ownerId }, `select id from public.deleted_jobs()`)).map(r => r.id)).toContain(id)
    expect(await errorAs(db, { id: A.ownerId }, `select public.restore_job($1)`, [id])).toBeNull()
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.jobs where id = $1`, [id])).toHaveLength(1)
  })

  it('without jobs.write nothing happens; another clinic cannot restore', async () => {
    const id = await jobWithFileAndShare()
    await errorAs(db, { id: A.workerId }, `delete from public.jobs where id = $1`, [id])
    expect((await db.query(`select deleted_at from public.jobs where id = $1`, [id])).rows[0]).toEqual({ deleted_at: null })
    await rowsAs(db, { id: A.ownerId }, `delete from public.jobs where id = $1 returning 1`, [id])
    expect(await errorAs(db, { id: B.ownerId }, `select public.restore_job($1)`, [id])).toMatch(/not found/)
  })

  it('a delete with no user (service role, organisation exit) is still real', async () => {
    const job = await makeRow(db, 'jobs', A)
    await db.query(`delete from public.jobs where id = $1`, [job.id])
    expect((await db.query(`select 1 from public.jobs where id = $1`, [job.id])).rows).toEqual([])
  })
})
