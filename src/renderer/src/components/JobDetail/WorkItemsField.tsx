/**
 * Picking work types and their teeth — THE implementation.
 *
 * A job and a revision are the same problem: one or more pieces of work, each a
 * type applied to some teeth, some of them bridges, laid out on one odontogram.
 * They had two different editors, and the revision's was the poorer of the two —
 * its type buttons TOGGLED, so clicking "Sild" when a bridge already existed
 * deleted it instead of adding a second one. A lab with two bridges in one case
 * could record them on the job and not on the remake of that same job.
 *
 * The distinction between two items of one type is already handled downstream:
 * MultiOdontogramPicker hue-shifts each same-type item, numbers its teeth, and
 * dashes the second bridge's connector. All that was ever missing was a way to
 * create the second item, which is what the `+` on each chip does.
 *
 * The parent owns `activeId` because both callers use it for more than this
 * field — the job page drives its material selector from it, and the fullscreen
 * layout renders the odontogram in a different column entirely.
 */
import type { WorkItem } from '../../types/job'
import { useWorkTypes } from '../../stores/useSettings'
import { MultiOdontogramPicker } from './MultiOdontogramPicker'
import { OdontogramPicker } from './OdontogramPicker'
import { workTypeImage } from '../../lib/workTypeImages'

export interface WorkItemsFieldProps {
  value: WorkItem[]
  onChange: (items: WorkItem[]) => void
  /** Which item the odontogram's clicks land on. Null = clicks do nothing. */
  activeId: string | null
  onActiveChange: (id: string | null) => void
  /** The type grid. Off when the caller renders it in another column. */
  showTypePicker?: boolean
  /** The odontogram. Off for the same reason. */
  showOdontogram?: boolean
  /**
   * Teeth to fall back on while no work item exists at all. Only the revision
   * uses this: a remake may just say "these teeth" without naming a type, and
   * dropping that would lose data already in the field.
   */
  looseTeeth?: string
  onLooseTeethChange?: (hambad: string) => void
  disabled?: boolean
  /**
   * The fullscreen revision editor paints itself slate-900 whatever theme is
   * active, so the theme's own ink and surface tokens would put dark text on a
   * dark panel there. This is the one place a hardcoded palette is right.
   */
  dark?: boolean
  /**
   * Columns in the type grid. More columns means fewer ROWS, which is what
   * actually decides whether the odontogram below it needs scrolling to.
   */
  typeColumns?: 3 | 4 | 5 | 6
}

/** Static class names, because Tailwind cannot see a computed one. */
const TYPE_GRID_COLS: Record<3 | 4 | 5 | 6, string> = {
  3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6',
}

/** Auto-mark as a bridge when the type says so, so nobody has to click twice. */
const looksLikeBridge = (nimi: string): boolean => /sild|bridge/i.test(nimi)

