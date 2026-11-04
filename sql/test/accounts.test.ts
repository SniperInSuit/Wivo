/**
 * sql/100 (docs/ACCOUNTS.md): usernames per clinic, stand-ins only with the
 * clinic's invite, the language from the invite, the username cleared when a
 * real e-mail replaces the stand-in, and the owner's view of how members sign in
 * (with sql/111's column types and sql/112's authenticator flag).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let codeA: string
let codeB: string

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Pärnu')
  const code = async (t: Tenant) =>
    (await db.query<{ c: string }>(`select lower(code_prefix) as c from public.clinics where id = $1`, [t.clinicId])).rows[0].c
  codeA = await code(A)
  codeB = await code(B)
}, 120_000)

const invite = async (t: Tenant) =>
  (await rowsAs<{ token: string }>(db, { id: t.ownerId }, `select public.create_worker_invite() as token`))[0].token

/** What GoTrue does when the Edge Function creates a user: insert it with its metadata. */
async function createAuthUser(email: string, meta: Record<string, string>): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify(meta)])
  return rows[0].id
}
const tryCreate = (email: string, meta: Record<string, string>) =>
  createAuthUser(email, meta).then(() => null, (e: Error) => e.message)

const standin = (name: string, code: string) => `${name}.${code}@nomail.wivodent.com`

const profile = async (id: string) => (await db.query<{ clinic_id: string | null; username: string | null; language: string | null; org_role: string | null }>(
  `select clinic_id, username, language, org_role from public.profiles where id = $1`, [id])).rows[0]

describe('usernames are per clinic', () => {
  it('two clinics can both have "tehnik"', async () => {
    const a = await createAuthUser(standin('tehnik', codeA), { full_name: 'A tech', username: 'tehnik', invite_token: await invite(A) })
    const b = await createAuthUser(standin('tehnik', codeB), { full_name: 'B tech', username: 'tehnik', invite_token: await invite(B) })
    expect(await profile(a)).toMatchObject({ clinic_id: A.clinicId, username: 'tehnik', org_role: 'technician' })
    expect(await profile(b)).toMatchObject({ clinic_id: B.clinicId, username: 'tehnik', org_role: 'technician' })
  })

  it('but not twice in the same clinic', async () => {
    expect(await tryCreate(standin('tehnik', codeA), { username: 'tehnik', invite_token: await invite(A) })).toMatch(/duplicate|unique/)
    const id = await createAuthUser(`${crypto.randomUUID()}@test.invalid`, { invite_token: await invite(A) })
    expect(await db.query(`update public.profiles set username = 'Tehnik' where id = $1`, [id]).then(() => null, (e: Error) => e.message))
      .toMatch(/duplicate|unique/)
  })

  it('an old build\'s signup (example.com, with the invite) still works, and its taken name is left empty', async () => {
    const fresh = await createAuthUser('vana1@example.com', { username: 'vana1', invite_token: await invite(A) })
    expect(await profile(fresh)).toMatchObject({ clinic_id: A.clinicId, username: 'vana1' })
    const clash = await createAuthUser('vana1@test.invalid', { username: 'vana1', invite_token: await invite(A) })
    expect(await profile(clash)).toMatchObject({ clinic_id: A.clinicId, username: null })
  })
})

describe('a stand-in only with its clinic\'s invite', () => {
  it('no invite: refused (nobody can take a clinic\'s name through the public sign-up)', async () => {
    expect(await tryCreate(standin('squat', codeA), { username: 'squat' })).toMatch(/owner in Wivo/)
  })

  it('another clinic\'s invite, a used or a wrong one: refused', async () => {
    expect(await tryCreate(standin('cross', codeA), { username: 'cross', invite_token: await invite(B) })).toMatch(/owner in Wivo/)
    expect(await tryCreate(standin('bad', codeA), { username: 'bad', invite_token: 'not-a-token' })).toMatch(/owner in Wivo/)
    const once = await invite(A)
    await createAuthUser(standin('first', codeA), { username: 'first', invite_token: once })
    expect(await tryCreate(standin('second', codeA), { username: 'second', invite_token: once })).toMatch(/owner in Wivo/)
  })

  it('an address that is not exactly <username>.<code>: refused', async () => {
    expect(await tryCreate(standin('other', codeA), { username: 'mismatch', invite_token: await invite(A) })).toMatch(/owner in Wivo/)
    expect(await tryCreate(standin('nouser', codeA), { invite_token: await invite(A) })).toMatch(/owner in Wivo/)
  })

  it('a refused one leaves nothing behind and does not use up the invite', async () => {
    const token = await invite(A)
    await tryCreate(standin('x1', codeB), { username: 'x1', invite_token: token })
    expect((await db.query(`select 1 from auth.users where email = $1`, [standin('x1', codeB)])).rows).toEqual([])
    const ok = await createAuthUser(standin('x1', codeA), { username: 'x1', invite_token: token })
    expect(await profile(ok)).toMatchObject({ clinic_id: A.clinicId })
  })

  it('a real address needs no username and is unaffected', async () => {
    const id = await createAuthUser('mari@kliinik.test', { full_name: 'Mari', invite_token: await invite(A) })
    expect(await profile(id)).toMatchObject({ clinic_id: A.clinicId, username: null })
  })
})

