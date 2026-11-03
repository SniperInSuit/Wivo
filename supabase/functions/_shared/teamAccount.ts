/**
 * The Edge Function `team-account` (docs/ACCOUNTS.md): accounts are made on
 * the server, never with the public sign-up.
 *
 *   { action: 'invite', email, fullName, language }        owner: a real e-mail gets an invite link
 *   { action: 'create_login', username, fullName, password, language }
 *                                                          owner: a login without e-mail (a stand-in)
 *   { action: 'resend', userId, language }                 owner: the invite again, while not accepted
 *   { action: 'add_email', email, language }               oneself: a real e-mail replaces one's stand-in
 *
 * The caller check, as in `account-security`:
 *  1. A signed-in user's access token, not a key (userTokenSubject).
 *  2. The second factor in a session that still exists (has_mfa, sql/098).
 *  3. For the owner's actions, the database decides: `create_worker_invite`
 *     answers only an owner of a clinic, and its one-time token is what puts
 *     the new person into THAT clinic (handle_new_user, sql/086/100).
 * Only then does the service key create the account (GoTrue's admin API).
 *
 * The e-mails are Wivo's own (Resend), in the person's language, with Wivo's
 * own link: `<app>/auth/confirm?type=…&token_hash=…`. Nothing here logs an
 * address, a password, a token or a link.
 */
import { userTokenSubject, type Rpc } from './accountSecurity.ts'
import { mayMail } from './mailAllow.ts'
import {
  STANDIN_DOMAIN, isStandinEmail, normaliseClinicCode, normaliseUsername, standinAddress, standinLogin,
} from './generated/loginAddress.ts'

export type Lang = 'en' | 'et' | 'ru'

export interface LinkResult { hashedToken: string | null; userId: string | null; error: string | null }

export interface TeamAccountDeps {
  /** As the caller: their token, the anon key. */
  asUser: Rpc
  /** sql/098 has_mfa(), asked as the caller. */
  hasMfa: () => Promise<boolean>
  /** The caller's own organisation, read as the caller. */
  callerClinic: (caller: string) => Promise<{ name: string; code: string | null } | null>
  /** GoTrue admin generateLink. */
  generateLink: (p:
    | { type: 'invite'; email: string; data?: Record<string, unknown> }
    | { type: 'email_change_new'; email: string; newEmail: string }) => Promise<LinkResult>
  /** GoTrue admin createUser. */
  createUser: (p: { email: string; password: string; emailConfirm: true; data: Record<string, unknown> }) =>
    Promise<{ userId: string | null; error: string | null }>
  /** GoTrue admin getUserById: the current address. */
  userEmail: (userId: string) => Promise<string | null>
  /** Resend. */
  sendMail: (m: { to: string; subject: string; text: string }) => Promise<{ ok: boolean; error?: string }>
  env: (name: string) => string | undefined
  warn: (message: string) => void
  now?: () => number
}

export type ErrorCode =
  | 'sign_in' | 'bad_request' | 'mfa_required' | 'not_allowed' | 'not_allowed_here' | 'mail_not_set_up'
  | 'email_taken' | 'username_taken' | 'weak_password' | 'not_pending' | 'has_email' | 'mail_failed' | 'failed'

export interface Answer {
  status: number
  body: { ok: true; userId?: string; login?: string } | { ok: false; error: ErrorCode; userId?: string }
}

export type TeamRequest =
  | { action: 'invite'; email: string; fullName: string; language: Lang }
  | { action: 'create_login'; username: string; fullName: string; password: string; language: Lang }
  | { action: 'resend'; userId: string; language: Lang }
  | { action: 'add_email'; email: string; language: Lang }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Good enough to refuse junk; GoTrue has the last word. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const lang = (v: unknown): Lang => (v === 'et' || v === 'ru' ? v : 'en')
const name = (v: unknown): string | null => typeof v === 'string' && v.trim().length <= 120 ? v.trim() : null
const realEmail = (v: unknown): string | null =>
  typeof v === 'string' && v.length <= 254 && EMAIL.test(v.trim()) && !isStandinEmail(v) ? v.trim().toLowerCase() : null

