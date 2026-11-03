/** What the phone app needs from the database (sql/090). */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, makeRow, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let jobId: string

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  await db.query(`insert into public.partnership (org_a, org_b, status, roles) values ($1, $2, 'active', array['design'])`, [A.clinicId, B.clinicId])
  await grant(db, B, B.workerId, ['jobs.read', 'jobs.write'])
  jobId = (await makeRow(db, 'jobs', A)).id as string
  await rowsAs(db, { id: A.ownerId }, `select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [jobId, B.clinicId])
}, 120_000)

async function upload(actor: { id: string }, type: string): Promise<void> {
  const [f] = await rowsAs<{ id: string; storage_path: string }>(db, actor,
    `select * from public.register_job_file($1, $2, $3, 10, 'image/jpeg', 'jpg')`, [jobId, type, 'b'.repeat(64)])
  await rowsAs(db, actor, `insert into storage.objects (bucket_id, name) values ('job-files', $1) returning 1`, [f.storage_path])
  await rowsAs(db, actor, `select public.confirm_job_file($1)`, [f.id])
}

const kinds = (userId: string) =>
  rowsAs<{ kind: string }>(db, { id: userId }, `select kind from public.notification where job_id = $1 and kind = 'files_added'`, [jobId])

describe('files added', () => {
  it('a photo from the owner\'s phone reaches the partner\'s notifications, not the owner\'s own side', async () => {
    await upload({ id: A.ownerId }, 'photo')
    expect(await kinds(B.workerId)).toHaveLength(1)
    expect(await kinds(A.workerId)).toEqual([])
  })

  it('a print file from the partner reaches the owner side', async () => {
    await upload({ id: B.workerId }, 'print')
    expect(await kinds(A.workerId)).toHaveLength(1)
  })
})

describe('push subscriptions', () => {
  it('each user registers and sees only their own browsers', async () => {
    expect(await errorAs(db, { id: A.workerId },
      `select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/a', 'k', 'a', 'iPhone')`)).toBeNull()
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.push_subscription`)).toHaveLength(1)
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.push_subscription`)).toEqual([])
  })

  it('after an owner\'s reset deleted them, the person, signed in again, can register the same browser again (the app\'s check, lib/push.ts)', async () => {
    const endpoint = 'https://web.push.apple.com/reset-me'
    const mine = `select 1 from public.push_subscription where endpoint = '${endpoint}'`
    await rowsAs(db, { id: A.workerId }, `select public.save_push_subscription('${endpoint}', 'k', 'a', 'iPhone')`)
    await db.query(`select public.complete_mfa_change('mfa_reset', $1, $2, $3, '{"reason":"Lost phone"}', true)`,
      [A.clinicId, A.ownerId, A.workerId])
    // What the app asks after the next sign-in: is this browser still mine? No.
    expect(await rowsAs(db, { id: A.workerId }, mine)).toEqual([])
    expect(await errorAs(db, { id: A.workerId },
      `select public.save_push_subscription('${endpoint}', 'k', 'a', 'iPhone')`)).toBeNull()
    expect(await rowsAs(db, { id: A.workerId }, mine)).toHaveLength(1)
    // Another account still cannot take it over (sql/091).
    expect(await errorAs(db, { id: A.ownerId },
      `select public.save_push_subscription('${endpoint}', 'k', 'a', 'iPhone')`)).toMatch(/another account/)
  })

  it('refuses something that is not a push endpoint', async () => {
    expect(await errorAs(db, { id: A.workerId },
      `select public.save_push_subscription('http://evil.example', 'k', 'a', 'x')`)).toMatch(/push endpoint/)
  })

  it('only the sender (service role) reads pending pushes; marking cleans gone browsers', async () => {
    expect(await errorAs(db, { id: A.workerId }, `select * from public.pending_pushes()`)).toMatch(/permission denied/)
    const { rows } = await db.query<{ notification_id: string; subscription_id: string }>(`select * from public.pending_pushes()`)
    expect(rows.length).toBeGreaterThan(0)
    await db.query(`select public.mark_pushed($1, '{}', $2)`, [rows.map(r => r.notification_id), [rows[0].subscription_id]])
    expect((await db.query(`select * from public.pending_pushes()`)).rows).toEqual([])
    expect((await db.query(`select 1 from public.push_subscription where id = $1`, [rows[0].subscription_id])).rows).toEqual([])
  })
})
