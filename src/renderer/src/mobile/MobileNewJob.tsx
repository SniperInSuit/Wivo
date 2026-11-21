/**
 * A new job from the phone (docs/WORKFLOW-STAGES.md §13). One kind of work, the
 * patient, the deadline, and the workflow part of the wizard (template, its
 * switches, the few rule answers, the stages the job will get): the same
 * state, the same toJobInput and the same create_job as the desk, so the job is
 * the same job. Anything more (several works, shade, price override, sharing)
 * is for the desk.
 */
import { useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { quoteJob } from '@shared/pricing/quote'
import { canCreate, createEmptyNewJobState, validateAll, type NewJobState } from '@shared/wizard'
import { priceBookOf, useSettings, useWorkTypes } from '../stores/useSettings'
import { usePipeline } from '../context/PipelineContext'
import { useCreateWorkflowJob } from '../hooks/useJobs'
import { useWorkflowTemplates } from '../hooks/useWorkflowTemplates'
import { WorkflowSection } from '../components/NewJobWizard/production/WorkflowSection'
import { switchesToSend } from '../components/NewJobWizard/state/workflowFields'
import { wizardQuoteInput } from '../components/NewJobWizard/state/workItems'
import { toJobInput } from '../components/NewJobWizard/state/toJobInput'
import { describeError } from '../components/Patients/errors'
import type { StageKey } from '../types/job'
import { teethText, toothModeOf, withMaterial, withTeeth, withWorkType } from './phoneNewJob'
import { t } from '@/lib/i18n'

const FIELD = 'w-full rounded-xl border border-ink-faint/30 bg-bg-card px-3 py-3 text-base outline-none focus:border-accent'
const LABEL = 'mb-1 block text-sm font-medium text-ink-soft'

export function MobileNewJob({ onCreated }: { onCreated: (jobId: string) => void }) {
  const { settings } = useSettings()
  const { types } = useWorkTypes()
  const { stages } = usePipeline()
  const { data: templates = [] } = useWorkflowTemplates()
  const createJob = useCreateWorkflowJob()
  const [state, setState] = useState<NewJobState>(() => createEmptyNewJobState({ machine: settings.defaultMachine || null }))
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const patch = (p: Partial<NewJobState>) => setState(s => ({ ...s, ...p }))

  const mode = toothModeOf(state, types)
  const quote = useMemo(() => quoteJob(wizardQuoteInput(state, types), priceBookOf(settings)), [state, types, settings])
  const problems = useMemo(() => validateAll(state, types).filter(e => e.severity === 'error'), [state, types])

  async function create() {
    if (inFlight.current) return
    if (!canCreate(state, types)) { setShowErrors(true); return }
    inFlight.current = true
    setError(null)
    try {
      const template = templates.find(x => x.id === state.templateId) ?? templates.find(x => x.isDefault) ?? null
      const job = await createJob.mutateAsync({
        input: toJobInput(state, { defaultStatus: (stages[0]?.key ?? 'disain') as StageKey, quote, types }),
        switches: template ? switchesToSend(template.stages, state.switches) : {},
        stageEdits: { people: state.stagePeople, skipped: state.stageSkipped },
        onStageEditsFailed: e => window.alert(t('workflow.couldNotApplyStages', { e: describeError(e) })),
      })
      onCreated(job.id)
    } catch (e) {
      setError(t('wizard.couldnTCreateTheJob', { e: describeError(e) }))
    } finally {
      inFlight.current = false
    }
  }

  return (
    <main className="space-y-4 p-3">
      <h1 className="text-lg font-semibold">{t('mobile.newJob')}</h1>

      <div>
        <label htmlFor="m-patient" className={LABEL}>{t('mobile.patientName')}</label>
        <input id="m-patient" className={FIELD} value={state.patient?.name ?? ''} autoComplete="off"
          onChange={e => patch({ patient: e.target.value ? { name: e.target.value, patientId: null } : null })} />
      </div>

      <div>
        <label htmlFor="m-work" className={LABEL}>{t('mobile.workType')}</label>
        <select id="m-work" className={FIELD} value={state.jobTypes[0] ?? ''}
          onChange={e => setState(s => withWorkType(s, e.target.value || null))}>
          <option value="">{t('mobile.chooseWork')}</option>
          {types.map(w => <option key={w.nimi} value={w.nimi}>{w.nimi}</option>)}
        </select>
      </div>

      {mode === 'tooth' && (
        <div>
          <label htmlFor="m-teeth" className={LABEL}>{t('mobile.teethHint')}</label>
          <input id="m-teeth" className={FIELD} inputMode="numeric" defaultValue={teethText(state)}
            onChange={e => setState(s => withTeeth(s, e.target.value))} />
        </div>
      )}
      {mode === 'arch' && (
        <div>
          <label htmlFor="m-arch" className={LABEL}>{t('wizard.jaw')}</label>
          <select id="m-arch" className={FIELD} value={state.selectedArch ?? ''}
            onChange={e => patch({ selectedArch: (e.target.value || null) as NewJobState['selectedArch'] })}>
            <option value="">—</option>
            <option value="upper">{t('wizard.upperJaw')}</option>
            <option value="lower">{t('wizard.lowerJaw')}</option>
            <option value="both">{t('wizard.bothJaws')}</option>
          </select>
        </div>
      )}

      {state.jobTypes.length > 0 && (
        <div>
          <label htmlFor="m-material" className={LABEL}>{t('mobile.material')}</label>
          <select id="m-material" className={FIELD} value={state.materialByType[state.jobTypes[0]] ?? ''}
            onChange={e => setState(s => withMaterial(s, e.target.value || null))}>
            <option value="">{t('mobile.chooseMaterial')}</option>
            {settings.materjalid.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="m-due" className={LABEL}>{t('wizard.dueDate')}</label>
        <input id="m-due" type="date" className={FIELD} value={state.deadline ?? ''}
          onChange={e => patch({ deadline: e.target.value || null })} />
      </div>

      <fieldset>
        <legend className={LABEL}>{t('wizard.jobPriority')}</legend>
        <label className="flex items-center gap-3 py-2 text-base">
          <input type="checkbox" className="h-5 w-5" checked={state.rush}
            onChange={e => patch({ rush: e.target.checked })} />
          {t('wizard.rushJob')}
        </label>
        <label className="flex items-center gap-3 py-2 text-base">
          <input type="checkbox" className="h-5 w-5" checked={state.model}
            onChange={e => patch({ model: e.target.checked })} />
          {t('wizard.model')}
        </label>
      </fieldset>

      <WorkflowSection state={state} patch={patch} isPhone />

      {showErrors && problems.length > 0 && (
        <div role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600">
          <p className="font-medium">{t('mobile.fixFirst')}</p>
          <ul className="list-disc pl-5">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}

      <button type="button" onClick={() => void create()} disabled={createJob.isPending}
        className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-base">
        {createJob.isPending && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
        {t('jobDetail.createJob')}
      </button>
    </main>
  )
}
