/**
 * Settings, for an account without e-mail (docs/ACCOUNTS.md §4.4): add a real
 * address. A link goes to that address only; opening it switches the account
 * to it, and from then on the person signs in with it and can reset their own
 * password. Until then nothing changes.
 */
import { useState } from 'react'
import { Mail, Loader2 } from 'lucide-react'
import { addOwnEmail, teamErrorMessage } from '../../lib/teamAccount'
import { t } from '@/lib/i18n'

export function AddOwnEmail() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await addOwnEmail(email.trim())
      setSentTo(email.trim())
    } catch (err) {
      setError(teamErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) return <p role="status" className="text-xs text-ink-soft">{t('team.addEmailSent', { email: sentTo })}</p>

  return (
    <form onSubmit={e => void submit(e)} className="space-y-1.5">
      <label className="label" htmlFor="own-email">{t('team.addEmailTitle')}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input id="own-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required
            placeholder={t('team.emailPlaceholder')} className="input pl-8 py-1.5 text-sm" autoCapitalize="none" autoCorrect="off" />
        </div>
        <button type="submit" disabled={busy} className="btn-ghost border border-ink-faint/25 text-sm disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : t('team.addEmailSend')}
        </button>
      </div>
      <p className="text-xs text-ink-muted">{t('team.addEmailHelp')}</p>
      {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
    </form>
  )
}
