/**
 * Settings → Security (sql/097): removing one's own authenticator, the
 * owner's reset, the records. The rules, each from the side that must be
 * refused: aal1, no proof, a stale code, someone else's factor, another
 * owner, another organisation — and a partner, who can do none of it.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, type Actor, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant // A's active partner

const now = (): number => Math.floor(Date.now() / 1000)

async function addFactor(userId: string, name = 'Wivo', status = 'verified'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.mfa_factors (user_id, friendly_name, status) values ($1, $2, $3::auth.factor_status) returning id`,
    [userId, name, status])
  return rows[0].id
}

async function newSession(userId: string, factorId: string | null): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.sessions (user_id, factor_id, aal) values ($1, $2, 'aal2') returning id`, [userId, factorId])
  await db.query(`insert into auth.refresh_tokens (token, user_id, session_id) values ('t', $1, $2)`, [userId, rows[0].id])
  return rows[0].id
}

async function setPassword(userId: string, password: string): Promise<void> {
  await db.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf', 4)) where id = $1`,
    [userId, password])
}

/** Signed in with the second factor; `codeAt` = when this session last verified a code (seconds). */
function withMfa(id: string, session: string, codeAt = now() - 3600): Actor {
  return { id, mfa: true, claims: { session_id: session, amr: [{ method: 'password', timestamp: now() - 7200 }, { method: 'totp', timestamp: codeAt }] } }
}

async function authorizeRemoval(actor: Actor, factor: string, password: string | null = null): Promise<Record<string, unknown>> {
  const [row] = await rowsAs<{ r: Record<string, unknown> }>(db, actor,
    `select public.authorize_mfa_removal($1, $2) as r`, [factor, password])
  return row.r
}

async function authorizeReset(actor: Actor, user: string, reason = 'Lost phone'): Promise<Record<string, unknown>> {
  const [row] = await rowsAs<{ r: Record<string, unknown> }>(db, actor, `select public.authorize_mfa_reset($1, $2) as r`, [user, reason])
  return row.r
}

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  await db.query(
    `insert into public.partnership (org_a, org_b, status, roles, dpa_reference)
     values ($1, $2, 'active', array['design'], 'DPA')`, [A.clinicId, B.clinicId])
}, 120_000)

