/**
 * A job's own stages: who is on each, what is done, what is next
 * (docs/WORKFLOW-STAGES.md §3.2, §4, §5), and the database functions that
 * change them (sql/123).
 *
 * Every change goes through a function that asks the database's own rule
 * (can_move_stage, may_edit_job_stages): the buttons only avoid offering what
 * would be refused. A job moves by move_job_stage, not by updating its row: a
 * person on a stage (IT on the intake stage) has no jobs.write.
 *
 * A database without sql/122–123 answers with a missing table or function;
 * that is "no stages", never an error on screen (jobStagesUnavailable).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

export interface JobStage {
  id: string
  stageKey: string
  position: number
  task: string | null
  skipped: boolean
  startedAt: string | null
  startedBy: string | null
  doneAt: string | null
  doneBy: string | null
  people: string[]
}

interface RawJobStage {
  id: string
  stage_key: string
  position: number
  task: string | null
  skipped_at: string | null
  started_at: string | null
  started_by: string | null
  done_at: string | null
  done_by: string | null
  job_stage_person: { profile_id: string }[] | null
}

const SELECT =
  'id, stage_key, position, task, skipped_at, started_at, started_by, done_at, done_by, job_stage_person(profile_id)'

/** Rows as read → stages in their order. Pure. */
export function jobStagesFromRows(rows: readonly RawJobStage[] | null | undefined): JobStage[] {
  return [...(rows ?? [])].sort((a, b) => a.position - b.position).map(r => ({
    id: r.id, stageKey: r.stage_key, position: r.position, task: r.task,
    skipped: r.skipped_at !== null,
    startedAt: r.started_at, startedBy: r.started_by, doneAt: r.done_at, doneBy: r.done_by,
    people: (r.job_stage_person ?? []).map(p => p.profile_id),
  }))
}

/** The database is older than sql/122–123: a missing table, relationship or function. */
export function jobStagesUnavailable(error: { code?: string | null } | null | undefined): boolean {
  const c = error?.code ?? ''
  return c === '42P01' || c === 'PGRST200' || c === 'PGRST205' || c === 'PGRST202' || c === '42883'
}

/** What a stage is, on screen. 'current' is the stage jobs.status names. */
export type StageState = 'done' | 'current' | 'upcoming' | 'skipped'

export interface StageLine extends JobStage {
  state: StageState
  /** Stages that are not skipped, between the current one and this one (0: it is next). Null unless upcoming. */
  stagesAway: number | null
}

/**
 * The stages with their state against the job's current stage. A stage
 * before the current one that was not skipped counts as done, whether or not
 * it carries a done mark: an old job's stages have none (the plan: it looks as
 * it did before).
 */
export function stageLines(stages: readonly JobStage[], currentKey: string): StageLine[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position)
  const current = ordered.find(s => s.stageKey === currentKey)
  let away = 0
  return ordered.map(s => {
    if (s.skipped) return { ...s, state: 'skipped' as const, stagesAway: null }
    if (current && s.stageKey === current.stageKey) return { ...s, state: 'current' as const, stagesAway: null }
    if (current && s.position < current.position) return { ...s, state: 'done' as const, stagesAway: null }
    away += 1
    return { ...s, state: 'upcoming' as const, stagesAway: away - 1 }
  })
}

/** Does anybody stand on any stage? Without, the job runs by today's rules and the panel has little to say. */
export const hasStagePeople = (stages: readonly JobStage[]): boolean => stages.some(s => !s.skipped && s.people.length > 0)

/**
 * The stages before and after the current one that are not skipped: the two
 * moves the buttons offer (the database decides whether this person may).
 */
export function neighbours(lines: readonly StageLine[]): { previous: StageLine | null; next: StageLine | null } {
  const idx = lines.findIndex(l => l.state === 'current')
  if (idx < 0) return { previous: null, next: null }
  const previous = [...lines.slice(0, idx)].reverse().find(l => l.state !== 'skipped') ?? null
  const next = lines.slice(idx + 1).find(l => l.state !== 'skipped') ?? null
  return { previous, next }
}

/** For me: how many of the job's stages are between the current one and my first upcoming one. */
export function myTurnIn(lines: readonly StageLine[], me: string | null | undefined): number | null {
  if (!me) return null
  const mine = lines.find(l => l.state === 'upcoming' && l.people.includes(me))
  return mine?.stagesAway ?? null
}

