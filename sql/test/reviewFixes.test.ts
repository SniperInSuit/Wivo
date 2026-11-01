/**
 * The production fixes from the review of sql/068–079 (sql/083). Each test is
 * the reviewer's reproduction, now expected to fail to reproduce.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, makeRow, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

const clinicOf = async (id: string) =>
  (await db.query<{ clinic_id: string | null; role: string }>(`select clinic_id, role from public.profiles where id = $1`, [id])).rows[0]

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
}, 120_000)

describe('adding a worker (the app\'s own update) really links them', () => {
  it('owner → fresh signup: clinic set, as a technician', async () => {
    const fresh = await createUser(db, 'New tech')
    const changed = await rowsAs(db, { id: A.ownerId },
      `update public.profiles set clinic_id = $1, username = 'newtech' where id = $2 returning 1`, [A.clinicId, fresh])
    expect(changed).toHaveLength(1)
    expect((await clinicOf(fresh)).clinic_id).toBe(A.clinicId)
  })

  it('a signup older than ten minutes is not visible to anyone\'s owner', async () => {
    const old = await createUser(db, 'Old signup')
    await db.query(`update public.profiles set created_at = now() - interval '11 minutes' where id = $1`, [old])
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.profiles where id = $1`, [old])).toEqual([])
  })

  it('nobody can make themselves "new" again', async () => {
    const me = await createUser(db, 'Sneaky')
    await db.query(`update public.profiles set created_at = now() - interval '2 days' where id = $1`, [me])
    await rowsAs(db, { id: me }, `update public.profiles set created_at = now() where id = $1 returning 1`, [me])
    const { rows } = await db.query<{ old: boolean }>(`select created_at < now() - interval '1 day' as old from public.profiles where id = $1`, [me])
    expect(rows[0].old).toBe(true)
  })
})

describe('permissions count only in their own clinic', () => {
  it('a worker\'s second account cannot grant the worker rights in their real clinic', async () => {
    const { rows: [p] } = await db.query<{ id: string }>(`insert into public.patients (clinic_id, nimi) values ($1, 'Secret Patient') returning id`, [A.clinicId])
    // The worker founds a clinic with a second account…
    const alt = await createUser(db, 'Alt')
    const [x] = await rowsAs<{ id: string }>(db, { id: alt }, `insert into public.clinics (name) values ('Shell') returning id`)
    await rowsAs(db, { id: alt }, `update public.profiles set clinic_id = $1 where id = $2 returning 1`, [x.id, alt])
    // …and tries to grant their real account patients.read.
    expect(await errorAs(db, { id: alt },
      `insert into public.worker_permissions (profile_id, clinic_id, permission) values ($1, $2, 'patients.read')`, [A.workerId, x.id])).not.toBeNull()
    // Even a grant that exists in the wrong clinic does not count.
    await db.query(`insert into public.worker_permissions (profile_id, clinic_id, permission) values ($1, $2, 'patients.read')`, [A.workerId, x.id])
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.patients where id = $1`, [p.id])).toEqual([])
  })

  it('an owner still grants rights in their own clinic', async () => {
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.worker_permissions (profile_id, clinic_id, permission) values ($1, $2, 'jobs.read')`, [A.workerId, A.clinicId])).toBeNull()
  })
})

describe('deleting a worker who is in the audit log', () => {
  it('works, and the history keeps the row without the person', async () => {
    const w = await createUser(db, 'Leaving')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, w])
    await db.query(`insert into public.worker_permissions (profile_id, clinic_id, permission) values ($1, $2, 'jobs.write'), ($1, $2, 'jobs.read')`, [w, A.clinicId])
    const job = await makeRow(db, 'jobs', A)
    await rowsAs(db, { id: w }, `update public.jobs set status = 'print' where id = $1 returning 1`, [job.id])
    expect(await errorAs(db, { id: A.ownerId }, `select public.admin_delete_worker($1)`, [w])).toBeNull()
    const { rows } = await db.query(`select user_id from public.audit_log where object = $1 and action = 'stage_move'`, ['job:' + job.id])
    expect(rows).toEqual([{ user_id: null }])
  })

  it('anything else in an audit row still cannot change', async () => {
    const { rows } = await db.query<{ id: number }>(`select id from public.audit_log limit 1`)
    expect(await errorAs(db, { id: A.ownerId }, `update public.audit_log set action = 'view' where id = $1`, [rows[0].id]).then(() =>
      db.query(`update public.audit_log set object = 'x' where id = $1`, [rows[0].id]).then(() => 'changed', () => 'refused'))).toBe('refused')
  })
})

describe('founding clinics', () => {
  it('a name that clashes with an existing prefix still founds a clinic', async () => {
    const u = await createUser(db, 'Founder 2')
    const [c] = await rowsAs<{ code_prefix: string }>(db, { id: u },
      `insert into public.clinics (name) values ('Tallinna Labor') returning code_prefix`)
    expect(c.code_prefix).toMatch(/^TAL\d+$/)
  })

  it('two non-Latin names both work', async () => {
    for (const name of ['Рижская лаборатория', 'Стоматология']) {
      const u = await createUser(db, name)
      expect(await errorAs(db, { id: u }, `insert into public.clinics (name) values ($1)`, [name])).toBeNull()
    }
  })

  it('nobody changes a prefix from the app', async () => {
    await rowsAs(db, { id: A.ownerId }, `update public.clinics set code_prefix = 'XYZ' where id = $1 returning 1`, [A.clinicId])
    const { rows } = await db.query<{ code_prefix: string }>(`select code_prefix from public.clinics where id = $1`, [A.clinicId])
    expect(rows[0].code_prefix).not.toBe('XYZ')
  })

  it('a removed founder cannot rejoin as owner, nor read the clinic while out', async () => {
    const founder = await createUser(db, 'Founder')
    const [c] = await rowsAs<{ id: string }>(db, { id: founder }, `insert into public.clinics (name) values ('Founded') returning id`)
    await rowsAs(db, { id: founder }, `update public.profiles set clinic_id = $1 where id = $2 returning 1`, [c.id, founder])
    const coOwner = await createUser(db, 'Co-owner')
    await db.query(`update public.profiles set clinic_id = $1, role = 'owner', org_role = 'owner' where id = $2`, [c.id, coOwner])
    await rowsAs(db, { id: coOwner }, `update public.profiles set clinic_id = null where id = $1 returning 1`, [founder])
    expect(await rowsAs(db, { id: founder }, `select 1 from public.clinics where id = $1`, [c.id])).toEqual([])
    await errorAs(db, { id: founder }, `update public.profiles set clinic_id = $1 where id = $2`, [c.id, founder])
    expect((await clinicOf(founder)).clinic_id).toBeNull()
  })

  it('a former owner put back comes back as a worker', async () => {
    const exOwner = await createUser(db, 'Ex owner')
    await db.query(`update public.profiles set clinic_id = $1, role = 'owner', org_role = 'owner' where id = $2`, [A.clinicId, exOwner])
    await rowsAs(db, { id: A.ownerId }, `update public.profiles set clinic_id = null where id = $1 returning 1`, [exOwner])
    await rowsAs(db, { id: A.ownerId }, `update public.profiles set clinic_id = $1 where id = $2 returning 1`, [A.clinicId, exOwner])
    expect(await clinicOf(exOwner)).toEqual({ clinic_id: A.clinicId, role: 'worker' })
  })
})

describe('job codes', () => {
  it('a job that gets its clinic later gets a code', async () => {
    const { rows: [j] } = await db.query<{ id: string }>(`insert into public.jobs (patsient) values ('Orphan') returning id`)
    await db.query(`update public.jobs set clinic_id = $1 where id = $2`, [A.clinicId, j.id])
    const { rows } = await db.query<{ job_code: string }>(`select job_code from public.jobs where id = $1`, [j.id])
    expect(rows[0].job_code).toMatch(/-\d{2}-\d{4}$/)
  })
})
