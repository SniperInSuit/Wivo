/**
 * Fixes from the independent review of sql/089–090, in sql/091. Each test is
 * the reviewer's reproduction, now expected to fail to reproduce.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, makeRow, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

const FCM = (k: string) => `https://fcm.googleapis.com/fcm/send/${k}`

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  await db.query(`insert into public.partnership (org_a, org_b, status, roles) values ($1, $2, 'active', array['design'])`, [A.clinicId, B.clinicId])
  await grant(db, B, B.workerId, ['jobs.read', 'jobs.write'])
}, 120_000)

describe('1. push endpoints', () => {
  it('only real push services; "https://" and other hosts are refused', async () => {
    for (const bad of ['https://', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'http://fcm.googleapis.com/x']) {
      expect(await errorAs(db, { id: A.workerId }, `select public.save_push_subscription($1, 'k', 'a', 'x')`, [bad])).toMatch(/push endpoint/)
    }
    for (const good of [FCM('ok1'), 'https://web.push.apple.com/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
      expect(await errorAs(db, { id: A.workerId }, `select public.save_push_subscription($1, 'k', 'a', 'x')`, [good])).toBeNull()
    }
  })

  it('no direct writes: a signed-in user cannot insert or update rows themselves', async () => {
    expect(await errorAs(db, { id: A.workerId },
      `insert into public.push_subscription (org_id, user_id, endpoint, p256dh, auth) values ($1, $2, 'not a url', 'k', 'a')`,
      [A.clinicId, A.workerId])).toMatch(/permission denied/)
    expect(await errorAs(db, { id: A.workerId }, `update public.push_subscription set endpoint = 'https://' where user_id = $1`, [A.workerId]))
      .toMatch(/permission denied/)
    // Switching push off on a phone still works.
    expect(await errorAs(db, { id: A.workerId }, `delete from public.push_subscription where endpoint = $1`, [FCM('ok1')])).toBeNull()
  })

  it('another account\'s endpoint is not taken over', async () => {
    await rowsAs(db, { id: A.ownerId }, `select public.save_push_subscription($1, 'k', 'a', 'x')`, [FCM('victim')])
    expect(await errorAs(db, { id: B.workerId }, `select public.save_push_subscription($1, 'k2', 'a2', 'x')`, [FCM('victim')]))
      .toMatch(/another account/)
    const { rows } = await db.query<{ user_id: string }>(`select user_id from public.push_subscription where endpoint = $1`, [FCM('victim')])
    expect(rows[0].user_id).toBe(A.ownerId)
  })

  it('at most 10 phones per person, the newest kept', async () => {
    const u = await createUser(db, 'Many phones')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, u])
    for (let i = 0; i < 13; i++) {
      await rowsAs(db, { id: u }, `select public.save_push_subscription($1, 'k', 'a', 'x')`, [FCM(`p${i}`)])
      await db.query(`select pg_sleep(0.002)`)
    }
    const rows = await rowsAs<{ endpoint: string }>(db, { id: u }, `select endpoint from public.push_subscription`)
    expect(rows).toHaveLength(10)
    expect(rows.map(r => r.endpoint)).toContain(FCM('p12'))
    expect(rows.map(r => r.endpoint)).not.toContain(FCM('p0'))
  })
})

describe('2. a deleted job stays out of reach', () => {
  async function deletedJob(): Promise<string> {
    const job = await makeRow(db, 'jobs', A)
    await rowsAs(db, { id: A.ownerId }, `delete from public.jobs where id = $1 returning 1`, [job.id])
    return job.id as string
  }

  it('cannot be shared again; the partner never sees it', async () => {
    const id = await deletedJob()
    expect(await errorAs(db, { id: A.ownerId }, `select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [id, B.clinicId]))
      .toMatch(/not found/i)
    expect(await rowsAs(db, { id: B.workerId }, `select 1 from public.partner_job_view where job_id = $1`, [id])).toEqual([])
  })

  it('an UPDATE cannot mark a job deleted (that skipped ending its shares)', async () => {
    const job = await makeRow(db, 'jobs', A)
    await rowsAs(db, { id: A.ownerId }, `select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [job.id, B.clinicId])
    // No WHERE: with one, Postgres already refuses (the new row fails the read
    // policy). Without one it went through and left the share live.
    expect(await errorAs(db, { id: A.ownerId }, `update public.jobs set deleted_at = now()`)).not.toBeNull()
    expect(await rowsAs(db, { id: B.workerId }, `select 1 from public.partner_job_view where job_id = $1`, [job.id])).toHaveLength(1)
  })

  it('takes no new files', async () => {
    const id = await deletedJob()
    expect(await errorAs(db, { id: A.ownerId },
      `select * from public.register_job_file($1, 'photo', $2, 10, 'image/jpeg', 'jpg')`, [id, 'c'.repeat(64)])).not.toBeNull()
  })

  it('restoring still works', async () => {
    const id = await deletedJob()
    expect(await errorAs(db, { id: A.ownerId }, `select public.restore_job($1)`, [id])).toBeNull()
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.jobs where id = $1`, [id])).toHaveLength(1)
  })
})

describe('3. deleted jobs: only what you could read', () => {
  it('jobs.write without jobs.read lists and restores only their own deleted jobs', async () => {
    const w = await createUser(db, 'Writer only')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, w])
    await grant(db, A, w, ['jobs.write'])
    const secret = await makeRow(db, 'jobs', A)
    const mine = await makeRow(db, 'jobs', A)
    await db.query(`update public.jobs set patsient = 'Secret Patient' where id = $1`, [secret.id])
    await db.query(`update public.jobs set patsient = 'My Patient', assigned_to = $2 where id = $1`, [mine.id, w])
    for (const j of [secret, mine]) await rowsAs(db, { id: A.ownerId }, `delete from public.jobs where id = $1 returning 1`, [j.id])
    const seen = (await rowsAs<{ patient: string }>(db, { id: w }, `select patient from public.deleted_jobs()`)).map(r => r.patient)
    expect(seen).toContain('My Patient')
    expect(seen).not.toContain('Secret Patient')
    expect(await errorAs(db, { id: w }, `select public.restore_job($1)`, [secret.id])).toMatch(/not found/i)
  })
})

describe('4. files added: one notification per burst', () => {
  it('fifteen photos are one notification per person, not fifteen', async () => {
    const job = await makeRow(db, 'jobs', A)
    await rowsAs(db, { id: A.ownerId }, `select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [job.id, B.clinicId])
    for (let i = 0; i < 15; i++) {
      const [f] = await rowsAs<{ id: string; storage_path: string }>(db, { id: A.ownerId },
        `select * from public.register_job_file($1, 'photo', $2, 10, 'image/jpeg', 'jpg')`, [job.id, String(i).padStart(64, 'd')])
      await rowsAs(db, { id: A.ownerId }, `insert into storage.objects (bucket_id, name) values ('job-files', $1) returning 1`, [f.storage_path])
      await rowsAs(db, { id: A.ownerId }, `select public.confirm_job_file($1)`, [f.id])
    }
    const n = await rowsAs(db, { id: B.workerId }, `select 1 from public.notification where job_id = $1 and kind = 'files_added'`, [job.id])
    expect(n).toHaveLength(1)
  })
})
