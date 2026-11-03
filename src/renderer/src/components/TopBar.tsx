import { Plus, LogOut, CalendarPlus } from 'lucide-react'
import { useSettings } from '../stores/useSettings'
import { useAuth } from '../context/AuthContext'
import { ImportCSVButton } from './ImportCSVButton'
import { NotificationBell } from './NotificationBell'
import { JobSearchBox } from './JobSearchBox'
import type { Job } from '../types/job'
import type { AppNotification } from '../hooks/useNotifications'
import { t } from '@/lib/i18n'

interface TopBarProps {
  search: string
  onSearchChange: (v: string) => void
  /** A search result was chosen (or Enter found one): open it. */
  onOpenJob: (job: Job) => void
  onNewJob: () => void
  /** A notification was clicked: open its job wherever it lives. */
  onOpenNotification?: (n: AppNotification) => void
  onNewVisit?: () => void
  onImportDone: () => void
  /**
   * Controls belonging to the active view, shown between the search box and the
   * actions. A slot rather than typed props so this strip does not have to know
   * what a calendar is — the view composes its own controls and hands them over.
   */
  centerSlot?: React.ReactNode
}

// Navigation moved to the Sidebar in 1.1.0 — this strip is now search + actions
// only. The h-[56px] flex-shrink-0 sizing stays byte-for-byte: every view's
// height contract is measured against it.
export function TopBar({ search, onSearchChange, onOpenJob, onNewJob, onNewVisit, onImportDone, centerSlot, onOpenNotification }: TopBarProps) {
  const { settings } = useSettings()
  const { displayName, signOut } = useAuth()
  const nimi = displayName
  const initials = nimi
    ? nimi.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
    : null

  return (
    <header className="flex items-center gap-3 px-5 py-3 bg-nav-bg flex-shrink-0 h-[56px]">
      <JobSearchBox value={search} onChange={onSearchChange} onOpenJob={onOpenJob} />

      {centerSlot && (
        <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
          {centerSlot}
        </div>
      )}

      <div className="flex items-center gap-2 ml-auto">
        {onOpenNotification && <NotificationBell onOpen={onOpenNotification} />}
        <ImportCSVButton onSuccess={onImportDone} />
        {onNewVisit && (
          <button onClick={onNewVisit} className="btn-ghost text-nav hover:text-nav border border-nav/20">
            <CalendarPlus size={14} />
            {t('topBar.newVisit')}
          </button>
        )}
        <button onClick={onNewJob} className="btn-primary">
          <Plus size={14} />
          {t('topBar.newJob')}
        </button>

        {initials && (
          <div className="flex items-center gap-2 pl-2 ml-1 border-l border-nav/20">
            <span className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
              {initials}
            </span>
            <span className="text-xs font-medium text-nav truncate max-w-[130px]">{nimi}</span>
            <button
              onClick={signOut}
              title={t('topBar.signOut')}
              className="p-1.5 text-nav/50 hover:text-nav transition-colors rounded-lg"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
