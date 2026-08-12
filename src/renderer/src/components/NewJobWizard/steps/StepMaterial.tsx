import { useState } from 'react'
import { Eraser, Info } from 'lucide-react'
import { baseTypeName } from '@shared/wizard'
import { useWorkTypes } from '@/stores/useSettings'
import type { WizardStepComponent } from '../types'
import { fieldErrors } from '../types'
import { MaterialPicker } from '../material/MaterialPicker'
import { WizardShadePicker } from '../material/WizardShadePicker'
import { WizardDieShadePicker } from '../material/WizardDieShadePicker'
import { SelectableCard } from '../ui/SelectableCard'
import { FOCUS_RING, WIZARD_BTN, WIZARD_ERROR, WIZARD_HELP } from '../wizardTheme'

// The contract fixes `glaze` and `texture` as free strings but names no option
// list, so these are the smallest set a finisher actually asks for. They stay
// plain strings: composeKirjeldus() writes them into kirjeldus verbatim, and a
// lab that wants different words can type over them on the Edit page.
const GLAZE_OPTIONS = ['Läikiv', 'Poolmatt', 'Matt'] as const
const TEXTURE_OPTIONS = ['Sile', 'Loomulik', 'Tugev'] as const

function SectionHeading({ id, title, help }: { id: string; title: string; help: string }) {
  return (
    <div className="mb-3">
      <h3 id={id} className="text-lg font-semibold text-ink">{title}</h3>
      <p className={WIZARD_HELP}>{help}</p>
    </div>
  )
}

/** One-of-N picker with an explicit clear — a radio group the user can undo. */
function OptionRow({ label, options, value, onChange }: {
  label: string
  options: readonly string[]
  value: string | null
  onChange: (value: string | null) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-3">
      {options.map(o => (
        <SelectableCard
          key={o}
          selected={value === o}
          onToggle={() => onChange(value === o ? null : o)}
          multi={false}
          label={o}
        />
      ))}
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`${WIZARD_BTN} inline-flex items-center gap-2 border border-ink-faint/40 bg-bg-card text-ink-soft`}
        >
          <Eraser className="w-4 h-4" aria-hidden="true" />
          Tühjenda
        </button>
      )}
    </div>
  )
}

/**
 * Step 3 — material, shade, glaze, texture.
 *
 * Everything below the material block is conditional on the work types chosen
 * in step 1: a nightguard has no VITA shade and asking for one is how a form
 * teaches people to answer questions that do not apply. The rules module owns
 * that decision; this step only reads it.
 */
export const StepMaterial: WizardStepComponent = ({ state, patch, rules, errors, showErrors }) => {
  const materialError = showErrors ? fieldErrors(errors, 'materials')[0] : undefined
  const { hex } = useWorkTypes()

  // Which piece of work the picker below assigns to. Defaults to the first, so
  // a single-type job behaves exactly as it did — pick a material, continue.
  const [activeKey, setActiveKey] = useState(state.jobTypes[0] ?? '')
  const active = state.jobTypes.includes(activeKey) ? activeKey : state.jobTypes[0] ?? ''
  const multi = state.jobTypes.length > 1

  const assign = (material: string | null) => {
    const next = { ...state.materialByType }
    if (material) next[active] = material
    else delete next[active]
    patch({ materialByType: next })
  }

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          id="wizard-materjal-label"
          title="Materjal"
          help={multi
            ? 'Iga tööosa võib olla eri materjalist. Vali ülalt tööosa ja siis selle materjal.'
            : 'Vali materjal, millest töö valmistatakse.'}
        />

        {/* One row per piece of work. Without it the wizard could only say what
            the WHOLE case was made of, so crowns in one material and bridges in
            another was unsayable — and priced at the first material's rate. */}
        {multi && (
          <div role="tablist" aria-label="Tööosad" className="flex flex-wrap gap-2 mb-4">
            {state.jobTypes.map(key => {
              const nimi = baseTypeName(key)
              const assigned = state.materialByType[key]?.trim()
              const isActive = key === active
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveKey(key)}
                  className={`flex items-center gap-2 min-h-[44px] px-3.5 rounded-xl border-2 text-base transition-colors ${FOCUS_RING} ${
                    isActive
                      ? 'border-accent bg-accent/10 text-ink font-semibold'
                      : 'border-ink-faint/30 bg-bg-card text-ink-soft hover:border-accent/40'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ background: hex(nimi) }}
                    aria-hidden="true"
                  />
                  {nimi}
                  <span className={assigned ? 'text-accent font-medium' : 'text-ink-faint'}>
                    {assigned ?? 'materjal valimata'}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <MaterialPicker
          value={state.materialByType[active] ?? null}
          onChange={assign}
          invalid={!!materialError}
          labelledBy="wizard-materjal-label"
          describedBy={materialError ? 'wizard-materjal-error' : undefined}
        />
        {/* Said plainly rather than left to be discovered on the price page:
            unassigned work is quoted with the job's first material. */}
        {multi && state.jobTypes.some(k => !state.materialByType[k]?.trim()) && (
          <p className={WIZARD_HELP}>
            Määramata tööosad hinnastatakse esimese valitud materjali järgi.
          </p>
        )}
        {materialError && (
          <p id="wizard-materjal-error" className={WIZARD_ERROR} role="alert">
            {materialError.message}
          </p>
        )}
      </section>

      {rules.supportsShade ? (
        <section>
          <SectionHeading
            id="wizard-toon-label"
            title="Värvitoon"
            help="Üks toon kehtib kõigile selle töö hammastele. Üksiku hamba tooni saad hiljem töö lehel muuta."
          />
          <WizardShadePicker
            value={state.defaultShade}
            onChange={defaultShade => patch({ defaultShade })}
          />

          {/* Köndivärv sits inside the shade section, not beside it: the two
              are one decision. The ingot is chosen from the pair — the target
              shade alone does not determine it. */}
          <div className="mt-6">
            <SectionHeading
              id="wizard-kondivarv-label"
              title="Köndivärv"
              help="Ihutud köndi enda toon (VITA ND). Läbipaistva keraamika all paistab see krooni läbi. Kui ei ole teada, jäta valimata."
            />
            <WizardDieShadePicker
              value={state.dieShade}
              onChange={dieShade => patch({ dieShade })}
            />
          </div>
        </section>
      ) : (
        // Said out loud rather than silently omitted: a missing field reads as
        // a bug to someone who filled this form yesterday for a crown.
        <p className="flex items-start gap-2 text-base text-ink-muted">
          <Info className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          Valitud töö tüüpide juures värvitooni ei küsita.
        </p>
      )}

      {rules.supportsGlaze && (
        <section>
          <SectionHeading
            id="wizard-glasuur-label"
            title="Glasuur"
            help="Kui glasuuri ei ole vaja, jäta valimata."
          />
          <OptionRow
            label="Glasuur"
            options={GLAZE_OPTIONS}
            value={state.glaze}
            onChange={glaze => patch({ glaze })}
          />
        </section>
      )}

      {rules.supportsTexture && (
        <section>
          <SectionHeading
            id="wizard-tekstuur-label"
            title="Tekstuur"
            help="Pinna tekstuur. Vabatahtlik."
          />
          <OptionRow
            label="Tekstuur"
            options={TEXTURE_OPTIONS}
            value={state.texture}
            onChange={texture => patch({ texture })}
          />
        </section>
      )}
    </div>
  )
}
