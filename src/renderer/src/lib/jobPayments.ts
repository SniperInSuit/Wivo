/**
 * What a job is worth, what has been received against it, and what is still owed.
 *
 * Since part payments exist, `makstud` alone is no longer the whole answer: a
 * job can be unpaid by the flag and still have money against it. Every screen
 * that shows money for a job has to read the payment rows, or it reports a debt
 * that has already been half settled.
 */
import type { Job } from '../types/job'
import type { Payment } from '../types/invoice'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Price + design fee + every revision's price. */
export const jobTotalValue = (job: Job): number => round2(
  Number(job.hind ?? 0)
  + Number(job.disain_hind ?? 0)
  + (job.revisions ?? []).reduce((s, r) => s + Number(r.price ?? 0), 0)
)

export const paidForJob = (jobId: string, payments: Payment[]): number =>
  round2(payments
    .filter(p => p.job_id === jobId)
    .reduce((s, p) => s + Number(p.amount), 0))

export function jobPaymentState(job: Job, payments: Payment[]): {
  total: number
  paid: number
  outstanding: number
  /** Something received, but not all of it. */
  partial: boolean
  settled: boolean
} {
  const total = jobTotalValue(job)
  // A job flagged paid before part payments existed has no rows behind it. Trust
  // the flag in that case rather than reporting an old settled job as unpaid.
  const rows = paidForJob(job.id, payments)
  const paid = rows === 0 && job.makstud ? total : rows
  const outstanding = round2(Math.max(0, total - paid))
  return {
    total,
    paid,
    outstanding,
    partial: paid > 0 && outstanding > 0,
    settled: total > 0 ? outstanding <= 0.005 : job.makstud,
  }
}

/** Totals across a set of jobs — the patient panel and the job list use this. */
export function jobsPaymentTotals(jobs: Job[], payments: Payment[]) {
  let total = 0, paid = 0
  for (const j of jobs) {
    const s = jobPaymentState(j, payments)
    total += s.total
    paid += Math.min(s.paid, s.total)
  }
  total = round2(total)
  paid = round2(paid)
  return {
    total,
    paid,
    outstanding: round2(total - paid),
    // Counted the same way the dashboard does: a job with no price is not an
    // outstanding invoice, however unpaid its flag says it is.
    unpaidCount: jobs.filter(j => {
      const s = jobPaymentState(j, payments)
      return s.total > 0 && s.outstanding > 0
    }).length,
    partialCount: jobs.filter(j => jobPaymentState(j, payments).partial).length,
  }
}
