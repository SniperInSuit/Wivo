/**
 * The action bar under the odontogram: how many teeth are selected, and the
 * four things you can do to that selection in bulk.
 *
 * Every action here writes to ONE work type — the one the chip row has active —
 * because that is the only type a tooth click would write to either. A control
 * that quietly filled a different type than the one you are looking at would be
 * worse than no control.
 *
 * All bulk actions are ADDITIVE and skip teeth another work type already owns:
 * the odontogram refuses to steal a tooth on click (JobDetailPanel's rule) and a
 * button that could do what a click cannot would make the rule look arbitrary.
 *
 * SHAPE: one white pill sitting under the blush chart field, count badge first.
 * It used to be a column of full-width buttons in a second grid column, a
 * chart's width from the thing they act on, with the colour legend stacked
 * underneath — the legend now lives on the chart itself, where the colours are.
 */
import { useState } from 'react'
import { Eraser } from 'lucide-react'
import upperImg from '@/assets/jobs/Upper.png'
import lowerImg from '@/assets/jobs/Lower.png'
import { FDI_LOWER, FDI_UPPER, archIndex, archOf, sortTeeth } from '@shared/wizard'
import { FOCUS_RING, WIZARD_BTN, WIZARD_HELP } from '../wizardTheme'
import { teethCountLabel } from './WorkTypeTabs'

export interface ToothLegendEntry {
  nimi: string
  hex: string
  count: number
  isBridge: boolean
  /** Teeth derived from the arch answer, not clickable. Labelled as such. */
  fromArch: boolean
}

export interface ToothControlsProps {
  /** The work type receiving clicks. null disables every bulk action. */
  activeType: string | null
  /** FDI numbers owned by activeType. */
  activeTeeth: readonly number[]
  /** Teeth owned by any OTHER work type. Bulk actions step around them. */
  blocked: ReadonlySet<number>
  /** Teeth selected across every work type on the job. */
  total: number
  /** Replaces activeType's teeth wholesale. */
  onSetActiveTeeth: (teeth: number[]) => void
  /** Clears every tooth on every work type. Destructive — confirmed here. */
  onClearAll: () => void
  disabled?: boolean
}

/**
 * The same tooth on the other side of the midline: 18↔28, 46↔36. Position
 * within the arch table mirrors around its centre, so this needs no anatomy
 * table of its own — FDI_UPPER/FDI_LOWER are already symmetric.
 */
function mirrorTooth(fdi: number): number | null {
  const arch = archOf(fdi)
  if (!arch) return null
  const table = arch === 'upper' ? FDI_UPPER : FDI_LOWER
  const i = archIndex(fdi)
  if (i < 0) return null
  return table[table.length - 1 - i] ?? null
}

