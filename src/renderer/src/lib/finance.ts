/**
 * What the clinic earns and what it spends, from the records that already exist.
 *
 * Three sources, deliberately kept apart:
 *   REVENUE  — invoices and payments. What was actually billed and received,
 *              not what jobs are priced at. A job priced at 200 € that was never
 *              invoiced is not revenue; it is money left on the table, and it is
 *              reported as exactly that.
 *   LABOUR   — the earnings engine. Frozen payouts plus what has accrued since.
 *   MATERIAL — settings' per-tooth cost, which is an ESTIMATE and is labelled so.
 *
 * COVERAGE MATTERS MORE THAN PRECISION
 *   Every figure here is only as complete as the data behind it: a job with no
 *   technician assigned contributes no labour cost, a job with no material
 *   contributes no material cost. Silently summing those produces a margin that
 *   looks great and is wrong. So every total carries a count of what it could
 *   not see, and the UI shows it next to the number.
 */
import type { Job } from '../types/job'
import { revisionReasons } from '../types/job'
import type { InvoiceFull } from '../types/invoice'
import type { MaterialPricing, FixedCost } from '../stores/useSettings'
import type { WorkType } from '../config/workTypes'
import { resolveWorkType, workTypeConsumables } from '../config/workTypes'
import { countSmallTeeth, countLargeTeeth } from '../stores/useSettings'
import {
  calculateEarnings, earningsTotal, type WorkerRate, type WorkHours
} from './earnings'
import type { WorkerPayout } from '../hooks/useWorkerPay'
import { outstanding, paidAmount, PAYMENT_METHOD_LABEL } from '../types/invoice'
import type { Payment as PaymentRow } from '../types/invoice'

const round2 = (n: number) => Math.round(n * 100) / 100
const toothCount = (h: string | null | undefined) =>
  (h ?? '').split(',').filter(t => t.trim()).length

export interface Coverage {
  total: number
  covered: number
  get missing(): number
}

const coverage = (total: number, covered: number): Coverage => ({
  total, covered, get missing() { return Math.max(0, this.total - this.covered) },
})

/** Material cost of one job, or null when the material has no cost recorded. */
/**
 * Material cost for a job. Checks machine-specific cost first (key: "material|machine"),
 * then falls back to base material cost (key: "material").
 * This is because capsule capacity differs by machine:
 *   Pro2 arch kit → bulk, lower per-tooth cost
 *   Midas → tooth per capsule (1 large, up to 3 small), higher per-tooth cost
 */
export function jobMaterialCost(
  job: Pick<Job, 'materjal' | 'hambad' | 'masina'>,
  costs: Record<string, MaterialPricing>
): number | null {
  const mat = job.materjal?.trim()
  if (!mat) return null
  const machine = job.masina?.trim()

  // Try machine-specific key first ("Crown HT|Pro2"), then base ("Crown HT")
  function findCost(material: string): MaterialPricing | undefined {
    const allKeys = Object.keys(costs).sort((a, b) => b.length - a.length)

    // 1. Machine-specific: "material|machine"
    if (machine) {
      const machineKey = allKeys.find(k => {
        if (!k.includes('|')) return false
        const [kMat, kMach] = k.split('|')
        return kMach.toLowerCase() === machine.toLowerCase()
          && (material === kMat || material.toLowerCase().startsWith(kMat.toLowerCase() + ' '))
      })
      if (machineKey) return costs[machineKey]
    }

    // 2. Base material (no machine)
    const baseKey = allKeys
      .filter(k => !k.includes('|'))
      .find(k => material === k || material.toLowerCase().startsWith(k.toLowerCase() + ' '))
    return baseKey ? costs[baseKey] : undefined
  }

  const c = findCost(mat)
  if (!c || (c.small === 0 && c.large === 0)) return null
  const h = job.hambad ?? ''
  return round2(countSmallTeeth(h) * c.small + countLargeTeeth(h) * c.large)
}

/** Total fixed overhead per job (gloves, shields, disinfection etc). */
export function jobFixedCost(fixedCosts: FixedCost[]): number {
  return round2(fixedCosts.reduce((s, c) => s + (c.summa ?? 0), 0))
}

export interface WorkTypeFinance {
  name: string
  jobs: number
  revenue: number       // invoiced for these jobs
  labour: number
  material: number
  margin: number
  marginPct: number
}

export interface RevisionLoss {
  reason: string
  count: number
  labour: number        // paid out for redoing the work
  material: number      // resin used again
  recovered: number     // what was actually charged for the revision
  net: number           // cost − recovered
}

