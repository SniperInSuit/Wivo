/**
 * The owner resets a member's two-factor sign-in (sql/097): for a lost
 * phone with no backup. Every authenticator of theirs goes, they are signed
 * out everywhere, and at the next sign-in Wivo makes them add a new one.
 *
 * Owner only, signed in with the second factor, a reason required, never for
 * another owner — the database decides, the Edge Function `account-security`
 * does it. The member gets a notification; the audit log has the reason.
 */
import { useEffect, useState } from 'react'
import { ShieldOff, Check } from 'lucide-react'
import { resetMemberMfa, securityErrorText } from '../../lib/accountSecurity'
import { t } from '@/lib/i18n'
import { confirmDialog } from '../../lib/confirm'

export function ResetMfaPanel({ memberId, name }: { memberId: string; name: string }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setReason(''); setDone(false); setError(null) }, [memberId])

  async function reset() {
    if (!(await confirmDialog({ message: t('workers.mfaResetConfirm', { name }), danger: true }))) return
    setBusy(true)
    setError(null)
    try {
      await resetMemberMfa(memberId, reason.trim())
      setDone(true)
      setReason('')
    } catch (e) {
      setError(securityErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pt-3 border-t border-ink-faint/15">
      <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">{t('workers.mfaResetTitle')}</p>
      {done ? (
        <div role="status" className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-800">
          <Check size={13} className="flex-shrink-0" aria-hidden="true" /> {t('workers.mfaResetDone', { name })}
        </div>
      ) : (
        <>
          <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={2}
            placeholder={t('workers.mfaResetReason')} aria-label={t('workers.mfaResetReason')} className="input text-sm w-full" />
          <button type="button" onClick={() => void reset()} disabled={busy || reason.trim().length < 3}
            className="mt-2 btn-ghost border border-ink-faint/25 text-xs disabled:opacity-50">
            <ShieldOff size={12} aria-hidden="true" /> {busy ? t('workers.mfaResetting') : t('workers.mfaResetButton')}
          </button>
        </>
      )}
      <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">{t('workers.mfaResetHelp', { name })}</p>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}
