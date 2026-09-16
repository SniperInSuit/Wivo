/**
 * Which teeth the DESIGNER did — asked next to the designer, not on the chart.
 *
 * The chart is step 2 and the designer is picked here on step 4, so a marking
 * mode back there would have had nobody to assign teeth to. The question only
 * exists once a name is on screen, so it is asked once a name is on screen.
 *
 * Unticking a tooth hands it to the technician. Everything ticked is the
 * default and is stored as nothing — see wizardWorkItems for why "all of them"
 * has to stay unsaid.
 */
import type { NewJobState } from '@shared/wizard'
import { sortTeeth } from '@shared/wizard'
import { WIZARD_HELP } from '../wizardTheme'

interface Props {
  state: NewJobState
  patch: (p: Partial<NewJobState>) => void
  /** Tooth-mode jobTypes keys that actually have teeth. */
  toothTypes: string[]
}

export function DesignSplit({ state, patch, toothTypes }: Props) {
  // Nothing to split without a designer, and nothing to split on a job whose
  // work has no individual teeth.
  const rows = toothTypes
    .map(key => ({ key, teeth: sortTeeth(state.selectedTeeth[key] ?? []) }))
    .filter(r => r.teeth.length > 1)
  if (!state.designer || rows.length === 0) return null

  function toggle(key: string, fdi: number, picked: number[]) {
    const cur = state.designByType[key]
    // Starts from ALL of them: until somebody says otherwise the designer had
    // the lot, so the first click takes one back rather than granting one.
    const from = cur && cur.length > 0 ? cur : picked
    const next = from.includes(fdi) ? from.filter(t => t !== fdi) : [...from, fdi]
    const store = next.length === 0 || next.length === picked.length ? [] : sortTeeth(next)
    patch({ designByType: { ...state.designByType, [key]: store } })
  }

  return (
    <div className="md:col-span-2">
      <p className="text-base font-medium text-ink">Disainija hambad</p>
      <p className={WIZARD_HELP}>
        Vaikimisi disainis disainija kõik hambad. Võta märge maha hammastelt,
        mille tehnik ise disainis — disainitasu arvestatakse ainult märgitutelt.
      </p>
      <div className="mt-2 space-y-2">
        {rows.map(({ key, teeth }) => {
          const stored = state.designByType[key]
          const mine = stored && stored.length > 0 ? stored : teeth
          return (
            <div key={key} className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink-soft min-w-[80px]">{key}</span>
              {teeth.map(t => {
                const on = mine.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggle(key, t, teeth)}
                    aria-pressed={on}
                    title={on ? `${t} — disainija` : `${t} — tehnik disainis ise`}
                    className={`min-h-[44px] min-w-[44px] rounded-xl border-2 px-2 text-base font-semibold tabular-nums transition-colors ${
                      on
                        ? 'border-violet-500 bg-violet-500 text-white'
                        : 'border-ink-faint/30 bg-bg-sidebar text-ink-muted'
                    }`}
                  >
                    {t}
                  </button>
                )
              })}
              <span className="text-sm text-ink-faint">
                {mine.length}/{teeth.length}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
