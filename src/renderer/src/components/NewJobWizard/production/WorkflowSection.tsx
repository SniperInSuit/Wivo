import { useMemo } from 'react'
import { materialiseTemplate, type OnlyIfRule } from '@shared/workflow/workflow'
import type { WizardStepProps } from '../types'
import { useWorkflowTemplates, useStageDefaults } from '@/hooks/useWorkflowTemplates'
import { useClinicProfiles } from '@/hooks/useClinicProfiles'
import { useAuth } from '@/context/AuthContext'
import { usePipeline } from '@/context/PipelineContext'
import { wizardWorkItems } from '../state/workItems'
import { useWorkTypes } from '@/stores/useSettings'
import { hasPrintedModel, implantsOnJob, jobFactsOf, switchesToSend } from '../state/workflowFields'
import { StageBar, type StageBarItem } from '@/components/JobDetail/StageBar'
import { WizardField } from '../ui/WizardField'
import { WizardSelect } from '../ui/WizardSelect'
import { WIZARD_HELP, FOCUS_RING } from '../wizardTheme'
import { t } from '@/lib/i18n'

/** Which rule fields a template reads: ask only those questions. */
export function rulesUsed(stages: readonly { onlyIf: readonly OnlyIfRule[] }[]): Set<OnlyIfRule> {
  return new Set(stages.flatMap(s => s.onlyIf))
}

/**
 * The workflow part of the production step (docs/WORKFLOW-STAGES.md §2.4–2.5):
 * the template, the switches of its optional stages, the few answers its
 * rules read, and the stages the job will get — so nobody is surprised by who
 * is told. Nothing here is a question when the clinic has one default template
 * with nothing optional and no rules: the section then says only what the
 * stages are, or is absent when the database has no templates.
 */