export function ToothControls({
  activeType, activeTeeth, blocked, total, onSetActiveTeeth, onClearAll, disabled,
}: ToothControlsProps) {
  const [confirmClear, setConfirmClear] = useState(false)
  // What the last bulk action actually did. Spoken, because a button that
  // silently skips half its teeth reads as a broken button.
  const [announcement, setAnnouncement] = useState<string | null>(null)

  const locked = Boolean(disabled) || !activeType

  /** Adds `teeth` to the active type, skipping what another type owns. */
  function addTeeth(teeth: readonly number[], what: string) {
    const skipped = teeth.filter(t => blocked.has(t))
    const added = teeth.filter(t => !blocked.has(t) && !activeTeeth.includes(t))
    if (added.length === 0 && skipped.length === 0) return
    onSetActiveTeeth(sortTeeth([...activeTeeth, ...added]))
    setAnnouncement(
      added.length === 0
        ? `${what}: kõik hambad kuuluvad juba teistele töödele.`
        : skipped.length > 0
          ? `${what}: lisatud ${teethCountLabel(added.length)}, ${teethCountLabel(skipped.length)} jäi vahele, sest kuulub teisele tööle.`
          : `${what}: lisatud ${teethCountLabel(added.length)}.`
    )
  }

  /**
   * Every bulk action goes through here.
   *
   * aria-disabled and an early return, NOT the native `disabled` attribute: a
   * natively disabled button leaves the tab order, so a keyboard user meets
   * three controls that simply do not exist and is told nothing about why. This
   * is the same convention WizardNavigation's blocked Continue uses — press it
   * and it explains itself.
   */
  function guarded(run: () => void) {
    return () => {
      if (disabled) return
      if (!activeType) {
        setAnnouncement('Vali kõigepealt, millisele tööle hambaid märgid.')
        return
      }
      run()
    }
  }

  function selectArch(arch: 'upper' | 'lower') {
    addTeeth(
      arch === 'upper' ? FDI_UPPER : FDI_LOWER,
      arch === 'upper' ? 'Ülemine lõualuu' : 'Alumine lõualuu'
    )
  }

  function mirrorSelection() {
    const partners = activeTeeth
      .map(mirrorTooth)
      .filter((t): t is number => t != null)
    addTeeth(partners, 'Peegeldus')
  }

  const seg = [
    'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium',
    'text-ink-soft transition-colors hover:bg-bg-sidebar border border-ink-faint/20',
    'aria-disabled:opacity-40 aria-disabled:cursor-not-allowed',
    FOCUS_RING,
  ].join(' ')

  return (
    <div className="space-y-2">
      {/* Count */}
      <span
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent"
        aria-live="polite"
      >
        {total} hammast valitud
      </span>

      {/* Arch buttons — card style like work types */}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={guarded(() => selectArch('upper'))} aria-disabled={locked || undefined}
          className={`rounded-xl border-2 overflow-hidden text-center transition-all duration-150 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed ${
            FOCUS_RING
          } border-ink-faint/25 bg-white hover:border-accent/40 hover:shadow-sm`}
        >
          <span className="flex h-12 items-center justify-center p-1">
            <img src={upperImg} alt="" className="h-full object-contain" />
          </span>
          <span className="block px-1 pb-1.5 text-[11px] font-semibold text-ink">Ülemine</span>
        </button>
        <button type="button" onClick={guarded(() => selectArch('lower'))} aria-disabled={locked || undefined}
          className={`rounded-xl border-2 overflow-hidden text-center transition-all duration-150 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed ${
            FOCUS_RING
          } border-ink-faint/25 bg-white hover:border-accent/40 hover:shadow-sm`}
        >
          <span className="flex h-12 items-center justify-center p-1">
            <img src={lowerImg} alt="" className="h-full object-contain" />
          </span>
          <span className="block px-1 pb-1.5 text-[11px] font-semibold text-ink">Alumine</span>
        </button>
      </div>

      {/* Tühjenda */}
      {total > 0 && (
        <button
          type="button"
          className={`${seg} !text-rose-500 !border-rose-200 hover:!bg-rose-50`}
          onClick={() => { if (!disabled) setConfirmClear(true) }}
          aria-disabled={Boolean(disabled) || undefined}
        >
          <Eraser className="h-3.5 w-3.5" /> Tühjenda
        </button>
      )}

      {activeType && (
        <p className="text-[11px] text-ink-muted">
          Märgid hambaid tööle „{activeType}"
        </p>
      )}

      {confirmClear && (
        <div role="alertdialog" className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-50 px-2.5 py-1.5">
          <span className="text-xs font-semibold text-rose-500">Tühjendada {teethCountLabel(total)}?</span>
          <button type="button" className="text-xs font-semibold bg-rose-500 text-white px-2 py-0.5 rounded"
            onClick={() => { onClearAll(); setConfirmClear(false); setAnnouncement('Tühjendatud.') }}>Jah</button>
          <button type="button" className="text-xs text-ink-muted" onClick={() => setConfirmClear(false)}>Ei</button>
        </div>
      )}

      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  )
}