/** How clients actually settle: cash, card, transfer. */
export interface PaymentMethodStat {
  method: string
  label: string
  count: number
  amount: number
  share: number    // % of received money
}

export interface WorkerFinance {
  profileId: string
  name: string
  /** Payroll or purchase invoice — decides whether employer tax applies. */
  engagement: 'tootaja' | 'ettevote'
  jobs: number
  teeth: number
  earned: number
  paidOut: number
}

export interface FinanceStats {
  // Revenue
  billed: number
  received: number
  outstanding: number
  overdue: number
  unbilled: number            // finished work not on any invoice
  unbilledJobs: number
  // Costs
  labourAccrued: number
  labourPaid: number
  /** The share of labourAccrued that is gross wages — employer tax applies to
   *  this only, never to a contractor's invoice. */
  labourEmployeeGross: number
  labourContractor: number
  materialCost: number
  /** Screws, abutments and the like, from the work type's cost list. */
  consumableCost: number
  fixedCostTotal: number
  // Result
  grossMargin: number
  grossMarginPct: number
  // Detail
  byWorkType: WorkTypeFinance[]
  revisionLoss: RevisionLoss[]
  revisionLossTotal: number
  byWorker: WorkerFinance[]
  byPaymentMethod: PaymentMethodStat[]
  // Honesty
  labourCoverage: Coverage    // finished jobs with a technician assigned
  materialCoverage: Coverage  // finished jobs with a costed material
}

export interface FinanceInput {
  jobs: Job[]                 // already filtered to the period
  invoices: InvoiceFull[]
  /** ALL payments, including those recorded against a job rather than an
   *  invoice. Counting only invoice payments would under-report every clinic
   *  that settles work without invoicing it. */
  payments: PaymentRow[]
  payouts: WorkerPayout[]
  rates: WorkerRate[]
  hours: WorkHours[]
  workers: { id: string; full_name: string; toosuhe?: string | null }[]
  types: WorkType[]
  materialCosts: Record<string, MaterialPricing>
  fixedCosts: FixedCost[]
  doneStageKey: string
  periodStart: string
  periodEnd: string
}

