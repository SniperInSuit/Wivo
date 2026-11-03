/**
 * Team → "Add staff member" (docs/ACCOUNTS.md). Made on the server by the
 * Edge Function `team-account`; the browser never signs anyone up.
 *
 * - With e-mail (the normal way): Wivo sends an invite in the person's
 *   language; they set their own password and authenticator.
 * - Without e-mail (the fallback): the owner picks a username and a first
 *   password; the person signs in as `tehnik@<clinic code>`, or just
 *   `tehnik` on this clinic's computers.
 */
import { useState } from 'react'
import { UserPlus, Mail, Lock, Loader2, Check, Copy, AtSign } from 'lucide-react'
import { inviteMember, createLogin, teamErrorMessage, TeamAccountError, type Language } from '../../lib/teamAccount'
import { MIN_PASSWORD } from '../../lib/authConfirm'
import { normaliseUsername } from '@shared/auth/loginAddress'
import { t, lang } from '@/lib/i18n'
import { useHoldRestart } from '../../lib/restartGuard'

/** Each language named in itself, as in Settings. */
const LANGUAGES: { key: Language; label: string }[] = [
  { key: 'et', label: 'Eesti' },
  { key: 'en', label: 'English' },
  { key: 'ru', label: 'Русский' },
]

type Mode = 'email' | 'login'
type Result =
  | { kind: 'invited'; email: string }
  | { kind: 'invitedNoMail' }
  | { kind: 'login'; login: string; password: string }

export function AddMemberDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  // An update restart waits while someone is being added (lib/restartGuard).
  useHoldRestart()
  const [mode, setMode] = useState<Mode>('email')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [language, setLanguage] = useState<Language>(lang)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const fullName = name.trim()
    if (mode === 'login') {
      if (!normaliseUsername(username)) { setError(t('team.usernameRule')); return }
      if (password.trim().length < MIN_PASSWORD) { setError(t('team.passwordRule', { n: MIN_PASSWORD })); return }
    }
    setBusy(true)
    try {
      if (mode === 'email') {
        await inviteMember({ email: email.trim(), fullName, language })
        setResult({ kind: 'invited', email: email.trim() })
      } else {
        const made = await createLogin({ username: username.trim(), fullName, password: password.trim(), language })
        setResult({ kind: 'login', login: made.login, password: password.trim() })
      }
      onCreated()
    } catch (err) {
      // The account was made and is in the clinic; only the e-mail did not go.
      if (err instanceof TeamAccountError && err.code === 'mail_failed' && err.userId) {
        setResult({ kind: 'invitedNoMail' })
        onCreated()
      } else {
        setError(teamErrorMessage(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-bg-card rounded-2xl shadow-panel p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
          {result ? <Done result={result} onClose={onClose} /> : (
            <>
              <h3 className="text-base font-semibold text-ink flex items-center gap-2">
                <UserPlus size={16} /> {t('workers.addStaffMember')}
              </h3>

              <div className="grid grid-cols-2 gap-1 rounded-xl bg-bg-sidebar p-1" role="tablist">
                {(['email', 'login'] as const).map(m => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m}
                    onClick={() => { setMode(m); setError(null) }}
                    className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                      mode === m ? 'bg-bg-card text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}>
                    {m === 'email' ? t('team.withEmail') : t('team.withoutEmail')}
                  </button>
                ))}
              </div>

              <form onSubmit={e => void submit(e)} className="space-y-3">
                <div>
                  <label className="label" htmlFor="member-name">{t('workers.name')}</label>
                  <input id="member-name" type="text" value={name} onChange={e => setName(e.target.value)}
                    placeholder={t('workers.staffMemberName')} className="input" required maxLength={120} />
                </div>

                {mode === 'email' ? (
                  <div>
                    <label className="label" htmlFor="member-email">{t('team.email')}</label>
                    <div className="relative">
                      <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                      <input id="member-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                        placeholder={t('team.emailPlaceholder')} className="input pl-9" autoCapitalize="none" autoCorrect="off" required />
                    </div>
                    <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">{t('team.inviteHelp')}</p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="label" htmlFor="member-username">{t('workers.username2')}</label>
                      <div className="relative">
                        <AtSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                        <input id="member-username" type="text" value={username} onChange={e => setUsername(e.target.value)}
                          placeholder={t('workers.technician')} className="input pl-9" autoCapitalize="none" autoCorrect="off" required />
                      </div>
                      <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">{t('team.usernameRule')}</p>
                    </div>
                    <div>
                      <label className="label" htmlFor="member-password">{t('workers.password2')}</label>
                      <div className="relative">
                        <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                        <input id="member-password" type="text" value={password} onChange={e => setPassword(e.target.value)}
                          className="input pl-9" required minLength={MIN_PASSWORD} autoComplete="off" />
                      </div>
                      <p className="text-[11px] text-ink-faint mt-1">{t('team.passwordRule', { n: MIN_PASSWORD })} {t('workers.youSetThePasswordGiveIt')}</p>
                    </div>
                  </>
                )}

                <div>
                  <label className="label" htmlFor="member-language">{t('team.language')}</label>
                  <select id="member-language" value={language} onChange={e => setLanguage(e.target.value as Language)} className="input">
                    {LANGUAGES.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
                  </select>
                </div>

                {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : mode === 'email' ? t('team.sendInvite') : t('workers.createAccount')}
                  </button>
                  <button type="button" onClick={onClose} className="btn-ghost">{t('workers.cancel2')}</button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Done({ result, onClose }: { result: Result; onClose: () => void }) {
  return (
    <>
      <h3 className="text-base font-semibold text-ink flex items-center gap-2">
        <Check size={16} className="text-emerald-500" /> {t('workers.accountCreated')}
      </h3>
      {result.kind === 'invited' && <p className="text-sm text-ink-muted">{t('team.invitedHelp', { email: result.email })}</p>}
      {result.kind === 'invitedNoMail' && <p className="text-sm text-amber-700">{t('team.invitedNoMail')}</p>}
      {result.kind === 'login' && (
        <>
          <p className="text-sm text-ink-muted">{t('workers.giveTheseDetailsToTheStaff')}</p>
          <div className="bg-bg-sidebar rounded-xl p-4 space-y-2">
            <CopyRow label={t('team.login')} value={result.login} />
            <CopyRow label={t('workers.password')} value={result.password} />
          </div>
          <p className="text-[11px] text-ink-faint">{t('team.loginHelp', { name: result.login.split('@')[0] })}</p>
        </>
      )}
      <button onClick={onClose} className="btn-primary w-full justify-center">{t('workers.close')}</button>
    </>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[10px] text-ink-faint uppercase font-semibold">{label}</p>
        <p className="text-sm font-mono text-ink break-all">{value}</p>
      </div>
      <button onClick={() => void navigator.clipboard.writeText(value)} className="p-1.5 text-ink-faint hover:text-accent transition-colors"
        title={t('workers.copy')} aria-label={t('workers.copy')}>
        <Copy size={13} />
      </button>
    </div>
  )
}
