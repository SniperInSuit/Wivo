/**
 * sql/115 (docs/AUDIT.md §2.7): who made each change survives their account.
 * The author's id stays (no foreign key), their name as it was is stored with
 * the row, the people an entry names are stored by name too, the log takes no
 * update at all, and the rows written before were given their author's name
 * once, by a fill that changed nothing else.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, emptyDb, applyMigrations, migrationFiles, createTenant, createUser, as, rowsAs, errorAs, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
}, 120_000)

/** A worker in A who may edit jobs. */
async function member(d: PGlite, t: Tenant, name: string): Promise<string> {
  const id = await createUser(d, name)
  await d.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'technician' where id = $2`, [t.clinicId, id])
  await grant(d, t, id, ['jobs.read', 'jobs.write'])
  return id
}

async function job(d: PGlite, t: Tenant): Promise<string> {
  const [j] = await rowsAs<{ id: string }>(d, { id: t.ownerId },
    `insert into public.jobs (clinic_id, patsient, status) values ($1, 'X', 'disain') returning id`, [t.clinicId])
  return j.id
}

const entries = async (object: string) => (await db.query<{ action: string; user_id: string | null; actor_name: string | null; detail: Record<string, any> }>(
  `select action, user_id, actor_name, detail from public.audit_log where object = $1 order by id`, [object])).rows

describe('the author\'s id stays', () => {
  it('audit_log has no foreign key on who made the entry', async () => {
    const { rows } = await db.query(`select conname from pg_constraint
      where conrelid = 'public.audit_log'::regclass and contype = 'f' and conkey = array[(select attnum from pg_attribute
        where attrelid = 'public.audit_log'::regclass and attname = 'user_id')]`)
    expect(rows).toEqual([])
    expect((await db.query(`select 1 from pg_constraint where conname = 'audit_log_user_id_fkey'`)).rows).toEqual([])
  })
})

describe('a deleted account', () => {
  let leaving: string
  let jobId: string

  beforeAll(async () => {
    leaving = await member(db, A, 'Liis Lahkuja')
    jobId = await job(db, A)
    await as(db, { id: leaving }, () => db.query(`update public.jobs set varv = 'A3' where id = $1`, [jobId]))
    expect(await errorAs(db, { id: A.ownerId }, `select public.admin_delete_worker($1)`, [leaving])).toBeNull()
  })

  it('its entries keep the id and the name', async () => {
    expect(await entries(`job:${jobId}`)).toMatchObject([
      { action: 'create', user_id: A.ownerId },
      { action: 'edit', user_id: leaving, actor_name: 'Liis Lahkuja' },
    ])
  })

  it('the screen shows the name, and the id with it', async () => {
    const found = await rowsAs<{ user_name: string; user_id: string; action: string }>(db, { id: A.ownerId },
      `select user_name, user_id, action from public.audit_search() where object = $1 and action = 'edit'`, [`job:${jobId}`])
    expect(found).toEqual([{ user_name: 'Liis Lahkuja', user_id: leaving, action: 'edit' }])
    const old = await rowsAs<{ user_name: string }>(db, { id: A.ownerId },
      `select user_name from public.audit_entries(1000) where object = $1 and action = 'edit'`, [`job:${jobId}`])
    expect(old).toEqual([{ user_name: 'Liis Lahkuja' }])
  })

  it('the person filter still lists them', async () => {
    const people = await rowsAs<{ user_id: string; name: string }>(db, { id: A.ownerId }, `select * from public.audit_people()`)
    expect(people).toContainEqual({ user_id: leaving, name: 'Liis Lahkuja' })
  })

  it('the account_deleted entry names them too', async () => {
    expect(await entries(`user:${leaving}`)).toMatchObject([
      { action: 'account_deleted', user_id: A.ownerId, detail: { target_name: 'Liis Lahkuja', names: { [leaving]: 'Liis Lahkuja' } } },
    ])
  })
})

describe('a renamed member', () => {
  it('their older entries keep the name they had; new ones carry the new', async () => {
    const m = await member(db, A, 'Mari Maasikas')
    const j = await job(db, A)
    await as(db, { id: m }, () => db.query(`update public.jobs set varv = 'A1' where id = $1`, [j]))
    await db.query(`update public.profiles set full_name = 'Mari Kask' where id = $1`, [m])
    await as(db, { id: m }, () => db.query(`update public.jobs set varv = 'A2' where id = $1`, [j]))
    expect((await entries(`job:${j}`)).filter(e => e.action === 'edit').map(e => e.actor_name)).toEqual(['Mari Maasikas', 'Mari Kask'])
  })
})

describe('the people an entry names, by name as they were', () => {
  it('a job\'s technician and designer, and a work item\'s designer', async () => {
    const tech = await member(db, A, 'Tõnu Tehnik')
    const j = await job(db, A)
    await as(db, { id: A.ownerId }, () => db.query(
      `update public.jobs set assigned_to = $2, designed_by = $3, work_items = $4 where id = $1`,
      [j, tech, A.ownerId, JSON.stringify([{ id: 'w1', too: 'Kroon', hambad: '11', designed_by: tech }])]))
    const [, edit] = await entries(`job:${j}`)
    expect(edit.detail.names).toEqual({ [tech]: 'Tõnu Tehnik', [A.ownerId]: 'Tallinn owner' })
  })

  it('the member whose permissions or role changed', async () => {
    const m = await member(db, A, 'Pille Õigus')
    await as(db, { id: A.ownerId }, () => db.query(
      `insert into public.worker_permissions (profile_id, clinic_id, permission) values ($1, $2, 'patients.read')`, [m, A.clinicId]))
    await as(db, { id: A.ownerId }, () => db.query(`update public.profiles set org_role = 'admin' where id = $1`, [m]))
    expect((await entries(`user:${m}`)).map(e => [e.action, e.detail.names])).toEqual([
      ['permission', { [m]: 'Pille Õigus' }],
      ['permission', { [m]: 'Pille Õigus' }],
    ])
  })

  it('a "job" or "nobody" is not a person: no name for it', async () => {
    const j = await job(db, A)
    await as(db, { id: A.ownerId }, () => db.query(`update public.jobs set work_items = $2 where id = $1`,
      [j, JSON.stringify([{ id: 'w1', too: 'Kroon', hambad: '11', designed_by: null }])]))
    const [, edit] = await entries(`job:${j}`)
    expect(edit.detail.names).toBeUndefined()
  })
})

describe('no update at all', () => {
  it('not a name, not an id, not from the SQL Editor', async () => {
    const { rows: [r] } = await db.query<{ id: string }>(`select id::text from public.audit_log where user_id is not null limit 1`)
    await expect(db.exec(`update public.audit_log set actor_name = 'Keegi teine' where id = ${r.id}`)).rejects.toThrow(/append-only/)
    await expect(db.exec(`update public.audit_log set user_id = null where id = ${r.id}`)).rejects.toThrow(/append-only/)
    expect(await errorAs(db, { id: A.ownerId }, `update public.audit_log set actor_name = 'x' where id = $1`, [r.id]))
      .toMatch(/permission denied/)
  })

  it('a writer cannot put another name in: the name comes from who is signed in', async () => {
    const j = await job(db, A)
    const [create] = await entries(`job:${j}`)
    expect(create.actor_name).toBe('Tallinn owner')
  })
})

describe('the one-time fill of the rows written before sql/115', () => {
  it('gives each its author\'s name (as the profile reads at the fill) and changes nothing else', async () => {
    const d = await emptyDb()
    await applyMigrations(d, migrationFiles().filter(f => f < '115'))
    const T = await createTenant(d, 'Tartu')
    const w = await member(d, T, 'Vana Nimi')
    const gone = await member(d, T, 'Ammu Läinud')
    const j = await job(d, T)
    await as(d, { id: w }, () => d.query(`update public.jobs set varv = 'A1' where id = $1`, [j]))
    await as(d, { id: gone }, () => d.query(`update public.jobs set varv = 'A2' where id = $1`, [j]))
    await d.query(`select public.audit($1, 'view', 'job:x')`, [T.clinicId])          // nobody signed in
    await as(d, { id: T.ownerId }, () => d.query(`select public.admin_delete_worker($1)`, [gone]))  // before 115: emptied
    await d.query(`update public.profiles set full_name = 'Uus Nimi' where id = $1`, [w])          // renamed before the fill

    const snapshot = `select id, org_id, user_id, action, object, detail, at from public.audit_log order by id`
    const before = (await d.query(snapshot)).rows
    await applyMigrations(d, ['115_audit_actor_names.sql'])
    expect((await d.query(snapshot)).rows).toEqual(before)

    const names = (await d.query<{ user_id: string | null; actor_name: string | null; action: string }>(
      `select user_id, actor_name, action from public.audit_log order by id`)).rows
    expect(names.filter(r => r.user_id === T.ownerId).every(r => r.actor_name === 'Tartu owner')).toBe(true)
    // The fill reads the profile as it is then: the renamed member's older entry shows the later name.
    expect(names.filter(r => r.user_id === w).map(r => r.actor_name)).toEqual(['Uus Nimi'])
    // No author (or one deleted before 115, whose id was emptied then): no name.
    expect(names.filter(r => r.user_id === null).every(r => r.actor_name === null)).toBe(true)
    expect(names.some(r => r.user_id === null && r.action === 'edit')).toBe(true)

    // The trigger is back on: nothing can be changed after the fill.
    const { rows: [t] } = await d.query<{ tgenabled: string }>(
      `select tgenabled from pg_trigger where tgname = 'audit_log_append_only'`)
    expect(t.tgenabled).toBe('O')
    await expect(d.exec(`update public.audit_log set actor_name = 'x'`)).rejects.toThrow(/append-only/)
  }, 120_000)
})
