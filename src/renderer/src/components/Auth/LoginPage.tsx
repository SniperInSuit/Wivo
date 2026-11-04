import { useState } from 'react'
import { Loader2, Lock, Eye, EyeOff, Mail, ArrowLeft } from 'lucide-react'
import { signIn, sendPasswordReset, rememberedClinicCode } from '../../lib/supabase'
import { resetTarget, resetOutcome } from '../../lib/passwordReset'
import wivoLogo from '../../assets/Wivo Logo.png'
import { t } from '@/lib/i18n'

/**
 * Sign in, or "Forgot password?" as a screen of its own: only the address
 * and "Send link", then only the answer. The address typed carries across.
 */
type Screen = 'signIn' | 'forgot' | 'sent'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [screen, setScreen] = useState<Screen>('signIn')
  const [sentTo, setSentTo] = useState('')
  const [code] = useState(rememberedClinicCode)

  const show = (next: Screen) => { setError(null); setScreen(next) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error } = await signIn(email, password)
      if (error) throw error
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? t('auth.somethingWentWrong')
      if (msg.includes('Invalid login credentials')) setError(t('auth.wrongUsernameOrPassword'))
      else if (msg.includes('valid email')) setError(t('auth.enterAValidUsernameOrEmail'))
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-nav-bg flex items-center justify-center">
      <div className="bg-bg-card rounded-2xl shadow-panel p-8 w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <img src={wivoLogo} alt="Wivo" className="w-16 h-16 rounded-xl mx-auto" />
          <h1 className="text-xl font-bold text-ink">Wivo</h1>
          <p className="text-sm text-ink-muted">
            {screen === 'signIn' ? t('auth.signInWithYourAccount') : t('auth.resetTitle')}
          </p>
        </div>

        {screen === 'forgot' ? (
          <ForgotPasswordForm email={email} onEmail={setEmail} onBack={() => show('signIn')}
            onSent={to => { setSentTo(to); show('sent') }} />
        ) : screen === 'sent' ? (
          <ResetLinkSent email={sentTo} onBack={() => show('signIn')} />
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">{t('auth.usernameOrEmail')}</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('auth.technicianOrNameClinicCom')}
                className="input pl-9"
                required
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
              />
            </div>
            {code && <p className="mt-1 text-[11px] text-ink-faint">{t('auth.usernameAtClinicHere', { code: code.toUpperCase() })}</p>}
          </div>

          <div>
            <label className="label">{t('auth.password')}</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input pl-9 pr-9"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink transition-colors"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : t('auth.signIn')}
          </button>
          <button type="button" onClick={() => show('forgot')} disabled={loading}
            className="block w-full text-center text-xs text-accent hover:underline disabled:opacity-50">
            {t('auth.forgotPassword')}
          </button>
        </form>
        )}

        {screen === 'signIn' && (
          <p className="text-center text-[10px] text-ink-faint">
            {t('auth.accountsAreCreatedByTheClinic')}
          </p>
        )}
      </div>
    </div>
  )
}

/** Only the address and "Send link". A username account is told who resets it. */
export function ForgotPasswordForm({ email, onEmail, onSent, onBack }: {
  email: string; onEmail: (email: string) => void; onSent: (to: string) => void; onBack: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    setNote(null)
    const target = resetTarget(email)
    if (target.kind === 'username') { setNote(t('auth.resetUsername')); return }
    if (target.kind === 'invalid') { setError(t('auth.enterAValidEmail')); return }
    setBusy(true)
    try {
      const { error: err } = await sendPasswordReset(target.email)
      const outcome = resetOutcome(err)
      if (outcome === 'sent') onSent(target.email)
      else setError(outcome === 'too_often' ? t('auth.resetTooOften') : t('auth.resetNoConnection'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={e => void submit(e)} className="space-y-4">
      <div>
        <label className="label" htmlFor="reset-email">{t('auth.email')}</label>
        <div className="relative">
          <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          {/* Text, not "email": a username typed here gets the answer, not the browser's. */}
          <input id="reset-email" type="text" inputMode="email" value={email} onChange={e => onEmail(e.target.value)}
            placeholder={t('team.emailPlaceholder')} className="input pl-9" required
            autoCapitalize="none" autoCorrect="off" autoFocus />
        </div>
        <p className="mt-1 text-[11px] text-ink-faint leading-relaxed">{t('auth.resetHelp')}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}
      {note && <p role="status" className="text-sm text-ink-soft">{note}</p>}

      <button type="submit" disabled={busy} aria-busy={busy} className="btn-primary w-full justify-center disabled:opacity-50">
        {busy ? <Loader2 size={16} className="animate-spin" /> : t('auth.sendLink')}
      </button>
      <BackToSignIn onBack={onBack} disabled={busy} />
    </form>
  )
}

/** Only the answer, the same whether or not the address has an account. */
export function ResetLinkSent({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <div role="status" className="space-y-2">
        <p className="text-sm text-ink-soft">{t('auth.resetSent')}</p>
        <p className="text-sm font-medium text-ink break-all bg-bg-sidebar rounded-lg px-3 py-2">{email}</p>
      </div>
      <BackToSignIn onBack={onBack} />
    </div>
  )
}

function BackToSignIn({ onBack, disabled }: { onBack: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onBack} disabled={disabled}
      className="flex items-center justify-center gap-1 w-full text-xs text-accent hover:underline disabled:opacity-50">
      <ArrowLeft size={12} aria-hidden="true" /> {t('auth.backToSignIn')}
    </button>
  )
}
