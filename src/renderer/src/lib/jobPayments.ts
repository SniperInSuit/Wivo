/**
 * What a job is worth, what has been received against it, and what is still owed.
 *
 * Since part payments exist, `makstud` alone is no longer the whole answer: a
 * job can be unpaid by the flag and still have money against it. Every screen
 * that shows money for a job has to read the payment rows, or it reports a debt
 * that has already been half settled.
 */
import type { Job } from '../types/job'
import type { InvoiceFull, Payment } from '../types/invoice'
import { lineTotal, paidAmount } from '../types/invoice'

const round2 = (n: number) => Math.round(n * 100) / 100

/** What the chosen extra services add. Copied onto the job at add time. */
export const jobExtrasTotal = (job: Pick<Job, 'extras'>): number => round2(
  (job.extras ?? []).reduce((s, e) => s + Number(e.hind ?? 0), 0)
)

/**
 * Price + design fee + extra services.
 *
 * Revision costs are internal (technician expense), not client-facing — they do
 * not increase what the client owes.
 *
 * `extras` was added in 1.25 and left out of this sum, so a job with a 60 €
 * Ülesehitus on it read as fully paid once the base price landed. Every screen
 * that shows what a job is worth reads this function, so the omission was
 * everywhere at once: payment state, the invoice candidate list, and unbilled
 * revenue in the finance view all under-reported by the extras.
 */
export const jobTotalValue = (job: Job): number => round2(
  Number(job.hind ?? 0)
  + Number(job.disain_hind ?? 0)
  + jobExtrasTotal(job)
)

/**
 * What has been received against ONE job.
 *
 * Money arrives by two routes and this used to see only the first:
 *
 *  1. A payment recorded straight on the job — `payments.job_id`. That is what
 *     "Märgi makstuks" writes.
 *  2. A payment against an INVOICE the job is a line on — `payments.invoice_id`,
 *     with `job_id` null, which is what the invoice screen writes.
 *
 * Counting only (1) meant a job billed on an invoice that was then paid IN FULL
 * still read "Maksmata" on its own panel, on the patient page and in the
 * Ülevaade total, permanently. The money was visible under Rahandus → Laekunud
 * and nowhere else, so the two screens disagreed by exactly the amount that had
 * been invoiced rather than settled job by job.
 *
 * An invoice is attributed by its SETTLEMENT RATIO, not by splitting the cash:
 * paid in full it settles every job on it, half paid it settles half of each.
 * The ratio is taken against `gross_total` and applied to net line values, so
 * VAT cancels instead of over-crediting the jobs by the tax.
 *
 * Which line the money was "for" is a question the data cannot answer — nobody
 * pays an invoice line — so pro-rata by value is the only honest split.
 */
export function paidForJob(
  jobId: string, payments: Payment[], invoices: InvoiceFull[] = []
): number {
  // `!p.invoice_id` so a row carrying both ids cannot be counted twice.
  let sum = payments
    .filter(p => p.job_id === jobId && !p.invoice_id)
    .reduce((s, p) => s + Number(p.amount), 0)

  for (const inv of invoices) {
    if (inv.status === 'tuhistatud') continue
    const mine = (inv.lines ?? [])
      .filter(l => l.job_id === jobId)
      .reduce((s, l) => s + lineTotal(l), 0)
    if (mine <= 0) continue
    const gross = Number(inv.gross_total ?? 0)
    if (gross <= 0) continue
    const ratio = Math.min(1, paidAmount(inv) / gross)
    if (ratio <= 0) continue
    sum += mine * ratio
  }
  return round2(sum)
}

export function jobPaymentState(
  job: Job, payments: Payment[], invoices: InvoiceFull[] = []
): {
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
  const rows = paidForJob(job.id, payments, invoices)
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
export function jobsPaymentTotals(
  jobs: Job[], payments: Payment[], invoices: InvoiceFull[] = []
) {
  let total = 0, paid = 0
  for (const j of jobs) {
    const s = jobPaymentState(j, payments, invoices)
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
      const s = jobPaymentState(j, payments, invoices)
      return s.total > 0 && s.outstanding > 0
    }).length,
    partialCount: jobs.filter(j => jobPaymentState(j, payments, invoices).partial).length,
  }
}
