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
import { revisionReasons, jobWorkItems } from '../types/job'
import type { InvoiceFull } from '../types/invoice'
import type { MaterialPricing, FixedCost, Overhead } from '../stores/useSettings'
import type { WorkType } from '../config/workTypes'
import { resolveWorkType, workTypeConsumables } from '../config/workTypes'
import { countSmallTeeth, countLargeTeeth } from '../stores/useSettings'
import {
  calculateEarnings, earningsTotal, type WorkerRate, type WorkHours
} from './earnings'
import type { WorkerPayout } from '../hooks/useWorkerPay'
import { outstanding, paidAmount, PAYMENT_METHOD_LABEL } from '../types/invoice'
import type { Payment as PaymentRow } from '../types/invoice'
import { jobTotalValue } from './jobPayments'

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
/**
 * Material cost for a job. Checks `costs` first (explicit cost prices),
 * falls back to `fallbackPrices` (selling prices used as cost estimate).
 */
export function jobMaterialCost(
  job: Pick<Job, 'materjal' | 'hambad' | 'masina'>,
  costs: Record<string, MaterialPricing>,
  fallbackPrices?: Record<string, MaterialPricing>
): number | null {
  const mat = job.materjal?.trim()
  if (!mat) return null
  const machine = job.masina?.trim()

  function findCost(material: string, table: Record<string, MaterialPricing>): MaterialPricing | undefined {
    const allKeys = Object.keys(table).sort((a, b) => b.length - a.length)

    // 1. Machine-specific: "material|machine"
    if (machine) {
      const machineKey = allKeys.find(k => {
        if (!k.includes('|')) return false
        const [kMat, kMach] = k.split('|')
        return kMach.toLowerCase() === machine.toLowerCase()
          && (material === kMat || material.toLowerCase().startsWith(kMat.toLowerCase() + ' '))
      })
      if (machineKey) return table[machineKey]
    }

    // 2. Base material (no machine)
    const baseKey = allKeys
      .filter(k => !k.includes('|'))
      .find(k => material === k || material.toLowerCase().startsWith(k.toLowerCase() + ' '))
    return baseKey ? table[baseKey] : undefined
  }

  // Try explicit cost prices first, fall back to selling prices as estimate
  let c = findCost(mat, costs)
  if (!c || (c.small === 0 && c.large === 0)) {
    if (fallbackPrices) c = findCost(mat, fallbackPrices)
  }
  if (!c || (c.small === 0 && c.large === 0)) return null
  const h = job.hambad ?? ''
  return round2(countSmallTeeth(h) * c.small + countLargeTeeth(h) * c.large)
}

/**
 * A month's overheads, prorated to the days the period actually covers.
 *
 * 30.44 days is the mean month length. Using it rather than the real length of
 * the month in question keeps a 28-day February from looking cheaper to run
 * than a 31-day March, which it is not — the rent is the same.
 */
const MEAN_MONTH_DAYS = 30.44

