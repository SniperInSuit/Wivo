/**
 * The freeze warning (docs/ARCHITECTURE-INSTANCES.md 5g): Wivo can't get a
 * current signed list of updates, so it can't confirm the clinic has the
 * latest ones, and installs wait. Shown to approvers only — the owner, or a
 * member with Install updates — while the database's clock says the list
 * has expired. It can be pushed aside for the session; the bell and the
 * e-mail have already said it once.
 */
import { useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import { format } from 'date-fns'
import { useUpdateStatus } from '../hooks/useUpdateStatus'
import { t, dateLocale } from '@/lib/i18n'

export function UpdateStaleBanner() {
  const status = useUpdateStatus()
  const [dismissed, setDismissed] = useState(false)
  if (!status?.stale || dismissed) return null

  const expired = status.list ? format(new Date(status.list.expires), 'd MMM yyyy', { locale: dateLocale }) : null
  return (
    <div role="alert" className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex-shrink-0">
      <ShieldAlert size={14} className="text-amber-600 flex-shrink-0" />
      <p className="text-xs text-ink flex-1">
        <strong>{t('updates.staleTitle')}</strong>{' '}
        {expired ? t('updates.staleSince', { date: expired }) : t('updates.staleNever')}{' '}
        {t('updates.staleWhatToDo')}
      </p>
      <button onClick={() => setDismissed(true)} className="text-ink-faint hover:text-ink" title={t('licenseBanner.dismiss')}>
        <X size={13} />
      </button>
    </div>
  )
}