describe('removing one\'s own authenticator', () => {
  it('needs a session signed in with the second factor', async () => {
    const f = await addFactor(A.workerId)
    expect(await errorAs(db, { id: A.workerId }, `select public.authorize_mfa_removal($1, null)`, [f]))
      .toMatch(/second factor first/)
  })

  it('needs proof given just now: no proof, a code from an hour ago, or a fresh code from ANOTHER authenticator are not enough', async () => {
    const u = await createUser(db)
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, u])
    const f1 = await addFactor(u, 'Phone')
    const f2 = await addFactor(u, 'Backup')
    const s = await newSession(u, f1)
    expect(await authorizeRemoval(withMfa(u, s), f2)).toEqual({ ok: false, error: 'proof_required' })
    expect(await authorizeRemoval(withMfa(u, s, now() - 3600), f1)).toEqual({ ok: false, error: 'proof_required' })
    // Fresh, but the session's factor is f1 and no challenge of f2 was verified.
    expect(await authorizeRemoval(withMfa(u, s, now()), f2)).toEqual({ ok: false, error: 'proof_required' })
  })

  it('a code from that authenticator just now: allowed, and says whether it is the last', async () => {
    const u = await createUser(db)
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, u])
    const f1 = await addFactor(u, 'Phone')
    const f2 = await addFactor(u, 'Backup')
    const s = await newSession(u, f2) // the app verified f2's code: GoTrue moved the session to f2
    const r = await authorizeRemoval(withMfa(u, s, now() - 10), f2)
    expect(r).toMatchObject({ ok: true, user_id: u, org_id: A.clinicId, factor_id: f2, name: 'Backup', how: 'code', last: false })
    // A verified challenge of the factor counts the same way.
    await db.query(`insert into auth.mfa_challenges (factor_id, verified_at) values ($1, now())`, [f1])
    expect(await authorizeRemoval(withMfa(u, s, now() - 10), f1)).toMatchObject({ ok: true, how: 'code' })

    await db.query(`delete from auth.mfa_factors where id = $1`, [f2])
    expect(await authorizeRemoval(withMfa(u, s, now() - 10), f1)).toMatchObject({ ok: true, last: true })
  })

  it('the password works instead; five wrong ones in 15 minutes lock it, even for the right one', async () => {
    const u = await createUser(db)
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, u])
    await setPassword(u, 'correct horse')
    const f = await addFactor(u)
    const s = await newSession(u, f)
    expect(await authorizeRemoval(withMfa(u, s), f, 'correct horse')).toMatchObject({ ok: true, how: 'password', last: true })
    for (let i = 0; i < 5; i++) {
      expect(await authorizeRemoval(withMfa(u, s), f, 'wrong')).toEqual({ ok: false, error: 'wrong_password' })
    }
    expect(await authorizeRemoval(withMfa(u, s), f, 'correct horse')).toEqual({ ok: false, error: 'too_many_attempts' })
    // The person sees their own attempts; nobody else does.
    expect(await rowsAs(db, { id: u }, `select 1 from public.mfa_attempt`)).toHaveLength(5)
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.mfa_attempt where user_id = $1`, [u])).toHaveLength(0)
  })

  it('an account without a password (Google) never matches one', async () => {
    const u = await createUser(db)
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, u])
    const f = await addFactor(u)
    const s = await newSession(u, f)
    expect(await authorizeRemoval(withMfa(u, s), f, '')).toEqual({ ok: false, error: 'proof_required' })
    expect(await authorizeRemoval(withMfa(u, s), f, 'anything')).toEqual({ ok: false, error: 'wrong_password' })
  })

  it('nobody removes someone else\'s authenticator: not the owner, not with a fresh code, not with their own password', async () => {
    const f = await addFactor(A.workerId)
    await setPassword(A.ownerId, 'owner pw')
    const s = await newSession(A.ownerId, f) // even a session pointing at it
    await db.query(`insert into auth.mfa_challenges (factor_id, verified_at) values ($1, now())`, [f])
    for (const pw of [null, 'owner pw']) {
      expect(await errorAs(db, withMfa(A.ownerId, s, now()), `select public.authorize_mfa_removal($1, $2)`, [f, pw]))
        .toMatch(/No such authenticator/)
    }
  })

  it('an unverified factor, or one that does not exist, is not on offer', async () => {
    const f = await addFactor(A.workerId, 'Half-done', 'unverified')
    const s = await newSession(A.workerId, null)
    expect(await errorAs(db, withMfa(A.workerId, s, now()), `select public.authorize_mfa_removal($1, null)`, [f]))
      .toMatch(/No such authenticator/)
    expect(await errorAs(db, withMfa(A.workerId, s, now()), `select public.authorize_mfa_removal(gen_random_uuid(), null)`))
      .toMatch(/No such authenticator/)
  })
})

describe('the owner\'s reset', () => {
  let member: string
  let secondOwner: string
  let admin: string
  let ownerSession: string

  beforeAll(async () => {
    member = await createUser(db, 'Mari Member')
    secondOwner = await createUser(db, 'Second Owner')
    admin = await createUser(db, 'Ann Admin')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'technician' where id = $2`, [A.clinicId, member])
    await db.query(`update public.profiles set clinic_id = $1, role = 'owner', org_role = 'owner' where id = $2`, [A.clinicId, secondOwner])
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'admin' where id = $2`, [A.clinicId, admin])
    await addFactor(member, 'Phone')
    await addFactor(member, 'Old', 'unverified')
    await addFactor(secondOwner)
    ownerSession = await newSession(A.ownerId, null)
  })

  it('an owner signed in with MFA, for a member of their own organisation, with a reason: every factor', async () => {
    const r = await authorizeReset(withMfa(A.ownerId, ownerSession), member, '  Lost phone  ')
    expect(r).toMatchObject({ ok: true, actor_id: A.ownerId, user_id: member, org_id: A.clinicId, name: 'Mari Member', reason: 'Lost phone' })
    expect(r.factor_ids).toHaveLength(2)
  })

  it('refused without MFA, without a reason, for oneself, for another owner', async () => {
    const reset = `select public.authorize_mfa_reset($1, $2)`
    expect(await errorAs(db, { id: A.ownerId }, reset, [member, 'Lost phone'])).toMatch(/second factor first/)
    expect(await errorAs(db, withMfa(A.ownerId, ownerSession), reset, [member, ' '])).toMatch(/Give a reason/)
    expect(await errorAs(db, withMfa(A.ownerId, ownerSession), reset, [member, null])).toMatch(/Give a reason/)
    expect(await errorAs(db, withMfa(A.ownerId, ownerSession), reset, [A.ownerId, 'Lost phone'])).toMatch(/Not for yourself/)
    expect(await errorAs(db, withMfa(A.ownerId, ownerSession), reset, [secondOwner, 'Lost phone'])).toMatch(/Another owner/)
    expect(await errorAs(db, withMfa(secondOwner, ownerSession), reset, [A.ownerId, 'Lost phone'])).toMatch(/Another owner/)
  })

  it('refused for anyone who is not the owner: a worker, an admin', async () => {
    const reset = `select public.authorize_mfa_reset($1, 'Lost phone')`
    expect(await errorAs(db, withMfa(A.workerId, ownerSession), reset, [member])).toMatch(/Only the owner/)
    expect(await errorAs(db, withMfa(admin, ownerSession), reset, [member])).toMatch(/Only the owner/)
  })

  it('refused for someone of another organisation, or someone removed from this one', async () => {
    const reset = `select public.authorize_mfa_reset($1, 'Lost phone')`
    const stranger = await createTenant(db, 'Vilnius')
    await addFactor(stranger.workerId)
    expect(await errorAs(db, withMfa(A.ownerId, ownerSession), reset, [stranger.workerId])).toMatch(/Not a member/)
    const gone = await createUser(db)
    await addFactor(gone)
    expect(await errorAs(db, withMfa(A.ownerId, ownerSession), reset, [gone])).toMatch(/Not a member/)
  })

  it('nothing to reset says so', async () => {
    const bare = await createUser(db)
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, bare])
    expect(await errorAs(db, withMfa(A.ownerId, ownerSession), `select public.authorize_mfa_reset($1, 'Lost phone')`, [bare]))
      .toMatch(/no authenticator/)
  })
})

describe('the record, the bell, the sign-out', () => {
  it('only the service key can complete a change; the helpers are not callable at all', async () => {
    for (const fn of [
      'complete_mfa_change(text, uuid, uuid, uuid, jsonb, boolean)', 'mfa_code_fresh(uuid)', 'mfa_password_ok(text)', 'require_own_mfa()',
    ]) {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await db.query<{ ok: boolean }>(`select has_function_privilege($1, 'public.${fn}', 'execute') as ok`, [role])
        expect(rows[0].ok, `${role} → ${fn}`).toBe(false)
      }
    }
    expect(await errorAs(db, { id: A.ownerId, mfa: true },
      `select public.complete_mfa_change('mfa_reset', $1, $2, $3, '{}', true)`, [A.clinicId, A.ownerId, A.workerId]))
      .toMatch(/permission denied/)
    // The browser cannot read GoTrue's tables either.
    expect(await errorAs(db, { id: A.workerId, mfa: true }, `select * from auth.mfa_factors`)).toMatch(/permission denied/)
    expect(await errorAs(db, { id: A.workerId, mfa: true }, `delete from auth.sessions`)).toMatch(/permission denied/)
  })

  it('a reset: audit row in the organisation, the member\'s bell, every session and phone gone', async () => {
    const m = await createUser(db, 'Kai Kask')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, m])
    await newSession(m, null)
    await newSession(m, null)
    const other = await newSession(A.workerId, null)
    await db.query(`insert into public.push_subscription (org_id, user_id, endpoint, p256dh, auth) values ($1, $2, 'https://fcm.googleapis.com/fcm/send/kai', 'k', 'a')`,
      [A.clinicId, m])

    await db.query(`select public.complete_mfa_change('mfa_reset', $1, $2, $3, $4, true)`,
      [A.clinicId, A.ownerId, m, JSON.stringify({ reason: 'Lost phone', factor_ids: ['x'] })])

    const audit = await rowsAs<{ action: string; user_name: string; object: string; detail: Record<string, unknown> }>(db, { id: A.ownerId },
      `select action, user_name, object, detail from public.audit_entries(10, 'mfa_reset', null)`)
    expect(audit[0]).toMatchObject({ action: 'mfa_reset', user_name: 'Tallinn owner', object: `user:${m}`,
      detail: { reason: 'Lost phone', target_name: 'Kai Kask', signed_out: true } })
    const bell = await rowsAs<{ kind: string; detail: Record<string, unknown> }>(db, { id: m }, `select kind, detail from public.notification`)
    expect(bell).toEqual([{ kind: 'mfa_reset', detail: { by: 'Tallinn owner', reason: 'Lost phone', signed_out: true } }])
    expect((await db.query(`select 1 from auth.sessions where user_id = $1`, [m])).rows).toHaveLength(0)
    expect((await db.query(`select 1 from auth.refresh_tokens where user_id = $1`, [m])).rows).toHaveLength(0)
    expect((await db.query(`select 1 from public.push_subscription where user_id = $1`, [m])).rows).toHaveLength(0)
    expect((await db.query(`select 1 from auth.sessions where id = $1`, [other])).rows).toHaveLength(1)
  })

  it('removing one of two: recorded and told, nobody signed out', async () => {
    const m = await createUser(db, 'Liis Lepp')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, m])
    await newSession(m, null)
    await db.query(`select public.complete_mfa_change('mfa_removed', $1, $2, $2, $3, false)`,
      [A.clinicId, m, JSON.stringify({ name: 'Backup', how: 'code', last: false })])
    const bell = await rowsAs<{ kind: string; detail: Record<string, unknown> }>(db, { id: m }, `select kind, detail from public.notification`)
    expect(bell).toEqual([{ kind: 'mfa_removed', detail: { name: 'Backup', signed_out: false } }])
    expect((await db.query(`select 1 from auth.sessions where user_id = $1`, [m])).rows).toHaveLength(1)
  })

  it('refuses a target or actor outside the organisation, and an unknown kind', async () => {
    const call = `select public.complete_mfa_change($1, $2, $3, $4, '{}', false)`
    await expect(db.query(call, ['mfa_reset', A.clinicId, A.ownerId, B.workerId])).rejects.toThrow(/Not a member/)
    await expect(db.query(call, ['mfa_reset', A.clinicId, B.ownerId, A.workerId])).rejects.toThrow(/actor is not a member/)
    await expect(db.query(call, ['stage_move', A.clinicId, A.ownerId, A.workerId])).rejects.toThrow(/Unknown change/)
  })

  it('adding: each verified authenticator logged once, only one\'s own', async () => {
    const m = await createUser(db, 'Mart Mets')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, m])
    const f = await addFactor(m, 'Phone')
    await addFactor(m, 'Half-done', 'unverified')
    expect((await rowsAs<{ n: number }>(db, { id: m, mfa: true }, `select public.record_mfa_factors() as n`))[0].n).toBe(1)
    expect((await rowsAs<{ n: number }>(db, { id: m, mfa: true }, `select public.record_mfa_factors() as n`))[0].n).toBe(0)
    const rows = (await db.query<{ user_id: string; detail: Record<string, unknown> }>(
      `select user_id, detail from public.audit_log where action = 'mfa_added' and object = $1`, [`user:${m}`])).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: m, detail: { factor_id: f, name: 'Phone' } })
  })
})

describe('a partner can do none of it', () => {
  it('reset, remove, complete, record: refused or empty for the partner\'s owner and worker', async () => {
    const member = await createUser(db, 'Shared Job Person')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, member])
    const f = await addFactor(member)
    const s = await newSession(B.ownerId, f)
    await db.query(`insert into auth.mfa_challenges (factor_id, verified_at) values ($1, now())`, [f])
    await setPassword(B.ownerId, 'partner pw')

    for (const p of [B.ownerId, B.workerId]) {
      const actor = withMfa(p, s, now())
      expect(await errorAs(db, actor, `select public.authorize_mfa_reset($1, 'Because')`, [member])).toMatch(/Not a member|Only the owner/)
      expect(await errorAs(db, actor, `select public.authorize_mfa_removal($1, 'partner pw')`, [f])).toMatch(/No such authenticator/)
      expect(await errorAs(db, actor, `select public.complete_mfa_change('mfa_reset', $1, $2, $3, '{}', true)`, [A.clinicId, p, member]))
        .toMatch(/permission denied/)
      await rowsAs(db, actor, `select public.record_mfa_factors()`)
    }
    expect((await db.query(`select 1 from public.audit_log where detail ->> 'factor_id' = $1`, [f])).rows).toHaveLength(0)
    expect((await db.query(`select 1 from auth.mfa_factors where id = $1`, [f])).rows).toHaveLength(1)
  })

  it('sees none of the organisation\'s security records: audit, bell, phones, attempts', async () => {
    const m = await createUser(db, 'Private Person')
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, m])
    await db.query(`insert into public.push_subscription (org_id, user_id, endpoint, p256dh, auth, user_agent) values ($1, $2, 'https://fcm.googleapis.com/fcm/send/pp', 'k', 'a', 'iPhone')`,
      [A.clinicId, m])
    await db.query(`insert into public.mfa_attempt (org_id, user_id) values ($1, $2)`, [A.clinicId, m])
    await db.query(`select public.complete_mfa_change('mfa_reset', $1, $2, $3, '{"reason": "Partner must not see"}', false)`,
      [A.clinicId, A.ownerId, m])

    for (const p of [B.ownerId, B.workerId]) {
      const actor: Actor = { id: p, mfa: true }
      expect(await rowsAs(db, actor, `select 1 from public.audit_log where org_id = $1 and action like 'mfa_%'`, [A.clinicId])).toEqual([])
      expect(await rowsAs(db, actor, `select 1 from public.notification where user_id = $1`, [m])).toEqual([])
      expect(await rowsAs(db, actor, `select 1 from public.push_subscription where user_id = $1`, [m])).toEqual([])
      expect(await rowsAs(db, actor, `select 1 from public.mfa_attempt where user_id = $1`, [m])).toEqual([])
    }
    const partnerAudit = await rowsAs<{ detail: unknown }>(db, { id: B.ownerId, mfa: true },
      `select detail from public.audit_entries(1000, null, null)`)
    expect(JSON.stringify(partnerAudit)).not.toContain('Partner must not see')
  })
})