describe('the language from the invite', () => {
  it('is stored; anything else is ignored', async () => {
    const et = await createAuthUser('keel1@kliinik.test', { language: 'et', invite_token: await invite(A) })
    const xx = await createAuthUser('keel2@kliinik.test', { language: 'xx', invite_token: await invite(A) })
    expect((await profile(et)).language).toBe('et')
    expect((await profile(xx)).language).toBeNull()
  })
})

describe('a real e-mail replaces the stand-in', () => {
  it('clears the username; nothing else does', async () => {
    const id = await createAuthUser(standin('lisab', codeA), { username: 'lisab', invite_token: await invite(A) })
    await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [id])
    expect((await profile(id)).username).toBe('lisab')
    await db.query(`update auth.users set email = 'lisab@kliinik.test' where id = $1`, [id])
    expect(await profile(id)).toMatchObject({ username: null, clinic_id: A.clinicId })

    const real = await createAuthUser('vahetab@kliinik.test', { invite_token: await invite(A) })
    await db.query(`update public.profiles set username = 'vahetab' where id = $1`, [real])
    await db.query(`update auth.users set email = 'uus@kliinik.test' where id = $1`, [real])
    expect((await profile(real)).username).toBe('vahetab')
  })
})

describe('team_accounts(): how each member signs in', () => {
  it('the owner sees their own clinic: the login to type, and whether an invite waits', async () => {
    const st = await createAuthUser(standin('kuvatav', codeA), { username: 'kuvatav', invite_token: await invite(A) })
    const invited = await createAuthUser('kutsutud@kliinik.test', { invite_token: await invite(A) })
    const accepted = await createAuthUser('votnud@kliinik.test', { invite_token: await invite(A) })
    const old = await createAuthUser('vanakuva@example.com', { username: 'vanakuva', invite_token: await invite(A) })
    await db.query(`update auth.users set email_confirmed_at = now() where id = any($1)`, [[st, accepted, old]])

    const rows = await rowsAs<{ id: string; login: string; has_email: boolean; invite_pending: boolean }>(
      db, { id: A.ownerId }, `select * from public.team_accounts()`)
    const byId = new Map(rows.map(r => [r.id, r]))
    expect(byId.get(st)).toMatchObject({ login: `kuvatav@${codeA}`, has_email: false, invite_pending: false })
    expect(byId.get(invited)).toMatchObject({ login: 'kutsutud@kliinik.test', has_email: true, invite_pending: true })
    expect(byId.get(accepted)).toMatchObject({ login: 'votnud@kliinik.test', has_email: true, invite_pending: false })
    expect(byId.get(old)).toMatchObject({ login: 'vanakuva', has_email: false, invite_pending: false })
    expect(byId.has(A.ownerId)).toBe(true)
    expect(byId.has(B.ownerId)).toBe(false)
    expect(byId.has(B.workerId)).toBe(false)
  })

  it('works with auth.users as Supabase has it: the address is varchar(255) (sql/111)', async () => {
    const { rows: [{ t }] } = await db.query<{ t: string }>(
      `select format_type(atttypid, atttypmod) as t from pg_attribute where attrelid = 'auth.users'::regclass and attname = 'email'`)
    expect(t).toBe('character varying(255)')
    expect(await errorAs(db, { id: A.ownerId }, `select * from public.team_accounts()`)).toBeNull()
  })

  it('whether each has an authenticator: yes only for a verified one, and nothing else about it (sql/112)', async () => {
    const withOne = await createAuthUser('tal-kood@kliinik.test', { invite_token: await invite(A) })
    const halfway = await createAuthUser('poolel@kliinik.test', { invite_token: await invite(A) })
    const without = await createAuthUser(standin('ilmata', codeA), { username: 'ilmata', invite_token: await invite(A) })
    const factor = (user: string, status: string) => db.query(
      `insert into auth.mfa_factors (user_id, friendly_name, status) values ($1, 'Telefon', $2::auth.factor_status)`, [user, status])
    await factor(withOne, 'verified')
    await factor(withOne, 'unverified')
    await factor(halfway, 'unverified')

    const rows = await rowsAs<Record<string, unknown>>(db, { id: A.ownerId }, `select * from public.team_accounts()`)
    const byId = new Map(rows.map(r => [r.id, r]))
    expect(byId.get(withOne)?.has_authenticator).toBe(true)
    expect(byId.get(halfway)?.has_authenticator).toBe(false)
    expect(byId.get(without)?.has_authenticator).toBe(false)
    expect(Object.keys(rows[0]).sort()).toEqual(['has_authenticator', 'has_email', 'id', 'invite_pending', 'login'])
  })

  it('a worker, an owner without the second factor and an anonymous caller get nothing', async () => {
    expect(await errorAs(db, { id: A.workerId }, `select * from public.team_accounts()`)).toMatch(/owner/)
    expect(await errorAs(db, { id: A.ownerId, mfa: false }, `select * from public.team_accounts()`)).toMatch(/second factor/)
    expect(await errorAs(db, 'anon', `select * from public.team_accounts()`)).toMatch(/permission denied/)
  })
})