export function calculateFinance(input: FinanceInput): FinanceStats {
  const {
    jobs, invoices, payments, payouts, rates, hours, workers, types,
    materialCosts, fixedCosts, doneStageKey, periodStart, periodEnd,
  } = input

  const inPeriod = (d: string | null) => !!d && d >= periodStart && d <= periodEnd

  // ── Revenue ───────────────────────────────────────────────────────────────
  const periodInvoices = invoices.filter(
    inv => inv.status !== 'tuhistatud' && inPeriod(inv.issue_date)
  )
  const billed = round2(periodInvoices.reduce((s, i) => s + Number(i.net_total), 0))
  // Payments are counted on the date they were received, which is not
  // necessarily the date the invoice was raised.
  const received = round2(payments
    .filter(p => inPeriod(p.paid_at))
    .reduce((s, p) => s + Number(p.amount), 0))
  const outstandingTotal = round2(invoices.reduce((s, i) => s + outstanding(i), 0))
  const overdueTotal = round2(invoices
    .filter(i => i.due_date && i.due_date < periodEnd && outstanding(i) > 0 && i.status !== 'tuhistatud')
    .reduce((s, i) => s + outstanding(i), 0))

  // Finished work that never reached an invoice — the most actionable number on
  // the page, because it is revenue the clinic has already earned the cost of.
  const billedJobIds = new Set<string>()
  for (const inv of invoices) {
    if (inv.status === 'tuhistatud') continue
    for (const l of inv.lines) if (l.job_id) billedJobIds.add(l.job_id)
  }
  const done = jobs.filter(j => j.status === doneStageKey)
  const unbilledList = done.filter(j => !billedJobIds.has(j.id))
  const unbilled = round2(unbilledList.reduce(
    (s, j) => s + Number(j.hind ?? 0) + Number(j.disain_hind ?? 0), 0))

  // ── Labour ────────────────────────────────────────────────────────────────
  // Accrued = what the current rules say this period's finished work is worth,
  // whether or not it has been paid out yet. Paid = what was actually frozen
  // into payouts covering this period.
  const byWorker: WorkerFinance[] = []
  let labourAccrued = 0
  for (const w of workers) {
    const lines = calculateEarnings({
      profileId: w.id, rates, jobs, hours, types,
      periodStart, periodEnd, doneStageKey,
      alreadyPaid: new Set(),   // gross accrual, not "what is still owed"
    })
    const earned = earningsTotal(lines)
    const paidOut = round2(payouts
      .filter(p => p.profile_id === w.id && p.period_start >= periodStart && p.period_end <= periodEnd)
      .reduce((s, p) => s + Number(p.total), 0))
    const jobsDone = done.filter(j => j.assigned_to === w.id)
    if (earned === 0 && paidOut === 0 && jobsDone.length === 0) continue
    labourAccrued += earned
    byWorker.push({
      profileId: w.id,
      name: w.full_name || 'Nimeta',
      engagement: w.toosuhe === 'ettevote' ? 'ettevote' : 'tootaja',
      jobs: jobsDone.length,
      teeth: jobsDone.reduce((s, j) => s + toothCount(j.hambad), 0),
      earned,
      paidOut,
    })
  }
  labourAccrued = round2(labourAccrued)
  const labourPaid = round2(byWorker.reduce((s, w) => s + w.paidOut, 0))
  byWorker.sort((a, b) => b.earned - a.earned)

  // ── Material and consumables ──────────────────────────────────────────────
  let materialCost = 0
  let costedJobs = 0
  let consumableCost = 0
  for (const j of done) {
    const c = jobMaterialCost(j, materialCosts)
    if (c != null) { materialCost += c; costedJobs++ }
    consumableCost += workTypeConsumables(j.too, types, toothCount(j.hambad)).total
  }
  materialCost = round2(materialCost)
  consumableCost = round2(consumableCost)
  const perJobFixed = jobFixedCost(fixedCosts)
  const fixedCostTotal = round2(done.length * perJobFixed)

  // ── Margin ────────────────────────────────────────────────────────────────
  // Against BILLED, not against job prices: an invoice is what the clinic can
  // actually collect on.
  const grossMargin = round2(billed - labourAccrued - materialCost - consumableCost - fixedCostTotal)
  const grossMarginPct = billed > 0 ? round2((grossMargin / billed) * 100) : 0

  // ── Per work type ─────────────────────────────────────────────────────────
  const revenueByJob = new Map<string, number>()
  for (const inv of invoices) {
    if (inv.status === 'tuhistatud' || !inPeriod(inv.issue_date)) continue
    for (const l of inv.lines) {
      if (!l.job_id) continue
      revenueByJob.set(l.job_id, (revenueByJob.get(l.job_id) ?? 0) + l.qty * l.unit_price)
    }
  }

  const typeBuckets = new Map<string, WorkTypeFinance>()
  for (const j of done) {
    const name = resolveWorkType(j.too, types).nimi
    const b = typeBuckets.get(name) ?? {
      name, jobs: 0, revenue: 0, labour: 0, material: 0, margin: 0, marginPct: 0,
    }
    b.jobs++
    b.revenue += revenueByJob.get(j.id) ?? 0
    // Consumables sit with material in the per-type table: both are "what this
    // job consumed", and splitting them there would add a column nobody asked for.
    b.material += (jobMaterialCost(j, materialCosts) ?? 0)
      + workTypeConsumables(j.too, types, toothCount(j.hambad)).total
    typeBuckets.set(name, b)
  }
  // Labour is attributed per job by re-running the engine for the job's own
  // technician; cheaper than it looks because the job list is already filtered.
  for (const w of workers) {
    const lines = calculateEarnings({
      profileId: w.id, rates, jobs, hours, types,
      periodStart, periodEnd, doneStageKey, alreadyPaid: new Set(),
      includeMonthly: false,   // salary belongs to nobody's work type
    })
    for (const l of lines) {
      if (!l.job_id) continue
      const job = jobs.find(x => x.id === l.job_id)
      if (!job) continue
      const name = resolveWorkType(job.too, types).nimi
      const b = typeBuckets.get(name)
      if (b) b.labour += l.amount
    }
  }
  const byWorkType = [...typeBuckets.values()].map(b => {
    const margin = round2(b.revenue - b.labour - b.material)
    return {
      ...b,
      revenue: round2(b.revenue),
      labour: round2(b.labour),
      material: round2(b.material),
      margin,
      marginPct: b.revenue > 0 ? round2((margin / b.revenue) * 100) : 0,
    }
  }).sort((a, b) => b.revenue - a.revenue)

  // ── Revisions ─────────────────────────────────────────────────────────────
  // What rework costs. A revision consumes resin and, when the rule says so,
  // labour — while usually earning nothing, because the lab caused it. The
  // reason field is what separates "our mistake" from "customer changed
  // their mind", which is the distinction worth managing.
  const reasonBuckets = new Map<string, RevisionLoss>()
  for (const j of jobs) {
    for (const r of j.revisions ?? []) {
      if (!inPeriod((r.deadline ?? r.ts ?? '').slice(0, 10))) continue
      // A revision can now name several causes. Each one is COUNTED, but the
      // money is SPLIT between them — adding the full cost to every bucket
      // would inflate the total by the number of reasons someone happened to tick.
      const names = revisionReasons(r)
      const reasons = names.length > 0 ? names : ['Määramata']
      const shareOf = (v: number) => v / reasons.length
      const revMaterial = (jobMaterialCost({ materjal: j.materjal, hambad: r.hambad ?? j.hambad, masina: j.masina }, materialCosts) ?? 0)
        + workTypeConsumables(j.too, types, toothCount(r.hambad ?? j.hambad)).total

      for (const reason of reasons) {
        const b = reasonBuckets.get(reason) ?? {
          reason, count: 0, labour: 0, material: 0, recovered: 0, net: 0,
        }
        b.count++
        b.recovered += shareOf(Number(r.price ?? 0))
        b.material += shareOf(revMaterial)
        reasonBuckets.set(reason, b)
      }
    }
  }
  // Labour actually paid for revisions comes from the earnings lines
  for (const w of workers) {
    const lines = calculateEarnings({
      profileId: w.id, rates, jobs, hours, types,
      periodStart, periodEnd, doneStageKey, alreadyPaid: new Set(), includeMonthly: false,
    })
    for (const l of lines) {
      if (!l.revision_id || !l.job_id) continue
      const job = jobs.find(x => x.id === l.job_id)
      const rev = job?.revisions?.find(r => r.id === l.revision_id)
      const names = rev ? revisionReasons(rev) : []
      const reasons = names.length > 0 ? names : ['Määramata']
      for (const reason of reasons) {
        const b = reasonBuckets.get(reason)
        if (b) b.labour += l.amount / reasons.length
      }
    }
  }
  const revisionLoss = [...reasonBuckets.values()].map(b => ({
    ...b,
    labour: round2(b.labour),
    material: round2(b.material),
    recovered: round2(b.recovered),
    net: round2(b.labour + b.material - b.recovered),
  })).sort((a, b) => b.net - a.net)
  const revisionLossTotal = round2(revisionLoss.reduce((s, r) => s + r.net, 0))

  const labourEmployeeGross = round2(byWorker
    .filter(w => w.engagement === 'tootaja')
    .reduce((s, w) => s + w.earned, 0))
  const labourContractor = round2(byWorker
    .filter(w => w.engagement === 'ettevote')
    .reduce((s, w) => s + w.earned, 0))

  // ── How they paid ─────────────────────────────────────────────────────────
  // Counted on the payments received in the period, not on the invoices raised:
  // the question is how money actually arrives, which is what decides whether a
  // card terminal or a bank reference is worth the trouble.
  const methodBuckets = new Map<string, PaymentMethodStat>()
  for (const p of payments) {
    if (!inPeriod(p.paid_at)) continue
    const b = methodBuckets.get(p.method) ?? {
      method: p.method,
      label: PAYMENT_METHOD_LABEL[p.method] ?? p.method,
      count: 0, amount: 0, share: 0,
    }
    b.count++
    b.amount = round2(b.amount + Number(p.amount))
    methodBuckets.set(p.method, b)
  }
  const methodTotal = [...methodBuckets.values()].reduce((s, m) => s + m.amount, 0)
  const byPaymentMethod = [...methodBuckets.values()]
    .map(m => ({ ...m, share: methodTotal > 0 ? round2((m.amount / methodTotal) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount)

  return {
    billed, received, outstanding: outstandingTotal, overdue: overdueTotal,
    unbilled, unbilledJobs: unbilledList.length,
    labourAccrued, labourPaid, labourEmployeeGross, labourContractor,
    materialCost, consumableCost, fixedCostTotal,
    grossMargin, grossMarginPct,
    byWorkType, revisionLoss, revisionLossTotal, byWorker, byPaymentMethod,
    labourCoverage: coverage(done.length, done.filter(j => j.assigned_to).length),
    materialCoverage: coverage(done.length, costedJobs),
  }
}

export { paidAmount }
