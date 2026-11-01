/**
 * Notifications (sql/075): the other side is told, the actor is not, nobody
 * reads anyone else's, and a notification carries no patient data.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let jobId: string

const mine = (userId: string) =>
  rowsAs<{ kind: string; job_code: string; detail: unknown }>(db, { id: userId },
    `select kind, job_code, detail from public.notification where job_id = $1 order by created_at`, [jobId])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  await db.query(`insert into public.partnership (org_a, org_b, status, roles) values ($1, $2, 'active', array['design'])`, [A.clinicId, B.clinicId])
  const { rows } = await db.query<{ id: string }>(
    `insert into public.jobs (clinic_id, patsient, status) values ($1, 'Mari Maasikas', 'disain') returning id`, [A.clinicId])
  jobId = rows[0].id
}, 120_000)

describe('a job is shared', () => {
  it('every member of the partner is told; nobody at the owner is', async () => {
    await rowsAs(db, { id: A.ownerId },
      `select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [jobId, B.clinicId])
    expect((await mine(B.ownerId)).map(n => n.kind)).toEqual(['job_shared'])
    expect((await mine(B.workerId)).map(n => n.kind)).toEqual(['job_shared'])
    expect(await mine(A.ownerId)).toEqual([])
    expect(await mine(A.workerId)).toEqual([])
  })

  it('it carries the code and nothing about the patient', async () => {
    const [n] = await mine(B.ownerId)
    expect(n.job_code).toMatch(/-\d{2}-\d{4}$/)
    expect(JSON.stringify(n)).not.toContain('Maasikas')
  })
})

describe('the stage is handed over', () => {
  it('partner → owner: the owner side is told, not the partner who moved it', async () => {
    await rowsAs(db, { id: B.workerId }, `select public.move_job_stage($1, 'print')`, [jobId])
    expect((await mine(A.ownerId)).map(n => n.kind)).toEqual(['stage_handover'])
    expect((await mine(B.workerId)).filter(n => n.kind === 'stage_handover')).toEqual([])
  })

  it('owner → partner: back into the partner\'s stage tells the partner', async () => {
    await rowsAs(db, { id: A.ownerId }, `select public.move_job_stage($1, 'disain')`, [jobId])
    expect((await mine(B.ownerId)).filter(n => n.kind === 'stage_handover')).toHaveLength(1)
  })

  it('a move within one side\'s own stages tells nobody', async () => {
    const before = (await mine(B.ownerId)).length + (await mine(A.workerId)).length
    await rowsAs(db, { id: B.workerId }, `select public.move_job_stage($1, 'print')`, [jobId])
    await rowsAs(db, { id: A.ownerId }, `select public.move_job_stage($1, 'poleeri')`, [jobId])
    const partnerSide = (await mine(B.ownerId)).length
    expect(partnerSide + (await mine(A.workerId)).length).toBe(before + 1) // only the print handover reached A's worker
  })
})

describe('a question is asked', () => {
  it('goes to the side that did not ask', async () => {
    await rowsAs(db, { id: A.ownerId }, `select public.move_job_stage($1, 'disain')`, [jobId])
    await rowsAs(db, { id: B.workerId }, `select public.post_job_comment($1, 'Margin?', true)`, [jobId])
    expect((await mine(A.workerId)).map(n => n.kind)).toContain('question')
    expect((await mine(B.ownerId)).map(n => n.kind)).not.toContain('question')
  })

  it('a plain comment notifies nobody', async () => {
    const before = (await mine(A.workerId)).length
    await rowsAs(db, { id: B.workerId }, `select public.post_job_comment($1, 'thanks', false)`, [jobId])
    expect(await mine(A.workerId)).toHaveLength(before)
  })
})

describe('reading', () => {
  it('nobody sees or marks anyone else\'s', async () => {
    const theirs = await rowsAs<{ id: string }>(db, { id: B.ownerId }, `select id from public.notification`)
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.notification where id = $1`, [theirs[0].id])).toEqual([])
    await rowsAs(db, { id: A.ownerId }, `select public.mark_notifications_read($1)`, [[theirs[0].id]])
    const { rows } = await db.query(`select read_at from public.notification where id = $1`, [theirs[0].id])
    expect(rows[0]).toEqual({ read_at: null })
  })

  it('marking read works for your own', async () => {
    await rowsAs(db, { id: B.ownerId }, `select public.mark_notifications_read()`)
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.notification where read_at is null`)).toEqual([])
  })
})

describe('e-mail', () => {
  it('only the service role reads the pending list (it holds addresses)', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select * from public.pending_notification_emails()`)).toMatch(/permission denied/)
    const { rows } = await db.query<{ job_code: string }>(`select * from public.pending_notification_emails()`)
    expect(rows.length).toBeGreaterThan(0)
    expect(JSON.stringify(rows)).not.toContain('Maasikas')
  })

  it('switched off, a user gets no e-mail but still the badge', async () => {
    await rowsAs(db, { id: A.workerId }, `select public.set_notify_email(false)`)
    const { rows } = await db.query<{ email: string }>(`select p.* from public.pending_notification_emails() p
      join auth.users u on u.email = p.email where u.id = $1`, [A.workerId])
    expect(rows).toEqual([])
    expect((await mine(A.workerId)).length).toBeGreaterThan(0)
  })
})
