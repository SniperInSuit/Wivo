/**
 * What a partner sees and does on a shared job (sql/071), as Riga, against
 * Tallinn's data. Spec, Phase 1 acceptance:
 *   - "A Riga test user cannot get a single Tallinn row or file through the
 *     API that has not been shared. An automated test checks this."
 *   - "A partial-visibility response has no name, personal code, date of
 *     birth or prices."
 *   - "A partner cannot move a locked stage, not even with a direct RPC call."
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant  // Tallinn — owns the jobs
let B: Tenant  // Riga — partner
let C: Tenant  // Cesis — no partnership
let partnershipId: string
let patientId: string

async function job(extra: Record<string, unknown> = {}): Promise<string> {
  const cols = ['clinic_id', 'patsient', 'patient_id', 'status', 'hind', 'too', 'hambad', 'revisions', ...Object.keys(extra)]
  const vals = [A.clinicId, 'Mari Maasikas', patientId, 'disain', 450, 'Kroon', '11,21',
    JSON.stringify([{ id: 'r1', ts: '2026-10-01', note: 'remake', price: 120, status: 'disain' }]), ...Object.values(extra)]
  const { rows } = await db.query<{ id: string }>(
    `insert into public.jobs (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals)
  return rows[0].id
}

const share = (jobId: string, opts: { caseType?: string; stages?: string[]; consent?: boolean; role?: string } = {}) =>
  rowsAs<{ id: string }>(db, { id: A.ownerId },
    `select public.share_job($1, $2, $3, $4, $5, null, $6, 80) as id`,
    [jobId, B.clinicId, opts.caseType ?? 'lab_work', opts.role ?? 'design', opts.stages ?? ['disain'], opts.consent ?? false])

const view = (actor: { id: string }, jobId: string) =>
  rowsAs<Record<string, unknown>>(db, actor, `select * from public.partner_job_view where job_id = $1`, [jobId])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  C = await createTenant(db, 'Cesis')
  // Partner staff act under THEIR organisation's permissions (sql/084).
  await grant(db, B, B.workerId, ['jobs.read', 'jobs.write'])
  const { rows } = await db.query<{ id: string }>(
    `insert into public.partnership (org_a, org_b, status, roles, dpa_reference)
     values ($1, $2, 'active', array['design', 'surgery'], 'DPA') returning id`, [A.clinicId, B.clinicId])
  partnershipId = rows[0].id
  const p = await db.query<{ id: string }>(
    `insert into public.patients (clinic_id, nimi, synniaeg, telefon, email, ravikaart)
     values ($1, 'Mari Maasikas', now()::date - interval '40 years 2 months', '+372 5555 5555', 'mari@example.com', 'secret chart')
     returning id`, [A.clinicId])
  patientId = p.rows[0].id
}, 120_000)

describe('nothing reaches the partner unless shared', () => {
  it('an unshared job is invisible through the view, the RPCs and the tables', async () => {
    const j = await job()
    expect(await view({ id: B.ownerId }, j)).toEqual([])
    expect(await errorAs(db, { id: B.ownerId }, `select * from public.open_partner_job($1)`, [j])).not.toBeNull()
    expect(await errorAs(db, { id: B.ownerId }, `select * from public.job_thread($1)`, [j])).not.toBeNull()
    expect(await errorAs(db, { id: B.ownerId }, `select public.move_job_stage($1, 'print')`, [j])).not.toBeNull()
  })

  it('a SHARED job is still invisible in Tallinn\'s own tables — only the view reaches it', async () => {
    const j = await job()
    await share(j)
    expect(await view({ id: B.ownerId }, j)).toHaveLength(1)
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.jobs where id = $1`, [j])).toEqual([])
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.patients where id = $1`, [patientId])).toEqual([])
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.messages m join public.channels c on c.id = m.channel_id where c.job_id = $1`, [j])).toEqual([])
  })

  it('a third organisation sees nothing at all', async () => {
    const j = await job()
    await share(j)
    expect(await view({ id: C.ownerId }, j)).toEqual([])
    expect(await rowsAs(db, { id: C.ownerId }, `select 1 from public.partner_job_view`)).toEqual([])
  })
})

describe('partial visibility (lab work)', () => {
  let row: Record<string, unknown>

  beforeAll(async () => {
    const j = await job()
    await share(j)
    ;[row] = await view({ id: B.workerId }, j)
  })

  it('has no identity: no name, no contacts, no date of birth — age only', () => {
    expect(row.patient_name).toBeNull()
    expect(row.patient_phone).toBeNull()
    expect(row.patient_email).toBeNull()
    expect(row.patient_age).toBe(40)
    expect(Object.keys(row).some(k => /synni|birth|isikukood|ravikaart|nimi$|patsient/.test(k))).toBe(false)
    expect(JSON.stringify(row)).not.toContain('Maasikas')
    expect(JSON.stringify(row)).not.toContain('secret chart')
  })

  it('has no patient price, but the partner\'s own price', () => {
    expect(Object.keys(row).some(k => /^hind$|makstud|extras|extra_costs|kulu|customer/.test(k))).toBe(false)
    expect(Number(row.partner_price)).toBe(80)
    expect(JSON.stringify(row.revisions)).not.toContain('"price"')
  })

  it('has the work: code, teeth, type, stage', () => {
    expect(row.job_code).toMatch(/-\d{2}-\d{4}$/)
    expect(row.teeth).toBe('11,21')
    expect(row.status).toBe('disain')
    expect(row.owner_org_name).toBe('Tallinn')
  })

  it('partners search by job code', async () => {
    const hits = await rowsAs(db, { id: B.workerId }, `select 1 from public.partner_job_view where job_code ilike $1`, [`%${String(row.job_code).slice(-4)}`])
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe('referral (sql/092: no longer full visibility)', () => {
  it('needs the consent mark', async () => {
    const j = await job()
    expect(await errorAs(db, { id: A.ownerId },
      `select public.share_job($1, $2, 'referral', 'surgery', array['disain'], null, false)`, [j, B.clinicId])).toMatch(/patient informed/)
  })

  it('with consent: who marked it — but the partner still sees no name or contacts', async () => {
    const j = await job()
    await share(j, { caseType: 'referral', consent: true, role: 'surgery' })
    const [row] = await view({ id: B.ownerId }, j)
    expect(row).toMatchObject({ case_type: 'referral', visibility: 'partial', patient_name: null, patient_phone: null, patient_email: null })
    const { rows } = await db.query(`select consent_by, consent_at, visibility from public.job_share where job_id = $1`, [j])
    expect(rows[0]).toMatchObject({ consent_by: A.ownerId, visibility: 'partial' })
  })

  it('a role outside the partnership is refused', async () => {
    const j = await job()
    expect(await errorAs(db, { id: A.ownerId },
      `select public.share_job($1, $2, 'lab_work', 'supplier', array['disain'])`, [j, B.clinicId])).toMatch(/role/)
  })
})

describe('stages', () => {
  it('the partner hands its stage over to the next one, and no further', async () => {
    const j = await job()
    await share(j, { stages: ['disain'] })
    expect(await errorAs(db, { id: B.workerId }, `select public.move_job_stage($1, 'valmis')`, [j])).toMatch(/not allowed/)
    expect(await errorAs(db, { id: B.workerId }, `select public.move_job_stage($1, 'print')`, [j])).toBeNull()
    // Now in `print`, which is not the partner's: locked, even by direct RPC.
    expect(await errorAs(db, { id: B.workerId }, `select public.move_job_stage($1, 'poleeri')`, [j])).toMatch(/not yours/)
    expect(await errorAs(db, { id: B.workerId }, `select public.move_job_stage($1, 'disain')`, [j])).toMatch(/not yours/)
    const [row] = await view({ id: B.workerId }, j)
    expect(row.can_move).toBe(false)
  })

  it('a partner cannot change the status by writing to the table', async () => {
    const j = await job()
    await share(j)
    await errorAs(db, { id: B.ownerId }, `update public.jobs set status = 'valmis' where id = $1`, [j])
    const { rows } = await db.query<{ status: string }>(`select status from public.jobs where id = $1`, [j])
    expect(rows[0].status).toBe('disain')
  })

  it('rules the owner wrote for partners are exactly what partners may do', async () => {
    const j = await job()
    await share(j, { stages: ['disain'] })
    await db.query(`insert into public.stage_transition (org_id, from_stage, to_stage, actor) values ($1, 'disain', 'valmis', 'partner')`, [A.clinicId])
    expect(await errorAs(db, { id: B.workerId }, `select public.move_job_stage($1, 'print')`, [j])).toMatch(/not allowed/)
    expect(await errorAs(db, { id: B.workerId }, `select public.move_job_stage($1, 'valmis')`, [j])).toBeNull()
    await db.query(`delete from public.stage_transition where org_id = $1`, [A.clinicId])
  })

  it('the owner\'s own rules hold on a direct update too', async () => {
    const j = await job()
    await db.query(`insert into public.stage_transition (org_id, from_stage, to_stage, actor) values ($1, 'disain', 'print', 'owner')`, [A.clinicId])
    expect(await errorAs(db, { id: A.ownerId }, `update public.jobs set status = 'valmis' where id = $1`, [j])).toMatch(/not allowed/)
    expect(await errorAs(db, { id: A.ownerId }, `update public.jobs set status = 'print' where id = $1`, [j])).toBeNull()
    await db.query(`delete from public.stage_transition where org_id = $1`, [A.clinicId])
  })

  it('every move is in the audit log of both sides', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log where action = 'stage_move' and org_id = $1`, [B.clinicId])
    expect(rows[0].n).toBeGreaterThan(0)
  })
})

describe('questions and comments', () => {
  it('a partner asks; the owner sees the flag; either side resolves it', async () => {
    const j = await job()
    await share(j)
    const [q] = await rowsAs<{ id: string }>(db, { id: B.workerId },
      `select public.post_job_comment($1, 'Is 21 a pontic?', true) as id`, [j])
    expect(await rowsAs(db, { id: A.ownerId }, `select open_count from public.open_questions() where job_id = $1`, [j]))
      .toEqual([{ open_count: 1 }])
    expect((await view({ id: B.workerId }, j))[0].open_questions).toBe(1)
    const thread = await rowsAs<{ author_org: string; is_question: boolean }>(db, { id: A.ownerId }, `select * from public.job_thread($1)`, [j])
    expect(thread).toEqual([expect.objectContaining({ author_org: 'Riga', is_question: true })])
    await rowsAs(db, { id: A.ownerId }, `select public.resolve_question($1)`, [q.id])
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.open_questions() where job_id = $1`, [j])).toEqual([])
  })

  it('the partner cannot read the thread of a job not shared with it', async () => {
    const j = await job()
    await rowsAs(db, { id: A.ownerId }, `select public.post_job_comment($1, 'internal note', false)`, [j])
    expect(await errorAs(db, { id: B.workerId }, `select * from public.job_thread($1)`, [j])).not.toBeNull()
  })

  it('in Tallinn, someone who cannot see the job cannot read its thread', async () => {
    const j = await job()
    expect(await errorAs(db, { id: A.workerId }, `select * from public.job_thread($1)`, [j])).not.toBeNull()
  })
})

describe('when sharing stops', () => {
  it('a revoked share disappears', async () => {
    const j = await job()
    await share(j)
    await rowsAs(db, { id: A.ownerId }, `select public.unshare_job($1, $2)`, [j, B.clinicId])
    expect(await view({ id: B.workerId }, j)).toEqual([])
  })

  it('after the partnership ends: read-only for the agreed time, then nothing', async () => {
    const j = await job()
    await share(j)
    await db.query(`update public.partnership set status = 'ended', ended_at = now(), readonly_until = now() + interval '1 day' where id = $1`, [partnershipId])
    const [row] = await view({ id: B.workerId }, j)
    expect(row.can_move).toBe(false)
    expect(await errorAs(db, { id: B.workerId }, `select public.move_job_stage($1, 'print')`, [j])).toMatch(/not active/)
    expect(await errorAs(db, { id: B.workerId }, `select public.post_job_comment($1, 'hi')`, [j])).not.toBeNull()
    expect(await errorAs(db, { id: A.ownerId },
      `select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [await job(), B.clinicId])).toMatch(/No active partnership/)
    await db.query(`update public.partnership set readonly_until = now() - interval '1 minute' where id = $1`, [partnershipId])
    expect(await view({ id: B.workerId }, j)).toEqual([])
    await db.query(`update public.partnership set status = 'active', ended_at = null, readonly_until = null where id = $1`, [partnershipId])
  })

  it('opening a shared job is logged as a view on both sides', async () => {
    const j = await job()
    await share(j)
    await rowsAs(db, { id: B.workerId }, `select * from public.open_partner_job($1)`, [j])
    for (const org of [A.clinicId, B.clinicId]) {
      const { rows } = await db.query(`select 1 from public.audit_log where org_id = $1 and action = 'view' and object = $2`, [org, 'job:' + j])
      expect(rows).toHaveLength(1)
    }
  })
})
