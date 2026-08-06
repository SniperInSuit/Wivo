/**
 * Step 1 — "Mida valmistame?"
 *
 * The only decision on this screen is WHICH kinds of work the job contains.
 * Everything downstream adapts to it (step 2 asks for teeth, an arch, or is
 * skipped entirely), so it deliberately shows nothing else — no patient, no
 * material, no price.
 */
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { jobRules } from '@shared/wizard'
import type { WorkTypeRules } from '@shared/wizard'
import { useWorkTypes } from '@/stores/useSettings'
import type { WizardStepComponent } from '../types'
import { fieldErrors } from '../types'
import { WizardErrors } from '../ui/WizardErrors'
import { WizardSearch } from '../ui/WizardSearch'
import { WorkTypeCardGrid, filterWorkTypes } from '../jobtype/WorkTypeCardGrid'
import { WIZARD_HELP, WIZARD_HIT_MIN, FOCUS_RING, WIZARD_FALLBACK_HEX } from '../wizardTheme'

/** Below this many types the search box is clutter — the grid fits on screen. */
const SEARCH_THRESHOLD = 12

/** What step 2 will ask for this type. Shown so the choice has a visible
 *  consequence rather than the next screen changing shape unannounced. */
function needsLabel(r: WorkTypeRules | undefined): string {
  if (!r) return ''
  if (r.isBridge) return 'Järgmisena: vali järjestikused hambad'
  if (r.toothMode === 'tooth') return 'Järgmisena: vali hambad'
  if (r.toothMode === 'arch') return 'Järgmisena: vali lõualuu'
  return 'Hambaid ei ole vaja valida'
}

export const StepJobType: WizardStepComponent = ({ state, patch, rules, errors, showErrors }) => {
  const { types } = useWorkTypes()
  const [search, setSearch] = useState('')

  // The card grid paints t.hex; the summary list below must paint the SAME
  // colour. rules.perType[i].hex is the RESOLVED type's colour, which differs
  // whenever a lab type resolves to a broader one ("Zirkoonkroon" → Kroon), so
  // the live list is the only honest source here.
  const hexOf = useMemo(
    () => new Map(types.map(t => [t.nimi, t.hex])),
    [types]
  )

  const selected = state.jobTypes
  const typeErrors = fieldErrors(errors, 'jobTypes')

  // perType is index-aligned with jobTypes, so the resolved rules for the type
  // the user picked are at the same position. (The resolved NAME can differ —
  // a lab type "Zirkoonkroon" resolves through the Kroon rule — so the label
  // always comes from jobTypes, never from rules.)
  const ruleAt = (i: number): WorkTypeRules | undefined => rules.perType[i]

  function toggle(nimi: string) {
    const removing = selected.includes(nimi)
    const next = removing
      ? selected.filter(n => n !== nimi)
      : [...selected, nimi]

    const patchState: Parameters<typeof patch>[0] = { jobTypes: next }
    const nextRules = jobRules(next, types)

    // Deselecting a type keeps its teeth: an accidental deselect must not throw
    // away a tooth map the user built, and toJobInput only reads keys that are
    // still in jobTypes.
    //
    // But putting a type BACK has to re-check them. While it was away another
    // type could have taken those teeth, and step 2's ownership map is derived
    // from current state, so it cannot undo an overlap that already exists —
    // the same FDI would end up on two work items and be priced twice, with no
    // way to fix it from inside the wizard. Anything already spoken for is
    // dropped from the returning type here, where the collision is created.
    if (!removing) {
      const stored = state.selectedTeeth[nimi] ?? []
      if (stored.length > 0) {
        const taken = new Set(
          selected.flatMap(other => state.selectedTeeth[other] ?? [])
        )
        const kept = stored.filter(t => !taken.has(t))
        if (kept.length !== stored.length) {
          patchState.selectedTeeth = { ...state.selectedTeeth, [nimi]: kept }
        }
      }
    }

    // The arch answer belongs to the arch types. With none left on the job it
    // is a stale fact that the review page would still print — "Lõualuu —
    // Ülemine lõualuu" on a single-crown job. Nothing covers an arch any more,
    // so nothing should claim one.
    //
    // It is deliberately NOT pre-answered when an arch type is added: a
    // pre-filled 'upper' satisfies the only arch gate there is, so the user can
    // ship a full-arch prosthesis for a jaw they never chose. Step 2 asks.
    if (nextRules.archTypes.length === 0 && state.selectedArch != null) {
      patchState.selectedArch = null
    }

    patch(patchState)
  }

  const showSearch = types.length > SEARCH_THRESHOLD
  const searching = search.trim().length > 0
  const matchCount = useMemo(
    () => (searching ? filterWorkTypes(types, search).length : 0),
    [searching, types, search]
  )

  return (
    <div className="space-y-6">
      <p className={WIZARD_HELP}>
        Võid valida mitu tüüpi — näiteks kroon ja sild samale tööle.
        Iga tüübi hambad saad valida eraldi järgmises sammus.
      </p>

      {showErrors && typeErrors.length > 0 && <WizardErrors errors={typeErrors} />}

      {showSearch && (
        <WizardSearch
          value={search}
          onChange={setSearch}
          placeholder="Otsi töö tüüpi…"
          ariaLabel="Otsi töö tüüpi"
          resultLabel={searching ? (matchCount === 1 ? '1 vaste' : `${matchCount} vastet`) : undefined}
        />
      )}

      <WorkTypeCardGrid
        types={types}
        selected={selected}
        onToggle={toggle}
        search={search}
        collapsible
      />

      {selected.length > 0 && (
        <section aria-label="Valitud töö tüübid" className="border-t border-ink-faint/30 pt-5">
          <h3 className="mb-3 text-base font-semibold text-ink">
            Valitud {selected.length === 1 ? 'töö tüüp' : 'töö tüübid'} ({selected.length})
          </h3>
          <ul className="space-y-2">
            {selected.map((nimi, i) => {
              const r = ruleAt(i)
              return (
                <li
                  key={nimi}
                  className="flex items-center gap-3 rounded-xl border border-ink-faint/40 bg-bg-sidebar px-3 py-2"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: hexOf.get(nimi) ?? r?.hex ?? WIZARD_FALLBACK_HEX }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-ink">{nimi}</span>
                    <span className="block text-base text-ink-muted">{needsLabel(r)}</span>
                  </span>
                  {/* Text + icon, never a bare ✕: a lone icon is the control an
                      older user misses, and this one destroys a selection. */}
                  <button
                    type="button"
                    onClick={() => toggle(nimi)}
                    aria-label={`Eemalda töö tüüp ${nimi}`}
                    className={`${WIZARD_HIT_MIN} ${FOCUS_RING} flex shrink-0 items-center gap-1.5 rounded-lg px-3 text-base font-medium text-ink-muted transition-colors hover:text-rose-500`}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    Eemalda
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
