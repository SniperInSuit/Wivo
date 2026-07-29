import { Plus, Kanban, BarChart2, Table2, Settings, CalendarDays } from 'lucide-react'
import { ImportCSVButton } from './ImportCSVButton'

export type ViewMode = 'board' | 'table' | 'stats' | 'calendar'

interface TopBarProps {
  view: ViewMode
  onViewChange: (v: ViewMode) => void
  onNewJob: () => void
  onImportDone: () => void
  onSettings: () => void
}

export function TopBar({ view, onViewChange, onNewJob, onImportDone, onSettings }: TopBarProps) {
  return (
    <header className="flex items-center justify-between px-5 py-3 bg-bg-card border-b border-ink-faint/15 flex-shrink-0 h-[56px]">
      {/* Logo / Brand */}
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1C3.686 1 1 3.686 1 7C1 10.314 3.686 13 7 13C10.314 13 13 10.314 13 7C13 3.686 10.314 1 7 1Z" fill="white" fillOpacity="0.3" />
            <path d="M5 4.5C5 4.224 5.224 4 5.5 4H8.5C8.776 4 9 4.224 9 4.5V6.5C9 6.776 8.776 7 8.5 7H5.5C5.224 7 5 6.776 5 6.5V4.5Z" fill="white" />
            <path d="M5.5 8H8.5C8.776 8 9 8.224 9 8.5V9.5C9 9.776 8.776 10 8.5 10H5.5C5.224 10 5 9.776 5 9.5V8.5C5 8.224 5.224 8 5.5 8Z" fill="white" fillOpacity="0.7" />
          </svg>
        </div>
        <span className="font-bold text-sm text-ink tracking-tight">Workly</span>
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-1 bg-bg-sidebar rounded-xl p-1">
        {([
          { key: 'board',    label: 'Tahvel',     icon: Kanban      },
          { key: 'table',    label: 'Tabel',       icon: Table2      },
          { key: 'calendar', label: 'Kalender',    icon: CalendarDays },
          { key: 'stats',    label: 'Statistika',  icon: BarChart2   },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
              view === key
                ? 'bg-bg-card text-ink shadow-card'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <ImportCSVButton onSuccess={onImportDone} />
        <button
          onClick={onSettings}
          className="btn-ghost p-2"
          title="Seaded"
        >
          <Settings size={15} />
        </button>
        <button onClick={onNewJob} className="btn-primary">
          <Plus size={14} />
          Uus töö
        </button>
      </div>
    </header>
  )
}
