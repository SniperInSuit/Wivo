/**
 * Which abutment an implant work item sits on. THE implementation.
 *
 * ONE FIELD FIRST, then exceptions. A case is usually all one system — "all
 * four are MIS C1" — and asking that once is the difference between one input
 * and four. The per-tooth rows stay folded until someone says a tooth differs.
 *
 * A tooth row left empty INHERITS the item's code; it does not mean "no
 * abutment". Storing an empty string would make it mean the second thing, which
 * is why `setTooth` deletes instead. `abutmentFor()` reads back with the same
 * rule, so the screen and the row cannot drift.
 *
 * Rendered by both job-page layouts. The side panel draws its own chips and the
 * fullscreen one uses WorkItemsField, and before this the field existed only
 * inside the second — so whether a lab could record an abutment at all depended
 * on which panel position they had chosen in Seaded.
 */
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { WorkItem } from '../../types/job'

export interface AbutmentFieldProps {
  item: WorkItem
  onChange: (patch: Partial<WorkItem>) => void
  /** Open state is owned by the caller — both layouts key it on the item id. */
  open: boolean
  onToggleOpen: () => void
  disabled?: boolean
  /** The fullscreen revision editor paints itself slate-900 in every theme. */
  dark?: boolean
}

export function AbutmentField({
  item, onChange, open, onToggleOpen, disabled, dark = false,
}: AbutmentFieldProps) {
  const all = item.kruvi ?? ''
  const teeth = item.hambad.split(',').map(t => t.trim()).filter(Boolean)

  const setTooth = (tooth: string, code: string) => {
    const next = { ...(item.kruvid ?? {}) }
    if (code.trim()) next[tooth] = code
    else delete next[tooth]
    onChange({ kruvid: Object.keys(next).length > 0 ? next : undefined })
  }

  // Only a code that DIFFERS is an exception worth a badge — one that repeats
  // the field above says nothing.
  const differing = teeth.filter(t => {
    const own = (item.kruvid?.[t] ?? '').trim()
    return !!own && own !== all.trim()
  }).length

  const inputCls = `input text-xs ${
    dark ? 'bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500' : ''
  }`
  const faint = dark ? 'text-slate-500' : 'text-ink-faint'

  return (
    <div>
      <label className={`text-[10px] font-medium ${dark ? 'text-slate-400' : 'text-ink-muted'}`}>
        Kruvi / abutment — {item.too}
      </label>
      <input
        type="text"
        value={all}
        disabled={disabled}
        onChange={e => onChange({ kruvi: e.target.value || undefined })}
        placeholder="Nt: MIS C1 3.75×11.5mm"
        className={`${inputCls} mt-0.5`}
      />
      {teeth.length > 1 && (
        <>
          <button
            type="button"
            onClick={onToggleOpen}
            className={`flex items-center gap-1 text-[10px] font-medium mt-1 transition-colors ${
              dark ? 'text-slate-400 hover:text-slate-200' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Hammaste kaupa
            {differing > 0 && (
              <span className="text-[9px] font-semibold text-accent bg-accent/10 px-1 py-0.5 rounded">
                {differing} erineb
              </span>
            )}
          </button>
          {open && (
            <div className="space-y-1 mt-1">
              {teeth.map(tooth => (
                <div key={tooth} className="flex items-center gap-1.5">
                  <span className={`w-7 flex-shrink-0 text-[11px] font-semibold tabular-nums ${faint}`}>
                    {tooth}
                  </span>
                  <input
                    type="text"
                    value={item.kruvid?.[tooth] ?? ''}
                    disabled={disabled}
                    onChange={e => setTooth(tooth, e.target.value)}
                    // The inherited code as the placeholder, so an empty row
                    // reads as "same as above" rather than "none".
                    placeholder={all || 'Kood puudub'}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
