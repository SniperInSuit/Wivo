/**
 * A job's stages: in order, who is on each, which one it is at, who started
 * it, what is done and skipped, and what is next (docs/WORKFLOW-STAGES.md §3.2,
 * §4, §5). Every action asks the database (lib/jobStages): a button is shown
 * only when the database would allow it, and an error from it is shown as is.
 *
 * The room for a rating on each stage (docs/MODULES-AND-RATINGS.md, part 2) is
 * `renderExtra`: nothing is built in it yet.
 */
import { useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Check, CircleDot, Circle, MinusCircle, ArrowLeft, ArrowRight, Play, Pencil, Plus, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePipeline } from '../../context/PipelineContext'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { describeError } from '../Patients/errors'
import {
  addJobStage, hasStagePeople, jobStagesUnavailable, moveJobStage, myTurnIn, neighbours, setJobStagePeople,
  setJobStageSkipped, startJobStage, stageLines, useCanMove, useJobStages, useRefreshJobStages,
  type StageLine,
} from '../../lib/jobStages'
import { assignPerson } from '../../lib/stageAssign'
import { QuickAssign } from './QuickAssign'
import { t, dateLocale } from '@/lib/i18n'

export interface JobStagesPanelProps {
  job: { id: string; status: string }
  /** Room for something under a stage's row (ratings, later). */
  renderExtra?: (line: StageLine) => ReactNode
  /** The phone: shows and moves the stages and changes people (with quick assign), but does not add or skip. */
  compact?: boolean
}

const when = (iso: string) => format(new Date(iso), 'd MMM HH:mm', { locale: dateLocale })