export function parseTeamRequest(body: unknown): TeamRequest | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const language = lang(b.language)
  if (b.action === 'invite') {
    const email = realEmail(b.email); const fullName = name(b.fullName)
    return email && fullName !== null ? { action: 'invite', email, fullName, language } : null
  }
  if (b.action === 'create_login') {
    const username = typeof b.username === 'string' ? normaliseUsername(b.username) : null
    const fullName = name(b.fullName)
    const password = typeof b.password === 'string' && b.password.length >= 6 && b.password.length <= 200 ? b.password : null
    return username && fullName !== null && password ? { action: 'create_login', username, fullName, password, language } : null
  }
  if (b.action === 'resend' && typeof b.userId === 'string' && UUID.test(b.userId)) {
    return { action: 'resend', userId: b.userId.toLowerCase(), language }
  }
  if (b.action === 'add_email') {
    const email = realEmail(b.email)
    return email ? { action: 'add_email', email, language } : null
  }
  return null
}

const fail = (status: number, error: ErrorCode, userId?: string): Answer =>
  ({ status, body: userId ? { ok: false, error, userId } : { ok: false, error } })

/** A refusal from the database, as the app should hear it. */
function refusal(e: { message: string; code?: string; hint?: string }): Answer {
  if (e.code?.startsWith('PGRST3') || /JWT/i.test(e.message)) return fail(401, 'sign_in')
  if (e.hint === 'mfa_required') return fail(403, 'mfa_required')
  return fail(403, 'not_allowed')
}

