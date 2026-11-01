/**
 * Two-factor sign-in, before the app opens (spec, Phase 1: "MFA for all
 * users"; "Sign in with Google is not two-factor sign-in").
 *
 * After the password, one of three screens: enter the authenticator's code,
 * add an authenticator (nobody skips this), or nothing when the session is
 * already aal2. What to show is `nextMfaStep` (lib/mfa.ts, tested). If the
 * project has TOTP switched off the gate steps aside — locking every user out
 * of a working app is worse than a missing second factor, and turning TOTP on
 * is a dashboard switch (docs/night-run/MORNING.md).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Loader2, ShieldCheck, LogOut } from 'lucide-react'
import { assurance, nextMfaStep, startEnrollment, verifiedTotp, verifyCode, type Enrollment, type MfaStep } from '../../lib/mfa'
import { supabase } from '../../lib/supabase'
import { describeError } from '../Patients/errors'
import { t } from '@/lib/i18n'

export function MfaGate({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<MfaStep | 'loading'>('loading')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = useCallback(async () => {
    setError(null)
    try {
      const a = await assurance()
      let s = nextMfaStep(a, true)
      if (s === 'verify') setFactorId(await verifiedTotp())
      if (s === 'enroll') {
        const e = await startEnrollment()
        if (e === 'disabled') s = 'disabled'
        else { setEnrollment(e); setFactorId(e.factorId) }
      }
      setStep(s)
    } catch (e) {
      // An auth server that cannot answer must not trap people outside. The
      // database still requires aal2 for what needs it (partnerships).
      console.warn('[wivo] MFA check failed, continuing without:', e)
      setStep('disabled')
    }
  }, [])

  useEffect(() => { void decide() }, [decide])

  if (step === 'ok' || step === 'disabled') return <>{children}</>

  return (
    <div className="fixed inset-0 bg-nav-bg flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-bg-card rounded-2xl shadow-panel p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-accent" size={20} aria-hidden="true" />
          <h1 className="text-base font-semibold text-ink">{t('mfa.twoFactorSignIn')}</h1>
        </div>

        {step === 'loading' ? (
          <Loader2 size={20} className="animate-spin text-accent" />
        ) : (
          <>
            {step === 'enroll' && enrollment && (
              <div className="space-y-3">
                <p className="text-sm text-ink-soft">{t('mfa.enrollIntro')}</p>
                <img src={enrollment.qrCode} alt={t('mfa.qrAlt')} className="mx-auto w-44 h-44 bg-white rounded-lg p-2" />
                <p className="text-xs text-ink-muted">{t('mfa.cannotScan')}</p>
                <p className="font-mono text-xs break-all bg-bg-sidebar rounded-lg p-2 select-all">{enrollment.secret}</p>
              </div>
            )}
            {step === 'verify' && <p className="text-sm text-ink-soft">{t('mfa.enterCode')}</p>}
            <CodeForm
              onSubmit={async code => {
                if (!factorId) return
                setError(null)
                try {
                  await verifyCode(factorId, code)
                  setStep('ok')
                } catch (e) {
                  setError(describeError(e))
                }
              }}
            />
            {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
            <button type="button" onClick={() => void supabase.auth.signOut()}
              className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
              <LogOut size={12} aria-hidden="true" /> {t('mfa.signOut')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function CodeForm({ onSubmit }: { onSubmit: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="flex gap-2"
      onSubmit={async e => {
        e.preventDefault()
        setBusy(true)
        await onSubmit(code)
        setBusy(false)
      }}
    >
      <input
        value={code}
        onChange={e => setCode(e.target.value.replace(/[^\d\s]/g, ''))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={7}
        placeholder="123 456"
        aria-label={t('mfa.sixDigitCode')}
        className="input font-mono text-lg tracking-widest w-full"
      />
      <button type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6} className="btn-primary disabled:opacity-50">
        {t('mfa.confirm')}
      </button>
    </form>
  )
}
