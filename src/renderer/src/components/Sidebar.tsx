import {
  LayoutDashboard, Kanban, CalendarDays, Table2, Users, BarChart2, Settings,
  PanelLeftClose, PanelLeftOpen, UsersRound, FileText, Wallet, Building2, Inbox
} from 'lucide-react'
import type { ViewMode } from '../types/view'
import wivoLogo from '../assets/Wivo Logo.png'
import { useSettings } from '../stores/useSettings'
import { useAuth } from '../context/AuthContext'
import { usePermissions, type PermissionKey } from '../hooks/usePermissions'
import { useAppVersion } from '../hooks/useAppVersion'
import { useNewRequestCount } from '../hooks/useVisitRequests'

interface SidebarProps {
  view: ViewMode
  onViewChange: (v: ViewMode) => void
}

// `clinical: true` = only in WivoDental/WivoX. `lab: true` = only in
// WivoLab/WivoX. Unmarked items (Ülevaade, Kalender, Arved, Töötasud,
// Statistika) belong to both products: a practice invoices and pays staff
// exactly like a laboratory does.
const NAV: {
  key: ViewMode; label: string; icon: typeof LayoutDashboard
  perm?: PermissionKey; clinical?: boolean; lab?: boolean
}[] = [
  { key: 'overview', label: 'Ülevaade',   icon: LayoutDashboard },
  { key: 'board',    label: 'Tööd',       icon: Kanban,          perm: 'jobs.read', lab: true },
  { key: 'calendar', label: 'Kalender',   icon: CalendarDays,    perm: 'visits.read' },
  { key: 'taotlused', label: 'Taotlused', icon: Inbox,           perm: 'visits.write' },
  { key: 'table',    label: 'Tabel',      icon: Table2,          perm: 'jobs.read', lab: true },
  { key: 'patients', label: 'Patsiendid', icon: Users,           perm: 'patients.read', clinical: true },
  { key: 'kliendid', label: 'Kliendid',   icon: Building2,       perm: 'jobs.read', lab: true },
  { key: 'arved',    label: 'Arved',      icon: FileText,        perm: 'payments.read' },
  { key: 'tootasud', label: 'Töötasud',   icon: Wallet },
  { key: 'stats',    label: 'Statistika', icon: BarChart2,       perm: 'stats.read' },
]

// Seaded is its own view (since 1.1.6) but stays visually separated below a rule
const SETTINGS_ITEM = { key: 'settings', label: 'Seaded', icon: Settings } as const

export function Sidebar({ view, onViewChange }: SidebarProps) {
  const { settings, toggleRiba } = useSettings()
  const { role } = useAuth()
  const { can } = usePermissions()
  const { running } = useAppVersion()
  const newRequests = useNewRequestCount()
  const wide = settings.ribaLaiendatud

  // Shared by the nav items and Seaded so the active treatment never drifts
  const itemClass = (active: boolean) =>
    `w-full flex items-center rounded-lg font-medium transition-all duration-150 ${
      wide ? 'gap-2.5 px-3 py-2 text-sm' : 'flex-col gap-1 px-1 py-2'
    } ${active
      ? 'bg-bg-card text-ink shadow-card'
      : 'text-nav hover:text-white hover:bg-nav/10'}`

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
        title="Wivo"
      >
        <img src={wivoLogo} alt="Wivo" className="w-[50px] h-[50px] rounded-xl flex-shrink-0" />
        {wide && <span className="font-bold text-sm text-nav tracking-tight">Wivo</span>}
      </div>

      {/* no-drag: without it the drag region above would swallow every nav click */}
      <nav className={`flex-1 overflow-y-auto space-y-1 [-webkit-app-region:no-drag] ${wide ? 'px-2' : 'px-1.5'}`}>
        {NAV
          .filter(item => !item.clinical || settings.kliinilineRezhiim)
          .filter(item => !item.lab || settings.laboriRezhiim)
          .filter(item => !item.perm || can(item.perm))
          .map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            title={label}
            className={`${itemClass(view === key)} relative`}
          >
            <Icon size={wide ? 15 : 17} className="flex-shrink-0" />
            <span className={wide ? 'truncate' : 'text-[10px] leading-none tracking-tight'}>{label}</span>
            {/* Somebody asked for an appointment and nobody has looked yet.
                It has to be visible from wherever you are, or the inbox is a
                page people remember to open, which is not a system. */}
            {/* RED, not the accent colour. Every other teal thing in this app
                is a place you MAY go; this is a person waiting for an answer,
                and it should read as "deal with me" from across the room.
                No ring: the rail is dark and an active item is light, so any
                single ring colour would be wrong against one of them. */}
            {key === 'taotlused' && newRequests > 0 && (
              <span
                title={`${newRequests} uut taotlust ootab vastust`}
                className={`text-[10px] font-bold rounded-full bg-red-500 text-white min-w-[17px] h-[17px] px-1 flex items-center justify-center ${
                  wide ? 'ml-auto' : 'absolute top-0.5 right-0.5'
                }`}
              >
                {newRequests > 99 ? '99+' : newRequests}
              </span>
            )}
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

          {role === 'owner' && (
            <button
              onClick={() => onViewChange('workers')}
              title="Meeskond"
              className={itemClass(view === 'workers')}
            >
              <UsersRound size={wide ? 15 : 17} className="flex-shrink-0" />
              <span className={wide ? 'truncate' : 'text-[10px] leading-none tracking-tight'}>
                Meeskond
              </span>
            </button>
          )}
        </div>
      </nav>

      <div className="mt-auto border-t border-nav/10">
        <button
          onClick={toggleRiba}
          title={wide ? 'Minimeeri külgriba' : 'Laienda külgriba'}
          className={`w-full flex items-center text-nav hover:text-white transition-colors ${
            wide ? 'gap-2.5 px-4 py-2.5 text-xs' : 'justify-center py-2.5'
          }`}
        >
          {wide ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={16} />}
          {wide && 'Minimeeri'}
        </button>
        <div className={`pb-2.5 ${wide ? 'px-4' : 'text-center'}`}>
          {/* The LIVE version, not the build-time constant — the constant goes
              stale in dev and reported a version the app was not running. */}
          <span className="text-[9px] text-nav-muted/70 font-mono">v{running}</span>
        </div>
      </div>
    </aside>
  )
}