export const jobStagesKey = (jobId: string) => ['job_stages', jobId] as const

/** A job's stages, with their people. Empty for a database without them. */
export function useJobStages(jobId: string | null | undefined) {
  return useQuery<JobStage[]>({
    queryKey: jobStagesKey(jobId ?? ''),
    enabled: !!jobId,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('job_stage').select(SELECT).eq('job_id', jobId!).order('position')
      if (error) {
        if (jobStagesUnavailable(error)) return []
        throw error
      }
      return jobStagesFromRows(data as unknown as RawJobStage[])
    },
  })
}

/**
 * May I move this job to `to`? The database's answer (can_move_stage, §5). A
 * database without the function: false, and the board's own drag keeps
 * working as it did.
 */
export function useCanMove(jobId: string, status: string, targetKey: string | null | undefined) {
  return useQuery<boolean>({
    queryKey: ['can_move_stage', jobId, status, targetKey ?? ''],
    enabled: !!targetKey,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_move_stage', { p_job: jobId, p_to: targetKey })
      if (error) {
        if (jobStagesUnavailable(error)) return false
        throw error
      }
      return data === true
    },
  })
}

/** After any change to a job's stages: what the screens show comes from these. */
export function useRefreshJobStages() {
  const qc = useQueryClient()
  return (jobId: string) => {
    void qc.invalidateQueries({ queryKey: jobStagesKey(jobId) })
    void qc.invalidateQueries({ queryKey: ['can_move_stage', jobId] })
    void qc.invalidateQueries({ queryKey: ['jobs'] })
  }
}

// ─── The database functions (sql/123), one call each ─────────────────────────

async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(fn, args)
  if (error) throw error
}

/** §5: move to a stage. */
export const moveJobStage = (jobId: string, to: string) => call('move_job_stage', { p_job: jobId, p_to: to })
/** §4: "I started" on the job's current stage. */
export const startJobStage = (jobId: string) => call('start_job_stage', { p_job: jobId })
/** §2.4: put one of the clinic's stages on a job, right after `after` (null: first). */
export const addJobStage = (jobId: string, stage: string, after: string | null, task?: string | null) =>
  call('add_job_stage', { p_job: jobId, p_stage: stage, p_after: after, p_task: task ?? null })
export const setJobStageSkipped = (jobId: string, stage: string, skipped: boolean) =>
  call('set_job_stage_skipped', { p_job: jobId, p_stage: stage, p_skipped: skipped })
export const setJobStagePeople = (jobId: string, stage: string, people: readonly string[]) =>
  call('set_job_stage_people', { p_job: jobId, p_stage: stage, p_people: [...people] })

/** Do I get e-mails for every stage of jobs I am on? Own setting; null on a database without it. */
export async function fetchNotifyEveryStage(userId: string): Promise<boolean | null> {
  const { data, error } = await supabase.from('profiles').select('notify_every_stage').eq('id', userId).maybeSingle()
  if (error || !data) return null
  return (data as { notify_every_stage: boolean | null }).notify_every_stage ?? false
}
export const setNotifyEveryStage = (on: boolean) => call('set_notify_every_stage', { p_on: on })

/**
 * The people and skips chosen in the new-job form, applied to the job once it
 * exists. Only stages the job really has (an optional one switched off has
 * none). Every change is tried; the first failure is thrown at the end, so one
 * refused change does not hide the others.
 */
export async function applyStageEdits(
  jobId: string,
  edits: { people: Readonly<Record<string, readonly string[]>>; skipped: readonly string[] },
): Promise<void> {
  const { data, error } = await supabase.from('job_stage').select('stage_key').eq('job_id', jobId)
  if (error) throw error
  const have = new Set((data ?? []).map(r => (r as { stage_key: string }).stage_key))
  let failure: unknown = null
  const attempt = async (f: () => Promise<void>) => { try { await f() } catch (e) { failure ??= e } }
  for (const [stage, people] of Object.entries(edits.people)) {
    if (have.has(stage)) await attempt(() => setJobStagePeople(jobId, stage, people))
  }
  for (const stage of edits.skipped) {
    if (have.has(stage)) await attempt(() => setJobStageSkipped(jobId, stage, true))
  }
  if (failure) throw failure
}