/** For logs: GoTrue's messages can quote the address. */
export const scrub = (text: string): string => text.replace(/[^\s@"'<>]+@[^\s@"'<>]+/g, '<address>').slice(0, 200)

/** GoTrue's words for "that address already has an account". */
const TAKEN = /already (been )?registered|already exists|email_exists|duplicate/i

// ── The e-mails ─────────────────────────────────────────────────────────────

const INVITE: Record<Lang, { subject: string; text: string }> = {
  en: {
    subject: '{clinic} invites you to Wivo',
    text: '{clinic} has added you to Wivo.\n\nOpen this link to set your password and your sign-in code. It works once, for 24 hours:\n{link}\n\nThen sign in to Wivo with this e-mail address.\n\nIf you were not expecting this, ignore this e-mail.\n',
  },
  et: {
    subject: '{clinic} kutsub sind Wivosse',
    text: '{clinic} lisas sind Wivosse.\n\nAva see link, et määrata oma parool ja sisselogimiskood. See töötab ühe korra, 24 tundi:\n{link}\n\nSeejärel logi Wivosse sisse selle e-posti aadressiga.\n\nKui sa seda ei oodanud, jäta see kiri tähelepanuta.\n',
  },
  ru: {
    subject: '{clinic} приглашает вас в Wivo',
    text: '{clinic} добавил(а) вас в Wivo.\n\nОткройте эту ссылку, чтобы задать пароль и код для входа. Она работает один раз, 24 часа:\n{link}\n\nЗатем войдите в Wivo с этим адресом электронной почты.\n\nЕсли вы этого не ожидали, просто проигнорируйте это письмо.\n',
  },
}

const ADD_EMAIL: Record<Lang, { subject: string; text: string }> = {
  en: {
    subject: 'Confirm your e-mail address for Wivo',
    text: 'Open this link to sign in to Wivo with this address from now on. It works once, for 24 hours:\n{link}\n\nIf you did not ask for this, ignore this e-mail: nothing changes.\n',
  },
  et: {
    subject: 'Kinnita oma e-posti aadress Wivo jaoks',
    text: 'Ava see link, et logida edaspidi Wivosse sisse selle aadressiga. See töötab ühe korra, 24 tundi:\n{link}\n\nKui sa seda ei küsinud, jäta see kiri tähelepanuta: midagi ei muutu.\n',
  },
  ru: {
    subject: 'Подтвердите адрес электронной почты для Wivo',
    text: 'Откройте эту ссылку, чтобы впредь входить в Wivo с этим адресом. Она работает один раз, 24 часа:\n{link}\n\nЕсли вы этого не запрашивали, проигнорируйте письмо: ничего не изменится.\n',
  },
}

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m)

/** The phone app's address: APP_LINK is `<site>/job/{id}` (send-notifications), its origin is the site. */
export function appOrigin(appLink: string | undefined): string | null {
  try { return appLink ? new URL(appLink.replace('{id}', 'x')).origin : null } catch { return null }
}

/** The page opens in the person's language on a device where nobody chose one. */
export function confirmLink(origin: string, type: 'invite' | 'email_change', hashedToken: string, language: Lang): string {
  return `${origin}/auth/confirm?type=${type}&token_hash=${encodeURIComponent(hashedToken)}&lang=${language}`
}

// ── The requests ────────────────────────────────────────────────────────────

export async function handleTeamRequest(authorization: string | null, body: unknown, deps: TeamAccountDeps): Promise<Answer> {
  const caller = userTokenSubject(authorization, (deps.now ?? Date.now)())
  if (!caller) return fail(401, 'sign_in')
  const req = parseTeamRequest(body)
  if (!req) return fail(400, 'bad_request')
  if (!(await deps.hasMfa())) return fail(403, 'mfa_required')
  switch (req.action) {
    case 'invite': return invite(caller, req, deps)
    case 'create_login': return createLogin(caller, req, deps)
    case 'resend': return resend(caller, req, deps)
    case 'add_email': return addEmail(caller, req, deps)
  }
}

/** Mail can go out at all, and to this address on this project. */
function mailCheck(to: string, deps: TeamAccountDeps): Answer | null {
  if (!deps.env('RESEND_API_KEY') || !deps.env('NOTIFY_FROM') || !appOrigin(deps.env('APP_LINK'))) return fail(503, 'mail_not_set_up')
  if (!mayMail(to, deps.env('EMAIL_ALLOW_ONLY'))) return fail(403, 'not_allowed_here')
  return null
}

/** The owner's one-time token for their clinic, or the database's refusal. */
async function ownerToken(deps: TeamAccountDeps): Promise<{ token: string } | Answer> {
  const { data, error } = await deps.asUser('create_worker_invite', {})
  if (error) return refusal(error)
  if (typeof data !== 'string' || data.length < 32) {
    deps.warn('create_worker_invite: unexpected answer')
    return fail(403, 'not_allowed')
  }
  return { token: data }
}

async function invite(caller: string, req: Extract<TeamRequest, { action: 'invite' }>, deps: TeamAccountDeps): Promise<Answer> {
  const blocked = mailCheck(req.email, deps)
  if (blocked) return blocked
  const owner = await ownerToken(deps)
  if ('status' in owner) return owner
  const clinic = await deps.callerClinic(caller)
  if (!clinic) return fail(403, 'not_allowed')

  const link = await deps.generateLink({
    type: 'invite', email: req.email,
    data: { full_name: req.fullName, language: req.language, invite_token: owner.token },
  })
  if (link.error) {
    if (TAKEN.test(link.error)) return fail(409, 'email_taken')
    deps.warn(`invite: generateLink failed: ${scrub(link.error)}`)
    return fail(502, 'failed')
  }
  if (!link.hashedToken || !link.userId) return fail(502, 'failed')
  // An address with an invite still open elsewhere is not made again: GoTrue
  // re-invites the existing account, which the token did not move. Mail only
  // someone who is now in the caller's clinic.
  const joined = await member(link.userId, deps)
  if (!joined || 'status' in joined) return fail(409, 'email_taken')
  return mailInvite(req.email, clinic.name, req.language, link.hashedToken, link.userId, deps)
}

async function mailInvite(to: string, clinic: string, language: Lang, hashedToken: string, userId: string, deps: TeamAccountDeps): Promise<Answer> {
  const t = INVITE[language]
  const url = confirmLink(appOrigin(deps.env('APP_LINK'))!, 'invite', hashedToken, language)
  const sent = await deps.sendMail({ to, subject: fill(t.subject, { clinic }), text: fill(t.text, { clinic, link: url }) })
  if (!sent.ok) {
    // The account is made and in the clinic; "Send again" retries the e-mail.
    deps.warn(`invite: e-mail not sent: ${scrub(sent.error ?? '')}`)
    return fail(502, 'mail_failed', userId)
  }
  return { status: 200, body: { ok: true, userId } }
}

async function createLogin(caller: string, req: Extract<TeamRequest, { action: 'create_login' }>, deps: TeamAccountDeps): Promise<Answer> {
  const owner = await ownerToken(deps)
  if ('status' in owner) return owner
  const clinic = await deps.callerClinic(caller)
  const code = normaliseClinicCode(clinic?.code)
  if (!clinic || !code) {
    deps.warn('create_login: the clinic has no usable code')
    return fail(403, 'not_allowed')
  }
  const domain = deps.env('STANDIN_DOMAIN')?.trim() || STANDIN_DOMAIN
  const made = await deps.createUser({
    email: standinAddress(req.username, code, domain), password: req.password, emailConfirm: true,
    data: { full_name: req.fullName, username: req.username, language: req.language, invite_token: owner.token },
  })
  if (made.error) {
    if (TAKEN.test(made.error)) return fail(409, 'username_taken')
    if (/password/i.test(made.error)) return fail(400, 'weak_password')
    deps.warn(`create_login: createUser failed: ${scrub(made.error)}`)
    return fail(502, 'failed')
  }
  if (!made.userId) return fail(502, 'failed')
  return { status: 200, body: { ok: true, userId: made.userId, login: standinLogin(req.username, code) } }
}

interface TeamRow { id: string; login: string; has_email: boolean; invite_pending: boolean }

/** A member of the caller's clinic, as the database tells the owner (sql/100 team_accounts). */
async function member(userId: string, deps: TeamAccountDeps): Promise<TeamRow | Answer | null> {
  const { data, error } = await deps.asUser('team_accounts', {})
  if (error) return refusal(error)
  return ((data ?? []) as TeamRow[]).find(r => r.id === userId) ?? null
}

async function resend(caller: string, req: Extract<TeamRequest, { action: 'resend' }>, deps: TeamAccountDeps): Promise<Answer> {
  const found = await member(req.userId, deps)
  if (!found) return fail(403, 'not_allowed')
  if ('status' in found) return found
  if (!found.has_email || !found.invite_pending) return fail(409, 'not_pending')
  const blocked = mailCheck(found.login, deps)
  if (blocked) return blocked
  const clinic = await deps.callerClinic(caller)
  if (!clinic) return fail(403, 'not_allowed')

  const link = await deps.generateLink({ type: 'invite', email: found.login })
  if (link.error || !link.hashedToken) {
    deps.warn(`resend: generateLink failed: ${scrub(link.error ?? 'no token')}`)
    return fail(502, 'failed')
  }
  return mailInvite(found.login, clinic.name, req.language, link.hashedToken, req.userId, deps)
}

async function addEmail(caller: string, req: Extract<TeamRequest, { action: 'add_email' }>, deps: TeamAccountDeps): Promise<Answer> {
  const current = await deps.userEmail(caller)
  if (!current) return fail(403, 'not_allowed')
  // Someone with a real address changes it the normal way: secure e-mail
  // change asks both addresses. Only a stand-in, which can receive nothing, comes here.
  if (!isStandinEmail(current, deps.env('STANDIN_DOMAIN')?.trim() || STANDIN_DOMAIN)) return fail(409, 'has_email')
  const blocked = mailCheck(req.email, deps)
  if (blocked) return blocked

  const link = await deps.generateLink({ type: 'email_change_new', email: current, newEmail: req.email })
  if (link.error) {
    if (TAKEN.test(link.error)) return fail(409, 'email_taken')
    deps.warn(`add_email: generateLink failed: ${scrub(link.error)}`)
    return fail(502, 'failed')
  }
  if (!link.hashedToken) return fail(502, 'failed')
  const t = ADD_EMAIL[req.language]
  const url = confirmLink(appOrigin(deps.env('APP_LINK'))!, 'email_change', link.hashedToken, req.language)
  const sent = await deps.sendMail({ to: req.email, subject: t.subject, text: fill(t.text, { link: url }) })
  if (!sent.ok) {
    deps.warn(`add_email: e-mail not sent: ${scrub(sent.error ?? '')}`)
    return fail(502, 'mail_failed')
  }
  return { status: 200, body: { ok: true } }
}
