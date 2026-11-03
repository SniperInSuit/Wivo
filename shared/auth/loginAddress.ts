/**
 * Sign-in identities (docs/ACCOUNTS.md).
 *
 * Supabase Auth needs an e-mail address. A person without one gets a stand-in
 * that can never receive mail: `<username>.<clinic code>@nomail.wivodent.com`,
 * unique per clinic because the clinic's code is (sql/070). Accounts made
 * before that keep `<username>@example.com` and their plain login.
 *
 * What a person types:
 *   `mari@kliinik.ee`  an `@` with a dot after it      → that address
 *   `tehnik@tal`       an `@` with no dot after it     → the stand-in at TAL
 *   `tehnik`           no `@`                          → the stand-in at this
 *                      device's last clinic (if it remembers one), then the old
 *                      `tehnik@example.com`
 *
 * No imports: the app and the Edge Function `team-account` both load it.
 */

export const STANDIN_DOMAIN = 'nomail.wivodent.com'
/** The stand-in domain before docs/ACCOUNTS.md (sql/029). */
export const LEGACY_DOMAIN = 'example.com'
/** Every domain that has held stand-ins; none can receive mail (sql/099). */
const NO_MAIL_DOMAINS = [LEGACY_DOMAIN, 'wivo.invalid', 'wivo.local']

/** A new username: lower case, 2–32 of a–z 0–9 . _ -, starting with a letter or digit. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/
/** A clinic's code as it appears in a login: its job-code prefix, lower case (letters, then an optional digit). */
export const CLINIC_CODE_RE = /^[a-z]{1,9}[0-9]?$/

const domainOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase()

/** An address that can never receive mail: a stand-in on any domain Wivo has used. */
export function isStandinEmail(email: string | null | undefined, standinDomain = STANDIN_DOMAIN): boolean {
  if (!email || !email.includes('@')) return false
  const domain = domainOf(email)
  return domain === standinDomain.toLowerCase() || NO_MAIL_DOMAINS.includes(domain)
}

/** A typed username as stored, or null when it is not a valid new username. */
export function normaliseUsername(raw: string): string | null {
  const name = raw.trim().toLowerCase()
  return USERNAME_RE.test(name) ? name : null
}

/** A clinic code as used in logins (`TAL` → `tal`), or null. */
export function normaliseClinicCode(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim().toLowerCase()
  return CLINIC_CODE_RE.test(code) ? code : null
}

/** The stand-in address of `username` at the clinic with `code`. */
export function standinAddress(username: string, code: string, standinDomain = STANDIN_DOMAIN): string {
  return `${username}.${code}@${standinDomain}`
}

/** The login name a person types for a stand-in: `tehnik@tal`. */
export function standinLogin(username: string, code: string): string {
  return `${username}@${code}`
}

/** For display: `tehnik@tal` for a new stand-in, `tehnik` for an old one, else the address. */
export function loginNameOf(email: string, standinDomain = STANDIN_DOMAIN): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return email
  const local = email.slice(0, at)
  const domain = domainOf(email)
  if (domain === standinDomain.toLowerCase()) {
    const dot = local.lastIndexOf('.')
    return dot > 0 ? standinLogin(local.slice(0, dot), local.slice(dot + 1)) : local
  }
  return NO_MAIL_DOMAINS.includes(domain) ? local : email
}

export interface LoginOptions {
  /** The clinic code this device last signed in to, if any. */
  rememberedCode?: string | null
  standinDomain?: string
}

/**
 * The addresses to try, in order, for what a person typed at sign-in. Empty
 * when it cannot be an account at all.
 */
export function loginAddresses(typed: string, opts: LoginOptions = {}): string[] {
  const domain = opts.standinDomain ?? STANDIN_DOMAIN
  const text = typed.trim()
  if (!text) return []

  const at = text.lastIndexOf('@')
  if (at >= 0) {
    const after = text.slice(at + 1)
    if (after.includes('.')) return [text]                 // a real address
    const name = normaliseUsername(text.slice(0, at))
    const code = normaliseClinicCode(after)
    return name && code ? [standinAddress(name, code, domain)] : []
  }

  // No @: an old plain login, or a new one at this device's clinic. Old
  // usernames were stored with only spaces removed (sql/029), so that form stays.
  const legacy = text.toLowerCase().replace(/\s+/g, '')
  const name = normaliseUsername(legacy)
  const code = normaliseClinicCode(opts.rememberedCode)
  const legacyAddress = `${legacy}@${LEGACY_DOMAIN}`
  return name && code ? [standinAddress(name, code, domain), legacyAddress] : [legacyAddress]
}
