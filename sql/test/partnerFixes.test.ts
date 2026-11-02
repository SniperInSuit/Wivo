/**
 * Partner-side fixes from the review of sql/068–079 (sql/084). Each test is
 * the reviewer's reproduction, now expected to fail to reproduce.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, makeRow, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant   // owner of the job
let B: Tenant   // partner (lab work)
let D: Tenant   // another partner (referral)
let C: Tenant   // stranger

async function partnership(x: Tenant, y: Tenant, status = 'active'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.partnership (org_a, org_b, status, roles) values ($1, $2, $3, array['design', 'surgery']) returning id`,
    [x.clinicId, y.clinicId, status])
  return rows[0].id
}

async function job(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.jobs (clinic_id, patsient, status, revisions) values ($1, 'Mari Maasikas', 'disain', $2) returning id`,
    [A.clinicId, JSON.stringify([{ id: 'r1', note: 'patient called, very upset', assigned_to: A.workerId, price: 50 }])])
  return rows[0].id
}

const share = (j: string, partner: Tenant, caseType = 'lab_work', consent = false) =>
  rowsAs(db, { id: A.ownerId }, `select public.share_job($1, $2, $3, 'design', array['disain'], 'full', $4)`, [j, partner.clinicId, caseType, consent])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  D = await createTenant(db, 'Daugavpils')
  C = await createTenant(db, 'Cesis')
  await partnership(A, B)
  await partnership(A, D)
  for (const t of [B, D]) await grant(db, t, t.workerId, ['jobs.read', 'jobs.write'])
}, 120_000)

describe('#5 the thread is scoped per partner and per share', () => {
  it('a partner sees neither another partner\'s messages nor the owner\'s notes from before the share', async () => {
    const j = await job()
    await rowsAs(db, { id: A.ownerId }, `select public.post_job_comment($1, 'internal: margin is thin', false)`, [j])
    await db.query(`select pg_sleep(0.01)`)
    await share(j, B)
    await share(j, D, 'referral', true)
    await rowsAs(db, { id: D.workerId }, `select public.post_job_comment($1, 'Mari Maasikas called', false)`, [j])
    await rowsAs(db, { id: A.ownerId }, `select public.post_job_comment($1, 'please check 21', false)`, [j])
    const seen = (await rowsAs<{ body: string }>(db, { id: B.workerId }, `select body from public.job_thread($1)`, [j])).map(m => m.body)
    expect(seen).toEqual(['please check 21'])
    // The owner still sees everything.
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.job_thread($1)`, [j])).toHaveLength(3)
  })

  it('the partner is never made creator of the owner\'s thread channel', async () => {
    const j = await job()
    await share(j, B)
    await rowsAs(db, { id: B.workerId }, `select public.post_job_comment($1, 'first!', false)`, [j])
    const { rows } = await db.query<{ created_by: string | null }>(`select created_by from public.channels where job_id = $1`, [j])
    expect(rows[0].created_by).toBeNull()
    expect(await rowsAs(db, { id: B.workerId }, `select 1 from public.channels where job_id = $1`, [j])).toEqual([])
  })
})

describe('#10 partner staff need their own organisation\'s permissions', () => {
  it('no jobs.read in Riga: no shared jobs; no jobs.write: no moves, no uploads', async () => {
    const j = await job()
    await share(j, B)
    const plain = await createUser(db, 'Riga intern')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [B.clinicId, plain])
    expect(await rowsAs(db, { id: plain }, `select 1 from public.partner_job_view where job_id = $1`, [j])).toEqual([])
    await grant(db, B, plain, ['jobs.read'])
    expect(await rowsAs(db, { id: plain }, `select 1 from public.partner_job_view where job_id = $1`, [j])).toHaveLength(1)
    expect(await errorAs(db, { id: plain }, `select public.move_job_stage($1, 'print')`, [j])).toMatch(/permission/)
    expect(await errorAs(db, { id: plain },
      `select public.register_job_file($1, 'design', $2, 1, null, 'stl')`, [j, 'a'.repeat(64)])).toMatch(/Not allowed/)
  })
})

describe('#9 ending and pausing', () => {
  it('the read-only window is at most 90 days, whatever is asked', async () => {
    const p = await partnership(C, D)
    await rowsAs(db, { id: D.ownerId, mfa: true }, `select public.set_partnership_status($1, 'ended', 3650000)`, [p])
    const { rows } = await db.query<{ days: number }>(`select round(extract(epoch from readonly_until - ended_at) / 86400)::int as days from public.partnership where id = $1`, [p])
    expect(rows[0].days).toBe(90)
  })

  it('only the side that paused can resume', async () => {
    const p = await partnership(B, C)
    await rowsAs(db, { id: B.ownerId, mfa: true }, `select public.set_partnership_status($1, 'suspended')`, [p])
    expect(await errorAs(db, { id: C.ownerId, mfa: true }, `select public.set_partnership_status($1, 'active')`, [p])).toMatch(/paused/)
    expect(await errorAs(db, { id: B.ownerId, mfa: true }, `select public.set_partnership_status($1, 'active')`, [p])).toBeNull()
  })
})

describe('#7 wrong codes typed into accept are counted', () => {
  it('after 5 wrong accepts, the 6th attempt is refused outright', async () => {
    const admin = { id: C.ownerId, mfa: true }
    for (let i = 0; i < 5; i++) {
      const [r] = await rowsAs<{ id: string | null }>(db, admin,
        `select public.accept_partnership_invite($1, false, 'partial', '{}', 'DPA') as id`, [`WIVO-BAD${i}-CODE`])
      expect(r.id).toBeNull()
    }
    expect(await errorAs(db, admin, `select public.accept_partnership_invite('WIVO-BAD9-CODE', false, 'partial', '{}', 'DPA')`)).toMatch(/Too many/)
  })
})

describe('the smaller ones', () => {
  // A full-default partnership can no longer exist (sql/092, partnership_partial_only).
  it('#16 lab work is partial even when full is asked', async () => {
    const j = await job()
    await share(j, B)
    const [row] = await rowsAs<{ visibility: string; patient_name: string | null }>(db, { id: B.workerId },
      `select visibility, patient_name from public.partner_job_view where job_id = $1`, [j])
    expect(row).toEqual({ visibility: 'partial', patient_name: null })
  })

  it('#15 revisions reach the partner without notes, staff ids or prices', async () => {
    const j = await job()
    await share(j, B)
    const [row] = await rowsAs<{ revisions: unknown }>(db, { id: B.workerId }, `select revisions from public.partner_job_view where job_id = $1`, [j])
    expect(JSON.stringify(row.revisions)).not.toMatch(/upset|assigned_to|price/)
  })

  it('#13 a stranger learns nothing about a job\'s stage from move_job_stage', async () => {
    const j = await job()
    expect(await errorAs(db, { id: C.ownerId }, `select public.move_job_stage($1, 'disain')`, [j])).toBe('Job not found')
    expect(await errorAs(db, { id: C.ownerId }, `select public.move_job_stage($1, 'nonsense')`, [j])).toBe('Job not found')
  })

  it('#14 unsharing writes nothing into an unrelated organisation\'s log', async () => {
    const j = await job()
    await rowsAs(db, { id: A.ownerId }, `select public.unshare_job($1, $2)`, [j, C.clinicId])
    const { rows } = await db.query(`select 1 from public.audit_log where org_id = $1 and action = 'unshare'`, [C.clinicId])
    expect(rows).toEqual([])
  })

  it('#17 a reserved upload slot dies with the share', async () => {
    const j = await job()
    await share(j, B)
    const [f] = await rowsAs<{ storage_path: string }>(db, { id: B.workerId },
      `select * from public.register_job_file($1, 'design', $2, 1, null, 'stl')`, [j, 'a'.repeat(64)])
    await rowsAs(db, { id: A.ownerId }, `select public.unshare_job($1, $2)`, [j, B.clinicId])
    expect(await errorAs(db, { id: B.workerId },
      `insert into storage.objects (bucket_id, name) values ('job-files', $1)`, [f.storage_path])).not.toBeNull()
  })

  it('#21 internal helpers are not callable from outside', async () => {
    for (const sql of [`select public.stage_order($1)`, `select public.invite_attempts_left($1)`]) {
      expect(await errorAs(db, 'anon', sql, [A.clinicId])).toMatch(/permission denied/)
      expect(await errorAs(db, { id: C.ownerId }, sql, [A.clinicId])).toMatch(/permission denied/)
    }
  })

  it('#11 a removed worker loses their channels', async () => {
    const { rows: [ch] } = await db.query<{ id: string }>(
      `insert into public.channels (clinic_id, kind, created_by) values ($1, 'grupp', $2) returning id`, [A.clinicId, A.ownerId])
    const w = await createUser(db, 'Leaver')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, w])
    await db.query(`insert into public.channel_members (channel_id, profile_id) values ($1, $2), ($1, $3)`, [ch.id, w, A.ownerId])
    await rowsAs(db, { id: A.ownerId }, `update public.profiles set clinic_id = null where id = $1 returning 1`, [w])
    expect(await errorAs(db, { id: w }, `insert into public.messages (channel_id, author_id, body) values ($1, $2, 'still here')`, [ch.id, w])).not.toBeNull()
    expect(await rowsAs(db, { id: w }, `select 1 from public.channels where id = $1`, [ch.id])).toEqual([])
  })

  it('#26 an observer cannot add other members', async () => {
    const { rows: [ch] } = await db.query<{ id: string }>(
      `insert into public.channels (clinic_id, kind, created_by) values ($1, 'grupp', $2) returning id`, [A.clinicId, A.ownerId])
    await db.query(`insert into public.channel_members (channel_id, profile_id, role) values ($1, $2, 'vaatleja')`, [ch.id, A.workerId])
    const other = await makeRow(db, 'profiles', A)
    expect(await errorAs(db, { id: A.workerId },
      `insert into public.channel_members (channel_id, profile_id) values ($1, $2)`, [ch.id, other.id])).not.toBeNull()
  })
})
