/**
 * A lost or stolen phone (spec, Phase 1b: "remote sign-out"): every other
 * session of this account ends — phones and computers — and this one stays.
 * Supabase revokes their refresh tokens at once; an access token already
 * handed out still works until it expires (at most an hour), then that
 * device is back at the login screen.
 */
import { useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { describeError } from '../Patients/errors'
import { t } from '@/lib/i18n'

export function SignOutOthersSection() {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (!window.confirm(t('signOutOthers.confirm'))) return
    setState('busy')
    setError(null)
    const { error: err } = await supabase.auth.signOut({ scope: 'others' })
    if (err) { setError(describeError(err)); setState('idle') } else setState('done')
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <MonitorSmartphone size={14} className="text-accent" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-ink">{t('signOutOthers.title')}</h3>
      </div>
      <p className="text-xs text-ink-faint mb-3 max-w-xl">{t('signOutOthers.intro')}</p>
      <button type="button" onClick={() => void run()} disabled={state === 'busy'}
        className="btn-ghost border border-ink-faint/30 text-sm disabled:opacity-50">
        {t('signOutOthers.button')}
      </button>
      {state === 'done' && <p role="status" className="mt-2 text-xs text-emerald-600">{t('signOutOthers.done')}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-rose-500">{error}</p>}
    </section>
  )
}
