/**
 * The Edge Function `team-account` (teamAccount.ts): the caller check, that
 * an account is made only after the database said yes, the stand-in address,
 * the e-mails, and that nothing personal reaches the logs.
 */
import { describe, it, expect, vi } from 'vitest'
import { handleTeamRequest, parseTeamRequest, appOrigin, confirmLink, scrub, type TeamAccountDeps } from './teamAccount'
import { mayMail } from './mailAllow'

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (payload: object) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`

const NOW = 1_800_000_000_000
const ME = '11111111-1111-4111-8111-111111111111'
const NEW = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'a'.repeat(48)
const AUTH = `Bearer ${jwt({ sub: ME, role: 'authenticated', aal: 'aal2', exp: NOW / 1000 + 600 })}`
const ENV: Record<string, string> = {
  RESEND_API_KEY: 're_test', NOTIFY_FROM: 'Wivo <no-reply@mail.wivodent.com>', APP_LINK: 'https://app.wivodent.com/job/{id}',
}

interface Opts {
  mfa?: boolean
  owner?: boolean
  env?: Record<string, string>
  team?: { id: string; login: string; has_email: boolean; invite_pending: boolean }[]
  linkError?: string
  createError?: string
  mailOk?: boolean
  currentEmail?: string
  code?: string | null
}

function setup(o: Opts = {}) {
  const calls = { links: [] as unknown[], created: [] as unknown[], mails: [] as { to: string; subject: string; text: string }[], rpc: [] as string[] }
  const warn = vi.fn()
  const deps: TeamAccountDeps = {
    asUser: async (fn) => {
      calls.rpc.push(fn)
      if (fn === 'create_worker_invite') {
        return o.owner === false
          ? { data: null, error: { message: 'Only a clinic owner can add workers', code: '42501' } }
          : { data: TOKEN, error: null }
      }
      if (fn === 'team_accounts') {
        return o.owner === false
          ? { data: null, error: { message: 'Only the clinic\'s owner can see this', code: '42501' } }
          : { data: o.team ?? [{ id: NEW, login: 'mari@kliinik.ee', has_email: true, invite_pending: true }], error: null }
      }
      return { data: null, error: { message: 'unknown' } }
    },
    hasMfa: async () => o.mfa !== false,
    callerClinic: async () => ({ name: 'Hambalabor OÜ', code: o.code === undefined ? 'TAL' : o.code }),
    generateLink: async (p) => {
      calls.links.push(p)
      return o.linkError ? { hashedToken: null, userId: null, error: o.linkError } : { hashedToken: 'hashed+token/1', userId: NEW, error: null }
    },
    createUser: async (p) => {
      calls.created.push(p)
      return o.createError ? { userId: null, error: o.createError } : { userId: NEW, error: null }
    },
    userEmail: async () => o.currentEmail ?? 'tehnik.tal@nomail.wivodent.com',
    sendMail: async (m) => { calls.mails.push(m); return o.mailOk === false ? { ok: false, error: 'resend 500 for mari@kliinik.ee' } : { ok: true } },
    env: name => ({ ...ENV, ...o.env })[name],
    warn,
    now: () => NOW,
  }
  return { deps, calls, warn }
}

const invite = { action: 'invite', email: 'Mari@Kliinik.ee', fullName: 'Mari Maasikas', language: 'et' }
const login = { action: 'create_login', username: 'Tehnik', fullName: 'Tehnik Üks', password: 'secret-123', language: 'en' }

describe('the caller', () => {
  it('needs a signed-in user\'s token, not a key or nothing', async () => {
    const { deps, calls } = setup()
    for (const auth of [null, 'Bearer sb_secret_x', `Bearer ${jwt({ role: 'service_role', exp: NOW / 1000 + 60 })}`,
                        `Bearer ${jwt({ sub: ME, role: 'authenticated', exp: NOW / 1000 - 1 })}`]) {
      expect((await handleTeamRequest(auth, invite, deps)).status).toBe(401)
    }
    expect(calls.links).toEqual([])
  })

  it('needs the second factor', async () => {
    const { deps, calls } = setup({ mfa: false })
    expect(await handleTeamRequest(AUTH, invite, deps)).toEqual({ status: 403, body: { ok: false, error: 'mfa_required' } })
    expect(calls.links).toEqual([])
    expect(calls.created).toEqual([])
  })

  it('a non-owner is refused by the database, and nothing is made', async () => {
    const { deps, calls } = setup({ owner: false })
    expect((await handleTeamRequest(AUTH, invite, deps)).body).toEqual({ ok: false, error: 'not_allowed' })
    expect((await handleTeamRequest(AUTH, login, deps)).body).toEqual({ ok: false, error: 'not_allowed' })
    expect(calls.links).toEqual([])
    expect(calls.created).toEqual([])
  })
})

describe('invite: a real e-mail', () => {
  it('creates the account with the owner\'s token and mails Wivo\'s own link, in the person\'s language', async () => {
    const { deps, calls } = setup()
    expect(await handleTeamRequest(AUTH, invite, deps)).toEqual({ status: 200, body: { ok: true, userId: NEW } })
    expect(calls.links).toEqual([{ type: 'invite', email: 'mari@kliinik.ee',
      data: { full_name: 'Mari Maasikas', language: 'et', invite_token: TOKEN } }])
    expect(calls.mails).toHaveLength(1)
    const m = calls.mails[0]
    expect(m.to).toBe('mari@kliinik.ee')
    expect(m.subject).toBe('Hambalabor OÜ kutsub sind Wivosse')
    expect(m.text).toContain('https://app.wivodent.com/auth/confirm?type=invite&token_hash=hashed%2Btoken%2F1&lang=et')
  })

  it('an address that already has an account', async () => {
    const { deps, calls } = setup({ linkError: 'A user with this email address has already been registered' })
    expect(await handleTeamRequest(AUTH, invite, deps)).toEqual({ status: 409, body: { ok: false, error: 'email_taken' } })
    expect(calls.mails).toEqual([])
  })

  it('an address whose open invite is another clinic\'s: not mailed', async () => {
    const { deps, calls } = setup({ team: [] })
    expect((await handleTeamRequest(AUTH, invite, deps)).body).toEqual({ ok: false, error: 'email_taken' })
    expect(calls.mails).toEqual([])
  })

  it('without the mail settings nothing is made', async () => {
    const { deps, calls } = setup({ env: { RESEND_API_KEY: '' } })
    expect((await handleTeamRequest(AUTH, invite, deps)).body).toEqual({ ok: false, error: 'mail_not_set_up' })
    expect(calls.links).toEqual([])
  })

  it('on the test copy, only the allowed addresses', async () => {
    const { deps, calls } = setup({ env: { EMAIL_ALLOW_ONLY: '@wivodent.com, fullgevity@' } })
    expect((await handleTeamRequest(AUTH, invite, deps)).body).toEqual({ ok: false, error: 'not_allowed_here' })
    expect(calls.links).toEqual([])
    expect(calls.rpc).toEqual([])
    expect((await handleTeamRequest(AUTH, { ...invite, email: 'fullgevity@gmail.com' }, deps)).status).toBe(200)
  })

  it('the e-mail failing: the account stays, the owner can send again', async () => {
    const { deps, warn } = setup({ mailOk: false })
    expect(await handleTeamRequest(AUTH, invite, deps)).toEqual({ status: 502, body: { ok: false, error: 'mail_failed', userId: NEW } })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('mari@')
  })
})

describe('create_login: without e-mail', () => {
  it('a confirmed stand-in at the clinic\'s code, with the token and the username', async () => {
    const { deps, calls } = setup()
    expect(await handleTeamRequest(AUTH, login, deps)).toEqual({ status: 200, body: { ok: true, userId: NEW, login: 'tehnik@tal' } })
    expect(calls.created).toEqual([{
      email: 'tehnik.tal@nomail.wivodent.com', password: 'secret-123', emailConfirm: true,
      data: { full_name: 'Tehnik Üks', username: 'tehnik', language: 'en', invite_token: TOKEN },
    }])
    expect(calls.mails).toEqual([])
  })

  it('another instance\'s stand-in domain', async () => {
    const { deps, calls } = setup({ env: { STANDIN_DOMAIN: 'nomail.example.org' } })
    await handleTeamRequest(AUTH, login, deps)
    expect((calls.created[0] as { email: string }).email).toBe('tehnik.tal@nomail.example.org')
  })

  it('a name already taken in the clinic, a weak password, a clinic without a code', async () => {
    expect((await handleTeamRequest(AUTH, login, setup({ createError: 'A user with this email address has already been registered' }).deps)).body)
      .toEqual({ ok: false, error: 'username_taken' })
    expect((await handleTeamRequest(AUTH, login, setup({ createError: 'Password should be at least 10 characters' }).deps)).body)
      .toEqual({ ok: false, error: 'weak_password' })
    const noCode = setup({ code: null })
    expect((await handleTeamRequest(AUTH, login, noCode.deps)).body).toEqual({ ok: false, error: 'not_allowed' })
    expect(noCode.calls.created).toEqual([])
  })

  it('needs no mail settings', async () => {
    const { deps } = setup({ env: { RESEND_API_KEY: '' } })
    expect((await handleTeamRequest(AUTH, login, deps)).status).toBe(200)
  })
})

describe('resend', () => {
  it('only to a member of the owner\'s clinic whose invite is still open', async () => {
    const ok = setup()
    expect((await handleTeamRequest(AUTH, { action: 'resend', userId: NEW, language: 'en' }, ok.deps)).status).toBe(200)
    expect(ok.calls.links).toEqual([{ type: 'invite', email: 'mari@kliinik.ee' }])
    expect(ok.calls.mails[0].to).toBe('mari@kliinik.ee')

    const other = setup({ team: [] })
    expect((await handleTeamRequest(AUTH, { action: 'resend', userId: NEW }, other.deps)).body).toEqual({ ok: false, error: 'not_allowed' })
    const accepted = setup({ team: [{ id: NEW, login: 'mari@kliinik.ee', has_email: true, invite_pending: false }] })
    expect((await handleTeamRequest(AUTH, { action: 'resend', userId: NEW }, accepted.deps)).body).toEqual({ ok: false, error: 'not_pending' })
    const notOwner = setup({ owner: false })
    expect((await handleTeamRequest(AUTH, { action: 'resend', userId: NEW }, notOwner.deps)).body).toEqual({ ok: false, error: 'not_allowed' })
    for (const s of [other, accepted, notOwner]) expect(s.calls.mails).toEqual([])
  })
})

describe('add_email: a real address replaces one\'s own stand-in', () => {
  it('a link for the new address only, mailed there', async () => {
    const { deps, calls } = setup()
    expect(await handleTeamRequest(AUTH, { action: 'add_email', email: 'Tehnik@Gmail.com', language: 'ru' }, deps))
      .toEqual({ status: 200, body: { ok: true } })
    expect(calls.links).toEqual([{ type: 'email_change_new', email: 'tehnik.tal@nomail.wivodent.com', newEmail: 'tehnik@gmail.com' }])
    expect(calls.mails[0].to).toBe('tehnik@gmail.com')
    expect(calls.mails[0].text).toContain('/auth/confirm?type=email_change&token_hash=')
    expect(calls.mails[0].subject).toMatch(/Wivo/)
  })

  it('an old example.com stand-in too', async () => {
    const { deps } = setup({ currentEmail: 'tehnik@example.com' })
    expect((await handleTeamRequest(AUTH, { action: 'add_email', email: 'tehnik@gmail.com' }, deps)).status).toBe(200)
  })

  it('someone who already has a real address uses the normal change', async () => {
    const { deps, calls } = setup({ currentEmail: 'mari@kliinik.ee' })
    expect((await handleTeamRequest(AUTH, { action: 'add_email', email: 'uus@kliinik.ee' }, deps)).body).toEqual({ ok: false, error: 'has_email' })
    expect(calls.links).toEqual([])
  })

  it('an address someone else has', async () => {
    const { deps, calls } = setup({ linkError: 'email_exists' })
    expect((await handleTeamRequest(AUTH, { action: 'add_email', email: 'taken@kliinik.ee' }, deps)).body).toEqual({ ok: false, error: 'email_taken' })
    expect(calls.mails).toEqual([])
  })
})

describe('requests', () => {
  it('junk is refused before anything runs', async () => {
    for (const body of [null, {}, { action: 'invite', email: 'no-at', fullName: 'X' }, { action: 'invite', email: 'x@example.com', fullName: 'X' },
                        { action: 'invite', email: 'a@b.ee', fullName: 'x'.repeat(121) },
                        { action: 'create_login', username: 'ü', fullName: 'X', password: 'secret-123' },
                        { action: 'create_login', username: 'tehnik', fullName: 'X', password: '123' },
                        { action: 'resend', userId: 'nope' }, { action: 'add_email', email: 'a@nomail.wivodent.com' }, { action: 'drop' }]) {
      expect(parseTeamRequest(body)).toBeNull()
    }
    const { deps, calls } = setup()
    expect((await handleTeamRequest(AUTH, { action: 'drop' }, deps)).status).toBe(400)
    expect(calls.rpc).toEqual([])
  })

  it('an unknown language is English', () => {
    expect(parseTeamRequest({ ...invite, language: 'de' })).toMatchObject({ language: 'en' })
  })
})

describe('helpers', () => {
  it('the app\'s address from APP_LINK, and the confirm link', () => {
    expect(appOrigin('https://wivo-test.pages.dev/job/{id}')).toBe('https://wivo-test.pages.dev')
    expect(appOrigin(undefined)).toBeNull()
    expect(appOrigin('not a url')).toBeNull()
    expect(confirmLink('https://x.dev', 'invite', 'a b', 'ru')).toBe('https://x.dev/auth/confirm?type=invite&token_hash=a%20b&lang=ru')
  })

  it('logs never carry an address', () => {
    expect(scrub('Email address "mari@kliinik.ee" is invalid')).toBe('Email address "<address>" is invalid')
  })

  it('EMAIL_ALLOW_ONLY', () => {
    expect(mayMail('anyone@x.ee', undefined)).toBe(true)
    expect(mayMail('anyone@x.ee', ' ')).toBe(true)
    const allow = '@wivodent.com, fullgevity@, kevin@example.org'
    expect(mayMail('a@wivodent.com', allow)).toBe(true)
    expect(mayMail('Fullgevity@gmail.com', allow)).toBe(true)
    expect(mayMail('kevin@example.org', allow)).toBe(true)
    expect(mayMail('mari@kliinik.ee', allow)).toBe(false)
    expect(mayMail('a@evilwivodent.com', allow)).toBe(false)
  })
})
