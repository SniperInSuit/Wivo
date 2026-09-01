import { createClient } from '@supabase/supabase-js'
import type { Job } from '../types/job'
import type { Session, User, AuthChangeEvent } from '@supabase/supabase-js'

// Read from .env — never hardcode these values
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Copy .env.example → .env and fill in your project URL and anon key.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * A throwaway client for creating someone ELSE's account.
 *
 * `signUp` signs the new user in on whichever client made the call. On the main
 * client that silently swaps the owner's session for the new worker's — they
 * would finish creating a technician and find themselves logged in as one.
 * (It only bites once email confirmation is off, because a confirmed-by-email
 * signup returns no session, which is why it stayed hidden.)
 *
 * This client keeps nothing: no storage, no refresh, no session. The new user's
 * token dies with the function call.
 */
export function createSignupClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

// Typed table reference for IDE completion
export type JobRow = Job

// ── Auth helpers ──────────────────────────────────────────────────────────────

export type UserRole = 'owner' | 'worker' | 'patient'

export type Engagement = 'tootaja' | 'ettevote'

/** Kas kokkulepitud number on bruto- või netopalk. Vt sql/054. */
export type PayBasis = 'bruto' | 'neto'

export interface Profile {
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
 * Login identity.
 *
 * Supabase Auth requires an email; a lab bench does not have one per person. A
 * username is therefore mapped to a synthetic address that users never see.
 *
 * The domain is `example.com` by default. It is RFC 2606-reserved, so it can
 * never be registered by anyone and IANA's servers discard mail sent to it —
 * which is the same guarantee `.invalid` gives, except that GoTrue's email
 * validator ACCEPTS it. `.invalid` and `.local` are rejected outright ("Email
 * address is invalid"), which is what this replaced.
 *
 * Override with VITE_USERNAME_DOMAIN if you own a domain and would rather these
 * read as `tehnik@users.sinukliinik.ee`. Changing it AFTER accounts exist
 * orphans them: their stored address keeps the old domain and the derived one
 * will no longer match, so pick it before creating staff logins.
 */
export const USERNAME_DOMAIN =
  (import.meta.env.VITE_USERNAME_DOMAIN as string | undefined)?.trim() || 'example.com'

/** Domains that have ever been used for synthetic logins, so display code can
 *  recognise and hide them all. */
const SYNTHETIC_DOMAINS = [USERNAME_DOMAIN, 'wivo.invalid', 'wivo.local']

export const isEmailAddress = (identifier: string): boolean => identifier.includes('@')

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase().replace(/\s+/g, '')}@${USERNAME_DOMAIN}`
}

/** Hide the synthetic address wherever an email would normally be displayed. */
export function displayIdentity(email: string | null | undefined, username?: string | null): string {
  if (username?.trim()) return username.trim()
  if (email && SYNTHETIC_DOMAINS.some(d => email.endsWith(`@${d}`))) return email.split('@')[0]
  return email ?? '—'
}

/** Accepts either a username or a real email address. */
export async function signIn(identifier: string, password: string) {
  const email = isEmailAddress(identifier) ? identifier.trim() : usernameToEmail(identifier)
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signUp(email: string, password: string, fullName: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } }
  })
}

export async function signOut() {
  return supabase.auth.signOut()
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
