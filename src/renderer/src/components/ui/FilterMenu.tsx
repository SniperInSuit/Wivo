/**
 * The two menus every list view filters with.
 *
 * `MultiFilterMenu` started life inside CalendarView. The table needed the same
 * thing — a searchable, checkable list that does not push the toolbar onto a
 * second row — so it moved here rather than being copied. Two dropdowns that
 * drift apart is how you end up with a search box in one view and not the
 * other.
 */
import { useState, useRef, useEffect } from 'react'
import { Search, CheckCircle2, ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** Close when the click lands anywhere outside `ref`. */
function useCloseOnOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])
  return ref
}

// ─── Single choice ────────────────────────────────────────────────────────────
// The button shows the CURRENT value, not the filter's name: a toolbar that
// reads "Periood" tells you nothing, one that reads "See kuu" tells you why the
// list is short.

export function SelectMenu<T extends string>({ icon: Icon, value, options, onChange }: {
  icon?: LucideIcon
  value: T
  options: { key: T; label: string }[]
  onChange: (v: T) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useCloseOnOutside(open, () => setOpen(false))
  const current = options.find(o => o.key === value) ?? options[0]
  const isDefault = value === options[0]?.key

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
          isDefault ? 'text-ink-muted hover:text-ink bg-bg-sidebar' : 'chip-active'
        }`}
      >
        {Icon && <Icon size={12} />}
        {current?.label}
        <ChevronDown size={12} className="opacity-60" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-bg-card border border-ink-faint/20 rounded-xl shadow-panel w-44 py-1">
          {options.map(o => (
            <button
              key={o.key}
              onClick={() => { onChange(o.key); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                o.key === value ? 'bg-accent/10 text-accent font-medium' : 'text-ink-muted hover:bg-bg-sidebar'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Many choices ─────────────────────────────────────────────────────────────

export function MultiFilterMenu({
  label, icon: Icon, options, selected, onChange, full, swatches, counts,
}: {
  label: string
  icon?: LucideIcon
  options: string[]
  selected: Set<string>
  onChange: (v: Set<string>) => void
  full?: boolean                      // stretch to the popover width instead of hugging the label
  swatches?: Record<string, string>   // optional colour key, by option
  counts?: Record<string, number>     // how many rows each option would leave
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useCloseOnOutside(open, () => setOpen(false))

  const toggle = (item: string) => {
    const next = new Set(selected)
    next.has(item) ? next.delete(item) : next.add(item)
    onChange(next)
  }

  // A clinic has hundreds of patients; scrolling a list that long to find one
  // name is not a filter, it is a haystack. Selected options always stay
  // visible so a search cannot hide what is already active.
  const q = query.trim().toLowerCase()
  const shown = q
    ? options.filter(o => o.toLowerCase().includes(q) || selected.has(o))
    : options

  return (
    <div className={`relative ${full ? 'w-full' : 'flex-shrink-0'}`} ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
          full ? 'w-full justify-between' : ''
        } ${
          selected.size > 0 ? 'chip-active' : 'text-ink-muted hover:text-ink bg-bg-sidebar'
        }`}
      >
        {Icon && <Icon size={12} />}
        {label}
        {selected.size > 0 && <>· {selected.size}</>}
        <ChevronDown size={12} className="opacity-60" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-bg-card border border-ink-faint/20 rounded-xl shadow-panel w-56 max-h-72 overflow-hidden py-1 flex flex-col">
          {options.length > 6 && (
            <div className="px-2 pb-1.5 pt-0.5 flex-shrink-0">
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={`Otsi… (${options.length})`}
                  className="input py-1 pl-6 pr-2 text-xs w-full"
                />
              </div>
            </div>
          )}
          <div className="overflow-y-auto">
            {options.length === 0 ? (
              <p className="text-xs text-ink-faint px-3 py-2">Andmed puuduvad</p>
            ) : shown.length === 0 ? (
              <p className="text-xs text-ink-faint px-3 py-2">Vastet ei leitud</p>
            ) : shown.map(opt => (
              <button
                key={opt}
                onClick={() => toggle(opt)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                  selected.has(opt) ? 'bg-accent/10 text-accent font-medium' : 'text-ink-muted hover:bg-bg-sidebar'
                }`}
              >
                <span className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                  selected.has(opt) ? 'bg-accent border-accent' : 'border-ink-faint'
                }`}>
                  {selected.has(opt) && <CheckCircle2 size={8} className="text-white" />}
                </span>
                {swatches?.[opt] && (
                  <span
                    className="w-2.5 h-2.5 rounded flex-shrink-0"
                    style={{ backgroundColor: swatches[opt] }}
                  />
                )}
                <span className="truncate">{opt}</span>
                {counts?.[opt] !== undefined && (
                  <span className="ml-auto text-ink-faint tabular-nums flex-shrink-0">{counts[opt]}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
