import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const invoke = vi.fn()
vi.mock('./supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}))
const { inviteMember, teamAccounts, accountBadges, signInLine, teamErrorMessage, TeamAccountError, TEAM_CALL_TIMEOUT_MS } = await import('./teamAccount')
const { t } = await import('@/lib/i18n')

const invite = { email: 'mari@kliinik.ee', fullName: 'Mari', language: 'et' as const }

describe('a call to team-account', () => {
  beforeEach(() => invoke.mockReset())

  it('waits far beyond a cold start, once', async () => {
    invoke.mockResolvedValue({ data: { ok: true, userId: 'u1' }, error: null })
    expect(await inviteMember(invite)).toEqual({ ok: true, userId: 'u1' })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0][1]).toMatchObject({ timeout: TEAM_CALL_TIMEOUT_MS })
    expect(TEAM_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
  })

  it('given up only when it does not answer: says to look before trying again', async () => {
    const abort = Object.assign(new Error('Failed to send a request to the Edge Function'), { context: { name: 'AbortError' } })
    invoke.mockResolvedValue({ data: null, error: abort })
    const e = await inviteMember(invite).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(TeamAccountError)
    expect((e as InstanceType<typeof TeamAccountError>).code).toBe('no_answer')
    expect(teamErrorMessage(e)).toMatch(/Team list|meeskonna nimekirja/)
  })

  it('the server\'s own answer is what the person hears', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ ok: false, error: 'failed' }) } } })
    expect(((await inviteMember(invite).catch((x: unknown) => x)) as InstanceType<typeof TeamAccountError>).code).toBe('failed')
  })
})

describe('how members sign in (team_accounts)', () => {
  beforeEach(() => rpc.mockReset())

  it('an older database without the function: nothing known, and nothing wrong', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    expect(await teamAccounts()).toEqual(new Map())
  })

  it('a failure is not "nobody has e-mail": null, so the Team page says it could not load', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42804', message: 'structure of query does not match function result type' } })
    expect(await teamAccounts()).toBeNull()
  })

  it('the answer, by member', async () => {
    const row = { id: 'u1', login: 'mari@kliinik.ee', has_email: true, invite_pending: true }
    rpc.mockResolvedValue({ data: [row], error: null })
    expect((await teamAccounts())?.get('u1')).toEqual(row)
  })
})

describe('the Team page\'s badges', () => {
  const account = { id: 'u1', login: 'mari@kliinik.ee', has_email: true, invite_pending: false, has_authenticator: true }
  const labels = (a?: Parameters<typeof accountBadges>[0]) => accountBadges(a).map(b => `${b.label} ${b.ok}`)

  it('an e-mail account: the invite, then the authenticator', () => {
    expect(labels(account)).toEqual(['team.verified true', 'team.authenticator true'])
    expect(labels({ ...account, invite_pending: true, has_authenticator: false }))
      .toEqual(['team.invitePending false', 'team.noAuthenticator false'])
  })

  it('a username account: only the authenticator', () => {
    expect(labels({ ...account, login: 'tehnik@tal', has_email: false })).toEqual(['team.authenticator true'])
    expect(labels({ ...account, login: 'tehnik@tal', has_email: false, has_authenticator: false })).toEqual(['team.noAuthenticator false'])
  })

  it('nothing that is not known: no details, or a database without sql/112', () => {
    expect(labels(undefined)).toEqual([])
    const { has_authenticator: _, ...older } = account
    expect(labels(older)).toEqual(['team.verified true'])
  })
})

describe('how a member signs in, under their name', () => {
  const account = { id: 'u1', login: 'mari@kliinik.ee', has_email: true, invite_pending: false }

  it('an e-mail account: the address', () => {
    expect(signInLine(account, 'mari')).toBe('mari@kliinik.ee')
  })

  it('a username account: said to be a username', () => {
    const line = signInLine({ ...account, login: 'tehnik@tal', has_email: false }, 'tehnik')
    expect(line).toBe(t('team.usernameLogin', { login: 'tehnik@tal' }))
    expect(line).toMatch(/^Kasutajanimi: tehnik@tal$/)
  })

  it('no account details: what the page had before', () => {
    expect(signInLine(undefined, 'tehnik')).toBe('tehnik')
  })
})
