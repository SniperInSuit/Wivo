/**
 * The Edge Function `account-security` (accountSecurity.ts): the caller
 * check, and that nothing is removed unless the database said yes — about
 * this caller, this factor, this member.
 */
import { describe, it, expect, vi } from 'vitest'
import { handleSecurityRequest, userTokenSubject, parseRequest, type SecurityDeps, type Rpc } from './accountSecurity'

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (payload: object) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`

const NOW = 1_800_000_000_000
const ME = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const F1 = '44444444-4444-4444-8444-444444444444'
const F2 = '55555555-5555-4555-8555-555555555555'
const USER_TOKEN = `Bearer ${jwt({ sub: ME, role: 'authenticated', aal: 'aal2', exp: NOW / 1000 + 600 })}`

function deps(user: Record<string, { data?: unknown; error?: { message: string; code?: string; hint?: string } }>, opts: { failDelete?: string[]; failComplete?: boolean } = {}) {
  const calls: { service: [string, Record<string, unknown>][]; deleted: [string, string][]; user: string[] } = { service: [], deleted: [], user: [] }
  const asUser: Rpc = async (fn) => { calls.user.push(fn); const r = user[fn] ?? {}; return { data: r.data ?? null, error: r.error ?? null } }
  const d: SecurityDeps = {
    asUser,
    asService: async (fn, args) => { calls.service.push([fn, args]); return { data: null, error: opts.failComplete ? { message: 'db down' } : null } },
    deleteFactor: async (u, f) => {
      if (opts.failDelete?.includes(f)) return { error: { message: 'gotrue said no' } }
      calls.deleted.push([u, f]); return { error: null }
    },
    warn: vi.fn(),
    now: () => NOW,
  }
  return { d, calls }
}

describe('the caller check', () => {
  it('a signed-in user\'s token, not expired: their id', () => {
    expect(userTokenSubject(USER_TOKEN, NOW)).toBe(ME)
  })

  it('refuses keys, an expired token, no user, junk, a malformed header', () => {
    const tokens = [
      jwt({ role: 'anon', exp: NOW / 1000 + 600 }),
      jwt({ role: 'service_role', exp: NOW / 1000 + 600 }),
      jwt({ sub: ME, role: 'service_role', exp: NOW / 1000 + 600 }),
      jwt({ sub: ME, role: 'authenticated', exp: NOW / 1000 - 1 }),
      jwt({ sub: ME, role: 'authenticated' }),
      jwt({ sub: 'not-a-uuid', role: 'authenticated', exp: NOW / 1000 + 600 }),
      'sb_secret_0123456789abcdef', 'sb_publishable_0123456789abcdef', 'a.b', 'x',
    ]
    for (const t of tokens) expect(userTokenSubject(`Bearer ${t}`, NOW), t).toBeNull()
    for (const h of [null, '', USER_TOKEN.slice(7), `bearer ${USER_TOKEN.slice(7)}`, `${USER_TOKEN} x`]) {
      expect(userTokenSubject(h, NOW)).toBeNull()
    }
  })

  it('nothing is asked of the database without a user token', async () => {
    const { d, calls } = deps({})
    const a = await handleSecurityRequest(`Bearer ${jwt({ role: 'service_role', exp: NOW / 1000 + 600 })}`, { action: 'remove', factorId: F1 }, d)
    expect(a).toEqual({ status: 401, body: { ok: false, error: 'sign_in' } })
    expect(calls.user).toEqual([])
  })
})

describe('parseRequest', () => {
  it('takes the two actions, with ids and bounded text', () => {
    expect(parseRequest({ action: 'remove', factorId: F1 })).toEqual({ action: 'remove', factorId: F1, password: null })
    expect(parseRequest({ action: 'remove', factorId: F1, password: 'pw' })).toEqual({ action: 'remove', factorId: F1, password: 'pw' })
    expect(parseRequest({ action: 'reset', userId: MEMBER, reason: 'Lost phone' })).toEqual({ action: 'reset', userId: MEMBER, reason: 'Lost phone' })
  })

  it('refuses anything else', () => {
    for (const b of [null, 'x', {}, { action: 'remove' }, { action: 'remove', factorId: 'x' }, { action: 'remove', factorId: F1, password: 5 },
      { action: 'remove', factorId: F1, password: 'p'.repeat(201) }, { action: 'reset', userId: MEMBER }, { action: 'reset', userId: MEMBER, reason: 'r'.repeat(501) },
      { action: 'delete_user', userId: MEMBER }]) {
      expect(parseRequest(b)).toBeNull()
    }
  })
})

describe('remove', () => {
  const allowed = (last: boolean) => ({ authorize_mfa_removal: { data: { ok: true, user_id: ME, org_id: ORG, factor_id: F1, name: 'Phone', how: 'code', last } } })

  it('the database says yes: removed, recorded; the last one signs out everywhere', async () => {
    const { d, calls } = deps(allowed(true))
    const a = await handleSecurityRequest(USER_TOKEN, { action: 'remove', factorId: F1 }, d)
    expect(a).toEqual({ status: 200, body: { ok: true, last: true, signedOut: true, removed: 1 } })
    expect(calls.deleted).toEqual([[ME, F1]])
    expect(calls.service).toEqual([['complete_mfa_change', {
      p_kind: 'mfa_removed', p_org: ORG, p_actor: ME, p_target: ME,
      p_detail: { factor_id: F1, name: 'Phone', how: 'code', last: true }, p_sign_out: true,
    }]])
  })

  it('one of two: nobody signed out', async () => {
    const { d, calls } = deps(allowed(false))
    expect((await handleSecurityRequest(USER_TOKEN, { action: 'remove', factorId: F1 }, d)).body).toMatchObject({ ok: true, signedOut: false })
    expect(calls.service[0][1].p_sign_out).toBe(false)
  })

  it('a refusal removes nothing: proof, password, lock, aal1, someone else\'s factor', async () => {
    const cases: [Record<string, { data?: unknown; error?: { message: string; code?: string; hint?: string } }>, number, string][] = [
      [{ authorize_mfa_removal: { data: { ok: false, error: 'proof_required' } } }, 403, 'proof_required'],
      [{ authorize_mfa_removal: { data: { ok: false, error: 'wrong_password' } } }, 403, 'wrong_password'],
      [{ authorize_mfa_removal: { data: { ok: false, error: 'too_many_attempts' } } }, 429, 'too_many_attempts'],
      [{ authorize_mfa_removal: { error: { message: 'Sign in with your second factor first', code: '42501', hint: 'mfa_required' } } }, 403, 'mfa_required'],
      [{ authorize_mfa_removal: { error: { message: 'No such authenticator on your account', code: '42501' } } }, 403, 'not_allowed'],
      [{ authorize_mfa_removal: { error: { message: 'JWT expired', code: 'PGRST301' } } }, 401, 'sign_in'],
    ]
    for (const [user, status, error] of cases) {
      const { d, calls } = deps(user)
      const a = await handleSecurityRequest(USER_TOKEN, { action: 'remove', factorId: F1, password: 'pw' }, d)
      expect(a.status).toBe(status)
      expect(a.body).toMatchObject({ ok: false, error })
      expect(calls.deleted).toEqual([])
      expect(calls.service).toEqual([])
    }
  })

  it('an answer about another user or another factor is not acted on', async () => {
    for (const data of [
      { ok: true, user_id: MEMBER, org_id: ORG, factor_id: F1, last: false },
      { ok: true, user_id: ME, org_id: ORG, factor_id: F2, last: false },
      { ok: true, user_id: ME, org_id: 'x', factor_id: F1, last: false },
      { ok: true, user_id: ME, org_id: ORG, factor_id: F1 },
      { ok: 'yes' },
    ]) {
      const { d, calls } = deps({ authorize_mfa_removal: { data } })
      expect((await handleSecurityRequest(USER_TOKEN, { action: 'remove', factorId: F1 }, d)).body).toEqual({ ok: false, error: 'not_allowed' })
      expect(calls.deleted).toEqual([])
    }
  })

  it('GoTrue refuses: nothing recorded; the record fails: said so', async () => {
    const a = deps(allowed(false), { failDelete: [F1] })
    expect((await handleSecurityRequest(USER_TOKEN, { action: 'remove', factorId: F1 }, a.d)).status).toBe(502)
    expect(a.calls.service).toEqual([])
    const b = deps(allowed(false), { failComplete: true })
    expect((await handleSecurityRequest(USER_TOKEN, { action: 'remove', factorId: F1 }, b.d)).body).toMatchObject({ ok: false, error: 'not_recorded' })
    expect(b.d.warn).toHaveBeenCalled()
  })
})

describe('reset', () => {
  const allowed = { authorize_mfa_reset: { data: { ok: true, actor_id: ME, user_id: MEMBER, org_id: ORG, name: 'Mari', factor_ids: [F1, F2], reason: 'Lost phone' } } }

  it('the database says yes: every factor removed, recorded, signed out everywhere', async () => {
    const { d, calls } = deps(allowed)
    const a = await handleSecurityRequest(USER_TOKEN, { action: 'reset', userId: MEMBER, reason: ' Lost phone ' }, d)
    expect(a).toEqual({ status: 200, body: { ok: true, last: true, signedOut: true, removed: 2 } })
    expect(calls.deleted).toEqual([[MEMBER, F1], [MEMBER, F2]])
    expect(calls.service).toEqual([['complete_mfa_change', {
      p_kind: 'mfa_reset', p_org: ORG, p_actor: ME, p_target: MEMBER,
      p_detail: { reason: 'Lost phone', factor_ids: [F1, F2], factors: 2 }, p_sign_out: true,
    }]])
  })

  it('refused by the database: nothing removed (not the owner, another owner, a partner, no MFA, no reason)', async () => {
    for (const [error, code] of [
      [{ message: 'Only the owner can reset two-factor sign-in', code: '42501' }, 'not_allowed'],
      [{ message: 'Another owner\'s two-factor sign-in cannot be reset', code: '42501' }, 'not_allowed'],
      [{ message: 'Not a member of your organisation', code: '42501' }, 'not_allowed'],
      [{ message: 'Sign in with your second factor first', code: '42501', hint: 'mfa_required' }, 'mfa_required'],
      [{ message: 'Give a reason (3 to 500 characters)', code: '22023' }, 'bad_request'],
      [{ message: 'They have no authenticator', code: '22023', hint: 'nothing_to_reset' }, 'nothing_to_reset'],
    ] as const) {
      const { d, calls } = deps({ authorize_mfa_reset: { error } })
      expect((await handleSecurityRequest(USER_TOKEN, { action: 'reset', userId: MEMBER, reason: 'x' }, d)).body).toMatchObject({ ok: false, error: code })
      expect(calls.deleted).toEqual([])
      expect(calls.service).toEqual([])
    }
  })

  it('an answer for another member, another actor, oneself, or with junk ids is not acted on', async () => {
    const base = allowed.authorize_mfa_reset.data
    for (const data of [
      { ...base, user_id: ME }, { ...base, actor_id: MEMBER }, { ...base, factor_ids: [] }, { ...base, factor_ids: [F1, 'x'] },
      { ...base, org_id: null }, { ...base, ok: false },
    ]) {
      const { d, calls } = deps({ authorize_mfa_reset: { data } })
      expect((await handleSecurityRequest(USER_TOKEN, { action: 'reset', userId: MEMBER, reason: 'Lost phone' }, d)).body).toEqual({ ok: false, error: 'not_allowed' })
      expect(calls.deleted).toEqual([])
    }
  })

  it('one factor removed, the next refused: what was removed is recorded and the member signed out', async () => {
    const { d, calls } = deps(allowed, { failDelete: [F2] })
    const a = await handleSecurityRequest(USER_TOKEN, { action: 'reset', userId: MEMBER, reason: 'Lost phone' }, d)
    expect(a.status).toBe(502)
    expect(calls.service[0][1]).toMatchObject({ p_detail: { factor_ids: [F1], factors: 1 }, p_sign_out: true })
  })
})
