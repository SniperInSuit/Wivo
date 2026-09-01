/**
 * "Kohanda" — pick the panels, drag them into order.
 *
 * On the page, not in Seaded, for the same reason the calendar controls sit in
 * the top bar: the question "which numbers do I want in front of me" is asked
 * while looking at the numbers. Walking to a settings screen, adding a tile
 * blind and walking back is the friction that gets a dashboard customised once
 * and never again.
 *
 * Reordering is a one-dimensional list, and that is honest rather than a
 * limitation: DOM order is what fills a CSS grid, so the list IS the layout.
 */
import { useMemo, useState } from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { GripVertical, X, Plus, Check, Search, RotateCcw } from 'lucide-react'
import {
  PANEL_CATALOGUE, PANEL_BY_ID, PANEL_GROUPS, PANEL_GROUP_LABEL,
  type PanelMeta,
} from './panels/catalogue'
import { PRESETS } from './panels/presets'
import { isPanelVisible, type VisibilityInput } from './PanelGrid'

interface PanelPickerProps {
  /** Stored ids this person can actually see, in order. */
  selected: string[]
  presetKey: string | null
  visibility: VisibilityInput
  onReorder: (ids: string[]) => void
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  onPreset: (key: string) => void
  onReset: () => void
  onClose: () => void
}

export function PanelPicker({
  selected, presetKey, visibility,
  onReorder, onAdd, onRemove, onPreset, onReset, onClose,
}: PanelPickerProps) {
  const [q, setQ] = useState('')

  // Panels this person cannot see are absent, not greyed out. A disabled
  // "Kasum" row is an invitation to ask why it is disabled.
  const available = useMemo(
    () => PANEL_CATALOGUE.filter(p => isPanelVisible(p as PanelMeta, visibility)),
    [visibility],
  )

  const chosen = new Set(selected)
  const needle = q.trim().toLowerCase()
  const matches = (p: PanelMeta): boolean =>
    !needle || p.title.toLowerCase().includes(needle) || (p.hint ?? '').toLowerCase().includes(needle)

  const presetLabel = presetKey
    ? `${PRESETS.find(p => p.key === presetKey)?.label ?? presetKey}`
    : 'Kohandatud'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <aside className="relative w-[420px] max-w-full h-full bg-bg-card shadow-card overflow-y-auto">
        <div className="sticky top-0 bg-bg-card border-b border-ink-faint/15 px-4 py-3 flex items-center gap-2 z-10">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-ink">Kohanda vaadet</h2>
            <p className="text-[11px] text-ink-faint truncate">{presetLabel} · {selected.length} paneeli</p>
          </div>
          <button onClick={onReset} className="btn-ghost text-xs" title="Tagasi rolli vaikevaatele">
            <RotateCcw size={13} /> Vaikimisi
          </button>
          <button onClick={onClose} className="btn-ghost p-2" aria-label="Sulge">
            <X size={16} />
          </button>
        </div>

        {/* ── Presets ── */}
        <section className="px-4 py-3 border-b border-ink-faint/10">
          <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Valmisvaated
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => onPreset(p.key)}
                title={p.hint}
                className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
                  presetKey === p.key ? 'bg-accent text-white' : 'bg-bg-sidebar text-ink-muted hover:text-ink'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-ink-faint mt-2 leading-relaxed">
            Valmisvaade on lähtepunkt, mitte lukk — iga muudatus pärast valimist jääb sinu omaks.
          </p>
        </section>

        {/* ── Chosen, draggable ── */}
        <section className="px-4 py-3 border-b border-ink-faint/10">
          <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Valitud ({selected.length})
          </h3>
          {selected.length === 0 ? (
            <p className="text-[11px] text-ink-faint py-2">
              Ühtegi paneeli ei ole valitud. Lisa allpool.
            </p>
          ) : (
            <Reorder.Group axis="y" values={selected} onReorder={onReorder} className="space-y-1.5">
              {selected.map(id => (
                <PickedRow
                  key={id}
                  id={id}
                  meta={PANEL_BY_ID[id]}
                  onRemove={() => onRemove(id)}
                />
              ))}
            </Reorder.Group>
          )}
        </section>

        {/* ── Catalogue ── */}
        <section className="px-4 py-3">
          <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Lisa paneel
          </h3>
          <div className="relative mb-3">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Otsi paneeli..."
              className="input py-1.5 pl-8 text-sm"
            />
          </div>

          {PANEL_GROUPS.map(group => {
            const rows = available.filter(p => p.group === group && matches(p as PanelMeta))
            if (rows.length === 0) return null
            return (
              <div key={group} className="mb-4 last:mb-0">
                <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider mb-1.5">
                  {PANEL_GROUP_LABEL[group]}
                </p>
                <div className="space-y-1">
                  {rows.map(p => {
                    const on = chosen.has(p.id)
                    return (
                      <button
                        key={p.id}
                        disabled={on}
                        onClick={() => onAdd(p.id)}
                        className={`w-full text-left rounded-lg px-2.5 py-1.5 flex items-start gap-2 transition-colors ${
                          on ? 'opacity-50 cursor-default' : 'hover:bg-bg-sidebar'
                        }`}
                      >
                        {on
                          ? <Check size={13} className="text-accent flex-shrink-0 mt-0.5" />
                          : <Plus size={13} className="text-ink-faint flex-shrink-0 mt-0.5" />}
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-ink">{p.title}</span>
                          {p.hint && <span className="block text-[10px] text-ink-faint leading-snug">{p.hint}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </section>
      </aside>
    </div>
  )
}

/**
 * `dragListener={false}` plus explicit controls: without a dedicated handle the
 * whole row drags and the remove button stops being clickable.
 */
function PickedRow({ id, meta, onRemove }: { id: string; meta?: PanelMeta; onRemove: () => void }) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      className="rounded-lg border border-ink-faint/15 bg-bg-card px-2 py-1.5 flex items-center gap-2"
    >
      <GripVertical
        size={14}
        className="text-ink-faint cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
        onPointerDown={e => controls.start(e)}
      />
      <span className="flex-1 min-w-0 text-xs text-ink truncate">
        {meta?.title ?? id}
      </span>
      <span className="text-[10px] text-ink-faint flex-shrink-0">
        {meta ? PANEL_GROUP_LABEL[meta.group] : 'tundmatu'}
      </span>
      <button onClick={onRemove} className="btn-ghost p-1 flex-shrink-0" aria-label="Eemalda">
        <X size={13} />
      </button>
    </Reorder.Item>
  )
}
