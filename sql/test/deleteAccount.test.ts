/**
 * sql/110: Team → "Delete account permanently" (admin_delete_worker). The
 * sign-in account and the profile go together or not at all, only for an
 * owner with the second factor, and the audit log says who deleted whom.
 *
 * The delete and the invite's duplicate check agree. team-account's invite
 * asks GoTrue, which refuses an address that still has a sign-in account
 * (or re-invites it, if unconfirmed, only into the clinic it is already in).
 * After a permanent delete the address and the username are free, and the
 * same invite makes a new account in the clinic. "Remove from team" keeps the
 * account, so its address stays taken until the person is restored.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, makeRow, SQL_DIR, type Tenant } from './harness'
import { AUDIT_ACTIONS } from '../../src/renderer/src/lib/auditSearch'

let db: PGlite
let A: Tenant
let B: Tenant
let codeA: string

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Pärnu')
  codeA = (await db.query<{ c: string }>(`select lower(code_prefix) as c from public.clinics where id = $1`, [A.clinicId])).rows[0].c
}, 120_000)

const inviteToken = async (t: Tenant) =>
  (await rowsAs<{ token: string }>(db, { id: t.ownerId }, `select public.create_worker_invite() as token`))[0].token

/** What GoTrue does for team-account: insert the account with its metadata (the trigger does the rest). */
async function gotrueCreates(email: string, meta: Record<string, string>): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify(meta)])
  return rows[0].id
}

/** An invite by e-mail, as team-account makes it. */
const invited = async (t: Tenant, email: string) =>
  gotrueCreates(email, { full_name: 'Kevin Test', language: 'et', invite_token: await inviteToken(t) })

/** GoTrue's duplicate check: an address with a sign-in account is taken. */
const taken = async (email: string) =>
  (await db.query(`select 1 from auth.users where lower(email) = lower($1)`, [email])).rows.length > 0

const inTeam = async (t: Tenant, id: string) =>
  (await rowsAs<{ id: string }>(db, { id: t.ownerId }, `select id from public.team_accounts()`)).some(r => r.id === id)

const remove = (owner: string, id: string) => errorAs(db, { id: owner }, `select public.admin_delete_worker($1)`, [id])

/** Everything the deletion touches, to see that a refusal changed none of it. */
async function state(id: string) {
  const one = async (sql: string) => (await db.query(sql, [id])).rows.length
  return {
    account: await one(`select 1 from auth.users where id = $1`),
    profile: await one(`select 1 from public.profiles where id = $1`),
    rates: await one(`select 1 from public.worker_rates where profile_id = $1`),
    audit: await one(`select 1 from public.audit_log where object = 'user:' || $1 and action = 'account_deleted'`),
  }
}

describe('a permanent delete', () => {
  it('removes the sign-in account and the profile, and the audit log says who deleted whom', async () => {
    const id = await invited(A, 'kevin+one@kliinik.test')
    await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [id])
    await db.query(`insert into public.worker_rates (clinic_id, profile_id, kind, amount) values ($1, $2, 'tund', 10)`, [A.clinicId, id])
    expect(await state(id)).toEqual({ account: 1, profile: 1, rates: 1, audit: 0 })

    expect(await remove(A.ownerId, id)).toBeNull()
    expect(await state(id)).toEqual({ account: 0, profile: 0, rates: 0, audit: 1 })
    const [entry] = (await db.query<{ org_id: string; user_id: string; detail: { target_name: string } }>(
      `select org_id, user_id, detail from public.audit_log where object = $1 and action = 'account_deleted'`, [`user:${id}`])).rows
    // sql/115: the name is also kept with the entry's other names.
    expect(entry).toEqual({ org_id: A.clinicId, user_id: A.ownerId, detail: { target_name: 'Kevin Test', names: { [id]: 'Kevin Test' } } })
  })

  it('frees the address: the same invite makes a new account in the clinic', async () => {
    for (const accepted of [true, false]) {
      const email = `kevin+${accepted ? 'accepted' : 'pending'}@kliinik.test`
      const first = await invited(A, email)
      if (accepted) await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [first])
      expect(await remove(A.ownerId, first)).toBeNull()
      expect(await taken(email)).toBe(false)
      const again = await invited(A, email)
      expect(await inTeam(A, again)).toBe(true)
    }
  })

  it('frees the username of a login without e-mail', async () => {
    const standin = `tehnik.${codeA}@nomail.wivodent.com`
    const first = await gotrueCreates(standin, { username: 'tehnik', invite_token: await inviteToken(A) })
    expect(await remove(A.ownerId, first)).toBeNull()
    const again = await gotrueCreates(standin, { username: 'tehnik', invite_token: await inviteToken(A) })
    expect(await inTeam(A, again)).toBe(true)
  })
})

