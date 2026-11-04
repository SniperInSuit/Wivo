/**
 * "Forgot password?" on the sign-in screen. Only a real address can get a
 * link; a username account has no mailbox, and its password is set by the
 * clinic's administrator (Team). The answer never says whether an address
 * has an account.
 */
import { isStandinEmail, loginAddresses } from '@shared/auth/loginAddress'

export type ResetTarget =
  | { kind: 'email'; email: string }
  /** `tehnik`, `tehnik@tal` or a stand-in address: no mailbox. */
  | { kind: 'username' }
  | { kind: 'invalid' }

export function resetTarget(typed: string): ResetTarget {
  const text = typed.trim()
  if (!text) return { kind: 'invalid' }
  if (!text.includes('@')) return { kind: 'username' }
  if (isStandinEmail(text)) return { kind: 'username' }
  const [address] = loginAddresses(text)
  if (address === text) return { kind: 'email', email: text }
  return address ? { kind: 'username' } : { kind: 'invalid' }
}

export type ResetOutcome = 'sent' | 'too_often' | 'no_connection'

/**
 * What the person is told after asking for a link. Only an answer that
 * cannot depend on the account is told apart: Wivo was never reached, or
 * too many requests. Anything else, such as a failed e-mail, which only an
 * existing account can have, reads as sent.
 */
export function resetOutcome(error: { name?: string; message: string; status?: number } | null): ResetOutcome {
  if (!error) return 'sent'
  if (/rate limit/i.test(error.message)) return 'too_often'
  if (error.name === 'AuthRetryableFetchError' && !error.status) return 'no_connection'
  return 'sent'
}
