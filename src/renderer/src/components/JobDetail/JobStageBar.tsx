/**
 * A job's stage bar (docs/WORKFLOW-STAGES.md §3.2, §4, §5): the stages in
 * order, who is on each, which one the job is at, and the buttons that move
 * it. Every change is one click and saved at once. Every action asks the
 * database (lib/jobStages): a button is shown only when the database would
 * allow it, and an error from it is shown as is.
 *
 * Renders nothing for a job without stages (an old job): the caller shows the
 * plain pipeline timeline then.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Play, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePipeline } from '../../context/PipelineContext'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { describeError } from '../Patients/errors'
import {
  addJobStage, hasStagePeople, jobStagesUnavailable, moveJobStage, myTurnIn, neighbours, setJobStagePeople,
  setJobStageSkipped, startJobStage, stageLines, useCanMove, useJobStages, useRefreshJobStages,
} from '../../lib/jobStages'
import { StageBar, type StageBarItem } from './StageBar'
import { t } from '@/lib/i18n'

export function JobStageBar({ job, size = 'md', canAddStage = true }: {
  job: { id: string; status: string }
  size?: 'md' | 'lg'
  /** The desk may add a stage to this job; the phone does not. */
  canAddStage?: boolean
}) {
  const { user } = useAuth()
  const { stages: clinicStages, stageMap, doneStageKey } = usePipeline()
  const { data: profiles = [] } = useClinicProfiles()
  const { data: stages = [] } = useJobStages(job.id)
  const refresh = useRefreshJobStages()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)

  const lines = stageLines(stages, job.status)
  const { previous, next } = neighbours(lines)
  const canNext = useCanMove(job.id, job.status, next?.stageKey)
  const canPrevious = useCanMove(job.id, job.status, previous?.stageKey)
  const { data: mayEdit = false } = useQuery<boolean>({
    queryKey: ['may_edit_job_stages', job.id],
    enabled: stages.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc('may_edit_job_stages', { p_job: job.id })
      if (err) {
        if (jobStagesUnavailable(err)) return false
        throw err
      }
      return data === true
    },
  })

  if (stages.length === 0) return null

  const label = (key: string) => stageMap[key]?.label ?? key
  const finished = job.status === doneStageKey
  const everyone = profiles.map(p => ({ id: p.id, name: p.full_name || t('wizard.unnamed') }))
  const current = lines.find(l => l.state === 'current')
  const turnIn = myTurnIn(lines, user?.id)
  const startable = !finished && current && (current.people.includes(user?.id ?? '') || !hasStagePeople(stages))

  const items: StageBarItem[] = lines.map(l => ({
    key: l.stageKey,
    label: label(l.stageKey),
    hex: stageMap[l.stageKey]?.hex ?? '#94A3B8',
    state: finished && l.state === 'current' ? 'done' : l.state,
    started: l.startedAt !== null,
    startedBy: l.startedBy,
    people: l.people,
    canSkip: l.state === 'skipped' || l.state === 'upcoming',
  }))

  async function run(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
      refresh(job.id)
    }
  }

  const btn = size === 'lg' ? 'min-h-[44px] px-4 text-sm' : 'px-3 py-1 text-xs'

  return (
    <section aria-label={t('workflow.stagesTitle')} className="space-y-3">
      <StageBar
        items={items}
        everyone={everyone}
        editable={mayEdit}
        size={size}
        busy={busy}
        onPeople={(key, people) => void run(() => setJobStagePeople(job.id, key, people))}
        onSkip={(key, skipped) => void run(() => setJobStageSkipped(job.id, key, skipped))}
      />

      {turnIn !== null && (
        <p className="text-xs text-ink-muted">
          {turnIn === 0 ? t('workflow.myTurnNext') : t('workflow.myTurnIn', { n: turnIn })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {previous && canPrevious.data === true && (
          <button type="button" disabled={busy} onClick={() => void run(() => moveJobStage(job.id, previous.stageKey))}
            className={`btn-ghost flex items-center gap-1 border border-ink-faint/30 ${btn}`}>
            <ArrowLeft size={14} aria-hidden="true" /> {t('workflow.previousStage')}
          </button>
        )}
        {startable && (
          <button type="button" disabled={busy} onClick={() => void run(() => startJobStage(job.id))}
            className={`btn-ghost flex items-center gap-1 border border-ink-faint/30 ${btn}`}>
            <Play size={14} aria-hidden="true" /> {t('workflow.iStarted')}
          </button>
        )}
        {next && canNext.data === true && (
          <button type="button" disabled={busy} onClick={() => void run(() => moveJobStage(job.id, next.stageKey))}
            className={`btn-ghost flex items-center gap-1 border border-accent/40 text-accent ${btn}`}>
            {t('workflow.nextStage')} <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
        {mayEdit && canAddStage && (
          <button type="button" onClick={() => setAdding(a => !a)} className={`btn-ghost ml-auto flex items-center gap-1 ${btn}`}>
            <Plus size={12} aria-hidden="true" /> {t('workflow.addStage')}
          </button>
        )}
      </div>

      {adding && mayEdit && (
        <AddStage
          options={clinicStages.filter(s => !lines.some(l => l.stageKey === s.key)).map(s => ({ key: s.key, label: s.label }))}
          after={lines.map(l => ({ key: l.stageKey, label: label(l.stageKey) }))}
          busy={busy}
          onAdd={(stage, after) => void run(async () => { await addJobStage(job.id, stage, after); setAdding(false) })}
        />
      )}
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </section>
  )
}

function AddStage({ options, after, busy, onAdd }: {
  options: { key: string; label: string }[]
  after: { key: string; label: string }[]
  busy: boolean
  onAdd: (stage: string, after: string | null) => void
}) {
  const [stage, setStage] = useState(options[0]?.key ?? '')
  const [where, setWhere] = useState<string>(after[after.length - 1]?.key ?? '')
  if (options.length === 0) return <p className="text-xs text-ink-muted">{t('workflow.noMoreStages')}</p>
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <select className="input w-40" value={stage} onChange={e => setStage(e.target.value)} aria-label={t('workflow.addStage')}>
        {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <select className="input w-44" value={where} onChange={e => setWhere(e.target.value)} aria-label={t('workflow.addAfter')}>
        <option value="">{t('workflow.atTheStart')}</option>
        {after.map(o => <option key={o.key} value={o.key}>{t('workflow.afterStage', { stage: o.label })}</option>)}
      </select>
      <button type="button" disabled={busy || !stage} onClick={() => onAdd(stage, where || null)} className="btn-ghost border border-ink-faint/30">
        {t('workflow.addStage')}
      </button>
    </div>
  )
}
