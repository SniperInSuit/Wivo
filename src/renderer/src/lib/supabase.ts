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

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  // Palgal või esitab arve. Määrab, kas summa on brutopalk (millele lisanduvad
  // tööandja maksud) või ostuarve (mille maksud on esitaja enda asi).
  toosuhe?: Engagement
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
  updates: Partial<Pick<Profile, 'full_name' | 'toosuhe'>>
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