describe('refused, and nothing changes', () => {
  it('without the second factor, by a worker, by another clinic\'s owner, for oneself or an owner', async () => {
    const id = await invited(A, 'kevin+refused@kliinik.test')
    expect(await errorAs(db, { id: A.ownerId, mfa: false }, `select public.admin_delete_worker($1)`, [id])).toMatch(/second factor/)
    expect(await remove(A.workerId, id)).toMatch(/omanik/)
    expect(await remove(B.ownerId, id)).toMatch(/ei kuulu sinu kliinikusse/)
    expect(await remove(A.ownerId, A.ownerId)).toMatch(/Iseennast/)
    expect(await errorAs(db, 'anon', `select public.admin_delete_worker($1)`, [id])).toMatch(/permission denied/)
    expect(await state(id)).toEqual({ account: 1, profile: 1, rates: 0, audit: 0 })
  })

  it('anyone with work: their history stays, and so does their address', async () => {
    const id = await invited(A, 'kevin+worked@kliinik.test')
    const job = await makeRow(db, 'jobs', A)
    await db.query(`update public.jobs set assigned_to = $1 where id = $2`, [id, job.id])
    expect(await remove(A.ownerId, id)).toMatch(/1 tööd/)
    expect(await state(id)).toEqual({ account: 1, profile: 1, rates: 0, audit: 0 })
    expect(await taken('kevin+worked@kliinik.test')).toBe(true)
  })

  it('someone removed from the team: restored first; until then the address stays taken', async () => {
    const email = 'kevin+removed@kliinik.test'
    const id = await invited(A, email)
    await db.query(`update public.profiles set clinic_id = null where id = $1`, [id])
    expect(await remove(A.ownerId, id)).toMatch(/Lisa ta enne meeskonda tagasi/)
    expect(await taken(email)).toBe(true)
    await db.query(`update public.profiles set clinic_id = $1 where id = $2`, [A.clinicId, id])
    expect(await remove(A.ownerId, id)).toBeNull()
    expect(await taken(email)).toBe(false)
  })
})

describe('on a database that drifted', () => {
  it('without the profile\'s foreign key (a restore): refused, the account and the profile both kept', async () => {
    const d = await freshDb()
    const T = await createTenant(d, 'Riga')
    await d.exec(`alter table public.profiles drop constraint profiles_id_fkey`)
    expect(await errorAs(d, { id: T.ownerId }, `select public.admin_delete_worker($1)`, [T.workerId]))
      .toMatch(/could not both be deleted; nothing was changed/)
    const left = async (sql: string) => (await d.query(sql, [T.workerId])).rows.length
    expect(await left(`select 1 from auth.users where id = $1`)).toBe(1)
    expect(await left(`select 1 from public.profiles where id = $1 and clinic_id is not null`)).toBe(1)
    expect(await left(`select 1 from public.audit_log where object = 'user:' || $1`)).toBe(0)
  }, 120_000)
})

describe('sql/checks/sign_in_account.sql', () => {
  const check = readFileSync(join(SQL_DIR, 'checks', 'sign_in_account.sql'), 'utf8')
  const run = async (d: PGlite, email: string) =>
    (await d.query<{ what: string; finding: string }>(check.replace(`'name@example.com'`, `'${email}'`))).rows.map(r => `${r.what}: ${r.finding}`)

  it('tells a new account from the invite again from one the delete left, and says what this database does', async () => {
    const email = 'kevin+check@kliinik.test'
    const first = await invited(A, email)
    expect(await remove(A.ownerId, first)).toBeNull()
    expect(await run(db, email)).toEqual([
      'sign-in account: none has this address: an invite to it makes a new one',
      'Delete account permanently (admin_delete_worker): sql/110\'s: both or nothing, second factor, audit entry; its owner postgres may delete sign-in accounts',
      'checked before every call (db_pre_request): the second factor and the app version (sql/104)',
    ])
    const again = await invited(A, email)
    const found = await run(db, email)
    expect(found[0]).toMatch(new RegExp(`^sign-in account ${again}: created \\d{4}-.+; not invited; never accepted; last sign-in never$`))
    expect(found[1]).toBe(`profile of ${again}: technician in "Tallinn"`)
    expect(found[2]).toMatch(/^made by an invite: of "Tallinn", used \d{4}-/)

    await db.query(`update public.profiles set clinic_id = null where id = $1`, [again])
    expect(await run(db, email)).toContain(`profile of ${again}: worker, removed from the team (no clinic)`)
  })

  it('names what is checked before every call, and says so when a restore lost it', async () => {
    const d = await freshDb()
    const said = async () => (await run(d, 'nobody@kliinik.test')).find(f => f.startsWith('checked before every call'))
    await d.exec(`alter role authenticator set pgrst.db_pre_request = 'public.require_mfa_for_api'`)
    expect(await said()).toMatch(/the second factor only/)
    await d.exec(`alter role authenticator reset pgrst.db_pre_request`)
    expect(await said()).toMatch(/NOTHING on this database/)
  }, 120_000)
})

describe('the audit log', () => {
  it('the app names every kind of entry the database allows, and no other', async () => {
    const { rows: [{ def }] } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'audit_log_action_valid'`)
    expect([...def.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort()).toEqual([...AUDIT_ACTIONS].sort())
  })
})
