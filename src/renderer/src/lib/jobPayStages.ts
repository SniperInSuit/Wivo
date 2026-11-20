/**
 * Jobs read WITH the stages that carry a pay kind (§10, docs/WORKFLOW-STAGES.md),
 * so the pay engine knows who a stage pays without a second query per screen.
 *
 * Only stages with a pay kind are embedded (`job_stage.pay_role`, sql/124): an
 * old job has none, a job from a template has at most four, and that is all pay
 * needs. The embedded rows pass the same RLS as the job itself (sql/122).
 *
 * A database without sql/124 (or without sql/122 at all) answers the embed with
 * "no such column / relationship". The jobs are then read alone, with no pay
 * stages, which is exactly today's rule: such a database has no stage people a
 * job could be paid by. Any other error is thrown, never swallowed: reading jobs
 * without their pay stages on a database that has them would pay the old way
 * where the new one applies.
 */
import { payStagesFromRows } from '@shared/workflow/pay'
import type { Job } from '../types/job'

/** `select(...)` for jobs with their pay stages. */
export const JOBS_WITH_PAY_STAGES =
  '*, job_stage(stage_key, position, pay_role, skipped_at, job_stage_person(profile_id))'

/** The embed filter: only the stages that carry a pay kind. */
export const PAY_STAGE_FILTER = ['job_stage.pay_role', 'is', null] as const

/**
 * The database is older than the embed: sql/122 (no job_stage relationship)
 * or sql/124 (no pay_role column). Nothing else counts.
 */
export function payStagesUnavailable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  const code = error.code ?? ''
  if (code === 'PGRST200' || code === '42P01' || code === 'PGRST205') return true
  // A missing column is only "older database" when it is the embed's own.
  if (code === '42703' || code === 'PGRST204') return /job_stage|pay_role/i.test(error.message ?? '')
  return false
}

/** One row as read: the embed turned into `pay_stages`, the raw rows dropped. */
export function withPayStages(row: Record<string, unknown>): Job {
  const { job_stage: rows, ...job } = row
  return { ...(job as unknown as Job), pay_stages: payStagesFromRows(rows) }
}

/** Remember for the session that this database has no pay stages to embed. */
let unavailable = false
export const payStagesKnownUnavailable = (): boolean => unavailable
export const markPayStagesUnavailable = (): void => { unavailable = true }
/** Tests only. */
export const resetPayStagesAvailability = (): void => { unavailable = false }
