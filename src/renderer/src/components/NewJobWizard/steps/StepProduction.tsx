import type { WizardStepComponent } from '../types'
import { fieldErrors } from '../types'
import { useSettings } from '@/stores/useSettings'
import { WizardField } from '../ui/WizardField'
import { WizardWorkerSelect } from '../production/WizardWorkerSelect'
import { MachinePicker } from '../production/MachinePicker'
import { PriorityPicker } from '../production/PriorityPicker'
import { DesignSplit } from '../production/DesignSplit'
import { WIZARD_INPUT, WIZARD_HELP } from '../wizardTheme'
import { t } from '@/lib/i18n'

/**
 * Step 4 — who makes it, on what, and by when.
 *
 * Two roomy columns rather than the Edit page's dense grid: everything here is
 * optional except the dates, so the step has to read as a short list of
 * questions a person can skip, not as a form that must be completed.
 */
export const StepProduction: WizardStepComponent = ({ state, patch, rules, errors, showErrors }) => {
  const { settings } = useSettings()

  const deadlineError = showErrors ? fieldErrors(errors, 'deadline')[0]?.message ?? null : null

  return (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="md:col-span-2">
          <MachinePicker state={state} patch={patch} />
        </div>

        <WizardWorkerSelect
          id="wizard-teostaja"
          label={t('Teostaja', 'Technician')}
          help={t('Kes töö valmistab. Võib jääda määramata.', 'Who makes the job. Can be left unassigned.')}
          value={state.technician}
          onChange={technician => patch({ technician })}
        />

        <WizardWorkerSelect
          id="wizard-disainija"
          label={t('Disainija', 'Designer')}
          help={t('Kes töö disainib. Võib olla sama inimene või jääda määramata.', 'Who designs the job. Can be the same person, or left unassigned.')}
          value={state.designer}
          onChange={designer => patch({ designer })}
        />

        <DesignSplit
          state={state}
          patch={patch}
          toothTypes={rules.toothTypes}
        />

        <WizardField
          label={t('Töö vastuvõtmise kuupäev', 'Date received')}
          htmlFor="wizard-kuupaev"
          help={t('Kuupäev, mil töö laborisse jõudis.', 'The date the job arrived at the lab.')}
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
          label={t('Tähtaeg', 'Due date')}
          htmlFor="wizard-tahtaeg"
          help={t('Millal töö peab valmis olema.', 'When the job has to be done.')}
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
          label={t('Kellaaeg', 'Time')}
          htmlFor="wizard-kellaaeg"
          help={t('Kui täpne kellaaeg on kokku lepitud. Muidu jäta tühjaks.', 'If an exact time was agreed. Otherwise leave it empty.')}
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
          label={t('Print ID', 'Print ID')}
          htmlFor="wizard-print-id"
          help={t('SprintRay töö number, kui see on juba teada.', 'The SprintRay job number, if it is already known.')}
        >
          <input
            id="wizard-print-id"
            type="text"
            value={state.printId}
            onChange={e => patch({ printId: e.target.value })}
            placeholder={t('Nt SR-10432', 'e.g. SR-10432')}
            className={WIZARD_INPUT}
          />
        </WizardField>

        <WizardField
          label={t('Disain ID', 'Design ID')}
          htmlFor="wizard-disain-id"
          help={t('Viide disainifailile või disainitarkvara numbrile.', 'A reference to the design file or the design software number.')}
        >
          <input
            id="wizard-disain-id"
            type="text"
            value={state.designId}
            onChange={e => patch({ designId: e.target.value })}
            placeholder={t('Nt D-2291', 'e.g. D-2291')}
            className={WIZARD_INPUT}
          />
        </WizardField>
      </div>

      <section>
        <h3 className="text-lg font-semibold text-ink">{t('Prioriteet', 'Priority')}</h3>
        <p className={`${WIZARD_HELP} mb-3`}>
          {t('Vali, kas tegu on tavalise töö, kiirtöö või mudeliga.', 'Choose whether this is a standard job, a rush job or a model.')}
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
              label={t('Mudel ID', 'Model ID')}
              htmlFor="wizard-mudel-id"
              help={t('Mudeli töö number, kui see on juba teada.', 'The model job number, if it is already known.')}
            >
              <input
                id="wizard-mudel-id"
                type="text"
                value={state.modelId}
                onChange={e => patch({ modelId: e.target.value })}
                placeholder={t('Nt M-3310', 'e.g. M-3310')}
                className={WIZARD_INPUT}
              />
            </WizardField>
          </div>
        )}
      </section>
    </div>
  )
}
