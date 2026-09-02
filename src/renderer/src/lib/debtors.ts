/**
 * Who owes money, how much, and how late. THE answer for both screens.
 *
 * Built on `jobPaymentState`, not on invoice totals, for one reason: a lab is
 * owed for WORK. Some of that work is on an invoice, some is delivered and
 * never billed, and some invoices carry several jobs with only part of the
 * money in. Counting invoices alone would report a lab as owed nothing while a
 * month of uninvoiced work sat on the shelf.
 *
 * THREE AGES OF DEBT, KEPT APART
 *   `overdue`    on an invoice whose due date has passed
 *   `notYetDue`  on an invoice that is still in date
 *   `uninvoiced` no invoice exists at all
 *
 * They are separate because they call for different actions and because
 * "overdue" is a claim you can only make about a bill somebody was actually
 * sent. Uninvoiced work is our own omission, not their lateness, and folding it
 * into "üle tähtaja" would put a customer on a chasing list for a bill they
 * never received.
 *
 * WHO THE DEBTOR IS
 *   The paying customer when the job names one, otherwise the patient. That is
 *   the same fallback the invoice form uses when it decides `bill_to_kind`, so
 *   a debtor here and an addressee there are the same entity.
 */
import type { Job } from '../types/job'
import type { InvoiceFull } from '../types/invoice'
import type { Payment } from '../types/invoice'
import { jobPaymentState } from './jobPayments'

const round2 = (n: number): number => Math.round(n * 100) / 100

export type DebtorKind = 'klient' | 'patsient'

export interface DebtorRow {
  /** Stable across renders and usable as a filter value. */
  key: string
  nimi: string
  liik: DebtorKind
  /** Customer id when `liik === 'klient'`, else null. */
  customerId: string | null
  /** What their unpaid work is worth in total. */
  total: number
  paid: number
  outstanding: number
  overdue: number
  notYetDue: number
  uninvoiced: number
  /** The oldest passed due date behind `overdue`. Null when nothing is late. */
  oldestDue: string | null
  /** Days since `oldestDue`. 0 when nothing is late. */
  daysLate: number
  jobs: number
  /** Jobs with money still against them — what the Table page filters to. */
  jobIds: string[]
  /** Something paid, but not all of it. Worth its own colour on screen. */
  partial: boolean
}

export interface DebtorStats {
  rows: DebtorRow[]
  /** Everything owed, whatever its age. */
  outstanding: number
  overdue: number
  notYetDue: number
  uninvoiced: number
  /** Debtors with a non-zero balance. */
  count: number
  /** The single worst case, for a one-line panel. */
  worst: DebtorRow | null
}

export const EMPTY_DEBTORS: DebtorStats = {
  rows: [], outstanding: 0, overdue: 0, notYetDue: 0, uninvoiced: 0, count: 0, worst: null,
}

export interface DebtorsInput {
  /** Every job in scope. Filter to a period BEFORE calling if that is wanted. */
  jobs: Job[]
  payments: Payment[]
  invoices: InvoiceFull[]
  /** 'YYYY-MM-DD'. What counts as late is measured from here. */
  today: string
  /** Names for customer ids, so a row can say "Hambakliinik OÜ". */
  customers: { id: string; name: string }[]
}

