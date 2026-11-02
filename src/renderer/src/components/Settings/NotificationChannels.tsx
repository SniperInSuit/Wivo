/**
 * Where a person's notifications reach them, besides the bell (which always
 * shows everything): push to all their phones (sql/095) and e-mail (sql/075).
 * Their own choice, in their own settings, on the desktop and on the phone.
 */
import { useState } from 'react'
import { BellRing } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { t } from '@/lib/i18n'

type Channel = 'notify_push' | 'notify_email'
const RPC: Record<Channel, string> = { notify_push: 'set_notify_push', notify_email: 'set_notify_email' }

export function NotificationChannels() {
  const auth = useAuth()
  const [on, setOn] = useState<Record<Channel, boolean>>({
    notify_push: auth.profile?.notify_push ?? true,
    notify_email: auth.profile?.notify_email ?? true,
  })
  const [error, setError] = useState<string | null>(null)

  async function toggle(channel: Channel, next: boolean) {
    setError(null)
    setOn(x => ({ ...x, [channel]: next }))
    const { error: err } = await supabase.rpc(RPC[channel], { p_on: next })
    if (err) {
      setOn(x => ({ ...x, [channel]: !next }))
      setError(t('notifications.channelSaveFailed'))
    } else {
      void auth.refreshProfile()
    }
  }

  const row = (channel: Channel, label: string, help: string) => (
    <label className="flex items-start gap-2 text-sm text-ink">
      <input type="checkbox" role="switch" aria-checked={on[channel]} className="mt-0.5" checked={on[channel]}
        onChange={e => void toggle(channel, e.target.checked)} />
      <span>
        {label}
        <span className="block text-xs text-ink-muted">{help}</span>
      </span>
    </label>
  )

  return (
    <section className="max-w-xl space-y-2">
      <div className="flex items-center gap-2">
        <BellRing size={14} className="text-accent" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-ink">{t('notifications.channelsTitle')}</h3>
      </div>
      <p className="text-xs text-ink-faint">{t('notifications.channelsHelp')}</p>
      {row('notify_push', t('notifications.pushMe'), t('notifications.pushHelp'))}
      {row('notify_email', t('notifications.emailMe'), t('notifications.emailHelp'))}
      {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
    </section>
  )
}
