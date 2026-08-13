import { useState } from 'react'
import { Cpu } from 'lucide-react'
import type { NewJobState } from '@shared/wizard'
import { baseTypeName } from '@shared/wizard'
import { useSettings, useWorkTypes } from '@/stores/useSettings'
import { WizardField } from '../ui/WizardField'
import { WizardSelect } from '../ui/WizardSelect'
import { FOCUS_RING, WIZARD_HELP } from '../wizardTheme'

export interface MachinePickerProps {
  state: NewJobState
  patch: (p: Partial<NewJobState>) => void
}

/**
 * Which printer each piece of work runs on.
 *
 * A single job-level dropdown could only say what the WHOLE case ran on. That
 * is wrong twice over: a lab with two printers routinely splits a case — the
 * bridge on the Pro2, the crowns on the Midas — and `jobMaterialCost` reads a
 * machine-specific cost key ("materjal|masin") BEFORE the base rate, precisely
 * because a Pro2 arch kit is bulk and a Midas capsule is per tooth. One machine
 * for the whole job therefore did not just lose detail, it produced a wrong
 * margin.
 *
 * Deliberately the same shape as StepMaterial's per-type strip: a technician
 * who has learned one of these has learned both, and the two questions are
 * asked about exactly the same list of work.
 */
export function MachinePicker({ state, patch }: MachinePickerProps) {
  const { settings } = useSettings()
  const { hex } = useWorkTypes()
  const [activeKey, setActiveKey] = useState(state.jobTypes[0] ?? '')

  const active = state.jobTypes.includes(activeKey) ? activeKey : state.jobTypes[0] ?? ''
  const multi = state.jobTypes.length > 1
  const options = settings.masinad.map(m => ({ value: m, label: m }))

  const assign = (machine: string | null) => {
    const next = { ...state.machineByType }
    if (machine) next[active] = machine
    else delete next[active]
    // `machine` stays in step with the first assignment so anything still
    // reading the job-level field — the draft banner, an older summary row —
    // does not go blank the moment this becomes per-item.
    patch({ machineByType: next, machine: next[state.jobTypes[0] ?? ''] ?? null })
  }

  // One type, or none picked yet: no strip, because there is nothing to split.
  // The question stays exactly the single dropdown it always was.
  if (!multi) {
    return (
      <WizardField
        label="Masin"
        htmlFor="wizard-masin"
        help="Millise printeri või freesiga töö tehakse."
      >
        <WizardSelect
          id="wizard-masin"
          value={active ? state.machineByType[active] ?? state.machine : state.machine}
          onChange={assign}
          placeholder="Määramata"
          options={options}
        />
      </WizardField>
    )
  }

  return (
    <div>
      <p className="text-base font-semibold text-ink">Masin</p>
      <p className={`${WIZARD_HELP} mb-3`}>
        Iga tööosa võib käia eri printeril. Vali tööosa ja siis selle masin.
      </p>

      <div role="tablist" aria-label="Tööosad" className="flex flex-wrap gap-2 mb-4">
        {state.jobTypes.map(key => {
          const nimi = baseTypeName(key)
          const assigned = state.machineByType[key]?.trim()
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
                {assigned ?? 'masin valimata'}
              </span>
            </button>
          )
        })}
      </div>

      <WizardField
        label={`${baseTypeName(active)} — masin`}
        htmlFor="wizard-masin"
        help="Määramata tööosa läheb töö esimese masina alla."
      >
        <WizardSelect
          id="wizard-masin"
          value={state.machineByType[active] ?? null}
          onChange={assign}
          placeholder="Määramata"
          options={options}
        />
      </WizardField>

      {state.jobTypes.some(k => !state.machineByType[k]?.trim()) && (
        <p className={`${WIZARD_HELP} mt-2 flex items-start gap-2`}>
          <Cpu className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          Masinapõhine materjalikulu arvutatakse tööosa masina järgi — määramata
          tööosa kasutab esimese masina hinda.
        </p>
      )}
    </div>
  )
}
