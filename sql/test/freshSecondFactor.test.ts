/**
 * sql/120: a fresh second-factor code, and who may approve an update
 * (docs/ARCHITECTURE-INSTANCES.md 5b, docs/AGREEMENTS.md §2).
 *
 * - Fresh means: the second factor in a live session, and an authenticator
 *   code in the token's `amr` no older than asked, by the database's clock.
 * - The age asked for is bounded, and a malformed `amr` is never fresh.
 * - update_approval() answers with the person's id, whether they approve
 *   updates for the instance's clinic, and whether their code is under 5
 *   minutes old; null without the second factor.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, grant, rowsAs, errorAs, type Actor, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let installer: string
let admin: string

/** A token's `amr`, as GoTrue writes it: a code entered `ago` seconds ago, after the password. */
const amr = (ago: number, method = 'totp') => [
  { method: 'password', timestamp: Math.floor(Date.now() / 1000) - 3600 },
  { method, timestamp: Math.floor(Date.now() / 1000) - ago },
]
const withCode = (id: string, ago: number, extra: Record<string, unknown> = {}): Actor =>
  ({ id, claims: { amr: amr(ago), ...extra } })

const fresh = async (actor: Actor, seconds = 300) =>
  (await rowsAs<{ f: boolean }>(db, actor, `select public.fresh_second_factor($1) as f`, [seconds]))[0].f
const approval = async (actor: Actor) =>
  (await rowsAs<{ a: Record<string, unknown> | null }>(db, actor, `select public.update_approval() as a`))[0].a

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Riga')
  B = await createTenant(db, 'Tallinn')
  installer = await createUser(db, 'Ilze Installer')
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, installer])
  await grant(db, A, installer, ['updates.install'])
  admin = await createUser(db, 'Anna Admin')
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'admin' where id = $2`, [A.clinicId, admin])
}, 120_000)

describe('a fresh code', () => {
  it('a code entered just now, or within the age asked for, is fresh', async () => {
    expect(await fresh(withCode(A.ownerId, 5))).toBe(true)
    expect(await fresh(withCode(A.ownerId, 280))).toBe(true)
    expect(await fresh(withCode(A.ownerId, 100), 120)).toBe(true)
  })

  it('an older code is not', async () => {
    expect(await fresh(withCode(A.ownerId, 320))).toBe(false)
    expect(await fresh(withCode(A.ownerId, 130), 120)).toBe(false)
  })

  it('no code in the token, or only the password, is not', async () => {
    expect(await fresh({ id: A.ownerId })).toBe(false)
    expect(await fresh({ id: A.ownerId, claims: { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] } })).toBe(false)
  })

  it('without the second factor in the session, a recent code in the token is not enough', async () => {
    expect(await fresh({ id: A.ownerId, mfa: false, claims: { amr: amr(5) } })).toBe(false)
  })

  it('in a session that has been ended, it is not fresh', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.sessions (user_id, aal) values ($1, 'aal2') returning id`, [A.workerId])
    const actor = withCode(A.workerId, 5, { session_id: rows[0].id })
    expect(await fresh(actor)).toBe(true)
    await db.query(`delete from auth.sessions where id = $1`, [rows[0].id])
    expect(await fresh(actor)).toBe(false)
  })

  it('the age asked for is bounded: 30 seconds to 15 minutes', async () => {
    expect(await fresh(withCode(A.ownerId, 5), 29)).toBe(false)
    expect(await fresh(withCode(A.ownerId, 5), 30)).toBe(true)
    expect(await fresh(withCode(A.ownerId, 5), 900)).toBe(true)
    expect(await fresh(withCode(A.ownerId, 5), 901)).toBe(false)
    expect(await fresh(withCode(A.ownerId, 5), 86_400)).toBe(false)
  })

  it('a time far ahead of the database\'s clock is refused', async () => {
    expect(await fresh(withCode(A.ownerId, -20))).toBe(true)
    expect(await fresh(withCode(A.ownerId, -600))).toBe(false)
  })

  it('a malformed amr is never fresh, and never an error', async () => {
    for (const bad of ['totp', { method: 'totp' }, [{ method: 'totp', timestamp: 'now' }], [{ method: 'totp' }], [null], 7]) {
      expect(await fresh({ id: A.ownerId, claims: { amr: bad } }), JSON.stringify(bad)).toBe(false)
    }
  })

  it('anon may not ask', async () => {
    expect(await errorAs(db, 'anon', `select public.fresh_second_factor(300)`)).toMatch(/permission denied/)
  })
})

describe('who may approve an update, asked by wivo-update with the person\'s own token', () => {
  it('before the project is an instance, nobody approves', async () => {
    expect(await approval(withCode(A.ownerId, 5))).toEqual({ user_id: A.ownerId, approver: false, fresh: true })
  })

  it('once it is, the owner and a member given "Install updates" approve; an admin without it, a worker and another clinic do not', async () => {
    await db.query(`select public.wivo_instance_create('stable')`)
    await db.query(`select public.wivo_instance_claim($1)`, [A.clinicId])
    expect(await approval(withCode(A.ownerId, 5))).toEqual({ user_id: A.ownerId, approver: true, fresh: true })
    expect(await approval(withCode(installer, 5))).toEqual({ user_id: installer, approver: true, fresh: true })
    expect(await approval(withCode(admin, 5))).toMatchObject({ approver: false })
    expect(await approval(withCode(A.workerId, 5))).toMatchObject({ approver: false })
    expect(await approval(withCode(B.ownerId, 5))).toMatchObject({ approver: false })
  })

  it('a code older than 5 minutes is not fresh enough to approve', async () => {
    expect(await approval(withCode(A.ownerId, 301))).toEqual({ user_id: A.ownerId, approver: true, fresh: false })
  })

  it('without the second factor: no answer at all', async () => {
    expect(await approval({ id: A.ownerId, mfa: false, claims: { amr: amr(5) } })).toBeNull()
  })

  it('anon may not ask', async () => {
    expect(await errorAs(db, 'anon', `select public.update_approval()`)).toMatch(/permission denied/)
  })
})
