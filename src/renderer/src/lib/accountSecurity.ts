/**
 * Settings → Security (sql/097): one's own authenticators and phones, and the
 * owner's reset of a member's two-factor sign-in.
 *
 * Listing and adding authenticators is Supabase's own client API. Removing
 * one, and the owner's reset, go through the Edge Function
 * `account-security`: the database decides as the signed-in person, and only
 * the function holds the admin rights to act. The phones are this person's
 * own `push_subscription` rows (RLS: only their own).
 */
import { supabase } from './supabase'
import { verifyCode, isWrongCode } from './mfa'
import { describeError } from '../components/Patients/errors'
import { t } from '@/lib/i18n'

export interface Authenticator { id: string; name: string; createdAt: string }

/** The verified authenticators of the signed-in person, oldest first. */
export async function listAuthenticators(): Promise<Authenticator[]> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  return data.totp
    .filter(f => f.status === 'verified')
    .map(f => ({ id: f.id, name: f.friendly_name ?? '', createdAt: f.created_at }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** A name no authenticator of theirs has yet: Supabase refuses a duplicate. */
export function backupName(existing: string[]): string {
  const taken = new Set(existing.map(n => n.trim().toLowerCase()))
  for (let i = 2; ; i++) if (!taken.has(`wivo ${i}`)) return `Wivo ${i}`
}

/** Logs each new authenticator in the organisation's audit log (once each; the database reads the real list). */
export async function recordAuthenticators(): Promise<void> {
  await supabase.rpc('record_mfa_factors')
}

// ── Through the Edge Function ───────────────────────────────────────────────

export type SecurityErrorCode =
  | 'sign_in' | 'bad_request' | 'mfa_required' | 'not_allowed' | 'proof_required' | 'wrong_password'
  | 'too_many_attempts' | 'nothing_to_reset' | 'failed' | 'not_recorded' | 'wrong_code'

export class SecurityError extends Error {
  constructor(readonly code: SecurityErrorCode, message?: string) { super(message ?? code) }
}

async function callFunction(body: Record<string, unknown>): Promise<{ last: boolean; removed: number }> {
  const { data, error } = await supabase.functions.invoke('account-security', { body })
  if (error) {
    // A non-2xx answer: the function's own body says why.
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context
    const answer = (await context?.json?.().catch(() => null)) as { error?: SecurityErrorCode; message?: string } | null
    throw answer?.error ? new SecurityError(answer.error, answer.message) : error
  }
  const d = data as { ok?: boolean; last?: boolean; removed?: number }
  if (!d?.ok) throw new SecurityError('failed')
  return { last: !!d.last, removed: d.removed ?? 0 }
}

export type RemovalProof = { code: string } | { password: string }

/**
 * Removes one of one's own authenticators. With a code, the code is first
 * verified with Supabase (the normal sign-in step); that is what the database
 * then checks, from the session itself.
 * `last`: it was the only one — every session has been ended.
 */
export async function removeAuthenticator(factorId: string, proof: RemovalProof): Promise<{ last: boolean }> {
  if ('code' in proof) {
    try { await verifyCode(factorId, proof.code) } catch (e) {
      throw isWrongCode(e) ? new SecurityError('wrong_code') : e
    }
    return callFunction({ action: 'remove', factorId })
  }
  return callFunction({ action: 'remove', factorId, password: proof.password })
}

/** The owner: every authenticator of a member, and they are signed out everywhere. */
export async function resetMemberMfa(userId: string, reason: string): Promise<{ removed: number }> {
  return callFunction({ action: 'reset', userId, reason })
}

/** What to tell the person. */
export function securityErrorText(e: unknown): string {
  if (!(e instanceof SecurityError)) return describeError(e)
  switch (e.code) {
    case 'wrong_code': return t('mfa.wrongCode')
    case 'wrong_password': return t('security.wrongPassword')
    case 'too_many_attempts': return t('security.tooManyAttempts')
    case 'proof_required': return t('security.proofRequired')
    case 'mfa_required': return t('security.needMfa')
    case 'sign_in': return t('security.signInAgain')
    case 'nothing_to_reset': return t('security.nothingToReset')
    case 'not_recorded': return t('security.notRecorded')
    case 'bad_request': return e.message && e.message !== e.code ? e.message : t('security.failed')
    case 'not_allowed': return e.message && e.message !== e.code ? e.message : t('security.notAllowed')
    default: return t('security.failed')
  }
}

// ── Phones ──────────────────────────────────────────────────────────────────

export type DeviceKind = 'iphone' | 'ipad' | 'android' | 'mac' | 'windows' | 'linux' | 'other'

/** What kind of device a browser is, from its user agent, for a person to recognise it. */
export function describeDevice(userAgent: string | null): { kind: DeviceKind; browser: string | null } {
  const ua = userAgent ?? ''
  const kind: DeviceKind = /iPhone|iPod/.test(ua) ? 'iphone'
    : /iPad/.test(ua) ? 'ipad'
      : /Android/.test(ua) ? 'android'
        : /Macintosh|Mac OS X/.test(ua) ? 'mac'
          : /Windows/.test(ua) ? 'windows'
            : /Linux|CrOS/.test(ua) ? 'linux'
              : 'other'
  const browser = /EdgiOS|Edg\//.test(ua) ? 'Edge'
    : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
      : /CriOS|Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari'
          : null
  return { kind, browser }
}

export interface Phone {
  id: string
  kind: DeviceKind
  browser: string | null
  createdAt: string
  lastOkAt: string | null
  /** This browser's own subscription. */
  current: boolean
}

async function thisEndpoint(): Promise<string | null> {
  try {
    if (!('serviceWorker' in navigator)) return null
    const reg = await navigator.serviceWorker.getRegistration()
    return (await reg?.pushManager?.getSubscription())?.endpoint ?? null
  } catch {
    return null
  }
}

/** The phones (and browsers) that get this person's push notifications. */
export async function listPhones(): Promise<Phone[]> {
  const [{ data, error }, mine] = await Promise.all([
    supabase.from('push_subscription').select('id, endpoint, user_agent, created_at, last_ok_at').order('created_at'),
    thisEndpoint(),
  ])
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id as string,
    ...describeDevice(r.user_agent as string | null),
    createdAt: r.created_at as string,
    lastOkAt: (r.last_ok_at as string | null) ?? null,
    current: !!mine && r.endpoint === mine,
  }))
}

/** That phone stops getting this person's notifications. */
export async function removePhone(id: string): Promise<void> {
  const { error } = await supabase.from('push_subscription').delete().eq('id', id)
  if (error) throw error
}
