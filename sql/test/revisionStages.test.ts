/** Revision stages through the stage gate (sql/087). */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let C: Tenant
let jobId: string

const rev = async (id: string) => {
  const { rows } = await db.query<{ revisions: { id: string; status: string; valmis_kuupaev?: string }[] }>(
    `select revisions from public.jobs where id = $1`, [jobId])
  return rows[0].revisions.find(r => r.id === id)!
}

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  C = await createTenant(db, 'Cesis')
  await db.query(`insert into public.partnership (org_a, org_b, status, roles) values ($1, $2, 'active', array['design'])`, [A.clinicId, B.clinicId])
  await grant(db, B, B.workerId, ['jobs.read', 'jobs.write'])
  const { rows } = await db.query<{ id: string }>(
    `insert into public.jobs (clinic_id, patsient, status, revisions) values ($1, 'X', 'valmis', $2) returning id`,
    [A.clinicId, JSON.stringify([{ id: 'r1', status: 'disain' }, { id: 'r2', status: 'print' }])])
  jobId = rows[0].id
  await rowsAs(db, { id: A.ownerId }, `select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [jobId, B.clinicId])
}, 120_000)

describe('move_revision_stage', () => {
  it('the partner hands its revision stage over; the owner side is told; both logs have it', async () => {
    expect(await errorAs(db, { id: B.workerId }, `select public.move_revision_stage($1, 'r1', 'print')`, [jobId])).toBeNull()
    expect((await rev('r1')).status).toBe('print')
    const n = await rowsAs<{ kind: string }>(db, { id: A.workerId }, `select kind from public.notification where job_id = $1`, [jobId])
    expect(n.map(x => x.kind)).toContain('stage_handover')
    for (const org of [A.clinicId, B.clinicId]) {
      const { rows } = await db.query(`select 1 from public.audit_log where org_id = $1 and action = 'stage_move' and detail->>'revision' = 'r1'`, [org])
      expect(rows.length).toBeGreaterThan(0)
    }
  })

  it('a revision in a stage that is not the partner\'s is locked to it', async () => {
    expect(await errorAs(db, { id: B.workerId }, `select public.move_revision_stage($1, 'r2', 'poleeri')`, [jobId])).toMatch(/not yours/)
  })

  it('the owner moves revisions and the done stage stamps the date', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.move_revision_stage($1, 'r2', 'valmis')`, [jobId])).toBeNull()
    expect((await rev('r2')).valmis_kuupaev).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('a stranger learns nothing', async () => {
    expect(await errorAs(db, { id: C.ownerId }, `select public.move_revision_stage($1, 'r1', 'valmis')`, [jobId])).toBe('Job not found')
  })
})