export function WorkItemsField({
  value, onChange, activeId, onActiveChange,
  showTypePicker = true, showOdontogram = true,
  looseTeeth, onLooseTeethChange, disabled,
  dark = false, typeColumns = 3,
}: WorkItemsFieldProps) {
  const wt = useWorkTypes()

  const colorMap: Record<string, string> = {}
  for (const t of wt.types) colorMap[t.nimi] = t.hex

  // Two palettes, one layout. Everything below picks from here rather than
  // inlining a conditional per class, so a new surface only edits this block.
  const c = dark
    ? {
        typeBorder: 'border-slate-600 hover:border-accent/50',
        typeLabel: 'text-slate-200',
        chipHover: 'hover:border-slate-500',
        faint: 'text-slate-500',
        matBadge: 'bg-slate-700/50',
        surface: 'bg-slate-800/60',
      }
    : {
        typeBorder: 'border-ink-faint/25 hover:border-accent/40',
        typeLabel: 'text-ink',
        chipHover: 'hover:border-ink-faint/30',
        faint: 'text-ink-faint',
        matBadge: 'bg-bg-sidebar/50',
        surface: 'bg-bg-sidebar',
      }

  /** Clicking a type in the grid: add one, or clear every item of that type. */
  function toggleType(nimi: string) {
    if (disabled) return
    if (value.some(i => i.too === nimi)) {
      const next = value.filter(i => i.too !== nimi)
      onChange(next)
      if (!next.some(i => i.id === activeId)) onActiveChange(next[0]?.id ?? null)
      return
    }
    const item: WorkItem = {
      id: crypto.randomUUID(),
      too: nimi,
      hambad: '',
      ...(looksLikeBridge(nimi) ? { bridge: true } : {}),
    }
    onChange([...value, item])
    onActiveChange(item.id)
  }

  /** The whole point: a second bridge, next to the first, teeth of its own. */
  function duplicate(item: WorkItem) {
    if (disabled) return
    const copy: WorkItem = {
      id: crypto.randomUUID(),
      too: item.too,
      hambad: '',
      ...(item.bridge ? { bridge: true } : {}),
      ...(item.materjal ? { materjal: item.materjal } : {}),
    }
    const next = [...value]
    next.splice(value.findIndex(i => i.id === item.id) + 1, 0, copy)
    onChange(next)
    onActiveChange(copy.id)
  }

  function remove(id: string) {
    if (disabled) return
    const next = value.filter(i => i.id !== id)
    onChange(next)
    if (activeId === id) onActiveChange(next[0]?.id ?? null)
  }

  function toggleBridge(id: string) {
    if (disabled) return
    onChange(value.map(i => i.id === id ? { ...i, bridge: !i.bridge } : i))
  }

  /** A tooth belongs to exactly one item — clicks never steal it from another. */
  function toggleTooth(tooth: number) {
    if (disabled || !activeId) return
    const s = String(tooth)
    const ownedByOther = value.some(
      i => i.id !== activeId && i.hambad.split(',').map(t => t.trim()).includes(s)
    )
    if (ownedByOther) return
    onChange(value.map(item => {
      if (item.id !== activeId) return item
      const teeth = new Set(item.hambad.split(',').map(t => t.trim()).filter(Boolean))
      teeth.has(s) ? teeth.delete(s) : teeth.add(s)
      return { ...item, hambad: [...teeth].join(',') }
    }))
  }

  // "Sild 1" / "Sild 2" only once a type actually repeats — numbering a lone
  // item would imply a second one exists somewhere.
  const perType = new Map<string, number>()
  for (const i of value) perType.set(i.too, (perType.get(i.too) ?? 0) + 1)
  const seen = new Map<string, number>()

  return (
    <div className="space-y-2">
      {showTypePicker && (
        <div className={`grid gap-1.5 ${TYPE_GRID_COLS[typeColumns]}`}>
          {wt.types.map(t => {
            const picked = value.some(i => i.too === t.nimi)
            const img = workTypeImage(t.nimi, t.pilt)
            return (
              <button
                key={t.nimi}
                type="button"
                disabled={disabled}
                onClick={() => toggleType(t.nimi)}
                title={t.hind != null
                  ? `${t.hind.toFixed(2)} € ${t.hinnaTyyp === 'hammas' ? '/ hammas' : '/ töö'}`
                  : t.nimi}
                className={`relative rounded-lg border-2 overflow-hidden text-left transition-all duration-100 disabled:opacity-50 ${
                  picked ? 'border-accent shadow-card' : c.typeBorder
                }`}
              >
                <span
                  className="flex h-10 items-center justify-center"
                  style={{ backgroundColor: `${t.hex}${picked ? '30' : '1f'}` }}
                >
                  {img
                    ? <img src={img} alt="" className="h-full w-full object-cover" />
                    : <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.hex }} />
                  }
                </span>
                <span className={`block px-1.5 py-1 text-[11px] font-medium truncate ${c.typeLabel}`}>
                  {t.nimi}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {value.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {value.map(item => {
            const hex = colorMap[item.too] ?? '#94A3B8'
            const isActive = item.id === activeId
            const teethCount = item.hambad.split(',').filter(t => t.trim()).length
            const n = (seen.get(item.too) ?? 0) + 1
            seen.set(item.too, n)
            const label = (perType.get(item.too) ?? 1) > 1 ? `${item.too} ${n}` : item.too

            return (
              <div key={item.id} className="flex items-center gap-0">
                <button
                  type="button"
                  onClick={() => onActiveChange(isActive ? null : item.id)}
                  className={`flex items-center gap-1.5 text-xs font-medium pl-2.5 pr-1.5 py-1.5 rounded-l-lg border-2 border-r-0 transition-all ${
                    isActive ? 'border-accent bg-accent/10' : `border-transparent ${c.chipHover}`
                  }`}
                  style={{ backgroundColor: isActive ? undefined : `${hex}15` }}
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                  <span style={{ color: isActive ? '#0AB6C4' : hex }}>{label}</span>
                  {teethCount > 0 && <span className={`text-[10px] ${c.faint}`}>{teethCount}</span>}
                  {item.materjal && (
                    <span className={`text-[9px] ${c.faint} ${c.matBadge} px-1 py-0.5 rounded truncate max-w-[80px]`}>
                      {item.materjal}
                    </span>
                  )}
                  <span
                    role="button"
                    onClick={e => { e.stopPropagation(); toggleBridge(item.id) }}
                    title={item.bridge ? 'Eemalda silla märge' : 'Märgi sillaks'}
                    className={`text-[10px] px-1 py-0.5 rounded transition-colors ${
                      item.bridge ? 'bg-accent/20 text-accent' : c.faint
                    }`}
                  >
                    {item.bridge ? '⛓ sild' : '⛓'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  title={`Lisa veel üks ${item.too}`}
                  onClick={e => { e.stopPropagation(); duplicate(item) }}
                  className={`text-[10px] font-bold px-1 py-1.5 border-2 border-l-0 transition-colors disabled:opacity-40 ${
                    isActive
                      ? 'border-accent bg-accent/5 text-accent hover:bg-accent/15'
                      : `border-transparent ${c.faint}`
                  }`}
                  style={{ backgroundColor: isActive ? undefined : `${hex}08` }}
                >
                  +
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  title="Eemalda"
                  onClick={e => { e.stopPropagation(); remove(item.id) }}
                  className={`text-[10px] font-bold px-1 py-1.5 rounded-r-lg border-2 border-l-0 transition-colors disabled:opacity-40 ${
                    isActive
                      ? 'border-accent bg-accent/5 text-red-400 hover:text-red-500'
                      : `border-transparent ${c.faint} hover:text-red-400`
                  }`}
                  style={{ backgroundColor: isActive ? undefined : `${hex}08` }}
                >
                  ×
                </button>
              </div>
            )
          })}
          <p className={`text-[10px] ${c.faint}`}>
            {activeId ? 'Klõpsa hammastel' : 'Vali tööosa, et hambaid märkida'}
          </p>
        </div>
      )}

      {showOdontogram && (
        <div className={`${c.surface} rounded-xl p-3`}>
          {value.length > 0 ? (
            <MultiOdontogramPicker
              items={value}
              activeItemId={activeId}
              colorMap={colorMap}
              onToggleTooth={toggleTooth}
              disabled={disabled}
            />
          ) : (
            // No work item yet. The revision still lets teeth be marked on their
            // own; the job page passes no handler and simply shows nothing.
            onLooseTeethChange && (
              <OdontogramPicker
                value={looseTeeth ?? ''}
                onChange={onLooseTeethChange}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}
