import type { WizardStepComponent } from '../types'
import { fieldErrors } from '../types'
import { useSettings } from '@/stores/useSettings'
import { WizardField } from '../ui/WizardField'
import { WizardWorkerSelect } from '../production/WizardWorkerSelect'
import { MachinePicker } from '../production/MachinePicker'
import { PriorityPicker } from '../production/PriorityPicker'
import { DesignSplit } from '../production/DesignSplit'
import { PartnerShare } from '../production/PartnerShare'
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
          label={t('wizard.technician')}
          help={t('wizard.whoMakesTheJobCanBe')}
          value={state.technician}
          onChange={technician => patch({ technician })}
        />

        <WizardWorkerSelect
          id="wizard-disainija"
          label={t('wizard.designer2')}
          help={t('wizard.whoDesignsTheJobCanBe')}
          value={state.designer}
          onChange={designer => patch({ designer })}
        />

        <DesignSplit
          state={state}
          patch={patch}
          toothTypes={rules.toothTypes}
        />

        <PartnerShare />

        <WizardField
          label={t('wizard.dateReceived')}
          htmlFor="wizard-kuupaev"
          help={t('wizard.theDateTheJobArrivedAt')}
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
          label={t('wizard.dueDate')}
          htmlFor="wizard-tahtaeg"
          help={t('wizard.whenTheJobHasToBe')}
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
          label={t('wizard.time')}
          htmlFor="wizard-kellaaeg"
          help={t('wizard.ifAnExactTimeWasAgreed')}
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
          label={t('wizard.printID')}
          htmlFor="wizard-print-id"
          help={t('wizard.theSprintRayJobNumberIfIt')}
        >
          <input
            id="wizard-print-id"
            type="text"
            value={state.printId}
            onChange={e => patch({ printId: e.target.value })}
            placeholder={t('wizard.eGSR10432')}
            className={WIZARD_INPUT}
          />
        </WizardField>

        <WizardField
          label={t('wizard.designID')}
          htmlFor="wizard-disain-id"
          help={t('wizard.aReferenceToTheDesignFile')}
        >
          <input
            id="wizard-disain-id"
            type="text"
            value={state.designId}
            onChange={e => patch({ designId: e.target.value })}
            placeholder={t('wizard.eGD2291')}
            className={WIZARD_INPUT}
          />
        </WizardField>
      </div>

      <section>
        <h3 className="text-lg font-semibold text-ink">{t('wizard.priority')}</h3>
        <p className={`${WIZARD_HELP} mb-3`}>
          {t('wizard.chooseWhetherThisIsAStandard')}
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
              label={t('wizard.modelID')}
              htmlFor="wizard-mudel-id"
              help={t('wizard.theModelJobNumberIfIt')}
            >
              <input
                id="wizard-mudel-id"
                type="text"
                value={state.modelId}
                onChange={e => patch({ modelId: e.target.value })}
                placeholder={t('wizard.eGM3310')}
                className={WIZARD_INPUT}
              />
            </WizardField>
          </div>
        )}
      </section>
    </div>
  )
}
