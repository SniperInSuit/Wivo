import { LayoutDashboard, Kanban, CalendarDays, Table2, Users, BarChart2, Settings } from 'lucide-react'
import type { ViewMode } from '../types/view'

interface SidebarProps {
  view: ViewMode
  onViewChange: (v: ViewMode) => void
  onSettings: () => void
}

const NAV = ([
  { key: 'overview', label: 'Ülevaade',   icon: LayoutDashboard },
  { key: 'board',    label: 'Tööd',       icon: Kanban          },
  { key: 'calendar', label: 'Kalender',   icon: CalendarDays    },
  { key: 'table',    label: 'Tabel',      icon: Table2          },
  { key: 'patients', label: 'Patsiendid', icon: Users           },
  { key: 'stats',    label: 'Statistika', icon: BarChart2       },
] as const)

export function Sidebar({ view, onViewChange, onSettings }: SidebarProps) {
  return (
    // Normal flow, not position:fixed — the fixed panels (JobDetailPanel,
    // SettingsPanel) are viewport-anchored and are meant to overlay this.
    <aside className="w-[76px] flex-shrink-0 h-full flex flex-col bg-bg-sidebar border-r border-ink-faint/15">
      {/* pt-9 clears the macOS traffic lights (main/index.ts titleBarStyle:'hiddenInset').
          [-webkit-app-region:drag] restores the window drag this strip would otherwise eat. */}
      <div className="flex items-center justify-center pt-9 pb-4 [-webkit-app-region:drag]" title="Workly">
        <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1C3.686 1 1 3.686 1 7C1 10.314 3.686 13 7 13C10.314 13 13 10.314 13 7C13 3.686 10.314 1 7 1Z" fill="white" fillOpacity="0.3" />
            <path d="M5 4.5C5 4.224 5.224 4 5.5 4H8.5C8.776 4 9 4.224 9 4.5V6.5C9 6.776 8.776 7 8.5 7H5.5C5.224 7 5 6.776 5 6.5V4.5Z" fill="white" />
            <path d="M5.5 8H8.5C8.776 8 9 8.224 9 8.5V9.5C9 9.776 8.776 10 8.5 10H5.5C5.224 10 5 9.776 5 9.5V8.5C5 8.224 5.224 8 5.5 8Z" fill="white" fillOpacity="0.7" />
          </svg>
        </div>
      </div>

      {/* no-drag: without it the drag region above would swallow every nav click */}
      <nav className="flex-1 overflow-y-auto px-1.5 space-y-1 [-webkit-app-region:no-drag]">
        {NAV.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            title={label}
            className={`w-full flex flex-col items-center gap-1 px-1 py-2 rounded-lg font-medium transition-all duration-150 ${
              view === key
                ? 'bg-bg-card text-ink shadow-card'
                : 'text-ink-muted hover:text-ink hover:bg-bg-card/60'
            }`}
          >
            <Icon size={17} />
            {/* 10px + leading-none keeps the longest label (Statistika) on one
                line at 76px without truncating */}
            <span className="text-[10px] leading-none tracking-tight">{label}</span>
          </button>
        ))}

        <div className="pt-2 mt-2 border-t border-ink-faint/10">
          {/* Seaded is an ACTION, not a view — it must call onSettings, never
              onViewChange. App.tsx has no render branch for a 'settings' view,
              so routing to one would silently blank <main>. */}
          <button
            onClick={onSettings}
            title="Seaded"
            className="w-full flex flex-col items-center gap-1 px-1 py-2 rounded-lg font-medium text-ink-muted hover:text-ink hover:bg-bg-card/60 transition-all duration-150"
          >
            <Settings size={17} />
            <span className="text-[10px] leading-none tracking-tight">Seaded</span>
          </button>
        </div>
      </nav>

      <div className="mt-auto py-2.5 border-t border-ink-faint/10 text-center">
        <span className="text-[9px] text-ink-faint font-mono">v{__APP_VERSION__}</span>
      </div>
    </aside>
  )
}
