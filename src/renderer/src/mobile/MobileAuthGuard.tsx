/**
 * Sign-in on the phone: the desktop's own login and second-factor screens
 * (spec: "the same Supabase sign-in and MFA"), plus the phone's 12-hour
 * session (session.ts). Founding a clinic is not a phone task.
 */
import { useEffect, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { LoginPage } from '../components/Auth/LoginPage'
import { MfaGate } from '../components/Auth/MfaGate'
import { forgetPushBeforeSignOut } from '../lib/push'
import { phoneSessionExpired, signedInAt, markSignedIn, clearSignedIn } from './session'
import { t } from '@/lib/i18n'

export function MobileAuthGuard({ children }: { children: ReactNode }) {
  const { status, needsClinicSetup } = useAuth()

  useEffect(() => {
    // The sign-in page: nobody is signed in, so no earlier sign-in's time may
    // carry over to the next one (it would sign them out at once).
    if (status === 'none') clearSignedIn()
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN' && signedInAt() === null) markSignedIn()
      if (event === 'SIGNED_OUT') clearSignedIn()
    })
    const check = () => {
      if (status === 'authenticated' && phoneSessionExpired(signedInAt(), Date.now())) {
        clearSignedIn()
        // This phone only: a global sign-out would end the desktop's session too.
        void forgetPushBeforeSignOut().then(() => supabase.auth.signOut({ scope: 'local' }))
      }
    }
    check()
    document.addEventListener('visibilitychange', check)
    return () => { data.subscription.unsubscribe(); document.removeEventListener('visibilitychange', check) }
  }, [status])

  if (status === 'loading') {
    return <div className="fixed inset-0 grid place-items-center bg-nav-bg"><Loader2 className="animate-spin text-accent" /></div>
  }
  if (status === 'none') return <LoginPage />
  if (needsClinicSetup) {
    return (
      <MfaGate>
        <div className="fixed inset-0 grid place-items-center bg-nav-bg p-6">
          <p className="max-w-xs text-center text-sm text-nav">{t('mobile.setUpOnDesktop')}</p>
        </div>
      </MfaGate>
    )
  }
  return <MfaGate>{children}</MfaGate>
}
