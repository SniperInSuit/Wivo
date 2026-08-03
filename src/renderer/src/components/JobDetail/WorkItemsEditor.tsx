/**
 * WorkItemsEditor — manages multiple work items within a job.
 * Each item has a work type + teeth selection. The shared odontogram
 * shows all items' teeth in their type's color.
 */
import { useState } from 'react'
import { Plus, Trash2, Link2 } from 'lucide-react'
import type { WorkItem } from '../../types/job'
import { useWorkTypes } from '../../stores/useSettings'
import { MultiOdontogramPicker } from './MultiOdontogramPicker'
import { workTypeImage } from '../../lib/workTypeImages'

interface WorkItemsEditorProps {
  value: WorkItem[]
  onChange: (items: WorkItem[]) => void
  disabled?: boolean
}

export function WorkItemsEditor({ value, onChange, disabled }: WorkItemsEditorProps) {
  const wt = useWorkTypes()
  const [activeId, setActiveId] = useState<string | null>(value[0]?.id ?? null)
  const [addingType, setAddingType] = useState(false)

  // Build color map: work type name → hex
  const colorMap: Record<string, string> = {}
  for (const t of wt.types) colorMap[t.nimi] = t.hex

  function addItem(typeName: string) {
    const item: WorkItem = {
      id: crypto.randomUUID(),
      too: typeName,
      hambad: '',
    }
    const next = [...value, item]
    onChange(next)
    setActiveId(item.id)
    setAddingType(false)
  }

  function removeItem(id: string) {
    const next = value.filter(i => i.id !== id)
    onChange(next)
    if (activeId === id) setActiveId(next[0]?.id ?? null)
  }

  function toggleBridge(id: string) {
    onChange(value.map(i => i.id !== id ? i : { ...i, bridge: !i.bridge }))
  }

  function handleToggleTooth(tooth: number) {
    if (!activeId) return
    const s = String(tooth)

    onChange(value.map(item => {
      if (item.id === activeId) {
        // Toggle on active item
        const teeth = new Set(item.hambad.split(',').map(t => t.trim()).filter(Boolean))
        teeth.has(s) ? teeth.delete(s) : teeth.add(s)
        return { ...item, hambad: [...teeth].join(',') }
      }
      // Remove from other items if it was just added to active (a tooth can only be in one item)
      const teeth = new Set(item.hambad.split(',').map(t => t.trim()).filter(Boolean))
      if (teeth.has(s)) {
        teeth.delete(s)
        return { ...item, hambad: [...teeth].join(',') }
      }
      return item
    }))
  }

  const activeItem = value.find(i => i.id === activeId)

  return (
    <div className="space-y-3">
      <label className="label">Tööosad</label>

      {/* Work items list */}
      <div className="space-y-1.5">
        {value.map(item => {
          const isActive = item.id === activeId
          const hex = colorMap[item.too] ?? '#94A3B8'
          const teethCount = item.hambad.split(',').filter(t => t.trim()).length
          const img = workTypeImage(item.too)

          return (
            <div
              key={item.id}
              onClick={() => setActiveId(item.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 cursor-pointer transition-all ${
                isActive
                  ? 'border-accent bg-accent/5'
                  : 'border-ink-faint/15 hover:border-ink-faint/30 bg-bg-card'
              }`}
            >
              {/* Color dot / icon */}
              <span
                className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${hex}25` }}
              >
                {img
                  ? <img src={img} alt="" className="w-full h-full object-cover rounded-md" />
                  : <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: hex }} />
                }
              </span>

              {/* Type name + tooth count */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{item.too}</p>
                <p className="text-[10px] text-ink-muted">
                  {teethCount > 0 ? `${teethCount} hammast` : 'Hambad valimata'}
                  {item.bridge && ' · sild'}
                </p>
              </div>

              {/* Bridge toggle */}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); toggleBridge(item.id) }}
                title={item.bridge ? 'Eemalda silla märge' : 'Märgi sillaks'}
                className={`p-1.5 rounded-lg transition-colors ${
                  item.bridge
                    ? 'bg-accent/15 text-accent'
                    : 'text-ink-faint hover:text-ink-muted'
                }`}
              >
                <Link2 size={13} />
              </button>

              {/* Remove */}
              {!disabled && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); removeItem(item.id) }}
                  className="p-1.5 text-ink-faint hover:text-red-500 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Add work item */}
      {!disabled && (
        addingType ? (
          <div className="border border-ink-faint/20 rounded-xl p-3 space-y-2 bg-bg-sidebar/50">
            <p className="text-xs font-semibold text-ink-muted">Vali töötüüp:</p>
            <div className="grid grid-cols-3 gap-1.5">
              {wt.types.map(t => {
                const img = workTypeImage(t.nimi, t.pilt)
                return (
                  <button
                    key={t.nimi}
                    type="button"
                    onClick={() => addItem(t.nimi)}
                    className="rounded-lg border border-ink-faint/25 hover:border-accent/40 overflow-hidden text-left transition-all"
                  >
                    <span
                      className="flex h-8 items-center justify-center"
                      style={{ backgroundColor: `${t.hex}1f` }}
                    >
                      {img
                        ? <img src={img} alt="" className="h-full w-full object-cover" />
                        : <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.hex }} />
                      }
                    </span>
                    <span className="block px-1.5 py-0.5 text-[10px] font-medium truncate text-ink">
                      {t.nimi}
                    </span>
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => setAddingType(false)}
              className="text-xs text-ink-muted hover:text-ink transition-colors"
            >
              Tühista
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingType(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-ink-faint/30 text-ink-muted hover:border-accent hover:text-accent transition-colors text-sm"
          >
            <Plus size={14} />
            Lisa tööosa
          </button>
        )
      )}

      {/* Shared odontogram */}
      <div className={`bg-bg-sidebar rounded-xl p-3 ${!activeId && value.length > 0 ? '' : ''}`}>
        <MultiOdontogramPicker
          items={value}
          activeItemId={activeId}
          colorMap={colorMap}
          onToggleTooth={handleToggleTooth}
          disabled={disabled}
        />
      </div>

      {/* Active item hint */}
      {activeItem && (
        <p className="text-[10px] text-ink-faint">
          Aktiivne: <span className="font-semibold text-accent">{activeItem.too}</span> — klõpsa hammastel, et neid sellele tööosale lisada/eemaldada
        </p>
      )}
    </div>
  )
}