/** Days between two 'YYYY-MM-DD' dates. Whole days, never negative here. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

export function debtors(input: DebtorsInput): DebtorStats {
  const { jobs, payments, invoices, today, customers } = input
  const nameOf = new Map(customers.map(c => [c.id, c.name]))

  // Which invoice, if any, a job's money sits on — and whether that invoice is
  // past its date. A cancelled invoice is not a bill, so it is skipped: the job
  // behind it goes back to being uninvoiced work.
  const invoiceOfJob = new Map<string, { due: string | null }>()
  for (const inv of invoices) {
    if (inv.status === 'tuhistatud') continue
    for (const l of inv.lines ?? []) {
      if (!l.job_id) continue
      const seen = invoiceOfJob.get(l.job_id)
      // The OLDEST due date wins when a job somehow appears on two documents:
      // the debt is as old as the first time we asked for it.
      if (!seen || (inv.due_date && seen.due && inv.due_date < seen.due)) {
        invoiceOfJob.set(l.job_id, { due: inv.due_date })
      }
    }
  }

  const acc = new Map<string, DebtorRow>()

  for (const job of jobs) {
    const pay = jobPaymentState(job, payments, invoices)
    if (pay.outstanding <= 0.005) continue

    const customerId = job.customer_id ?? null
    const key = customerId ? `klient:${customerId}` : `patsient:${(job.patsient ?? '').trim().toLowerCase()}`
    const nimi = customerId
      ? (nameOf.get(customerId) ?? 'Tundmatu klient')
      : ((job.patsient ?? '').trim() || 'Nimeta')

    let row = acc.get(key)
    if (!row) {
      row = {
        key, nimi, liik: customerId ? 'klient' : 'patsient', customerId,
        total: 0, paid: 0, outstanding: 0,
        overdue: 0, notYetDue: 0, uninvoiced: 0,
        oldestDue: null, daysLate: 0, jobs: 0, jobIds: [], partial: false,
      }
      acc.set(key, row)
    }

    row.total += pay.total
    row.paid += pay.paid
    row.outstanding += pay.outstanding
    row.jobs += 1
    row.jobIds.push(job.id)
    if (pay.partial) row.partial = true

    const inv = invoiceOfJob.get(job.id)
    if (!inv) {
      row.uninvoiced += pay.outstanding
    } else if (inv.due && inv.due < today) {
      row.overdue += pay.outstanding
      if (!row.oldestDue || inv.due < row.oldestDue) row.oldestDue = inv.due
    } else {
      // An invoice with no due date is a bill without a deadline. It is issued,
      // so it is not uninvoiced; it cannot be late, so it is not overdue.
      row.notYetDue += pay.outstanding
    }
  }

  const rows = [...acc.values()]
    .map(r => ({
      ...r,
      total: round2(r.total),
      paid: round2(r.paid),
      outstanding: round2(r.outstanding),
      overdue: round2(r.overdue),
      notYetDue: round2(r.notYetDue),
      uninvoiced: round2(r.uninvoiced),
      daysLate: r.oldestDue ? daysBetween(r.oldestDue, today) : 0,
    }))
    // Worst first: most overdue, then largest balance. A chasing list is read
    // from the top, so the top has to be the call worth making.
    .sort((a, b) => (b.overdue - a.overdue) || (b.outstanding - a.outstanding))

  return {
    rows,
    outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
    overdue: round2(rows.reduce((s, r) => s + r.overdue, 0)),
    notYetDue: round2(rows.reduce((s, r) => s + r.notYetDue, 0)),
    uninvoiced: round2(rows.reduce((s, r) => s + r.uninvoiced, 0)),
    count: rows.length,
    worst: rows[0] ?? null,
  }
}

/** Bands for the panel. Age is measured from the invoice due date, never today. */
export interface DebtBucket { label: string; amount: number; count: number }

export function debtBuckets(stats: DebtorStats): DebtBucket[] {
  const bands: { label: string; min: number; max: number }[] = [
    { label: '1–30 p',  min: 1,  max: 30 },
    { label: '31–60 p', min: 31, max: 60 },
    { label: '61–90 p', min: 61, max: 90 },
    { label: '90+ p',   min: 91, max: Infinity },
  ]
  return bands.map(b => {
    const hits = stats.rows.filter(r => r.overdue > 0 && r.daysLate >= b.min && r.daysLate <= b.max)
    return {
      label: b.label,
      amount: round2(hits.reduce((s, r) => s + r.overdue, 0)),
      count: hits.length,
    }
  })
}
