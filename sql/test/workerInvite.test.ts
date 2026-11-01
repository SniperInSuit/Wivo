/** "Add worker" with an invite token (sql/086): no window, nothing to race. */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
}, 120_000)

/** What Supabase Auth does on signUp: insert the user with its metadata. */
async function signUp(meta: Record<string, string>): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${crypto.randomUUID()}@test.invalid`, JSON.stringify(meta)])
  return rows[0].id
}

const profile = async (id: string) => (await db.query<{ clinic_id: string | null; role: string; org_role: string | null; username: string | null }>(
  `select clinic_id, role, org_role, username from public.profiles where id = $1`, [id])).rows[0]

const invite = async (t: Tenant) =>
  (await rowsAs<{ token: string }>(db, { id: t.ownerId }, `select public.create_worker_invite() as token`))[0].token

describe('worker invites', () => {
  it('a signup with the owner\'s token is in the clinic at once, as a technician, with its username', async () => {
    const token = await invite(A)
    const id = await signUp({ full_name: 'New tech', invite_token: token, username: 'NewTech' })
    expect(await profile(id)).toEqual({ clinic_id: A.clinicId, role: 'worker', org_role: 'technician', username: 'newtech' })
  })

  it('a token works once', async () => {
    const token = await invite(A)
    await signUp({ invite_token: token })
    const second = await signUp({ invite_token: token })
    expect((await profile(second)).clinic_id).toBeNull()
  })

  it('an expired token does nothing', async () => {
    const token = await invite(A)
    await db.query(`update public.worker_invite set expires_at = now() - interval '1 second'`)
    const id = await signUp({ invite_token: token })
    expect((await profile(id)).clinic_id).toBeNull()
  })

  it('a taken username leaves the signup in the clinic without one, instead of failing', async () => {
    const t1 = await invite(A)
    await signUp({ invite_token: t1, username: 'dup' })
    const t2 = await invite(A)
    const id = await signUp({ invite_token: t2, username: 'DUP' })
    expect(await profile(id)).toMatchObject({ clinic_id: A.clinicId, username: null })
  })

  it('only an owner creates tokens; nobody else sees them', async () => {
    expect(await errorAs(db, { id: A.workerId }, `select public.create_worker_invite()`)).toMatch(/owner/)
    await invite(A)
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.worker_invite where clinic_id = $1`, [A.clinicId])).toEqual([])
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.worker_invite`)).toEqual([])
  })

  it('without a token, signing up is unchanged: no clinic', async () => {
    const id = await signUp({ full_name: 'Someone' })
    expect((await profile(id)).clinic_id).toBeNull()
  })
})
