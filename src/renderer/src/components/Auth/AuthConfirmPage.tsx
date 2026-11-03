/**
 * `<app>/auth/confirm` (docs/ACCOUNTS.md): where the e-mails' links land, on
 * the phone app's site, outside the sign-in.
 *
 * - invite: Continue → set a password → add the authenticator (MfaGate).
 * - recovery: Continue → the authenticator's code first (an e-mail alone never
 *   gets past the second factor) → a new password → every other device signed out.
 * - email_change: Continue → the address is switched.
 *
 * The token is spent only by Continue, never on page load (mail scanners open
 * links ahead of people), and is then taken out of the address bar.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, KeyRound, Lock, CheckCircle2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { CONFIRM_PATH, MIN_PASSWORD, isLinkDead, linkLanguage, parseConfirm, passwordProblem } from '../../lib/authConfirm'
import { markSignedIn } from '../../mobile/session'
import { MfaGate } from './MfaGate'
import { describeError } from '../Patients/errors'
import wivoLogo from '../../assets/Wivo Logo.png'
import { t, lang, setLang, languageChosenHere } from '@/lib/i18n'

type Stage = 'start' | 'busy' | 'password' | 'recoveryCode' | 'enrol' | 'done' | 'dead' | 'bad'

export function AuthConfirmPage() {
  const link = useMemo(() => parseConfirm(location.search), [])
  const [stage, setStage] = useState<Stage>(link ? 'start' : 'bad')
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  // The e-mail was in the person's language; so is this page, unless this
  // device has a language someone chose. Before anything is typed or spent.
  useEffect(() => {
    const wanted = linkLanguage(location.search)
    if (wanted && wanted !== lang && !languageChosenHere()) setLang(wanted)
  }, [])

  async function proceed() {
    if (!link) return
    setStage('busy')
    setError(null)
    const { data, error: err } = await supabase.auth.verifyOtp({ type: link.type, token_hash: link.tokenHash })
    if (err) {
      if (isLinkDead(err)) setStage('dead')
      else { setError(describeError(err)); setStage('start') }
      return
    }
    if (data.session) markSignedIn()
    history.replaceState(null, '', CONFIRM_PATH)
    if (link.type === 'email_change') { setEmail(data.user?.email ?? null); setStage('done') }
    else setStage(link.type === 'invite' ? 'password' : 'recoveryCode')
  }

  if (stage === 'password') {
    return <PasswordStep onSaved={() => setStage('enrol')} />
  }
  if (stage === 'recoveryCode') {
    return (
      <MfaGate>
        <PasswordStep onSaved={async () => {
          await supabase.auth.signOut({ scope: 'others' }).catch(() => {})
          setStage('done')
        }} />
      </MfaGate>
    )
  }
  if (stage === 'enrol') {
    return <MfaGate><Done type="invite" email={null} /></MfaGate>
  }
  if (stage === 'done') return <Done type={link?.type ?? 'invite'} email={email} />

  return (
    <Card icon={stage === 'dead' || stage === 'bad' ? <AlertTriangle className="text-amber-500" size={20} aria-hidden="true" /> : <KeyRound className="text-accent" size={20} aria-hidden="true" />}
      title={stage === 'dead' || stage === 'bad' ? t('authConfirm.linkProblemTitle') : t(TITLE[link!.type])}>
      {stage === 'bad' && <p className="text-sm text-ink-soft">{t('authConfirm.badLink')}</p>}
      {stage === 'dead' && <p className="text-sm text-ink-soft">{t('authConfirm.deadLink')}</p>}
      {(stage === 'start' || stage === 'busy') && link && (
        <>
          <p className="text-sm text-ink-soft">{t(INTRO[link.type])}</p>
          {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
          <button type="button" onClick={() => void proceed()} disabled={stage === 'busy'} className="btn-primary w-full justify-center disabled:opacity-50">
            {stage === 'busy' ? <Loader2 size={16} className="animate-spin" /> : t('authConfirm.continue')}
          </button>
        </>
      )}
    </Card>
  )
}

const TITLE = { invite: 'authConfirm.inviteTitle', recovery: 'authConfirm.recoveryTitle', email_change: 'authConfirm.emailTitle' } as const
const INTRO = { invite: 'authConfirm.inviteIntro', recovery: 'authConfirm.recoveryIntro', email_change: 'authConfirm.emailIntro' } as const

function PasswordStep({ onSaved }: { onSaved: () => void | Promise<void> }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const problem = passwordProblem(password, again)
    if (problem) { setError(problem === 'tooShort' ? t('authConfirm.passwordTooShort', { n: MIN_PASSWORD }) : t('authConfirm.passwordsDiffer')); return }
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) { setError(describeError(err)); setSaving(false); return }
    await onSaved()
  }

  return (
    <Card icon={<Lock className="text-accent" size={20} aria-hidden="true" />} title={t('authConfirm.passwordTitle')}>
      <form onSubmit={e => void save(e)} className="space-y-3">
        <div>
          <label className="label" htmlFor="new-password">{t('authConfirm.newPassword')}</label>
          <input id="new-password" type="password" autoComplete="new-password" className="input" value={password}
            onChange={e => setPassword(e.target.value)} required autoFocus />
          <p className="mt-1 text-xs text-ink-muted">{t('authConfirm.passwordTooShort', { n: MIN_PASSWORD })}</p>
        </div>
        <div>
          <label className="label" htmlFor="new-password-again">{t('authConfirm.repeatPassword')}</label>
          <input id="new-password-again" type="password" autoComplete="new-password" className="input" value={again}
            onChange={e => setAgain(e.target.value)} required />
        </div>
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <button type="submit" disabled={saving} className="btn-primary w-full justify-center disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : t('authConfirm.savePassword')}
        </button>
      </form>
    </Card>
  )
}

function Done({ type, email }: { type: 'invite' | 'recovery' | 'email_change'; email: string | null }) {
  const text = type === 'invite' ? t('authConfirm.doneInvite')
    : type === 'recovery' ? t('authConfirm.doneRecovery')
    : email ? t('authConfirm.doneEmail', { email }) : t('authConfirm.doneEmailNoAddress')
  return (
    <Card icon={<CheckCircle2 className="text-emerald-500" size={20} aria-hidden="true" />} title={t('authConfirm.doneTitle')}>
      <p className="text-sm text-ink-soft">{text}</p>
      <button type="button" onClick={() => location.assign('/')} className="btn-primary w-full justify-center">
        {t('authConfirm.openWivo')}
      </button>
    </Card>
  )
}

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-nav-bg">
      <div className="flex min-h-full items-center justify-center px-4 sm:px-6"
        style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <div className="w-full max-w-sm space-y-4 rounded-2xl bg-bg-card p-5 shadow-panel sm:p-6">
          <img src={wivoLogo} alt="Wivo" className="h-12 w-12 rounded-xl" />
          <div className="flex items-center gap-2">
            {icon}
            <h1 className="text-base font-semibold text-ink">{title}</h1>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
