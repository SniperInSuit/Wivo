import {
  LayoutDashboard, Kanban, CalendarDays, Table2, Users, BarChart2, Settings,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react'
import type { ViewMode } from '../types/view'
import { useSettings } from '../stores/useSettings'

interface SidebarProps {
  view: ViewMode
  onViewChange: (v: ViewMode) => void
}

const NAV = ([
  { key: 'overview', label: 'Ülevaade',   icon: LayoutDashboard },
  { key: 'board',    label: 'Tööd',       icon: Kanban          },
  { key: 'calendar', label: 'Kalender',   icon: CalendarDays    },
  { key: 'table',    label: 'Tabel',      icon: Table2          },
  { key: 'patients', label: 'Patsiendid', icon: Users           },
  { key: 'stats',    label: 'Statistika', icon: BarChart2       },
] as const)

// Seaded is its own view (since 1.1.6) but stays visually separated below a rule
const SETTINGS_ITEM = { key: 'settings', label: 'Seaded', icon: Settings } as const

export function Sidebar({ view, onViewChange }: SidebarProps) {
  const { settings, toggleRiba } = useSettings()
  const wide = settings.ribaLaiendatud

  // Shared by the nav items and Seaded so the active treatment never drifts
  const itemClass = (active: boolean) =>
    `w-full flex items-center rounded-lg font-medium transition-all duration-150 ${
      wide ? 'gap-2.5 px-3 py-2 text-sm' : 'flex-col gap-1 px-1 py-2'
    } ${active
      ? 'bg-bg-card text-ink shadow-card'
      : 'text-nav-muted hover:text-nav hover:bg-nav/10'}`

  return (
    // Normal flow, not position:fixed — the fixed panels (JobDetailPanel) are
    // viewport-anchored and are meant to overlay this.
    <aside
      className={`${wide ? 'w-[190px]' : 'w-[76px]'} flex-shrink-0 h-full flex flex-col bg-nav-bg border-r border-nav/10 transition-[width] duration-200`}
    >
      {/* pt-9 clears the macOS traffic lights (main/index.ts titleBarStyle:'hiddenInset').
          [-webkit-app-region:drag] restores the window drag this strip would otherwise eat. */}
      <div
        className={`flex items-center pt-9 pb-4 [-webkit-app-region:drag] ${wide ? 'gap-2.5 px-4' : 'justify-center'}`}
        title="Workly"
      >
        <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1C3.686 1 1 3.686 1 7C1 10.314 3.686 13 7 13C10.314 13 13 10.314 13 7C13 3.686 10.314 1 7 1Z" fill="white" fillOpacity="0.3" />
            <path d="M5 4.5C5 4.224 5.224 4 5.5 4H8.5C8.776 4 9 4.224 9 4.5V6.5C9 6.776 8.776 7 8.5 7H5.5C5.224 7 5 6.776 5 6.5V4.5Z" fill="white" />
            <path d="M5.5 8H8.5C8.776 8 9 8.224 9 8.5V9.5C9 9.776 8.776 10 8.5 10H5.5C5.224 10 5 9.776 5 9.5V8.5C5 8.224 5.224 8 5.5 8Z" fill="white" fillOpacity="0.7" />
          </svg>
        </div>
        {wide && <span className="font-bold text-sm text-nav tracking-tight">Workly</span>}
      </div>

      {/* no-drag: without it the drag region above would swallow every nav click */}
      <nav className={`flex-1 overflow-y-auto space-y-1 [-webkit-app-region:no-drag] ${wide ? 'px-2' : 'px-1.5'}`}>
        {NAV.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            title={label}
            className={itemClass(view === key)}
          >
            <Icon size={wide ? 15 : 17} className="flex-shrink-0" />
            <span className={wide ? 'truncate' : 'text-[10px] leading-none tracking-tight'}>{label}</span>
          </button>
        ))}

        <div className="pt-2 mt-2 border-t border-nav/15">
          <button
            onClick={() => onViewChange(SETTINGS_ITEM.key)}
            title={SETTINGS_ITEM.label}
            className={itemClass(view === SETTINGS_ITEM.key)}
          >
            <SETTINGS_ITEM.icon size={wide ? 15 : 17} className="flex-shrink-0" />
            <span className={wide ? 'truncate' : 'text-[10px] leading-none tracking-tight'}>
              {SETTINGS_ITEM.label}
            </span>
          </button>
        </div>
      </nav>

      <div className="mt-auto border-t border-nav/10">
        <button
          onClick={toggleRiba}
          title={wide ? 'Minimeeri külgriba' : 'Laienda külgriba'}
          className={`w-full flex items-center text-nav-muted hover:text-nav transition-colors ${
            wide ? 'gap-2.5 px-4 py-2.5 text-xs' : 'justify-center py-2.5'
          }`}
        >
          {wide ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={16} />}
          {wide && 'Minimeeri'}
        </button>
        <div className={`pb-2.5 ${wide ? 'px-4' : 'text-center'}`}>
          <span className="text-[9px] text-nav-muted/70 font-mono">v{__APP_VERSION__}</span>
        </div>
      </div>
    </aside>
  )
}