export function JobStagesPanel({ job, renderExtra, compact = false }: JobStagesPanelProps) {
  const { user } = useAuth()
  const { stages: clinicStages, stageMap } = usePipeline()
  const { data: profiles = [] } = useClinicProfiles()
  const { data: stages = [] } = useJobStages(job.id)
  const refresh = useRefreshJobStages()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const lines = stageLines(stages, job.status)
  const { previous, next } = neighbours(lines)
  const canNext = useCanMove(job.id, job.status, next?.stageKey)
  const canPrevious = useCanMove(job.id, job.status, previous?.stageKey)
  const { data: mayEditStages = false } = useQuery<boolean>({
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

  const mayEdit = mayEditStages
  const mayAddOrSkip = mayEditStages && !compact

  if (stages.length === 0) return null

  const label = (key: string) => stageMap[key]?.label ?? key
  const name = (id: string | null) => (id && profiles.find(p => p.id === id)?.full_name) || t('workflow.someone')
  const current = lines.find(l => l.state === 'current')
  const turnIn = myTurnIn(lines, user?.id)
  const startable = current && (current.people.includes(user?.id ?? '') || !hasStagePeople(stages))

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

  return (
    <section className="card p-4 space-y-3" aria-label={t('workflow.stagesTitle')}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{t('workflow.stagesTitle')}</h3>
        {mayAddOrSkip && (
          <button type="button" onClick={() => setAdding(a => !a)} className="btn-ghost ml-auto text-xs flex items-center gap-1">
            <Plus size={12} aria-hidden="true" /> {t('workflow.addStage')}
          </button>
        )}
      </div>

      {turnIn !== null && (
        <p className="text-xs text-ink-muted">
          {turnIn === 0 ? t('workflow.myTurnNext') : t('workflow.myTurnIn', { n: turnIn })}
        </p>
      )}

      <ol className="space-y-2">
        {lines.map(l => (
          <li key={l.id} className={`rounded-lg border px-3 py-2 text-sm ${l.state === 'current' ? 'border-accent/50 bg-accent/5' : 'border-ink-faint/15'}`}>
            <div className="flex items-center gap-2">
              {l.state === 'done' ? <Check size={14} className="text-emerald-500" aria-label={t('workflow.done')} />
                : l.state === 'current' ? <CircleDot size={14} className="text-accent" aria-label={t('workflow.nowHere')} />
                : l.state === 'skipped' ? <MinusCircle size={14} className="text-ink-faint" aria-label={t('workflow.skipped')} />
                : <Circle size={14} className="text-ink-faint" aria-hidden="true" />}
              <span className={`font-medium ${l.state === 'skipped' ? 'text-ink-faint line-through' : 'text-ink'}`}>{label(l.stageKey)}</span>
              {l.state === 'skipped' && <span className="text-[11px] text-ink-muted">{t('workflow.skipped')}</span>}
              <span className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
                {mayEdit && (
                  <>
                    <button type="button" onClick={() => setEditing(editing === l.stageKey ? null : l.stageKey)}
                      title={t('workflow.changePeople')} aria-label={t('workflow.changePeople')} className="hover:text-ink">
                      <Users size={12} />
                    </button>
                    {mayAddOrSkip && l.state !== 'done' && l.state !== 'current' && (
                      <button type="button" disabled={busy} onClick={() => void run(() => setJobStageSkipped(job.id, l.stageKey, l.state !== 'skipped'))}
                        className="hover:text-ink">
                        {l.state === 'skipped' ? t('workflow.unskip') : t('workflow.skip')}
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
            <p className="mt-0.5 pl-6 text-xs text-ink-muted">
              {l.people.length === 0 ? t('workflow.nobody') : l.people.map(name).join(', ')}
              {l.task && <> · {l.task}</>}
            </p>
            {l.startedAt && (
              <p className="pl-6 text-[11px] text-ink-muted">{t('workflow.startedBy', { who: name(l.startedBy), when: when(l.startedAt) })}</p>
            )}
            {l.doneAt && l.state === 'done' && (
              <p className="pl-6 text-[11px] text-ink-muted">{t('workflow.doneBy', { who: name(l.doneBy), when: when(l.doneAt) })}</p>
            )}
            {editing === l.stageKey && (
              <PeoplePicker
                everyone={profiles.map(p => ({ id: p.id, name: p.full_name || t('wizard.unnamed') }))}
                chosen={l.people}
                busy={busy}
                onSave={people => run(async () => { await setJobStagePeople(job.id, l.stageKey, people); setEditing(null) })}
              />
            )}
            {renderExtra?.(l)}
          </li>
        ))}
      </ol>

      {mayEdit && (
        <QuickAssign
          stages={lines.map(l => ({ stageKey: l.stageKey, label: label(l.stageKey), people: l.people, skipped: l.state === 'skipped' || l.state === 'done' }))}
          everyone={profiles.map(p => ({ id: p.id, name: p.full_name || t('wizard.unnamed') }))}
          busy={busy}
          onApply={(person, ticked) => run(async () => {
            const changes = assignPerson(lines.filter(l => l.state !== 'skipped' && l.state !== 'done'), person, ticked)
            for (const c of changes) await setJobStagePeople(job.id, c.stageKey, c.people)
          })}
        />
      )}

      {adding && mayAddOrSkip && (
        <AddStage
          options={clinicStages.filter(s => !lines.some(l => l.stageKey === s.key)).map(s => ({ key: s.key, label: s.label }))}
          after={lines.map(l => ({ key: l.stageKey, label: label(l.stageKey) }))}
          busy={busy}
          onAdd={(stage, after) => run(async () => { await addJobStage(job.id, stage, after); setAdding(false) })}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {startable && (
          <button type="button" disabled={busy} onClick={() => void run(() => startJobStage(job.id))}
            className="btn-ghost text-xs border border-ink-faint/30 flex items-center gap-1">
            <Play size={12} aria-hidden="true" /> {t('workflow.iStarted')}
          </button>
        )}
        {previous && canPrevious.data === true && (
          <button type="button" disabled={busy} onClick={() => void run(() => moveJobStage(job.id, previous.stageKey))}
            className="btn-ghost text-xs border border-ink-faint/30 flex items-center gap-1">
            <ArrowLeft size={12} aria-hidden="true" /> {t('workflow.moveBack', { stage: label(previous.stageKey) })}
          </button>
        )}
        {next && canNext.data === true && (
          <button type="button" disabled={busy} onClick={() => void run(() => moveJobStage(job.id, next.stageKey))}
            className="btn-ghost text-xs border border-accent/40 text-accent flex items-center gap-1">
            {t('workflow.moveOn', { stage: label(next.stageKey) })} <ArrowRight size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </section>
  )
}

export function PeoplePicker({ everyone, chosen, busy, onSave }: {
  everyone: { id: string; name: string }[]
  chosen: string[]
  busy: boolean
  onSave: (people: string[]) => void
}) {
  const [picked, setPicked] = useState<string[]>(chosen)
  return (
    <div className="mt-2 ml-6 space-y-1 rounded-lg bg-bg-sidebar p-2">
      {everyone.map(p => (
        <label key={p.id} className="flex items-center gap-2 text-xs text-ink">
          <input type="checkbox" checked={picked.includes(p.id)}
            onChange={e => setPicked(x => e.target.checked ? [...x, p.id] : x.filter(i => i !== p.id))} />
          {p.name}
        </label>
      ))}
      <button type="button" disabled={busy} onClick={() => onSave(picked)} className="btn-ghost text-xs border border-ink-faint/30 flex items-center gap-1">
        <Pencil size={11} aria-hidden="true" /> {t('workflow.savePeople')}
      </button>
    </div>
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
