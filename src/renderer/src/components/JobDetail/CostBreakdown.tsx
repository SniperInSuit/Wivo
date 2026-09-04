/**
 * The cost table. One component, two homes.
 *
 * It used to live inside the edit form, which meant the only way to see what a
 * job cost was to press "Muuda" — you had to open a form you might not want to
 * save just to read a number. Now the read view renders the same component with
 * `editable={false}`, so the figure on screen is the same figure either way.
 *
 * The pencil writes to `jobs.kulu_yle` (sql/057) — a per-job correction, not a
 * rate change. Nobody's wages move.
 */
import { useState } from 'react'
import { Pencil, RotateCcw, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import type { JobCosts, CostKey, JobTotal } from '../../lib/jobCosts'

export function CostBreakdown({ costs, editable, onOverride, extraCostsSlot, dense, total }: {
  costs: JobCosts
  /** False in the read view: the numbers show, the pencils do not. */
  editable: boolean
  /** null clears the override and returns the category to the rules. */
  onOverride?: (key: CostKey, value: number | null) => void
  /** The edit form's ad-hoc cost editor, dropped in where the ad-hoc lines go. */
  extraCostsSlot?: React.ReactNode
  dense?: boolean
  /**
   * The whole case, remakes included. When given, the totals below become the
   * case's rather than the original's — which is what anybody asking "what did
   * this patient's work cost us" means. Absent on a revision's own view, where
   * the original's figure is the honest answer.
   */
  total?: JobTotal
}) {
  const [editing, setEditing] = useState<CostKey | null>(null)
  const [draft, setDraft] = useState('')
  const [showRemakes, setShowRemakes] = useState(false)

  const hasRemakes = !!total && total.revisions.length > 0
  // The margin follows whatever the total line says, so the two can never
  // disagree about which cost they are a percentage of.
  const shown = hasRemakes ? total! : costs

  const nothingToShow =
    costs.total === 0 &&
    costs.categories.every(c => c.lines.length === 0 && c.override == null) &&
    !editable
  if (nothingToShow) return null

  const start = (key: CostKey, current: number) => {
    setEditing(key)
    setDraft(current.toFixed(2))
  }
  const commit = (key: CostKey) => {
    const v = parseFloat(draft.replace(',', '.'))
    // A blank box means "no opinion" — back to the rules. Anything unparseable
    // is a typo, not an instruction, so it changes nothing.
    if (draft.trim() === '') onOverride?.(key, null)
    else if (Number.isFinite(v) && v >= 0) onOverride?.(key, Math.round(v * 100) / 100)
    setEditing(null)
  }

  const pad = dense ? 'p-2.5' : 'p-3'

  return (
    <div className={`bg-bg-sidebar rounded-xl ${pad} space-y-1`}>
      <p className="text-xs font-semibold text-ink-muted mb-1.5">Omahind (labori kulu)</p>

      {costs.categories.map(cat => {
        const overridden = cat.override != null
        const empty = cat.lines.length === 0 && !overridden
        // An empty category is noise in the read view. In the edit form it stays
        // visible, because a cost you cannot see is a cost you cannot correct.
        if (empty && !editable) return null

        return (
          <div key={cat.key} className="space-y-0.5">
            {/* The rule lines, greyed out once a person has overruled them. */}
            {!overridden && cat.lines.map((l, i) => (
              <div key={i} className="flex justify-between text-xs text-ink-muted">
                <span className="truncate">
                  {cat.lines.length === 1 ? cat.label : `${cat.label}: ${l.label.split(':')[0]}`}
                </span>
                <span className="tabular-nums text-ink flex-shrink-0 ml-2">
                  {l.amount.toFixed(2)} €{' '}
                  <span className="text-ink-faint text-[10px]">
                    {l.label.split(':').slice(1).join(':').trim()}
                  </span>
                </span>
              </div>
            ))}

            {(overridden || (editable && empty)) && (
              <div className="flex justify-between items-center text-xs">
                <span className={overridden ? 'text-ink-muted' : 'text-ink-faint'}>
                  {cat.label}
                  {overridden && (
                    <span className="ml-1.5 text-[9px] px-1 py-px rounded bg-amber-100 text-amber-700 font-medium align-middle">
                      käsitsi
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5">
                  {overridden && cat.computed !== cat.amount && (
                    <span className="text-[10px] text-ink-faint line-through tabular-nums">
                      {cat.computed.toFixed(2)} €
                    </span>
                  )}
                  <span className="tabular-nums text-ink">{cat.amount.toFixed(2)} €</span>
                </span>
              </div>
            )}

            {/* Pencil row. Separate line so a long rule label never collides. */}
            {editable && (
              editing === cat.key ? (
                <div className="flex items-center gap-1 justify-end">
                  <div className="relative w-24">
                    <input
                      type="number" min="0" step="0.01" autoFocus
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commit(cat.key) }
                        if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
                      }}
                      placeholder={cat.computed.toFixed(2)}
                      className="input py-0.5 px-1.5 pr-5 text-xs text-right"
                    />
                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-ink-faint pointer-events-none">€</span>
                  </div>
                  <button type="button" onClick={() => commit(cat.key)}
                    title="Salvesta" className="text-emerald-600 hover:text-emerald-700 p-0.5">
                    <Check size={12} />
                  </button>
                  <button type="button" onClick={() => setEditing(null)}
                    title="Loobu" className="text-ink-faint hover:text-ink p-0.5">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 justify-end">
                  <button type="button" onClick={() => start(cat.key, cat.amount)}
                    title={`Muuda ${cat.label.toLowerCase()}u kulu käsitsi`}
                    className="text-[10px] text-accent hover:text-accent/80 flex items-center gap-0.5">
                    <Pencil size={9} /> muuda
                  </button>
                  {overridden && (
                    <button type="button" onClick={() => onOverride?.(cat.key, null)}
                      title="Tagasi reeglite juurde"
                      className="text-[10px] text-ink-faint hover:text-ink flex items-center gap-0.5">
                      <RotateCcw size={9} /> reegel
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        )
      })}

      {costs.technicianHourly != null && (
        <div className="flex justify-between text-[10px] text-ink-faint">
          <span>Tehnik tunnihind</span>
          <span className="tabular-nums">{costs.technicianHourly.toFixed(2)} €/h</span>
        </div>
      )}

      {/* Ad-hoc costs: the form's own editor, or plain lines in the read view. */}
      {extraCostsSlot ?? costs.adHoc.map((l, i) => (
        <div key={i} className="flex justify-between text-xs text-ink-muted">
          <span className="truncate">{l.label}</span>
          <span className="tabular-nums text-ink flex-shrink-0 ml-2">{l.amount.toFixed(2)} €</span>
        </div>
      ))}

      {/* When there are remakes, this line is the ORIGINAL only and says so —
          an unlabelled "Kokku kulu" that silently excluded five remakes is
          what made the margin on this page wrong. */}
      <div className="flex justify-between text-xs border-t border-ink-faint/15 pt-1 mt-1">
        <span className={hasRemakes ? 'text-ink-muted' : 'font-semibold text-ink'}>
          {hasRemakes ? 'Originaal' : 'Kokku kulu'}
        </span>
        <span className={`tabular-nums ${hasRemakes ? 'text-ink' : 'font-bold text-red-500'}`}>
          {costs.total.toFixed(2)} €
        </span>
      </div>

      {hasRemakes && (
        <>
          <button
            type="button"
            onClick={() => setShowRemakes(v => !v)}
            className="w-full flex justify-between items-center text-xs hover:opacity-70 transition-opacity"
          >
            <span className="text-ink-muted flex items-center gap-1">
              {showRemakes ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Muudatused ({total!.revisions.length})
            </span>
            <span className="tabular-nums text-ink">{total!.revisionTotal.toFixed(2)} €</span>
          </button>

          {showRemakes && (
            <div className="pl-4 space-y-0.5 border-l border-ink-faint/20 ml-1">
              {total!.revisions.map(r => (
                <div key={r.id} className="flex justify-between text-[11px] gap-2">
                  <span className="text-ink-muted truncate">
                    Muudatus {r.nr}
                    {r.note ? ` · ${r.note}` : ''}
                    {/* Both are reasons a remake costs less than it looks, and
                        both are worth seeing next to the number, not guessing at. */}
                    {!r.tasustatav && <span className="text-ink-faint"> · tasustamata</span>}
                    {!r.valmis && <span className="text-amber-600"> · pooleli</span>}
                  </span>
                  <span className="tabular-nums text-ink flex-shrink-0">{r.total.toFixed(2)} €</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between text-xs border-t border-ink-faint/15 pt-1 mt-1">
            <span className="font-semibold text-ink">Kokku kulu</span>
            <span className="font-bold text-red-500 tabular-nums">{total!.total.toFixed(2)} €</span>
          </div>
        </>
      )}

      {shown.revenue > 0 && (
        <div className="flex justify-between text-xs">
          <span className="text-ink-muted">Kate</span>
          <span className={`font-semibold tabular-nums ${shown.margin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {shown.margin.toFixed(2)} € ({shown.marginPct != null ? `${shown.marginPct.toFixed(0)}%` : '—'})
          </span>
        </div>
      )}
    </div>
  )
}
