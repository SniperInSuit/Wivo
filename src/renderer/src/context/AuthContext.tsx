import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import {
  supabase, getSession, getProfile, onAuthStateChange, signOut as doSignOut,
  setActiveClinicId, type Profile, type UserRole
} from '../lib/supabase'

export interface Clinic {
  id: string
  name: string
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
  created_at: string
  updated_at: string
}

interface AuthState {
  /** null = not loaded yet, 'none' = no session */
  status: 'loading' | 'authenticated' | 'none'
  user: User | null
  profile: Profile | null
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

async function fetchClinic(clinicId: string): Promise<Clinic | null> {
  const { data, error } = await supabase
    .from('clinics')
    .select('*')
    .eq('id', clinicId)
    .single()
  if (error) return null
  return data as Clinic
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    profile: null,
    clinic: null
  })

  const loadProfile = useCallback(async (user: User) => {
    const profile = await getProfile(user.id)
    let clinic: Clinic | null = null
    if (profile?.clinic_id) {
      clinic = await fetchClinic(profile.clinic_id)
    }
    setActiveClinicId(profile?.clinic_id ?? null)
    setState({ status: 'authenticated', user, profile, clinic })
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!state.user) return
    const profile = await getProfile(state.user.id)
    let clinic = state.clinic
    if (profile?.clinic_id && profile.clinic_id !== state.profile?.clinic_id) {
      clinic = await fetchClinic(profile.clinic_id)
    }
    setState(prev => ({ ...prev, profile, clinic }))
  }, [state.user, state.clinic, state.profile?.clinic_id])

  useEffect(() => {
    getSession().then(session => {
      if (session?.user) {
        loadProfile(session.user)
      } else {
        setState({ status: 'none', user: null, profile: null, clinic: null })
      }
    })

    const { data: { subscription } } = onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadProfile(session.user)
      } else {
        setState({ status: 'none', user: null, profile: null, clinic: null })
      }
    })

    return () => subscription.unsubscribe()
  }, [loadProfile])

  const handleSignOut = useCallback(async () => {
    await doSignOut()
    setState({ status: 'none', user: null, profile: null, clinic: null })
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
