/**
 * The bell in the top bar. Says what happened and to which job (by code) —
 * the same and only facts the e-mail carries.
 */
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Bell } from 'lucide-react'
import { useNotifications, type AppNotification } from '../hooks/useNotifications'
import { usePipeline } from '../context/PipelineContext'
import { t, dateLocale } from '@/lib/i18n'

const text = (n: AppNotification, stageLabel: (key: string) => string): string => {
  const code = n.job_code ?? '—'
  if (n.kind === 'stage_reached') {
    const stage = stageLabel(String(n.detail.to ?? ''))
    return n.detail.revision ? t('notifications.remakeReachedStage', { code, stage }) : t('notifications.reachedStage', { code, stage })
  }
  if (n.kind === 'assigned') {
    return n.detail.role === 'designer' ? t('notifications.assignedDesigner', { code }) : t('notifications.assignedTechnician', { code })
  }
  if (n.kind === 'job_shared') return t('notifications.jobShared', { code, from: String(n.detail.from_org ?? '') })
  if (n.kind === 'stage_handover') return t('notifications.handedOver', { code })
  if (n.kind === 'files_added') return t('notifications.filesAdded', { code })
  return t('notifications.question', { code })
}

export function NotificationBell({ onOpen }: { onOpen: (n: AppNotification) => void }) {
  const { items, unread, markRead } = useNotifications()
  const { stageMap } = usePipeline()
  const stageLabel = (key: string): string => stageMap[key]?.label ?? key
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-label={t('notifications.notifications')}
        title={t('notifications.notifications')}
        className="relative btn-ghost text-nav hover:text-nav border border-nav/20 px-2">
        <Bell size={14} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 text-[10px] font-bold rounded-full bg-red-500 text-white min-w-[16px] h-[16px] px-1 flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 z-50 rounded-xl bg-bg-card shadow-panel border border-ink-faint/20 p-2">
          <div className="flex items-center px-2 py-1">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{t('notifications.notifications')}</span>
            {unread > 0 && (
              <button type="button" onClick={() => markRead.mutate(undefined)} className="ml-auto text-xs text-accent hover:underline">
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-2 py-3 text-sm text-ink-muted">{t('notifications.none')}</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map(n => (
                <li key={n.id}>
                  <button type="button"
                    onClick={() => { if (!n.read_at) markRead.mutate([n.id]); setOpen(false); onOpen(n) }}
                    className={`w-full text-left rounded-lg px-2 py-2 text-sm hover:bg-bg-sidebar ${n.read_at ? 'text-ink-muted' : 'text-ink font-medium'}`}>
                    {text(n, stageLabel)}
                    <span className="block text-[11px] font-normal text-ink-muted">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dateLocale })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
