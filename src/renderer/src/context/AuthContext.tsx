import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import {
  supabase, getSession, getProfile, onAuthStateChange, signOut as doSignOut, rememberClinicCode,
  setActiveClinicId, type Profile, type UserRole
} from '../lib/supabase'
import { isMfaRefusal } from '../lib/mfa'
import { meansAppIsBehind, worthShowing, type ProfileFailure } from '../lib/profileLoad'
import { reportUpdateRequired } from '../lib/appVersion'

export interface Clinic {
  id: string
  name: string
  /** sql/070. Absent until that migration runs. */
  country?: string
  default_language?: 'en' | 'et' | 'ru'
  code_prefix?: string | null
  address: string | null
  city: string | null
  postal_code: string | null
  phone: string | null
  email: string | null
  reg_code: string | null
  vat_number: string | null
  bank_name: string | null
  bank_account: string | null
  logo_url: string | null
  /** Public website URL key, set in Seaded → Kliinik. Null = no public site. */
  public_slug: string | null
  created_at: string
  updated_at: string
}

interface AuthState {
  /** null = not loaded yet, 'none' = no session */
  status: 'loading' | 'authenticated' | 'none'
  user: User | null
  profile: Profile | null
  /** Why there is no profile, when there is none. See lib/profileLoad. */
  profileFailure?: ProfileFailure | null
  clinic: Clinic | null
}

interface AuthContextValue extends AuthState {
  displayName: string
  role: UserRole | null
  clinicId: string | null
  /** True when the owner is logged in but hasn't set up a clinic yet */
  needsClinicSetup: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  /** Called after clinic setup wizard completes */
  setClinic: (clinic: Clinic) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export async function fetchClinic(clinicId: string): Promise<Clinic | null> {
  const { data, error } = await supabase
    .from('clinics')
    .select('*')
    .eq('id', clinicId)
    .single()
  if (error) {
    // Returning null used to be the whole story, which made a failed fetch
    // indistinguishable from "this user has no clinic" — and everything
    // downstream (settings sync, the Kliinik page) then behaved as if the
    // clinic did not exist. The profile's clinic_id is still the truth; this
    // only means the DETAILS could not be loaded.
    // Before the second factor the database refuses it (sql/098), and the
    // sign-in that follows loads it again (onAuthStateChange): not an error.
    if (!isMfaRefusal(error)) console.error('[Wivo] kliiniku andmete laadimine ebaõnnestus:', error.message)
    return null
  }
  return data as Clinic
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    profile: null,
    clinic: null,
    profileFailure: null,
  })

  const loadProfile = useCallback(async (user: User) => {
    const read = await getProfile(user.id)
    const profile = read.ok ? read.profile : null

    // Why there is no profile, kept so the screen can SAY it. Blank name and
    // "Role: —" used to be the whole report, and it took reading migrations
    // to find out that the database had refused the read. See lib/profileLoad.
    const failure = read.ok ? null : read.failure
    if (failure && worthShowing(failure)) {
      console.error('[Wivo] profile could not be read:', failure, read.ok ? '' : read.message)
    }
    // An app older than the schema it is talking to. The same "Update Wivo"
    // sql/104 raises for a refused SAVE, reached here by a refused READ —
    // docs/MIN-VERSION.md. Without this the app shows empty views and blames
    // nothing.
    if (failure && meansAppIsBehind(failure)) reportUpdateRequired()

    let clinic: Clinic | null = null
    if (profile?.clinic_id) {
      clinic = await fetchClinic(profile.clinic_id)
    }
    // A username alone then signs in at this clinic on this device (docs/ACCOUNTS.md).
    rememberClinicCode(clinic?.code_prefix)
    setActiveClinicId(profile?.clinic_id ?? null)
    setState({ status: 'authenticated', user, profile, clinic, profileFailure: failure })
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!state.user) return
    const read = await getProfile(state.user.id)
    // A refresh that fails keeps what is already on screen: losing a loaded
    // profile because one later read was refused would be a worse answer than
    // the one it replaces.
    if (!read.ok) {
      if (meansAppIsBehind(read.failure)) reportUpdateRequired()
      setState(prev => ({ ...prev, profileFailure: read.failure }))
      return
    }
    const profile = read.profile
    let clinic = state.clinic
    if (profile?.clinic_id && profile.clinic_id !== state.profile?.clinic_id) {
      clinic = await fetchClinic(profile.clinic_id)
    }
    setState(prev => ({ ...prev, profile, clinic, profileFailure: null }))
  }, [state.user, state.clinic, state.profile?.clinic_id])

  useEffect(() => {
    getSession().then(session => {
      if (session?.user) {
        loadProfile(session.user)
      } else {
        setState({ status: 'none', user: null, profile: null, clinic: null, profileFailure: null })
      }
    })

    const { data: { subscription } } = onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadProfile(session.user)
      } else {
        setState({ status: 'none', user: null, profile: null, clinic: null, profileFailure: null })
      }
    })

    return () => subscription.unsubscribe()
  }, [loadProfile])

  const handleSignOut = useCallback(async () => {
    await doSignOut()
    setState({ status: 'none', user: null, profile: null, clinic: null, profileFailure: null })
  }, [])

  const setClinic = useCallback((clinic: Clinic) => {
    setActiveClinicId(clinic.id)
    setState(prev => ({ ...prev, clinic }))
  }, [])

  const displayName = state.profile?.full_name?.trim()
    || state.user?.email?.split('@')[0]
    || 'Tundmatu'

  const needsClinicSetup = state.status === 'authenticated'
    && state.profile?.role === 'owner'
    && !state.profile?.clinic_id

  const value: AuthContextValue = {
    ...state,
    displayName,
    role: state.profile?.role ?? null,
    clinicId: state.profile?.clinic_id ?? null,
    needsClinicSetup,
    signOut: handleSignOut,
    refreshProfile,
    setClinic
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
