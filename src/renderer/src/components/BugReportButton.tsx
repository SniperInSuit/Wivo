/**
 * "Report a bug" (spec, Phase 1): sends the version, the organisation, the
 * screen, the description and the latest errors. A screenshot ONLY if the
 * user adds one themselves — the app never takes one, because a screenshot
 * of Wivo almost always shows a patient's name.
 */
import { useState } from 'react'
import { Bug, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { recentErrors } from '../lib/errorLog'
import { describeError } from './Patients/errors'
import { t } from '@/lib/i18n'

export function BugReportButton({ screen, version, compact }: { screen: string; version: string | null; compact: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={t('bugReport.reportABug')}
        className={`flex items-center gap-1.5 text-nav/70 hover:text-white ${compact ? 'justify-center' : 'text-[11px]'}`}>
        <Bug size={13} aria-hidden="true" />
        {!compact && t('bugReport.reportABug')}
      </button>
      {open && <BugReportDialog screen={screen} version={version} onClose={() => setOpen(false)} />}
    </>
  )
}

function BugReportDialog({ screen, version, onClose }: { screen: string; version: string | null; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [shot, setShot] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const errors = recentErrors()

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.rpc('submit_bug_report', {
        p_message: message, p_screen: screen, p_app_version: version ?? '',
        p_recent_errors: errors, p_with_screenshot: !!shot,
      })
      if (err) throw err
      const row = ((data ?? []) as { id: string; screenshot_path: string | null }[])[0]
      if (shot && row?.screenshot_path) {
        const { error: upErr } = await supabase.storage.from('bug-reports')
          .upload(row.screenshot_path, shot, { contentType: shot.type, upsert: false })
        if (upErr) throw upErr
        await supabase.rpc('confirm_bug_screenshot', { p_report: row.id })
      }
      setSent(true)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg bg-bg-card rounded-2xl shadow-panel p-5 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink">{t('bugReport.reportABug')}</h2>
          <button type="button" onClick={onClose} aria-label={t('bugReport.close')} className="ml-auto text-ink-muted hover:text-ink"><X size={16} /></button>
        </div>
        {sent ? (
          <p className="text-sm text-emerald-600">{t('bugReport.thanks')}</p>
        ) : (
          <>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5} autoFocus
              placeholder={t('bugReport.whatHappened')} aria-label={t('bugReport.whatHappened')} className="input w-full resize-y" />
            <label className="block text-sm text-ink">
              {t('bugReport.attachScreenshot')}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="block mt-1 text-xs"
                onChange={e => setShot(e.target.files?.[0] ?? null)} />
              <span className="block text-xs text-ink-muted">{t('bugReport.screenshotWarning')}</span>
            </label>
            <p className="text-xs text-ink-muted">
              {t('bugReport.whatIsSent', { version: version ?? '—', screen, errors: errors.length })}
            </p>
            {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn-ghost text-sm">{t('bugReport.cancel')}</button>
              <button type="button" onClick={send} disabled={busy || !message.trim()} className="btn-primary text-sm disabled:opacity-50">
                {t('bugReport.send')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