export function WorkflowSection({ state, patch, isPhone = false }: Pick<WizardStepProps, 'state' | 'patch'> & { isPhone?: boolean }) {
  const { data: templates = [] } = useWorkflowTemplates()
  const { data: clinicDefaults = {} } = useStageDefaults()
  const { data: profiles = [] } = useClinicProfiles()
  const { user } = useAuth()
  const { stageMap } = usePipeline()
  const { types } = useWorkTypes()

  const active = templates.find(x => x.id === state.templateId) ?? templates.find(x => x.isDefault) ?? templates[0] ?? null
  const items = useMemo(() => wizardWorkItems(state, types), [state, types])
  const used = useMemo(() => rulesUsed(active?.stages ?? []), [active])
  const switchStages = (active?.stages ?? []).filter(s => s.optional)

  const plan = useMemo(() => active ? materialiseTemplate({
    stages: active.stages,
    facts: jobFactsOf(state, items),
    orderedBy: user?.id ?? null,
    switches: switchesToSend(active.stages, state.switches),
    clinicDefaults,
  }) : [], [active, state, items, user, clinicDefaults])

  if (!active) return null

  const label = (key: string) => stageMap[key]?.label ?? key
  const name = (id: string) => profiles.find(p => p.id === id)?.full_name || t('wizard.unnamed')
  const everyone = profiles.map(p => ({ id: p.id, name: p.full_name || t('wizard.unnamed') }))
  // The first stage is where the job starts: the database does not let it be skipped.
  const barItems: StageBarItem[] = plan.map((p, i) => ({
    key: p.stageKey,
    label: label(p.stageKey),
    hex: stageMap[p.stageKey]?.hex ?? '#94A3B8',
    state: state.stageSkipped.includes(p.stageKey) ? 'skipped' : i === 0 ? 'current' : 'upcoming',
    started: false,
    startedBy: null,
    people: state.stagePeople[p.stageKey] ?? p.people,
    canSkip: i > 0,
  }))
  const asks = used.has('digital') || used.has('conventional')
  const asksMethod = used.has('print') || used.has('mill')

  return (
    <section className="space-y-4" aria-labelledby="wizard-workflow-h">
      <div>
        <h3 id="wizard-workflow-h" className="text-lg font-semibold text-ink">{t('workflow.sectionTitle')}</h3>
        <p className={WIZARD_HELP}>{t('workflow.sectionHelp')}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {templates.length > 1 && (
          <WizardField label={t('workflow.template')} htmlFor="wizard-template">
            <WizardSelect
              id="wizard-template"
              value={active.id}
              // A switch belongs to its template's stages: a new template starts from its own defaults.
              onChange={id => patch({ templateId: id && id !== templates.find(x => x.isDefault)?.id ? id : null, switches: {}, stagePeople: {}, stageSkipped: [] })}
              placeholder={t('workflow.template')}
              options={templates.map(x => ({ value: x.id, label: x.name }))}
            />
          </WizardField>
        )}

        {asks && (
          <WizardField label={t('workflow.impressionType')} htmlFor="wizard-impression">
            <WizardSelect
              id="wizard-impression"
              value={state.impressionType}
              onChange={v => patch({ impressionType: v === 'digital' || v === 'conventional' ? v : null })}
              placeholder={t('workflow.notSaid')}
              options={[
                { value: 'digital', label: t('workflow.impressionDigital') },
                { value: 'conventional', label: t('workflow.impressionConventional') },
              ]}
            />
          </WizardField>
        )}

        {asksMethod && (
          <WizardField label={t('workflow.productionMethod')} htmlFor="wizard-method">
            <WizardSelect
              id="wizard-method"
              value={state.productionMethod}
              onChange={v => patch({ productionMethod: v === 'print' || v === 'mill' ? v : null })}
              placeholder={t('workflow.notSaid')}
              options={[
                { value: 'print', label: t('workflow.methodPrint') },
                { value: 'mill', label: t('workflow.methodMill') },
              ]}
            />
          </WizardField>
        )}
      </div>

      {(used.has('implants_gt_1') || used.has('printed_model')) && (
        <ul className={`${WIZARD_HELP} space-y-1`}>
          {used.has('implants_gt_1') && (
            <li>{t('workflow.implantsCounted', { n: implantsOnJob(items) })}</li>
          )}
          {used.has('printed_model') && (
            <li>{hasPrintedModel(state) ? t('workflow.printedModelYes') : t('workflow.printedModelNo')}</li>
          )}
        </ul>
      )}

      {switchStages.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-base font-semibold text-ink-soft">{t('workflow.switches')}</legend>
          {switchStages.map(s => (
            <label key={s.stageKey} className={`flex min-h-[44px] items-center gap-3 text-base text-ink ${FOCUS_RING} rounded-lg`}>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[#EC4899]"
                checked={state.switches[s.stageKey] ?? s.defaultOn}
                onChange={e => patch({ switches: { ...state.switches, [s.stageKey]: e.target.checked } })}
              />
              <span>{label(s.stageKey)}</span>
              {s.task && <span className="text-ink-muted">· {s.task}</span>}
            </label>
          ))}
        </fieldset>
      )}

      <div className="space-y-2">
        <p className="text-base font-semibold text-ink-soft">{t('workflow.plan')}</p>
        {plan.length === 0 ? (
          <p className={WIZARD_HELP}>{t('workflow.planEmpty')}</p>
        ) : (
          <>
            <p className={WIZARD_HELP}>{t('workflow.planNote')}</p>
            <StageBar
              items={barItems}
              everyone={everyone}
              editable
              size={isPhone ? 'lg' : 'md'}
              onPeople={(key, people) => patch({ stagePeople: { ...state.stagePeople, [key]: people } })}
              onSkip={(key, skipped) => patch({
                stageSkipped: skipped ? [...state.stageSkipped, key] : state.stageSkipped.filter(k => k !== key),
              })}
            />
          </>
        )}
      </div>
    </section>
  )
}
