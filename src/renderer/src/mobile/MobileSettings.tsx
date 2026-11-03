/**
 * Phone settings: notifications on this phone, sounds, language, security
 * (authenticators, phones, signing out everywhere else for a lost phone),
 * signing out here. Nothing about the organisation — that is the desktop's job.
 */
import { useEffect, useState } from 'react'
import { Bell, LogOut, Languages, Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { pushState, enablePush, disablePush, needsHomeScreen, forgetPushBeforeSignOut, type PushState } from '../lib/push'
import { SoundSection } from '../components/Settings/SoundSection'
import { NotificationChannels } from '../components/Settings/NotificationChannels'
import { SecuritySection } from '../components/Settings/SecuritySection'
import { describeError } from '../components/Patients/errors'
import { t, lang, setLang, type Lang } from '@/lib/i18n'

const LANGUAGES: { key: Lang; label: string }[] = [
  { key: 'et', label: 'Eesti' },
  { key: 'en', label: 'English' },
]

/** `onWhatsNew`: reopens the release notes; null when this version has none. */
export function MobileSettings({ onWhatsNew }: { onWhatsNew: (() => void) | null }) {
  const auth = useAuth()

  async function signOut() {
    await forgetPushBeforeSignOut()
    // This phone only; the desktop's signOut() is also local now.
    await supabase.auth.signOut({ scope: 'local' })
  }

  async function choose(next: Lang) {
    if (auth.user) await supabase.from('profiles').update({ language: next }).eq('id', auth.user.id)
    setLang(next)
  }

  return (
    <main className="space-y-6 p-4">
      <section className="space-y-1">
        <p className="text-sm font-semibold">{auth.displayName}</p>
        {auth.clinic && <p className="text-xs text-ink-muted">{auth.clinic.name}</p>}
      </section>

      <PushSection />

      <NotificationChannels />

      <SoundSection />

      <section>
        <div className="flex items-center gap-2 mb-2">
          <Languages size={14} className="text-accent" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-ink">Keel · Language</h3>
        </div>
        <div className="flex gap-2">
          {LANGUAGES.map(l => (
            <button key={l.key} type="button" onClick={() => void choose(l.key)} aria-pressed={lang === l.key}
              className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold ${lang === l.key ? 'border-accent bg-accent text-white' : 'border-ink-faint/30 bg-bg-sidebar text-ink-muted'}`}>
              {l.label}
            </button>
          ))}
        </div>
      </section>

      {onWhatsNew && (
        <button type="button" onClick={onWhatsNew}
          className="flex w-full items-center gap-2 rounded-xl border border-ink-faint/30 bg-bg-card px-3 py-3 text-sm font-semibold text-ink">
          <Sparkles size={16} className="text-accent" aria-hidden="true" /> {t('whatsNew.menu')}
          <span className="ml-auto text-xs font-normal text-ink-muted">v{__APP_VERSION__}</span>
        </button>
      )}

      <SecuritySection />

      <button type="button" onClick={() => void signOut()}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-faint/30 py-3 text-sm font-semibold text-rose-500">
        <LogOut size={16} aria-hidden="true" /> {t('mobile.signOut')}
      </button>
      <p className="text-center text-[11px] text-ink-muted">{t('mobile.sessionNote')}</p>
    </main>
  )
}

function PushSection() {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void pushState().then(setState, () => setState('unsupported')) }, [])

  async function toggle(on: boolean) {
    setBusy(true)
    setError(null)
    try { setState(on ? await enablePush() : await disablePush()) }
    catch (e) { setError(describeError(e)) }
    finally { setBusy(false) }
  }

  const note =
    state === 'unsupported' ? (needsHomeScreen() ? t('mobile.pushNeedsHomeScreen') : t('mobile.pushUnsupported'))
      : state === 'not-configured' ? t('mobile.pushNotConfigured')
        : state === 'denied' ? t('mobile.pushDenied')
          : t('mobile.pushIntro')

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Bell size={14} className="text-accent" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-ink">{t('mobile.pushTitle')}</h3>
      </div>
      <p className="text-xs text-ink-faint mb-3">{note}</p>
      {(state === 'on' || state === 'off') && (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" role="switch" aria-checked={state === 'on'} checked={state === 'on'} disabled={busy}
            onChange={e => void toggle(e.target.checked)} />
          {t('mobile.pushOnThisPhone')}
        </label>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-500">{error}</p>}
    </section>
  )
}
