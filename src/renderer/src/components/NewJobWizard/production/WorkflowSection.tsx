import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { materialiseTemplate, type OnlyIfRule } from '@shared/workflow/workflow'
import type { WizardStepProps } from '../types'
import { useWorkflowTemplates, useStageDefaults } from '@/hooks/useWorkflowTemplates'
import { useClinicProfiles } from '@/hooks/useClinicProfiles'
import { useAuth } from '@/context/AuthContext'
import { usePipeline } from '@/context/PipelineContext'
import { wizardWorkItems } from '../state/workItems'
import { useWorkTypes } from '@/stores/useSettings'
import { hasPrintedModel, implantsOnJob, jobFactsOf, switchesToSend } from '../state/workflowFields'
import { PeoplePicker } from '@/components/JobDetail/JobStagesPanel'
import { QuickAssign } from '@/components/JobDetail/QuickAssign'
import { assignPerson } from '@/lib/stageAssign'
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
export function WorkflowSection({ state, patch }: Pick<WizardStepProps, 'state' | 'patch'>) {
  const { data: templates = [] } = useWorkflowTemplates()
  const { data: clinicDefaults = {} } = useStageDefaults()
  const { data: profiles = [] } = useClinicProfiles()
  const { user } = useAuth()
  const { stageMap } = usePipeline()
  const { types } = useWorkTypes()
  const [editing, setEditing] = useState<string | null>(null)

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
  const effective = plan.map(p => ({
    ...p,
    people: state.stagePeople[p.stageKey] ?? p.people,
    skipped: state.stageSkipped.includes(p.stageKey),
  }))
  const everyone = profiles.map(p => ({ id: p.id, name: p.full_name || t('wizard.unnamed') }))
  const setPeople = (key: string, people: string[]) => patch({ stagePeople: { ...state.stagePeople, [key]: people } })
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
            <ol className="space-y-2">
              {effective.map((p, i) => (
                <li key={p.stageKey} className="rounded-lg border border-ink-faint/15 px-3 py-2 text-base">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${p.skipped ? 'text-ink-faint line-through' : 'text-ink'}`}>{i + 1}. {label(p.stageKey)}</span>
                    {p.skipped && <span className="text-sm text-ink-muted">{t('workflow.skipped')}</span>}
                    <span className="ml-auto flex items-center gap-3 text-sm text-ink-muted">
                      <button type="button" className="inline-flex min-h-[32px] items-center gap-1 hover:text-ink"
                        onClick={() => setEditing(editing === p.stageKey ? null : p.stageKey)}>
                        <Users size={14} aria-hidden="true" /> {t('workflow.changePeople')}
                      </button>
                      {i > 0 && (
                        <button type="button" className="min-h-[32px] hover:text-ink"
                          onClick={() => patch({ stageSkipped: p.skipped ? state.stageSkipped.filter(k => k !== p.stageKey) : [...state.stageSkipped, p.stageKey] })}>
                          {p.skipped ? t('workflow.unskip') : t('workflow.skip')}
                        </button>
                      )}
                    </span>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {p.people.length === 0 ? t('workflow.nobody') : p.people.map(id => id === user?.id ? t('workflow.you') : name(id)).join(', ')}
                    {p.task && <> · {p.task}</>}
                  </p>
                  {editing === p.stageKey && (
                    <PeoplePicker
                      key={p.stageKey}
                      everyone={everyone}
                      chosen={p.people}
                      busy={false}
                      onSave={people => { setPeople(p.stageKey, people); setEditing(null) }}
                    />
                  )}
                </li>
              ))}
            </ol>
            <QuickAssign
              stages={effective.map(p => ({ stageKey: p.stageKey, label: label(p.stageKey), people: p.people, skipped: p.skipped }))}
              everyone={everyone}
              onApply={(person, ticked) => patch({
                stagePeople: {
                  ...state.stagePeople,
                  ...Object.fromEntries(assignPerson(effective.filter(p => !p.skipped), person, ticked).map(c => [c.stageKey, c.people])),
                },
              })}
            />
          </>
        )}
      </div>
    </section>
  )
}
