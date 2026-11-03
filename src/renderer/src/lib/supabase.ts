import { createClient } from '@supabase/supabase-js'
import { supabaseTarget } from './testCopy'
import type { Job } from '../types/job'
import type { Session, User, AuthChangeEvent } from '@supabase/supabase-js'
import { STANDIN_DOMAIN, loginAddresses, loginNameOf, normaliseClinicCode } from '@shared/auth/loginAddress'

// Read from .env — never hardcode these values. In test mode (`npm run
// dev:test`) from .env.test, and never production: lib/testCopy.
const target = supabaseTarget(
  import.meta.env.MODE,
  import.meta.env.VITE_SUPABASE_URL as string | undefined,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
)
const supabaseUrl = target.url
const supabaseAnonKey = target.key
/** Why test mode is not connected, if it is not (the banner says it). */
export const testCopyProblem = target.problem

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Copy .env.example → .env and fill in your project URL and anon key.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * For the resumable upload, which talks to Storage's TUS endpoint directly
 * (supabase-js has no TUS client). The anon key is public by design; the
 * user's access token is what Storage authorises against.
 */
export const storageEndpoint = (): string => `${supabaseUrl}/storage/v1/upload/resumable`
export const anonKey = (): string => supabaseAnonKey

// Typed table reference for IDE completion
export type JobRow = Job

// ── Auth helpers ──────────────────────────────────────────────────────────────

export type UserRole = 'owner' | 'worker' | 'patient'

export type Engagement = 'tootaja' | 'ettevote'

/** Kas kokkulepitud number on bruto- või netopalk. Vt sql/054. */
export type PayBasis = 'bruto' | 'neto'

export interface Profile {
  /** sql/075: e-mail for notifications. The in-app bell is always on. */
  notify_email?: boolean
  /** sql/095: push to this person's phones. */
  notify_push?: boolean
  /** sql/070. */
  org_role?: 'owner' | 'admin' | 'doctor' | 'technician' | 'assistant' | null
  language?: 'en' | 'et' | 'ru' | null
  id: string
  full_name: string
  role: UserRole
  // Palgal või esitab arve. Määrab, kas summa on brutopalk (millele lisanduvad
  // tööandja maksud) või ostuarve (mille maksud on esitaja enda asi).
  toosuhe?: Engagement
  /**
   * What this person's piece rates are multiplied by on a rush job. Null or 1
   * means the uplift is not shared with them.
   *
   * NOT `settings.kiirtooKordaja`: that one is the price the CUSTOMER pays for
   * a rush, and how much of it reaches the bench is a separate agreement with
   * each person. One field for both would have meant raising the rush price
   * quietly raised everyone's pay.
   */
  kiirtoo_kordaja?: number | null
  /**
   * Kas tasureeglite summad on bruto või neto. See on tööandja ja inimese
   * vaheline kokkulepe, mitte rakenduse eeldus: kes lepib kokku kättesaadava
   * summa, sisestab netot, ja bruto ning tööandja maksud arvutatakse sellest.
   *
   * Vaikimisi 'bruto' — see on see, mida senised numbrid juba eeldasid.
   */
  tasu_arvestus?: PayBasis
  /** II samba määr %. NULL = kliiniku vaikeväärtus, 0 = ei ole II sambas. */
  kogumispension_protsent?: number | null
  /** Maksuvaba tulu € kuus. NULL = kliiniku vaikeväärtus, 0 = ei rakendata. */
  maksuvaba_tulu?: number | null
  /**
   * Isiklikud vaateseaded — Statistika paneelid jm. Vt sql/055 ja lib/uiPrefs.
   *
   * `unknown` meelega: kuju kuulub `normaliseUiPrefs`-ile, mis peab lugema ka
   * seda, mille kirjutas uuem versioon. Siin tüübi kinni naelutamine tähendaks,
   * et vanem klient kustutab selle, mida ta ei tunne.
   */
  ui_prefs?: unknown
  /** Login name for accounts without a real mailbox. */
  username?: string | null
  clinic_id: string | null
  patient_id: string | null
  created_at: string
  updated_at: string
}

