/**
 * `<app>/auth/confirm?type=…&token_hash=…`: the link in Wivo's invite, password
 * and e-mail-change e-mails (docs/ACCOUNTS.md). The token is used only when
 * the person presses Continue, never on page load: mail scanners that open
 * links in advance would otherwise use it up.
 */
export type ConfirmType = 'invite' | 'recovery' | 'email_change'

export const CONFIRM_PATH = '/auth/confirm'

/** A new password: at least this long (the Supabase project's minimum may be higher). */
export const MIN_PASSWORD = 10

export function isConfirmPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === CONFIRM_PATH
}

export function parseConfirm(search: string): { type: ConfirmType; tokenHash: string } | null {
  const q = new URLSearchParams(search)
  const type = q.get('type')
  const tokenHash = q.get('token_hash')?.trim()
  if (!tokenHash || tokenHash.length > 512) return null
  return type === 'invite' || type === 'recovery' || type === 'email_change' ? { type, tokenHash } : null
}

/** The language the e-mail was written in, if the link says. */
export function linkLanguage(search: string): 'en' | 'et' | 'ru' | null {
  const l = new URLSearchParams(search).get('lang')
  return l === 'en' || l === 'et' || l === 'ru' ? l : null
}

/** GoTrue's answer for a link that was used already or has run out. */
export function isLinkDead(e: unknown): boolean {
  const err = e as { status?: number; code?: string; message?: string } | null
  return err?.code === 'otp_expired' || err?.status === 403 || /expired|invalid/i.test(err?.message ?? '')
}

export type PasswordProblem = 'tooShort' | 'differ'

export function passwordProblem(password: string, again: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD) return 'tooShort'
  return password === again ? null : 'differ'
}
