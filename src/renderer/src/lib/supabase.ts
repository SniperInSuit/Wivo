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

// Typed table reference for IDE completion
export type JobRow = Job

// ── Auth helpers ──────────────────────────────────────────────────────────────

export type UserRole = 'owner' | 'worker' | 'patient'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  clinic_id: string | null
  patient_id: string | null
  created_at: string
  updated_at: string
}

export async function signIn(email: string, password: string) {
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

export async function updateProfile(userId: string, updates: Partial<Pick<Profile, 'full_name'>>) {
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
