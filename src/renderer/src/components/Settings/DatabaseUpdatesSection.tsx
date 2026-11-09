/**
 * Settings → Updates, the clinic's database (docs/ARCHITECTURE-INSTANCES.md
 * 5b, 5g): for approvers only, in a clinic's own instance. What is
 * installed, how fresh Wivo's signed list is (by the database's clock), the
 * last check and a button to check now, the last installs with their result,
 * and the update keys this project has accepted (5e: a new key is something
 * an owner should see). The functions token's state comes with it later
 * (phase 1, slice 3).
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { DatabaseZap, RefreshCw } from 'lucide-react'
import { useUpdateStatus } from '../../hooks/useUpdateStatus'
import { checkDatabaseUpdates, updateReasonText } from '../../lib/databaseUpdate'
import { t, dateLocale } from '@/lib/i18n'

const when = (iso: string) => format(new Date(iso), 'd MMM yyyy HH:mm', { locale: dateLocale })

export function DatabaseUpdatesSection() {
  const status = useUpdateStatus()
  const qc = useQueryClient()
  const [checking, setChecking] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  if (!status) return null

  async function checkNow() {
    setChecking(true)
    setAnswer(null)
    const r = await checkDatabaseUpdates()
    setAnswer(r.ok ? t('dbUpdate.checkedOk') : updateReasonText(r.reason))
    await qc.invalidateQueries({ queryKey: ['update-status'] })
    setChecking(false)
  }

  return (
    <section className="pt-4 border-t border-ink-faint/20 space-y-3">
      <div className="flex items-center gap-2">
        <DatabaseZap size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">{t('dbUpdate.sectionTitle')}</h3>
      </div>
      <p className="text-xs text-ink-faint max-w-xl leading-relaxed">{t('dbUpdate.sectionHint')}</p>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-ink-muted">{t('dbUpdate.installedLabel')}</dt>
        <dd className="text-ink tabular-nums">{status.installed ? `${status.installed.version} · ${when(status.installed.at)}` : '–'}</dd>
        <dt className="text-ink-muted">{t('dbUpdate.channel')}</dt>
        <dd className="text-ink">{status.channel === 'test' ? t('dbUpdate.channelTest') : t('dbUpdate.channelStable')}</dd>
        <dt className="text-ink-muted">{t('dbUpdate.list')}</dt>
        <dd className={status.stale ? 'text-amber-600' : 'text-ink'}>
          {status.list
            ? t(status.stale ? 'dbUpdate.listExpired' : 'dbUpdate.listFresh', { serial: status.list.serial, date: when(status.list.expires) })
            : t('updates.staleNever')}
        </dd>
        <dt className="text-ink-muted">{t('dbUpdate.lastCheck')}</dt>
        <dd className="text-ink">
          {status.last_check
            ? `${when(status.last_check.at)} · ${status.last_check.result === 'accepted' ? t('dbUpdate.accepted') : updateReasonText(status.last_check.reason ?? 'refused')}`
            : '–'}
        </dd>
      </dl>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void checkNow()} disabled={checking}
          className="btn-ghost text-xs border border-ink-faint/25 flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={11} className={checking ? 'animate-spin' : ''} /> {t('dbUpdate.checkNow')}
        </button>
        {answer && <span className="text-[11px] text-ink-muted">{answer}</span>}
      </div>

      {status.installs.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">{t('dbUpdate.history')}</h4>
          <ul className="space-y-0.5 text-[11px]">
            {status.installs.map((i, n) => (
              <li key={n} className="text-ink">
                <span className="text-ink-muted tabular-nums">{when(i.at)}</span>{' · '}
                {i.from ? `${i.from} → ` : ''}{i.to}{' · '}
                {i.result === 'installed' ? t('dbUpdate.resultInstalled') : i.result === 'failed' ? t('dbUpdate.resultFailed') : t('dbUpdate.resultRefused')}
                {i.by ? ` · ${i.by}` : i.mode === 'automatic' ? ` · ${t('dbUpdate.automatic')}` : ''}
                {i.reason ? <span className="text-ink-muted"> · {updateReasonText(i.reason)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {status.keys.length > 0 && (
        <p className="text-[11px] text-ink-muted">
          {t('dbUpdate.keys')} {status.keys.map(k => `${k.key_id} (${when(k.accepted_at)})`).join(', ')}
        </p>
      )}
    </section>
  )
}
