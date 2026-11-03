import { useState } from 'react'
import { Plus, Search, LogOut, CalendarPlus } from 'lucide-react'
import { useSettings } from '../stores/useSettings'
import { useAuth } from '../context/AuthContext'
import { ImportCSVButton } from './ImportCSVButton'
import { NotificationBell } from './NotificationBell'
import type { AppNotification } from '../hooks/useNotifications'
import { t } from '@/lib/i18n'

/** What Enter in the search box has to say when it opened nothing. */
export interface SearchNotice {
  tone: 'error' | 'info'
  text: string
}

interface TopBarProps {
  search: string
  onSearchChange: (v: string) => void
  /** Enter: open the job the query names, or say why not. */
  onSearchSubmit?: (query: string) => SearchNotice | null
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
export function TopBar({ search, onSearchChange, onSearchSubmit, onNewJob, onNewVisit, onImportDone, centerSlot, onOpenNotification }: TopBarProps) {
  const [notice, setNotice] = useState<SearchNotice | null>(null)
  const { settings } = useSettings()
  const { displayName, signOut } = useAuth()
  const nimi = displayName
  const initials = nimi
    ? nimi.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
    : null

  return (
    <header className="flex items-center gap-3 px-5 py-3 bg-nav-bg flex-shrink-0 h-[56px]">
      <div className="relative w-full max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-nav" />
        <input
          value={search}
          onChange={e => { onSearchChange(e.target.value); setNotice(null) }}
          onKeyDown={e => {
            if (e.key === 'Enter' && onSearchSubmit) setNotice(onSearchSubmit(search))
            else if (e.key === 'Escape') setNotice(null)
          }}
          onBlur={() => setNotice(null)}
          placeholder={t('topBar.searchPatientsJobs')}
          aria-label={t('topBar.searchPatientsJobs')}
          aria-describedby={notice ? 'topbar-search-notice' : undefined}
          className="w-full pl-8 px-3 py-1.5 text-sm bg-nav/10 border border-nav/20 rounded-lg text-nav placeholder:text-nav/60 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors duration-150"
        />
        {notice && (
          <p
            id="topbar-search-notice"
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border px-3 py-2 text-xs shadow-lg ${
              notice.tone === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-bg-card border-ink-faint/30 text-ink-muted'
            }`}
          >
            {notice.text}
          </p>
        )}
      </div>

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
