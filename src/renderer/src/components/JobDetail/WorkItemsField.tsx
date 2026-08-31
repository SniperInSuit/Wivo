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
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { WorkItem } from '../../types/job'
import { useWorkTypes } from '../../stores/useSettings'
import { workTypeRules } from '@shared/wizard'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { MultiOdontogramPicker } from './MultiOdontogramPicker'
import { AbutmentField } from './AbutmentField'
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
  // Only to LABEL a per-item designer, never to pick one — that field is set on
  // the job page, where the job's own designer is on screen to inherit from.
  const { data: clinicWorkers = [] } = useClinicProfiles()
  const [showAllTypes, setShowAllTypes] = useState(false)
  // Which item has its per-tooth abutment rows open. One at a time: the list is
  // an exception editor, not something to leave unfolded on every item.
  const [perToothFor, setPerToothFor] = useState<string | null>(null)

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

  // Whether the items name more than one designer between them. Only then is a
  // per-chip name worth the space — otherwise it repeats the Disainija field.
  const splitDesign = new Set(value.map(i => i.designed_by ?? null)).size > 1

  // "Sild 1" / "Sild 2" only once a type actually repeats — numbering a lone
  // item would imply a second one exists somewhere.
  const perType = new Map<string, number>()
  for (const i of value) perType.set(i.too, (perType.get(i.too) ?? 0) + 1)
  const seen = new Map<string, number>()

  return (
    <div className="space-y-2">
      {showTypePicker && (() => {
        const hasSelected = value.length > 0
        const visibleTypes = showAllTypes || !hasSelected
          ? wt.types
          : wt.types.filter(t => value.some(i => i.too === t.nimi))

        return (
        <>
        <div className={`grid gap-2 ${TYPE_GRID_COLS[typeColumns]}`}>
          {visibleTypes.map(t => {
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
                className={`relative rounded-xl border-2 overflow-hidden text-center transition-all duration-150 disabled:opacity-50 ${
                  picked
                    ? 'border-accent bg-accent/5 shadow-card'
                    : `${c.typeBorder} bg-white hover:shadow-sm`
                }`}
              >
                {picked && (
                  <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                    <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>
                )}
                <span className="flex h-14 items-center justify-center p-1.5">
                  {img
                    ? <img src={img} alt="" className="h-full object-contain" />
                    : <span className="w-5 h-5 rounded-full" style={{ backgroundColor: t.hex }} />
                  }
                </span>
                <span className={`block px-1 pb-1.5 text-[11px] font-semibold truncate ${
                  picked ? 'text-accent' : c.typeLabel
                }`}>
                  {t.nimi}
                </span>
                {t.hind != null && (
                  <span className={`block px-1 pb-1 text-[9px] tabular-nums ${
                    picked ? 'text-accent/70' : 'text-ink-faint'
                  }`}>
                    {t.hind.toFixed(0)} € / {t.hinnaTyyp === 'hammas' ? 'hammas' : 'töö'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {hasSelected && (
          <button
            type="button"
            onClick={() => setShowAllTypes(!showAllTypes)}
            className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors ${
              dark ? 'text-slate-400 hover:text-slate-200' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {showAllTypes ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showAllTypes ? 'Peida' : `Näita kõiki (${wt.types.length})`}
          </button>
        )}
        </>
        )
      })()}

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
                  {splitDesign && (() => {
                    const name = clinicWorkers.find(w => w.id === item.designed_by)?.full_name ?? ''
                    return (
                      <span
                        title={`Disainija: ${name || '—'}`}
                        className="text-[9px] text-accent bg-accent/10 px-1 py-0.5 rounded truncate max-w-[70px]"
                      >
                        ✎ {name.split(' ')[0] || '—'}
                      </span>
                    )
                  })()}
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

      {/* Screw/abutment. `supportsAbutment` rather than a regex written here:
          the same classifier the wizard uses, so "Abutmendile kroon" is
          recognised on both screens instead of only the one whose regex
          happened to list it. */}
      {(() => {
        const activeItem = value.find(i => i.id === activeId)
        if (!activeItem) return null
        if (!workTypeRules(activeItem.too, wt.types).supportsAbutment) return null
        return (
          <AbutmentField
            item={activeItem}
            disabled={disabled}
            dark={dark}
            open={perToothFor === activeItem.id}
            onToggleOpen={() => setPerToothFor(perToothFor === activeItem.id ? null : activeItem.id)}
            onChange={patch => onChange(
              value.map(i => i.id === activeItem.id ? { ...i, ...patch } : i)
            )}
          />
        )
      })()}

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
              <MultiOdontogramPicker
                items={[{ id: '__loose__', too: 'Hambad', hambad: looseTeeth ?? '' }]}
                activeItemId="__loose__"
                colorMap={{ Hambad: '#0AB6C4' }}
                onToggleTooth={tooth => {
                  const teeth = new Set((looseTeeth ?? '').split(',').map(t => t.trim()).filter(Boolean))
                  const s = String(tooth)
                  teeth.has(s) ? teeth.delete(s) : teeth.add(s)
                  onLooseTeethChange([...teeth].join(','))
                }}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}
