/**
 * "The technician's pay, large, on the job" (spec, Phase 1 — from the
 * existing rule engine).
 *
 * The engine pays only FINISHED work in a period, so a job on the bench earns
 * nothing yet. This asks the engine one hypothetical: if this job were done
 * today, what would it pay this person? Same function, same rules, same rush
 * share — the number on the job and the number on the payslip cannot disagree,
 * because they are the same calculation.
 *
 * Only the job itself; revisions are paid when each of them is finished.
 */
import type { Job } from '../types/job'
import type { WorkType } from '../config/workTypes'
import { calculateEarnings, earningsTotal, type EarningLine, type WorkerRate } from './earnings'

export interface JobPay {
  amount: number
  lines: EarningLine[]
}

export function projectedJobPay(args: {
  job: Job
  profileId: string
  rates: WorkerRate[]
  types: WorkType[]
  doneStageKey: string
  rushMultiplier?: number
  today: string
}): JobPay {
  const { job, profileId, rates, types, doneStageKey, rushMultiplier = 1, today } = args
  const asIfDone: Job = { ...job, status: doneStageKey, valmis_kuupaev: today }
  const lines = calculateEarnings({
    profileId, rates, jobs: [asIfDone], hours: [], types,
    periodStart: today, periodEnd: today, doneStageKey,
    includeMonthly: false, rushMultiplier,
  }).filter(l => l.job_id === job.id && l.revision_id === null)
  return { amount: earningsTotal(lines), lines }
}
