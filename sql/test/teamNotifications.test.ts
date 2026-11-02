/**
 * Notifications inside the clinic (sql/095): the job's technician and
 * designers hear when the job (or a remake) reaches a stage — per stage, as
 * the clinic set it — and when they are put on a job. Never the person
 * acting, never anyone outside the clinic, never a partner.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant       // the clinic: owner moves jobs, worker is the technician
let B: Tenant       // a partner
let designer: string
let designer2: string

async function job(extra: Record<string, unknown> = {}): Promise<string> {
  const base: Record<string, unknown> = { clinic_id: A.clinicId, patsient: 'Mari Maasikas', status: 'disain', ...extra }
  const cols = Object.keys(base)
  const { rows } = await db.query<{ id: string }>(
    `insert into public.jobs (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(base))
  return rows[0].id
}

/** As the owner: what a person in the app does. */
const update = (j: string, set: string, params: unknown[] = []) =>
  rowsAs(db, { id: A.ownerId }, `update public.jobs set ${set} where id = $1`, [j, ...params])

const got = async (user: string, j: string) =>
  (await db.query<{ kind: string; detail: Record<string, string> }>(
    `select kind, detail from public.notification where user_id = $1 and job_id = $2 order by created_at, kind`, [user, j])).rows

const setStages = (stages: unknown[]) =>
  db.query(`update public.clinic_settings set pipeline_stages = $2 where clinic_id = $1`, [A.clinicId, JSON.stringify(stages)])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  designer = await createUser(db, 'Disa Ainer')
  designer2 = await createUser(db, 'Teine Disainer')
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = any($2)`, [A.clinicId, [designer, designer2]])
  await db.query(`insert into public.clinic_settings (clinic_id) values ($1) on conflict (clinic_id) do nothing`, [A.clinicId])
  await db.query(`insert into public.partnership (org_a, org_b, status, roles) values ($1, $2, 'active', array['design'])`, [A.clinicId, B.clinicId])
}, 120_000)

describe('put on a job', () => {
  it('a new job tells its technician and designer; the person creating it hears nothing', async () => {
    const j = await job({ assigned_to: A.workerId, designed_by: designer })
    expect(await got(A.workerId, j)).toEqual([{ kind: 'assigned', detail: { role: 'technician' } }])
    expect(await got(designer, j)).toEqual([{ kind: 'assigned', detail: { role: 'designer' } }])
  })

  it('a change tells only the newcomer; a work item designer counts too', async () => {
    const j = await job({ assigned_to: A.workerId })
    await db.query(`delete from public.notification`)
    await update(j, `designed_by = $2`, [designer])
    await update(j, `work_items = $2`, [JSON.stringify([{ id: 'w1', too: 'Kroon', hambad: '11', designed_by: designer2 }])])
    expect(await got(A.workerId, j)).toEqual([])
    expect(await got(designer, j)).toEqual([{ kind: 'assigned', detail: { role: 'designer' } }])
    expect(await got(designer2, j)).toEqual([{ kind: 'assigned', detail: { role: 'designer' } }])
  })

  it('someone made technician and designer at once hears it once', async () => {
    const j = await job({ assigned_to: designer, designed_by: designer })
    expect(await got(designer, j)).toEqual([{ kind: 'assigned', detail: { role: 'technician' } }])
  })

  it('putting yourself on a job tells nobody', async () => {
    const j = await job()
    await update(j, `assigned_to = $2`, [A.ownerId])
    expect(await got(A.ownerId, j)).toEqual([])
  })
})

describe('the job reached a stage', () => {
  it('by default the technician and every designer hear it, with where it went', async () => {
    const j = await job({ assigned_to: A.workerId, designed_by: designer,
      work_items: JSON.stringify([{ id: 'w1', too: 'Kroon', hambad: '11', designed_by: designer2 }]) })
    await db.query(`delete from public.notification`)
    await update(j, `status = 'print'`)
    expect(await got(A.workerId, j)).toEqual([{ kind: 'stage_reached', detail: { from: 'disain', to: 'print', role: 'technician' } }])
    expect(await got(designer, j)).toEqual([{ kind: 'stage_reached', detail: { from: 'disain', to: 'print', role: 'designer' } }])
    expect(await got(designer2, j)).toHaveLength(1)
    expect(await got(A.ownerId, j)).toEqual([])  // the person who moved it
  })

  it('per stage, as the clinic set it: unticked roles are not told', async () => {
    await setStages([
      { key: 'disain', label: 'Disain', hex: '#000' },
      { key: 'print', label: 'Print', hex: '#000', notifyDesigner: false },
      { key: 'valmis', label: 'Valmis', hex: '#000', notifyTechnician: false, notifyDesigner: false },
    ])
    const j = await job({ assigned_to: A.workerId, designed_by: designer })
    await db.query(`delete from public.notification`)
    await update(j, `status = 'print'`)
    expect(await got(A.workerId, j)).toHaveLength(1)
    expect(await got(designer, j)).toEqual([])
    await update(j, `status = 'valmis'`)
    expect(await got(A.workerId, j)).toHaveLength(1)
    await setStages([])
  })

  it('the technician moving the job themselves is not told; the designer is', async () => {
    const j = await job({ assigned_to: A.workerId, designed_by: designer })
    await db.query(`delete from public.notification`)
    await db.query(`insert into public.worker_permissions (profile_id, clinic_id, permission) values ($1, $2, 'jobs.write') on conflict do nothing`, [A.workerId, A.clinicId])
    await rowsAs(db, { id: A.workerId }, `update public.jobs set status = 'print' where id = $1`, [j])
    expect(await got(A.workerId, j)).toEqual([])
    expect(await got(designer, j)).toHaveLength(1)
  })

  it('a remake that moves tells its own technician, else the job\'s', async () => {
    const j = await job({ assigned_to: A.workerId, designed_by: designer, revisions: JSON.stringify([
      { id: 'r1', ts: '2026-11-01', note: 'x', status: 'disain', assigned_to: designer2 },
      { id: 'r2', ts: '2026-11-01', note: 'y', status: 'disain' },
    ]) })
    await db.query(`delete from public.notification`)
    await update(j, `revisions = $2`, [JSON.stringify([
      { id: 'r1', ts: '2026-11-01', note: 'x', status: 'print', assigned_to: designer2 },
      { id: 'r2', ts: '2026-11-01', note: 'y edited', status: 'disain' },
    ])])
    expect(await got(designer2, j)).toEqual([{ kind: 'stage_reached', detail: { from: 'disain', to: 'print', revision: 'r1', role: 'technician' } }])
    expect(await got(A.workerId, j)).toEqual([])         // r1 has its own technician; r2 did not move
    expect(await got(designer, j)).toEqual([{ kind: 'stage_reached', detail: { from: 'disain', to: 'print', revision: 'r1', role: 'designer' } }])
  })

  it('nothing for a deleted job, nothing for someone who left the clinic', async () => {
    const j = await job({ assigned_to: A.workerId, designed_by: B.workerId })   // a profile of another organisation
    expect(await got(B.workerId, j)).toEqual([])
    await db.query(`delete from public.notification`)
    await db.query(`update public.jobs set deleted_at = now() where id = $1`, [j])
    await update(j, `status = 'print'`)
    expect(await got(A.workerId, j)).toEqual([])
  })
})

describe('the partner side', () => {
  it('a partner never gets the clinic\'s own notifications, even on a shared job', async () => {
    const j = await job({ assigned_to: A.workerId })
    await rowsAs(db, { id: A.ownerId }, `select public.share_job($1, $2, 'lab_work', 'design', array['print'])`, [j, B.clinicId])
    await update(j, `status = 'print'`)
    const { rows } = await db.query(`select kind from public.notification where org_id = $1 and job_id = $2`, [B.clinicId, j])
    expect([...new Set(rows.map(r => r.kind))].sort()).toEqual(['job_shared', 'stage_handover'])  // one each, to both partner members
  })
})

describe('each person chooses push and e-mail; the bell always shows', () => {
  it('push off: the notification is in the bell, but no phone gets it', async () => {
    await db.query(`insert into public.push_subscription (org_id, user_id, endpoint, p256dh, auth) values ($1, $2, 'https://web.push.apple.com/t1', 'k', 'a')`, [A.clinicId, A.workerId])
    await rowsAs(db, { id: A.workerId }, `select public.set_notify_push(false)`)
    const j = await job({ assigned_to: A.workerId })
    expect(await got(A.workerId, j)).toHaveLength(1)
    const pushes = async () => (await db.query(`select 1 from public.pending_pushes() p join public.notification n on n.id = p.notification_id where n.job_id = $1`, [j])).rows
    expect(await pushes()).toEqual([])
    await rowsAs(db, { id: A.workerId }, `select public.set_notify_push(true)`)
    expect(await pushes()).toHaveLength(1)
  })

  it('e-mail off (sql/075): no e-mail; the bell still has it', async () => {
    await rowsAs(db, { id: A.workerId }, `select public.set_notify_email(false)`)
    const j = await job({ assigned_to: A.workerId })
    expect(await got(A.workerId, j)).toHaveLength(1)
    expect((await db.query(`select 1 from public.pending_notification_emails() where job_id = $1`, [j])).rows).toEqual([])
    await rowsAs(db, { id: A.workerId }, `select public.set_notify_email(true)`)
  })

  it('only for oneself, and not without signing in', async () => {
    await rowsAs(db, { id: A.ownerId }, `select public.set_notify_push(false)`)
    expect((await db.query(`select notify_push from public.profiles where id = $1`, [A.workerId])).rows).toEqual([{ notify_push: true }])
    await rowsAs(db, { id: A.ownerId }, `select public.set_notify_push(true)`)
    expect(await errorAs(db, 'anon', `select public.set_notify_push(false)`)).toMatch(/permission denied/)
  })
})
