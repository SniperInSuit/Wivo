/**
 * "Enter a code from your authenticator app" for an action that needs one AT
 * THAT MOMENT, even in a session that already has the second factor
 * (sql/120 fresh_second_factor): approving an update now, signing an
 * agreement later (docs/AGREEMENTS.md §2). On a right code the session's
 * token records a fresh code, and `onConfirmed` runs the action at once,
 * well inside the window the database allows.
 */
import { useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { verifiedTotp, verifyCode, isWrongCode } from '../../lib/mfa'
import { t } from '@/lib/i18n'

export function FreshCodeDialog({ title, explanation, confirmLabel, onConfirmed, onClose }: {
  title: string
  explanation: string
  confirmLabel: string
  onConfirmed: () => Promise<void>
  onClose: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const factorId = await verifiedTotp()
      if (!factorId) { setError(t('freshCode.noAuthenticator')); return }
      await verifyCode(factorId, code)
      await onConfirmed()
      onClose()
    } catch (err) {
      setError(isWrongCode(err) ? t('freshCode.wrongCode') : t('freshCode.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <form role="dialog" aria-modal="true" onSubmit={submit} onClick={e => e.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-bg-card p-5 shadow-panel">
        <div className="flex items-start gap-3">
          <KeyRound size={18} className="mt-0.5 flex-shrink-0 text-accent" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-ink">{title}</p>
            <p className="text-xs text-ink-muted leading-relaxed">{explanation}</p>
          </div>
        </div>
        <div>
          <label className="label">{t('freshCode.codeFromApp')}</label>
          <input ref={input} value={code} onChange={e => setCode(e.target.value.replace(/[^\d\s]/g, ''))} inputMode="numeric"
            autoComplete="one-time-code" maxLength={7} placeholder="123 456" className="input font-mono text-lg tracking-widest w-40" />
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost text-sm">{t('confirm.cancel')}</button>
          <button type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6} className="btn-primary text-sm disabled:opacity-50">
            {busy ? t('freshCode.working') : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
