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
}

/**
 * Starts adding an authenticator. Leftover unverified factors from an
 * abandoned attempt are removed first: Supabase refuses a second factor with
 * the same friendly name, and the user would be stuck.
 */
export async function startEnrollment(): Promise<Enrollment | 'disabled'> {
  const { data: list } = await supabase.auth.mfa.listFactors()
  for (const f of list?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Wivo' })
  if (error) {
    // The project has MFA (TOTP) switched off: enrolment cannot work for
    // anyone, so the gate must not lock everybody out.
    if (/disabled|not enabled|mfa_totp_enroll_not_enabled/i.test(`${error.code ?? ''} ${error.message}`)) return 'disabled'
    throw error
  }
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

/** Checks a 6-digit code; on success the session becomes aal2. */
export async function verifyCode(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') })
  if (error) throw error
}
