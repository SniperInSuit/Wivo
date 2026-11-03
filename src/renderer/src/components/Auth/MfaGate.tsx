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
 *
 * Adding an authenticator is written for someone who has never used one:
 * three numbered steps, the exact taps for the app they pick, and on a phone
 * (which cannot scan its own screen) a link that opens the app and a key to
 * copy instead of the QR code.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Loader2, ShieldCheck, LogOut, Copy, Check } from 'lucide-react'
import {
  assurance, nextMfaStep, startEnrollment, verifiedTotp, verifyCode, defaultAuthApp, groupKey, isWrongCode, isSessionGone,
  type AuthApp, type Enrollment, type MfaStep,
} from '../../lib/mfa'
import { supabase, signOut } from '../../lib/supabase'
import { recordAuthenticators } from '../../lib/accountSecurity'
import { syncPushSubscription } from '../../lib/push'
import { describeError } from '../Patients/errors'
import { RichText } from '../ui/RichText'
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

  // The server can end this session (an owner's reset, the last authenticator
  // removed, "sign out on all other devices"); the database then answers it
  // nothing (sql/098). Noticed here too, so the person lands on the sign-in
  // page rather than on screens of errors: on returning to the window and once
  // a minute.
  useEffect(() => {
    if (step !== 'ok') return
    const check = () => {
      void supabase.auth.getUser().then(({ error }) => { if (isSessionGone(error)) void signOut() }, () => {})
    }
    const timer = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    return () => { clearInterval(timer); window.removeEventListener('focus', check) }
  }, [step])

  // Signed in all the way: this browser's push subscription may have been
  // deleted on the server meanwhile (an owner's reset, the last authenticator
  // removed). Checked and repaired after every sign-in, phone and desktop
  // browser alike (lib/push.ts).
  useEffect(() => {
    if (step === 'ok' || step === 'disabled') void syncPushSubscription().catch(() => {})
  }, [step])

  if (step === 'ok' || step === 'disabled') return <>{children}</>

  const enrolling = step === 'enroll' && enrollment !== null
  const codeForm = (
    <>
      <CodeForm
        autoFocus={!enrolling}
        onSubmit={async code => {
          if (!factorId) return
          setError(null)
          try {
            await verifyCode(factorId, code)
            // The organisation's audit log: a new authenticator (sql/097).
            if (enrolling) void recordAuthenticators().catch(() => {})
            setStep('ok')
          } catch (e) {
            setError(isWrongCode(e) ? t('mfa.wrongCode') : describeError(e))
          }
        }}
      />
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </>
  )

  return (
    <div className="fixed inset-0 overflow-y-auto bg-nav-bg">
      <div
        className="flex min-h-full items-center justify-center px-4 sm:px-6"
        style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className={`w-full ${enrolling ? 'max-w-xl' : 'max-w-sm'} space-y-4 rounded-2xl bg-bg-card p-5 shadow-panel sm:p-6`}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-accent" size={20} aria-hidden="true" />
            <h1 className="text-base font-semibold text-ink">{enrolling ? t('mfa.setUpTitle') : t('mfa.twoFactorSignIn')}</h1>
          </div>

          {step === 'loading' ? (
            <Loader2 size={20} className="animate-spin text-accent" />
          ) : (
            <>
              {enrolling ? (
                <EnrollSteps enrollment={enrollment} codeForm={codeForm} />
              ) : (
                <>
                  <p className="text-sm text-ink-soft"><RichText text={t('mfa.verifyHow')} /></p>
                  {codeForm}
                  <p className="text-xs text-ink-muted">{t('mfa.lostPhone')}</p>
                </>
              )}
              {/* This device only: on the phone, a global sign-out would end
                  the desktop's session too. */}
              <button type="button" onClick={() => void signOut()}
                className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
                <LogOut size={12} aria-hidden="true" /> {t('mfa.signOut')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const APPS: { key: AuthApp; name: string }[] = [
  { key: 'google', name: 'Google Authenticator' },
  { key: 'microsoft', name: 'Microsoft Authenticator' },
  { key: 'apple', name: 'iPhone Passwords' },
]
const GET = { google: 'mfa.getGoogle', microsoft: 'mfa.getMicrosoft', apple: 'mfa.getApple' } as const
const SCAN = { google: 'mfa.scanGoogle', microsoft: 'mfa.scanMicrosoft', apple: 'mfa.scanApple' } as const
const KEY = { google: 'mfa.keyGoogle', microsoft: 'mfa.keyMicrosoft', apple: 'mfa.keyApple' } as const

/** Also Settings → Security, for adding a backup authenticator. */
export function EnrollSteps({ enrollment, codeForm }: { enrollment: Enrollment; codeForm: ReactNode }) {
  const [app, setApp] = useState<AuthApp>(() => defaultAuthApp(navigator.userAgent))
  // A phone or tablet: the QR code is on the same screen as the camera that
  // would have to scan it.
  const [touch] = useState(() => window.matchMedia?.('(pointer: coarse)').matches ?? false)
  const [showQr, setShowQr] = useState(!touch)
  const [showKey, setShowKey] = useState(touch)

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-soft">{t('mfa.setUpWhy')}</p>

      <Step n={1} title={t('mfa.step1Title')}>
        <p className="text-xs text-ink-muted">{t('mfa.step1Body')}</p>
        <div className="grid grid-cols-3 gap-2">
          {APPS.map(a => (
            <button key={a.key} type="button" onClick={() => setApp(a.key)} aria-pressed={app === a.key}
              className={`rounded-xl border-2 px-2 py-2 text-xs font-semibold leading-tight transition-colors ${
                app === a.key ? 'border-accent bg-accent/10 text-ink' : 'border-ink-faint/30 text-ink-muted hover:border-accent/50'
              }`}>
              {a.name}
            </button>
          ))}
        </div>
        <p className="text-sm text-ink-soft"><RichText text={t(GET[app])} /></p>
      </Step>

      <Step n={2} title={touch ? t('mfa.step2PhoneTitle') : t('mfa.step2ScanTitle')}>
        {touch && (
          <>
            <a href={enrollment.uri} className="btn-primary w-full justify-center">{t('mfa.openInApp')}</a>
            <p className="text-xs text-ink-muted">{t('mfa.openInAppHint')}</p>
          </>
        )}
        {showQr && (
          <>
            <p className="text-sm text-ink-soft"><RichText text={t(SCAN[app])} /></p>
            <img src={enrollment.qrCode} alt={t('mfa.qrAlt')} className="mx-auto h-44 w-44 rounded-lg bg-white p-2" />
          </>
        )}
        {showKey ? (
          <>
            <p className="text-sm text-ink-soft"><RichText text={t(KEY[app])} /></p>
            <KeyBox secret={enrollment.secret} />
          </>
        ) : (
          <button type="button" onClick={() => setShowKey(true)} className="text-xs font-medium text-accent hover:underline">
            {t('mfa.cannotScanToggle')}
          </button>
        )}
        {!showQr && (
          <button type="button" onClick={() => setShowQr(true)} className="block text-xs font-medium text-accent hover:underline">
            {t('mfa.showQr')}
          </button>
        )}
      </Step>

      <Step n={3} title={t('mfa.step3Title')}>
        <p className="text-sm text-ink-soft"><RichText text={t('mfa.step3Body')} /></p>
        {codeForm}
      </Step>

      <p className="text-xs text-ink-muted">{t('mfa.afterSetup')} {t('mfa.lostPhone')}</p>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-3">
      <span aria-hidden="true" className="mt-px grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-white">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {children}
      </div>
    </section>
  )
}

function KeyBox({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <p aria-label={t('mfa.keyLabel')} className="min-w-0 flex-1 select-all break-all rounded-lg bg-bg-sidebar p-2 font-mono text-sm tracking-wide text-ink">
        {groupKey(secret)}
      </p>
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(secret).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }, () => {})}
        className="btn-ghost flex-shrink-0 border border-ink-faint/30 text-xs"
      >
        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        {copied ? t('mfa.copied') : t('mfa.copyKey')}
      </button>
    </div>
  )
}

export function CodeForm({ onSubmit, autoFocus }: { onSubmit: (code: string) => Promise<void>; autoFocus: boolean }) {
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
        autoFocus={autoFocus}
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
