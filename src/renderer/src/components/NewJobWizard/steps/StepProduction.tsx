import type { WizardStepComponent } from '../types'
import { fieldErrors } from '../types'
import { useSettings } from '@/stores/useSettings'
import { WizardField } from '../ui/WizardField'
import { WizardSelect } from '../ui/WizardSelect'
import { WizardWorkerSelect } from '../production/WizardWorkerSelect'
import { PriorityPicker } from '../production/PriorityPicker'
import { WIZARD_INPUT, WIZARD_HELP } from '../wizardTheme'

/**
 * Step 4 — who makes it, on what, and by when.
 *
 * Two roomy columns rather than the Edit page's dense grid: everything here is
 * optional except the dates, so the step has to read as a short list of
 * questions a person can skip, not as a form that must be completed.
 */
export const StepProduction: WizardStepComponent = ({ state, patch, errors, showErrors }) => {
  const { settings } = useSettings()

  const deadlineError = showErrors ? fieldErrors(errors, 'deadline')[0]?.message ?? null : null

  return (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-2">
        <WizardField
          label="Masin"
          htmlFor="wizard-masin"
          help="Millise printeri või freesiga töö tehakse."
        >
          <WizardSelect
            id="wizard-masin"
            value={state.machine}
            onChange={machine => patch({ machine })}
            placeholder="Määramata"
            options={settings.masinad.map(m => ({ value: m, label: m }))}
          />
        </WizardField>

        <div className="hidden md:block" aria-hidden="true" />

        <WizardWorkerSelect
          id="wizard-teostaja"
          label="Teostaja"
          help="Kes töö valmistab. Võib jääda määramata."
          value={state.technician}
          onChange={technician => patch({ technician })}
        />

        <WizardWorkerSelect
          id="wizard-disainija"
          label="Disainija"
          help="Kes töö disainib. Võib olla sama inimene või jääda määramata."
          value={state.designer}
          onChange={designer => patch({ designer })}
        />

        <WizardField
          label="Töö vastuvõtmise kuupäev"
          htmlFor="wizard-kuupaev"
          help="Kuupäev, mil töö laborisse jõudis."
        >
          <input
            id="wizard-kuupaev"
            type="date"
            value={state.date ?? ''}
            onChange={e => patch({ date: e.target.value || null })}
            className={WIZARD_INPUT}
          />
        </WizardField>

        <div className="hidden md:block" aria-hidden="true" />

        <WizardField
          label="Tähtaeg"
          htmlFor="wizard-tahtaeg"
          help="Millal töö peab valmis olema."
          error={deadlineError}
        >
          <input
            id="wizard-tahtaeg"
            type="date"
            value={state.deadline ?? ''}
            onChange={e => patch({ deadline: e.target.value || null })}
            className={WIZARD_INPUT}
          />
        </WizardField>

        <WizardField
          label="Kellaaeg"
          htmlFor="wizard-kellaaeg"
          help="Kui täpne kellaaeg on kokku lepitud. Muidu jäta tühjaks."
        >
          <input
            id="wizard-kellaaeg"
            type="time"
            value={state.time ?? ''}
            onChange={e => patch({ time: e.target.value || null })}
            className={WIZARD_INPUT}
          />
        </WizardField>

        <WizardField
          label="Print ID"
          htmlFor="wizard-print-id"
          help="SprintRay töö number, kui see on juba teada."
        >
          <input
            id="wizard-print-id"
            type="text"
            value={state.printId}
            onChange={e => patch({ printId: e.target.value })}
            placeholder="Nt SR-10432"
            className={WIZARD_INPUT}
          />
        </WizardField>

        <WizardField
          label="Disain ID"
          htmlFor="wizard-disain-id"
          help="Viide disainifailile või disainitarkvara numbrile."
        >
          <input
            id="wizard-disain-id"
            type="text"
            value={state.designId}
            onChange={e => patch({ designId: e.target.value })}
            placeholder="Nt D-2291"
            className={WIZARD_INPUT}
          />
        </WizardField>
      </div>

      <section>
        <h3 className="text-lg font-semibold text-ink">Prioriteet</h3>
        <p className={`${WIZARD_HELP} mb-3`}>
          Vali, kas tegu on tavalise töö, kiirtöö või mudeliga.
        </p>
        <PriorityPicker
          value={state.priority}
          onChange={priority => patch({ priority })}
        />

        {/* The model is a separate print with its own number, so it gets its own
            field — and only once Mudel is chosen. Not left in the two-column
            grid above with Print ID: there it would sit on every job as a
            question that has no answer. */}
        {state.priority === 'mudel' && (
          <div className="mt-4 max-w-sm">
            <WizardField
              label="Mudel ID"
              htmlFor="wizard-mudel-id"
              help="Mudeli töö number, kui see on juba teada."
            >
              <input
                id="wizard-mudel-id"
                type="text"
                value={state.modelId}
                onChange={e => patch({ modelId: e.target.value })}
                placeholder="Nt M-3310"
                className={WIZARD_INPUT}
              />
            </WizardField>
          </div>
        )}
      </section>
    </div>
  )
}
