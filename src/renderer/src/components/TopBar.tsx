import { Plus, Search } from 'lucide-react'
import { useSettings } from '../stores/useSettings'
import { ImportCSVButton } from './ImportCSVButton'

interface TopBarProps {
  search: string
  onSearchChange: (v: string) => void
  onNewJob: () => void
  onImportDone: () => void
}

// Navigation moved to the Sidebar in 1.1.0 — this strip is now search + actions
// only. The h-[56px] flex-shrink-0 sizing stays byte-for-byte: every view's
// height contract is measured against it.
export function TopBar({ search, onSearchChange, onNewJob, onImportDone }: TopBarProps) {
  const { settings } = useSettings()
  const nimi = settings.kasutajaNimi.trim()
  const initials = nimi
    ? nimi.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
    : null

  return (
    <header className="flex items-center gap-3 px-5 py-3 bg-bg-card border-b border-ink-faint/15 flex-shrink-0 h-[56px]">
      <div className="relative w-full max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Otsi patsienti, tööd…"
          className="input pl-8 py-1.5 text-sm"
        />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <ImportCSVButton onSuccess={onImportDone} />
        <button onClick={onNewJob} className="btn-primary">
          <Plus size={14} />
          Uus töö
        </button>

        {/* Technician chip. Real data from Seaded → Sinu nimi, not an account —
            there is no login, so an avatar menu would be decoration. */}
        {initials && (
          <div className="flex items-center gap-2 pl-2 ml-1 border-l border-ink-faint/20" title="Seaded → Sinu nimi">
            <span className="w-7 h-7 rounded-full bg-accent-light text-accent-dark flex items-center justify-center text-[11px] font-bold flex-shrink-0">
              {initials}
            </span>
            <span className="text-xs font-medium text-ink truncate max-w-[130px]">{nimi}</span>
          </div>
        )}
      </div>
    </header>
  )
}
