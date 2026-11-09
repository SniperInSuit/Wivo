/**
 * "Database update 2.3.0 is ready", for approvers only: the owner, or a
 * member with Install updates (docs/ARCHITECTURE-INSTANCES.md 5b). The
 * release note and the migrations it brings, and Install, which asks for a
 * fresh code and then the clinic's own `wivo-update` installs it. Nothing is
 * shown to anyone else, or in a project that isn't a clinic's own instance.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DatabaseZap, X } from 'lucide-react'
import { useUpdateStatus } from '../hooks/useUpdateStatus'
import { pendingDatabaseUpdate, installDatabaseUpdate, updateReasonText } from '../lib/databaseUpdate'
import { FreshCodeDialog } from './ui/FreshCodeDialog'
import { t } from '@/lib/i18n'

export function DatabaseUpdateBanner() {
  const status = useUpdateStatus()
  const qc = useQueryClient()
  const pending = pendingDatabaseUpdate(status)
  const [asking, setAsking] = useState(false)
  const [details, setDetails] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  if (result) {
    return (
      <div role="status" className={`flex items-center gap-2 px-4 py-2 border-b flex-shrink-0 ${result.ok ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
        <DatabaseZap size={14} className={result.ok ? 'text-emerald-600' : 'text-amber-600'} />
        <p className="text-xs text-ink flex-1">{result.text}</p>
        <button onClick={() => setResult(null)} className="text-ink-faint hover:text-ink" title={t('licenseBanner.dismiss')}><X size={13} /></button>
      </div>
    )
  }
  if (!pending || dismissed === pending.version) return null

  return (
    <div className="px-4 py-2 bg-accent/10 border-b border-accent/30 flex-shrink-0 space-y-1">
      <div className="flex items-center gap-2">
        <DatabaseZap size={14} className="text-accent flex-shrink-0" />
        <p className="text-xs text-ink flex-1">
          <strong>{t('dbUpdate.ready', { version: pending.version })}</strong>{' '}
          {pending.note ?? t('dbUpdate.noNote')}{' '}
          {(pending.migrations?.length || pending.functions?.length) ? (
            <button onClick={() => setDetails(d => !d)} className="underline decoration-dotted underline-offset-2">
              {t('dbUpdate.whatItChanges')}
            </button>
          ) : null}
        </p>
        <button onClick={() => setAsking(true)} className="btn-primary text-xs py-1">{t('dbUpdate.install')}</button>
        <button onClick={() => setDismissed(pending.version)} className="text-ink-faint hover:text-ink" title={t('licenseBanner.dismiss')}><X size={13} /></button>
      </div>
      {details && (
        <ul className="text-[11px] text-ink-muted font-mono pl-6 list-disc">
          {[...(pending.migrations ?? []), ...(pending.functions ?? [])].map(p => <li key={p}>{p}</li>)}
        </ul>
      )}
      {asking && (
        <FreshCodeDialog
          title={t('dbUpdate.installTitle', { version: pending.version })}
          explanation={t('dbUpdate.installExplanation')}
          confirmLabel={t('dbUpdate.install')}
          onClose={() => setAsking(false)}
          onConfirmed={async () => {
            const r = await installDatabaseUpdate(pending.version)
            setResult(r.ok
              ? { ok: true, text: t('dbUpdate.installed', { version: r.to ?? pending.version }) }
              : { ok: false, text: `${t('dbUpdate.notInstalled', { version: pending.version })} ${updateReasonText(r.reason)}` })
            await qc.invalidateQueries({ queryKey: ['update-status'] })
          }}
        />
      )}
    </div>
  )
}
