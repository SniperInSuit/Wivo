/**
 * Fixes from the second review (of sql/080–084), in sql/085. Each test is the
 * reviewer's reproduction, now expected to fail to reproduce.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, makeRow, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let C: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  C = await createTenant(db, 'Cesis')
}, 120_000)

describe('1. the new-signup window', () => {
  it('a removed owner (no clinic) sees no fresh signups', async () => {
    const exOwner = await createUser(db, 'Ex owner')
    await db.query(`update public.profiles set role = 'owner', clinic_id = null where id = $1`, [exOwner])
    const fresh = await createUser(db, 'Fresh')
    expect(await rowsAs(db, { id: exOwner }, `select 1 from public.profiles where id = $1`, [fresh])).toEqual([])
  })

  it('it lasts two minutes, not ten', async () => {
    const fresh = await createUser(db, 'Three minutes old')
    await db.query(`update public.profiles set created_at = now() - interval '3 minutes' where id = $1`, [fresh])
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.profiles where id = $1`, [fresh])).toEqual([])
  })

  it('an owner cannot rename a fresh signup without linking it; linking still works', async () => {
    const fresh = await createUser(db, 'Original name')
    await errorAs(db, { id: B.ownerId }, `update public.profiles set full_name = 'Hijacked' where id = $1`, [fresh])
    const { rows } = await db.query<{ full_name: string }>(`select full_name from public.profiles where id = $1`, [fresh])
    expect(rows[0].full_name).toBe('Original name')
    const linked = await rowsAs(db, { id: A.ownerId },
      `update public.profiles set clinic_id = $1, username = 'tech1' where id = $2 returning 1`, [A.clinicId, fresh])
    expect(linked).toHaveLength(1)
  })
})

describe('2. payroll permission and stale grants', () => {
  it('a payroll grant from another clinic does not count', async () => {
    await db.query(`insert into public.worker_permissions (profile_id, clinic_id, permission) values ($1, $2, 'payroll.manage')`, [A.workerId, C.clinicId])
    const [r] = await rowsAs<{ ok: boolean }>(db, { id: A.workerId }, `select public.can_manage_payroll() as ok`)
    expect(r.ok).toBe(false)
  })

  it('the rightful owner\'s grant replaces the stale row instead of failing', async () => {
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.worker_permissions (profile_id, clinic_id, permission) values ($1, $2, 'payroll.manage')
       on conflict (profile_id, permission) do update set granted = true`, [A.workerId, A.clinicId])).toBeNull()
    const [r] = await rowsAs<{ ok: boolean }>(db, { id: A.workerId }, `select public.can_manage_payroll() as ok`)
    expect(r.ok).toBe(true)
  })
})

describe('3. the thread remembers where a message came from', () => {
  let jobId: string
  beforeAll(async () => {
    for (const t of [B, C]) {
      await db.query(`insert into public.partnership (org_a, org_b, status, roles) values ($1, $2, 'active', array['design'])`, [A.clinicId, t.clinicId])
      await grant(db, t, t.workerId, ['jobs.read', 'jobs.write'])
    }
    jobId = (await makeRow(db, 'jobs', A)).id as string
    for (const t of [B, C]) {
      await rowsAs(db, { id: A.ownerId }, `select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [jobId, t.clinicId])
    }
  })

  it('moving to another partner does not carry your old messages along', async () => {
    const mover = await createUser(db, 'Mover')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [C.clinicId, mover])
    await grant(db, C, mover, ['jobs.read'])
    await rowsAs(db, { id: mover }, `select public.post_job_comment($1, 'from Cesis', false)`, [jobId])
    await db.query(`update public.profiles set clinic_id = $1 where id = $2`, [B.clinicId, mover])
    const seen = (await rowsAs<{ body: string }>(db, { id: B.workerId }, `select body from public.job_thread($1)`, [jobId])).map(m => m.body)
    expect(seen).not.toContain('from Cesis')
  })

  it('after the partnership ends, nothing written later reaches the partner', async () => {
    await db.query(`update public.partnership set status = 'ended', ended_at = now(), readonly_until = now() + interval '30 days'
                     where org_b = $1`, [B.clinicId])
    await db.query(`select pg_sleep(0.01)`)
    await rowsAs(db, { id: A.ownerId }, `select public.post_job_comment($1, 'internal after the end', false)`, [jobId])
    const seen = (await rowsAs<{ body: string }>(db, { id: B.workerId }, `select body from public.job_thread($1)`, [jobId])).map(m => m.body)
    expect(seen).not.toContain('internal after the end')
  })
})

describe('4–9', () => {
  it('4. open_questions answers only for jobs the caller can see', async () => {
    const job = await makeRow(db, 'jobs', A)
    await rowsAs(db, { id: A.ownerId }, `select public.post_job_comment($1, 'Q?', true)`, [job.id])
    const plain = await createUser(db, 'No rights')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, plain])
    expect(await rowsAs(db, { id: plain }, `select * from public.open_questions()`)).toEqual([])
  })

  it('5. job number 10 000 does not collide with 1 000', async () => {
    const year = new Date().getFullYear()
    await db.query(`insert into public.job_code_counter (org_id, year, last) values ($1, $2, 999)
                    on conflict (org_id, year) do update set last = 999`, [C.clinicId, year])
    const j1000 = await makeRow(db, 'jobs', C)
    await db.query(`update public.job_code_counter set last = 9999 where org_id = $1 and year = $2`, [C.clinicId, year])
    const j10000 = await makeRow(db, 'jobs', C)
    expect(String(j1000.job_code).endsWith('-1000')).toBe(true)
    expect(String(j10000.job_code).endsWith('-10000')).toBe(true)
  })

  it('6. the year is today\'s whatever created_at says; a restore keeps its codes', async () => {
    const [r] = await rowsAs<{ job_code: string }>(db, { id: A.ownerId },
      `insert into public.jobs (clinic_id, patsient, created_at) values ($1, 'Old', '1927-06-01') returning job_code`, [A.clinicId])
    expect(r.job_code).toContain(`-${String(new Date().getFullYear() % 100).padStart(2, '0')}-`)
    const { rows } = await db.query<{ job_code: string }>(
      `insert into public.jobs (clinic_id, patsient, job_code) values ($1, 'Restored', 'TAL-24-0042') returning job_code`, [A.clinicId])
    expect(rows[0].job_code).toBe('TAL-24-0042')
  })

  it('7. only a job thread may carry a job id', async () => {
    const job = await makeRow(db, 'jobs', A)
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.channels (clinic_id, kind, job_id, created_by) values ($1, 'grupp', $2, $3)`, [A.clinicId, job.id, A.ownerId])).not.toBeNull()
  })

  it('8. the pausing organisation can resume even if the admin who paused has left', async () => {
    const { rows: [p] } = await db.query<{ id: string }>(
      `insert into public.partnership (org_a, org_b, status) values ($1, $2, 'active') returning id`, [B.clinicId, C.clinicId])
    const admin2 = await createUser(db, 'Second admin')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'admin' where id = $2`, [B.clinicId, admin2])
    await rowsAs(db, { id: admin2, mfa: true }, `select public.set_partnership_status($1, 'suspended')`, [p.id])
    await db.query(`update public.profiles set clinic_id = null where id = $1`, [admin2])
    expect(await errorAs(db, { id: B.ownerId, mfa: true }, `select public.set_partnership_status($1, 'active')`, [p.id])).toBeNull()
  })

  it('9. a removed worker no longer sees channels they created', async () => {
    const w = await createUser(db, 'Creator')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, w])
    const { rows: [ch] } = await db.query<{ id: string }>(
      `insert into public.channels (clinic_id, kind, name, created_by) values ($1, 'grupp', 'Secret plans', $2) returning id`, [A.clinicId, w])
    await db.query(`update public.profiles set clinic_id = null where id = $1`, [w])
    expect(await rowsAs(db, { id: w }, `select 1 from public.channels where id = $1`, [ch.id])).toEqual([])
  })
})