/**
 * Login identity: docs/ACCOUNTS.md, rules in shared/auth/loginAddress.ts.
 *
 * A real e-mail is the normal way. A person without one has a stand-in that
 * can never receive mail, `<username>.<clinic code>@nomail.wivodent.com`, and
 * types `tehnik@tal`, or just `tehnik` on a device that remembers the clinic.
 * Accounts made before that keep `<username>@example.com` and their plain
 * login. Stand-ins are made only on the server (Edge Function team-account).
 *
 * VITE_STANDIN_DOMAIN must match the function's STANDIN_DOMAIN (another
 * instance only); changing it after accounts exist orphans their logins.
 */
export const LOGIN_STANDIN_DOMAIN =
  (import.meta.env.VITE_STANDIN_DOMAIN as string | undefined)?.trim() || STANDIN_DOMAIN

const LOGIN_CODE_KEY = 'wivo.loginClinicCode'

/** The clinic this device last signed in to, so a username alone is enough here. */
export function rememberedClinicCode(): string | null {
  try { return normaliseClinicCode(localStorage.getItem(LOGIN_CODE_KEY)) } catch { return null }
}

export function rememberClinicCode(code: string | null | undefined): void {
  const c = normaliseClinicCode(code)
  if (!c) return
  try { localStorage.setItem(LOGIN_CODE_KEY, c) } catch { /* private mode: type the code */ }
}

/** How a person signs in, for display: `tehnik@tal`, an old `tehnik`, or the address. */
export function displayIdentity(email: string | null | undefined, username?: string | null): string {
  if (email) return loginNameOf(email, LOGIN_STANDIN_DOMAIN)
  return username?.trim() || '—'
}

/**
 * A real address, `username@code`, or a plain username (this device's clinic
 * first, then the old login). Each address is tried in turn while the answer
 * is "wrong password", so an old `tehnik` still works on a device that
 * remembers a clinic with its own `tehnik`.
 */
export async function signIn(identifier: string, password: string) {
  const tries = loginAddresses(identifier, { rememberedCode: rememberedClinicCode(), standinDomain: LOGIN_STANDIN_DOMAIN })
  if (tries.length === 0) return supabase.auth.signInWithPassword({ email: identifier.trim(), password })
  let result = await supabase.auth.signInWithPassword({ email: tries[0], password })
  for (const email of tries.slice(1)) {
    if (!result.error || !/Invalid login credentials/i.test(result.error.message)) break
    result = await supabase.auth.signInWithPassword({ email, password })
  }
  return result
}

/** "Forgot password?": a link to a real address. Same answer whether or not it has an account. */
export async function sendPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email.trim())
}

export async function signOut() {
  return supabase.auth.signOut({ scope: 'local' })
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
) {
  return supabase.auth.onAuthStateChange(callback)
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) return null
  return data as Profile
}

export async function updateProfile(
  userId: string,
  updates: Partial<Pick<Profile,
    'full_name' | 'toosuhe' | 'kiirtoo_kordaja' |
    'tasu_arvestus' | 'kogumispension_protsent' | 'maksuvaba_tulu'>>
) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data as Profile
}

/** Cached clinic_id — set by AuthContext after login, read by create mutations */
let _clinicId: string | null = null
export function setActiveClinicId(id: string | null) { _clinicId = id }
export function getActiveClinicId(): string | null { return _clinicId }

export { type Session, type User }

/**
 * Write this user's interface preferences. Own row only — `profiles_update_own`
 * is the whole authorisation story, and there is no path here for one person to
 * write another's layout.
 */
export async function updateUiPrefs(userId: string, prefs: unknown): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ ui_prefs: prefs, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw error
}