export function overheadForPeriod(
  overheads: Overhead[], periodStart: string, periodEnd: string
): number {
  const monthly = overheads.reduce((s, o) => s + (Number(o.summa) || 0), 0)
  if (monthly <= 0) return 0
  const start = Date.parse(`${periodStart}T00:00:00Z`)
  const end = Date.parse(`${periodEnd}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0
  const days = (end - start) / 86_400_000 + 1   // inclusive of both ends
  return round2(monthly * (days / MEAN_MONTH_DAYS))
}

/** Total fixed overhead per job (gloves, shields, disinfection etc). */
export function jobFixedCost(fixedCosts: FixedCost[]): number {
  return round2(fixedCosts.reduce((s, c) => s + (c.summa ?? 0), 0))
}

export interface WorkTypeFinance {
  name: string
  jobs: number
  teeth: number         // total teeth across all jobs of this type
  income: number        // sum of job.hind (what the jobs are worth)
  revenue: number       // invoiced for these jobs
  costs: number         // consumables (screws etc) + fixed costs per job
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
  /** Rent, leases, software — prorated to the period. See overheadForPeriod. */
  overheadCost: number
  // Result
  grossMargin: number
  grossMarginPct: number
  /** Gross margin minus overheads. This is the one that answers "did we earn". */
  netMargin: number
  netMarginPct: number
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
  /** ALL jobs — revisions are filtered by their own date, not the job's. */
  allJobs?: Job[]
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
  /** Selling prices — used as fallback when materialCosts has no entry. */
  materialPrices?: Record<string, MaterialPricing>
  fixedCosts: FixedCost[]
  /** Monthly recurring costs. Empty = overheads unknown, reported as 0. */
  overheads: Overhead[]
  doneStageKey: string
  periodStart: string
  periodEnd: string
  /**
   * End date for TIME-BASED costs only (overheads). Defaults to periodEnd.
   *
   * Counts and revenue use the whole period; rent does not accrue for days that
   * have not happened. Keeping these apart is what let the counting window be
   * unified with Tootmine without charging a full month's rent against three
   * days of work.
   */
  overheadEnd?: string
}

export function calculateFinance(input: FinanceInput): FinanceStats {
  const {
    jobs, invoices, payments, payouts, rates, hours, workers, types,
    materialCosts, materialPrices, fixedCosts, overheads, doneStageKey, periodStart, periodEnd, allJobs,
    overheadEnd,
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
  // jobTotalValue, not a hand-rolled sum: unbilled revenue and what the invoice
  // form would actually bill have to be the same number, and they were not
  // while extras were missing from this one.
  const unbilled = round2(unbilledList.reduce((s, j) => s + jobTotalValue(j), 0))

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
    const c = jobMaterialCost(j, materialCosts, materialPrices)
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

  // Overheads are charged by the month, so a period that is not a whole month
  // gets its share by days. A three-day view showing a full month's rent would
  // read as a catastrophic loss.
  const overheadCost = overheadForPeriod(overheads ?? [], periodStart, overheadEnd ?? periodEnd)
  const netMargin = round2(grossMargin - overheadCost)
  const netMarginPct = billed > 0 ? round2((netMargin / billed) * 100) : 0

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
  // Pre-seed all configured work types so every one shows in the table
  for (const t of types) {
    typeBuckets.set(t.nimi, { name: t.nimi, jobs: 0, teeth: 0, income: 0, revenue: 0, costs: 0, labour: 0, material: 0, margin: 0, marginPct: 0 })
  }
  for (const j of done) {
    const items = jobWorkItems(j)
    const jobRev = revenueByJob.get(j.id) ?? 0
    const jobIncome = Number(j.hind ?? 0)
    const jobMatCost = jobMaterialCost(j, materialCosts, materialPrices) ?? 0
    // Distribute revenue/income/material proportionally by tooth count when multi-type
    const totalTeeth = toothCount(j.hambad) || 1
    const jobCons = workTypeConsumables(j.too, types, totalTeeth).total

    if (items.length <= 1) {
      // Single type — attribute everything to it
      const name = resolveWorkType(j.too, types).nimi
      const b = typeBuckets.get(name) ?? {
        name, jobs: 0, teeth: 0, income: 0, revenue: 0, costs: 0, labour: 0, material: 0, margin: 0, marginPct: 0,
      }
      b.jobs++
      b.teeth += totalTeeth
      b.income += jobIncome
      b.revenue += jobRev
      b.material += jobMatCost
      b.costs += jobCons + perJobFixed
      typeBuckets.set(name, b)
    } else {
      // Multi-type — each work item gets its share
      const fixedShare = perJobFixed / items.length
      for (const item of items) {
        const name = resolveWorkType(item.too, types).nimi
        const b = typeBuckets.get(name) ?? {
          name, jobs: 0, teeth: 0, income: 0, revenue: 0, costs: 0, labour: 0, material: 0, margin: 0, marginPct: 0,
        }
        const itemTeeth = toothCount(item.hambad)
        const share = totalTeeth > 0 ? itemTeeth / totalTeeth : 1 / items.length
        b.jobs++
        b.teeth += itemTeeth
        b.income += round2(jobIncome * share)
        b.revenue += round2(jobRev * share)
        b.material += round2(jobMatCost * share)
        b.costs += round2(workTypeConsumables(item.too, types, itemTeeth).total + fixedShare)
        typeBuckets.set(name, b)
      }
    }
  }
  // ── Completed revisions — count their work types too ───────────────────────
  // A revision can carry its own work_items (e.g. Allon4 redo on a Crown job).
  // These are real production work and must appear in the per-type table.
  // Uses allJobs (unfiltered) because a revision may be completed this period
  // even if the parent job was created in an earlier period.
  for (const j of (allJobs ?? jobs)) {
    for (const rev of j.revisions ?? []) {
      if ((rev.status ?? '') !== doneStageKey) continue
      const revDate = (rev.valmis_kuupaev ?? rev.deadline ?? rev.ts ?? '').slice(0, 10)
      if (!revDate || revDate < periodStart || revDate > periodEnd) continue

      const revItems = Array.isArray(rev.work_items) && rev.work_items.length > 0
        ? rev.work_items
        : rev.hambad
          ? [{ id: rev.id, too: j.too ?? '', hambad: rev.hambad }]
          : []

      for (const item of revItems) {
        const name = resolveWorkType(item.too, types).nimi
        const b = typeBuckets.get(name)
        if (!b) continue
        const teeth = toothCount(item.hambad)
        // Revisions are cost only (internal), not income — but they ARE work done
        b.teeth += teeth
        b.costs += workTypeConsumables(item.too, types, teeth).total
        b.material += (jobMaterialCost({ materjal: rev.materjal ?? j.materjal, hambad: item.hambad, masina: j.masina }, materialCosts, materialPrices) ?? 0)
      }
    }
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
    const margin = round2(b.income - b.labour - b.material - b.costs)
    return {
      ...b,
      income: round2(b.income),
      revenue: round2(b.revenue),
      costs: round2(b.costs),
      labour: round2(b.labour),
      material: round2(b.material),
      margin,
      marginPct: b.income > 0 ? round2((margin / b.income) * 100) : 0,
    }
  }).sort((a, b) => b.income - a.income)

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
      const revMat = r.materjal ?? j.materjal
      const revHambad = r.hambad ?? j.hambad
      const revMaterial = (jobMaterialCost({ materjal: revMat, hambad: revHambad, masina: j.masina }, materialCosts, materialPrices) ?? 0)
        + workTypeConsumables(j.too, types, toothCount(revHambad)).total

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
    materialCost, consumableCost, fixedCostTotal, overheadCost,
    grossMargin, grossMarginPct, netMargin, netMarginPct,
    byWorkType, revisionLoss, revisionLossTotal, byWorker, byPaymentMethod,
    labourCoverage: coverage(done.length, done.filter(j => j.assigned_to).length),
    materialCoverage: coverage(done.length, costedJobs),
  }
}

export { paidAmount }
