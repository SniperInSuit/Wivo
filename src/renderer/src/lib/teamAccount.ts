/**
 * Accounts are made on the server (docs/ACCOUNTS.md): the Edge Function
 * `team-account` checks that the caller is the clinic's owner with the second
 * factor, and only then creates the account. The browser never signs anyone up.
 */
import { supabase } from './supabase'
import { t, lang, type Lang } from '@/lib/i18n'
import type { MessageKey } from '@shared/i18n'

export type TeamErrorCode =
  | 'sign_in' | 'bad_request' | 'mfa_required' | 'not_allowed' | 'not_allowed_here' | 'mail_not_set_up'
  | 'email_taken' | 'username_taken' | 'weak_password' | 'not_pending' | 'has_email' | 'mail_failed' | 'failed'
  /** Ours, not the server's: no answer within TEAM_CALL_TIMEOUT_MS. */
  | 'no_answer'

export class TeamAccountError extends Error {
  constructor(readonly code: TeamErrorCode, readonly userId?: string) { super(code) }
}

const MESSAGE: Record<TeamErrorCode, MessageKey> = {
  sign_in: 'team.errorSignIn',
  bad_request: 'team.errorBadRequest',
  mfa_required: 'team.errorMfa',
  not_allowed: 'team.errorNotAllowed',
  not_allowed_here: 'team.errorNotAllowedHere',
  mail_not_set_up: 'team.errorMailNotSetUp',
  email_taken: 'team.errorEmailTaken',
  username_taken: 'team.errorUsernameTaken',
  weak_password: 'team.errorWeakPassword',
  not_pending: 'team.errorNotPending',
  has_email: 'team.errorHasEmail',
  mail_failed: 'team.errorMailFailed',
  failed: 'team.errorFailed',
  no_answer: 'team.errorNoAnswer',
}

/** What to tell the person, for any error from these calls. */
export function teamErrorMessage(e: unknown): string {
  if (e instanceof TeamAccountError) return t(MESSAGE[e.code])
  return (e as Error)?.message || t('team.errorFailed')
}

export type Language = Lang

/**
 * How long one call may take before the app stops waiting. A cold start of
 * the Edge Function takes seconds; this is far beyond that and its e-mail,
 * so only a call that will not answer is given up. The server may still
 * finish it, which is what the message then says.
 */
export const TEAM_CALL_TIMEOUT_MS = 90_000

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('team-account', { body, timeout: TEAM_CALL_TIMEOUT_MS })
  if (error) {
    if ((error as { context?: { name?: string } }).context?.name === 'AbortError') throw new TeamAccountError('no_answer')
    // A non-2xx answer: the function's own body says why.
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context
    const answer = (await context?.json?.().catch(() => null)) as { error?: TeamErrorCode; userId?: string } | null
    throw answer?.error && answer.error in MESSAGE ? new TeamAccountError(answer.error, answer.userId) : error
  }
  const d = data as { ok?: boolean } & T
  if (!d?.ok) throw new TeamAccountError('failed')
  return d
}

/** The owner: a real e-mail gets an invite link, in the person's language. */
export function inviteMember(p: { email: string; fullName: string; language: Language }): Promise<{ userId: string }> {
  return call({ action: 'invite', ...p })
}

/** The owner: a login without e-mail. `login` is what the person types: `tehnik@tal`. */
export function createLogin(p: { username: string; fullName: string; password: string; language: Language }): Promise<{ userId: string; login: string }> {
  return call({ action: 'create_login', ...p })
}

/** The owner: the invite again, while it has not been accepted. */
export function resendInvite(userId: string, language: Language): Promise<{ userId: string }> {
  return call({ action: 'resend', userId, language })
}

/** Oneself: a real e-mail replaces one's stand-in, once the link in that mailbox is opened. */
export function addOwnEmail(email: string): Promise<unknown> {
  return call({ action: 'add_email', email, language: lang })
}

export interface TeamAccount {
  id: string
  login: string
  has_email: boolean
  invite_pending: boolean
  /** A verified authenticator (sql/112); missing on a database without it. */
  has_authenticator?: boolean
}

/**
 * The owner's view of how each member signs in (sql/100, 111, 112). An older
 * database has no such function: empty. Any other failure: null, and the
 * Team page says so rather than showing everyone as a username account.
 */
export async function teamAccounts(): Promise<Map<string, TeamAccount> | null> {
  const { data, error } = await supabase.rpc('team_accounts')
  if (error) return error.code === 'PGRST202' ? new Map() : null
  return new Map(((data ?? []) as TeamAccount[]).map(r => [r.id, r]))
}

export interface AccountBadge { label: MessageKey; ok: boolean }

/**
 * The Team page's badges for one member: the invite (e-mail accounts only),
 * then the authenticator. Nothing for what is not known: no account details,
 * or a database without sql/112.
 */
export function accountBadges(account: TeamAccount | undefined): AccountBadge[] {
  if (!account) return []
  const badges: AccountBadge[] = []
  if (account.has_email) {
    badges.push(account.invite_pending ? { label: 'team.invitePending', ok: false } : { label: 'team.verified', ok: true })
  }
  if (typeof account.has_authenticator === 'boolean') {
    badges.push(account.has_authenticator ? { label: 'team.authenticator', ok: true } : { label: 'team.noAuthenticator', ok: false })
  }
  return badges
}

/**
 * How the member signs in, under their name: the address, or the username
 * said to be one (`tehnik@tal` alone reads like a broken address). Without
 * account details, `fallback`.
 */
export function signInLine(account: TeamAccount | undefined, fallback: string): string {
  if (!account) return fallback
  return account.has_email ? account.login : t('team.usernameLogin', { login: account.login })
}
