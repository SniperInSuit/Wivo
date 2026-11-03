/**
 * Two-factor sign-in with an authenticator app (spec: "TOTP — Google
 * Authenticator, Microsoft Authenticator or a password manager. No SMS.";
 * Phase 1: "MFA for all users").
 *
 * Supabase does the cryptography. This file decides what the user has to do
 * next, and wraps the four calls the gate makes. The decision is a pure
 * function so it can be tested without a server.
 */
import { supabase } from './supabase'

export type MfaStep =
  | 'ok'        // signed in with a second factor (aal2)
  | 'verify'    // has an authenticator; must enter its code
  | 'enroll'    // has none; must add one before the app opens
  | 'disabled'  // the project has no TOTP: let them in, and say so

export interface Assurance {
  currentLevel: string | null
  nextLevel: string | null
}

/**
 * - aal2 now → nothing to do.
 * - aal2 possible (a verified factor exists) → enter the code.
 * - otherwise → enrol, unless the project cannot do TOTP at all.
 */
export function nextMfaStep(a: Assurance, totpAvailable: boolean): MfaStep {
  if (a.currentLevel === 'aal2') return 'ok'
  if (a.nextLevel === 'aal2') return 'verify'
  return totpAvailable ? 'enroll' : 'disabled'
}

export async function assurance(): Promise<Assurance> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  return { currentLevel: data.currentLevel, nextLevel: data.nextLevel }
}

/** The verified authenticator to challenge, if there is one. */
export async function verifiedTotp(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  return data.totp.find(f => f.status === 'verified')?.id ?? null
}

export interface Enrollment {
  factorId: string
  /** An SVG data URL to scan. */
  qrCode: string
  /** The same secret as text, for a password manager or a phone that cannot scan. */
  secret: string
  /** The otpauth:// link: on a phone, it opens the authenticator app directly. */
  uri: string
}

/**
 * Starts adding an authenticator. Leftover unverified factors from an
 * abandoned attempt are removed first: Supabase refuses a second factor with
 * the same friendly name, and the user would be stuck. A backup added in
 * Settings → Security needs a name of its own for the same reason.
 */
export async function startEnrollment(friendlyName = 'Wivo'): Promise<Enrollment | 'disabled'> {
  const { data: list } = await supabase.auth.mfa.listFactors()
  for (const f of list?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
  }
  // The issuer is the name the authenticator app shows next to the code. Left
  // out, it is the project's site address, which nobody would recognise.
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName, issuer: 'Wivo' })
  if (error) {
    // The project has MFA (TOTP) switched off: enrolment cannot work for
    // anyone, so the gate must not lock everybody out.
    if (/disabled|not enabled|mfa_totp_enroll_not_enabled/i.test(`${error.code ?? ''} ${error.message}`)) return 'disabled'
    throw error
  }
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri }
}

/** Checks a 6-digit code; on success the session becomes aal2. */
export async function verifyCode(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') })
  if (error) throw error
}

/** The apps the setup screen explains, step by step. */
export type AuthApp = 'google' | 'microsoft' | 'apple'

/** The app to explain first: an iPhone already has Passwords. */
export function defaultAuthApp(userAgent: string): AuthApp {
  return /iPhone|iPad|iPod/.test(userAgent) ? 'apple' : 'google'
}

/** The setup key in groups of four, the way the apps print it, so it can be typed. */
export function groupKey(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')
}

/** A wrong or expired code, as opposed to a server that could not answer. */
export function isWrongCode(e: unknown): boolean {
  const { code, message } = (e ?? {}) as { code?: unknown; message?: unknown }
  return code === 'mfa_verification_failed' || code === 'mfa_challenge_expired'
    || /invalid totp/i.test(typeof message === 'string' ? message : '')
}

/**
 * The server has ended this session: an owner's reset, the last authenticator
 * removed, "sign out on all other devices". The database stops answering such a
 * session at once (sql/098); this is how the app notices, from GoTrue's answer
 * to `getUser()`. A network failure has no status and is not this.
 */
export function isSessionGone(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const { status, code } = e as { status?: number; code?: string }
  return status === 401 || status === 403 || code === 'session_not_found'
}
