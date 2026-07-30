import { Plus, Search, LogOut } from 'lucide-react'
import { useSettings } from '../stores/useSettings'
import { useAuth } from '../context/AuthContext'
import { ImportCSVButton } from './ImportCSVButton'

interface TopBarProps {
  search: string
  onSearchChange: (v: string) => void
  onNewJob: () => void
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
export function TopBar({ search, onSearchChange, onNewJob, onImportDone, centerSlot }: TopBarProps) {
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
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Otsi patsienti, tööd…"
          className="w-full pl-8 px-3 py-1.5 text-sm bg-nav/10 border border-nav/20 rounded-lg text-nav placeholder:text-nav/60 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors duration-150"
        />
      </div>

      {centerSlot && (
        <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
          {centerSlot}
        </div>
      )}

      <div className="flex items-center gap-2 ml-auto">
        <ImportCSVButton onSuccess={onImportDone} />
        <button onClick={onNewJob} className="btn-primary">
          <Plus size={14} />
          Uus töö
        </button>

        {initials && (
          <div className="flex items-center gap-2 pl-2 ml-1 border-l border-nav/20">
            <span className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
              {initials}
            </span>
            <span className="text-xs font-medium text-nav truncate max-w-[130px]">{nimi}</span>
            <button
              onClick={signOut}
              title="Logi välja"
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
