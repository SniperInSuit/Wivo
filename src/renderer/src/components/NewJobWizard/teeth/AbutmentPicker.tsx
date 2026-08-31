/**
 * Which abutment each implant sits on.
 *
 * The wizard could not say this at all: `WorkItem.kruvi` has existed since work
 * items did and only the Edit page ever offered it, so a case created through
 * the wizard had to be reopened and edited to record something the technician
 * knew at the moment they picked the teeth.
 *
 * ONE FIELD FIRST, then exceptions. The usual case is a whole case on one
 * system — "all four are MIS C1" — and asking that once is the difference
 * between one input and four. The per-tooth rows are folded away until someone
 * says a tooth differs, because a case that is genuinely mixed is the minority
 * and should not set the shape of the common one.
 *
 * A tooth row left empty inherits; it does not mean "no abutment". That is the
 * same rule `abutmentFor()` applies when reading, so what is on screen and what
 * is stored cannot drift.
 */
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { sortTeeth } from '@shared/wizard'
import { FOCUS_RING, WIZARD_HELP } from '../wizardTheme'

export interface AbutmentPickerProps {
  /** `too` keys that want an abutment, with the teeth currently on each. */
  types: { too: string; hex: string; teeth: readonly number[] }[]
  /** too → the code covering every tooth of that type. */
  byType: Record<string, string>
  /** FDI number as a string → the code for that tooth alone. */
  byTooth: Record<string, string>
  onChangeType: (too: string, code: string) => void
  onChangeTooth: (tooth: string, code: string) => void
}

const INPUT =
  'w-full rounded-lg border border-ink-faint/40 bg-white px-3 py-2 text-base text-ink ' +
  'placeholder:text-ink-faint transition-colors duration-150 ' + FOCUS_RING

export function AbutmentPicker({
  types, byType, byTooth, onChangeType, onChangeTooth,
}: AbutmentPickerProps) {
  const [openFor, setOpenFor] = useState<string | null>(null)
  const withTeeth = types.filter(t => t.teeth.length > 0)
  if (withTeeth.length === 0) return null

  return (
    <div className="space-y-3 border-t border-ink-faint/30 pt-3">
      <div>
        <h3 className="text-sm font-semibold text-ink-soft">Kruvi / abutment</h3>
        <p className={WIZARD_HELP}>
          Kood kehtib kõigile selle töö hammastele. Kui mõni hammas erineb, ava
          „hammaste kaupa“ ja täida ainult see.
        </p>
      </div>

      {withTeeth.map(({ too, hex, teeth }) => {
        const open = openFor === too
        const all = byType[too] ?? ''
        const sorted = sortTeeth([...teeth])
        // Only the exceptions are worth a badge — a row that inherits says
        // nothing the field above it has not already said.
        const overrides = sorted.filter(t => {
          const own = (byTooth[String(t)] ?? '').trim()
          return !!own && own !== all.trim()
        }).length

        return (
          <div key={too} className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm font-medium text-ink-soft">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
              <span className="truncate">{too}</span>
              <span className="text-ink-faint font-normal">{sorted.length} hammast</span>
            </label>
            <input
              type="text"
              value={all}
              onChange={e => onChangeType(too, e.target.value)}
              placeholder="Nt MIS C1 3.75×11.5mm"
              className={INPUT}
            />

            <button
              type="button"
              onClick={() => setOpenFor(open ? null : too)}
              className="flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink transition-colors"
            >
              {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Hammaste kaupa
              {overrides > 0 && (
                <span className="text-[11px] font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                  {overrides} erineb
                </span>
              )}
            </button>

            {open && (
              <div className="space-y-1.5 pl-1">
                {sorted.map(t => {
                  const tooth = String(t)
                  return (
                    <div key={tooth} className="flex items-center gap-2">
                      <span className="w-9 flex-shrink-0 text-sm font-semibold tabular-nums text-ink-muted">
                        {tooth}
                      </span>
                      <input
                        type="text"
                        value={byTooth[tooth] ?? ''}
                        onChange={e => onChangeTooth(tooth, e.target.value)}
                        // The inherited value as the placeholder, so an empty
                        // row visibly means "same as above" rather than "none".
                        placeholder={all || 'Kood puudub'}
                        className={INPUT + ' py-1.5 text-sm'}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
