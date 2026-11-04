/**
 * sql/030, 113: the owner sets a username account's password (Team → "Set a
 * new password"). The function writes the hash itself, past Supabase Auth's
 * minimum, so the length is checked here: 10, as everywhere else.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Pärnu')
}, 120_000)

const setPassword = (actor: string, profile: string, password: string) =>
  errorAs(db, { id: actor }, `select public.admin_set_worker_password($1, $2)`, [profile, password])

/** Whether `password` signs in as `user`, the way GoTrue checks it. */
const signsIn = async (user: string, password: string) =>
  (await db.query<{ ok: boolean }>(
    `select encrypted_password = extensions.crypt($2, encrypted_password) as ok from auth.users where id = $1`,
    [user, password])).rows[0].ok ?? false

describe('the owner sets a password', () => {
  it('10 characters: set, and it signs in', async () => {
    expect(await setPassword(A.ownerId, A.workerId, 'kümme-1234')).toBeNull()
    expect(await signsIn(A.workerId, 'kümme-1234')).toBe(true)
  })

  it('9 characters: refused, and the old one still signs in', async () => {
    expect(await setPassword(A.ownerId, A.workerId, 'üheksa-12')).toMatch(/vähemalt 10/)
    expect(await signsIn(A.workerId, 'kümme-1234')).toBe(true)
  })

  it('still only the owner, and only for their own clinic', async () => {
    expect(await setPassword(A.workerId, A.workerId, 'pikk-parool-1')).toMatch(/omanik/)
    expect(await setPassword(A.ownerId, B.workerId, 'pikk-parool-1')).toMatch(/ei kuulu/)
  })

  it('anon cannot run it', async () => {
    expect(await errorAs(db, 'anon', `select public.admin_set_worker_password($1, 'pikk-parool-1')`, [A.workerId]))
      .toMatch(/permission denied/)
  })
})
