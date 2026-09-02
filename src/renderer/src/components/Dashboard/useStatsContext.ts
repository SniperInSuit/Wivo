/**
 * Everything any statistics panel can need, assembled once per page.
 *
 * A panel is a pure renderer over this object. It may filter, sort a copy,
 * format and pick colours; it may NOT call `periodMetrics`, `calculateFinance`
 * or `calculateEarnings`, and it may not invent a named number by reducing over
 * `stats.filtered`. Any arithmetic that produces a new named figure belongs in
 * `lib/`.
 *
 * That rule is not style. Three screens once each decided for themselves what
 * "this month" meant and reported 19 and 15 tööd for the same period; the fix
 * was a single aggregator, and a dashboard of forty independently-computing
 * cards is the same bug with forty places to hide.
 */
import { useMemo } from 'react'
import { format } from 'date-fns'
import type { Job } from '../../types/job'
import { jobPeriodDate } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { useSettings, useWorkTypes, type WivoSettings } from '../../stores/useSettings'
import { useInvoices, usePayments } from '../../hooks/useInvoices'
import { useVisits } from '../../hooks/useVisits'
import { usePatients } from '../../hooks/usePatients'
import { useWorkerRates, useWorkHours, useWorkerPayouts } from '../../hooks/useWorkerPay'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { usePermissions } from '../../hooks/usePermissions'
import {
  calculateFinance, profitOf, EMPTY_FINANCE,
  type FinanceStats, type ProfitBreakdown,
} from '../../lib/finance'
import {
  periodMetrics, rangeFor, elapsedEndOf, type PeriodMetrics, type Range,
} from '../../lib/periodMetrics'
import { useDashboardStats, type Period, type DateRange } from './useDashboardStats'
import { useCustomers } from '../../hooks/useCustomers'
import { invoiceMetrics, type InvoiceMetrics } from '../../lib/invoiceMetrics'
import { unitEconomics, type UnitEconomics } from '../../lib/unitEconomics'
import {
  turnaroundStats, onTimeStats, deliveryStats, weekdayLoad,
  type TurnaroundStats, type OnTimeStats, type DeliveryStats, type WeekdayLoad,
} from '../../lib/throughput'
import { customerStats, type CustomerStats } from '../../lib/customerStats'
import { debtors, EMPTY_DEBTORS, type DebtorStats } from '../../lib/debtors'
import { funFacts, type FunFacts } from '../../lib/funFacts'
import type { PermissionKey } from '../../hooks/usePermissions'

/**
 * Which expensive slice a panel needs. See `PanelMeta.needs`.
 *
 * The point is not micro-optimisation: `calculateFinance` runs the pay engine
 * three times per worker, and a technician looking at four production tiles
 * should not pay for it. Each slice is computed the same way whether one panel
 * or ten asked for it — this decides only WHETHER, never HOW.
 */
export type PanelNeed = 'finance' | 'invoices' | 'unit' | 'flow' | 'customers' | 'fun' | 'debtors'

export interface PanelCtx {
  // ── Scope. Every panel that shows a total should be able to name its window.
  period: Period
  range: Range
  rangeLabel: string

  // ── The shared aggregators. Never recomputed by a panel.
  m: PeriodMetrics
  stats: ReturnType<typeof useDashboardStats>
  fin: FinanceStats
  /** False when no visible panel asked for finance — `fin` is then all zeros. */
  finReady: boolean
  profit: ProfitBreakdown
  /** Aging, days-to-pay, VAT. Invoice-based, and the panels say so. */
  invoices: InvoiceMetrics
  unit: UnitEconomics
  turnaround: TurnaroundStats
  onTime: OnTimeStats
  delivery: DeliveryStats
  weekdays: WeekdayLoad[]
  customers: CustomerStats
  /**
   * Who owes what, ALL-TIME rather than for the selected period. A debt does
   * not stop existing because the date filter moved: a bill from March is
   * still owed in September, and a "võlglased" panel that emptied itself when
   * you looked at this week would be worse than no panel.
   */
  debt: DebtorStats
  /** All-time curiosities. Every one prints its own scope. */
  fun: FunFacts

  // ── Ambient
  settings: WivoSettings
  wt: ReturnType<typeof useWorkTypes>
  can: (p: PermissionKey) => boolean
  /** True when the invoices table is missing — every money figure reads 0. */
  invoicesMissing: boolean
}

/**
 * @param needs  Which slices the CURRENTLY VISIBLE panels want. `calculateFinance`
 *               runs `calculateEarnings` three times per worker; without this
 *               gate a technician looking at four production tiles would pay for
 *               the whole payroll engine on every render.
 */
export function useStatsContext(
  jobs: Job[],
  period: Period,
  window: DateRange,
  needs: ReadonlySet<PanelNeed>,
): PanelCtx {
  const { doneStageKey } = usePipeline()
  const { settings } = useSettings()
  const wt = useWorkTypes()
  const { can } = usePermissions()
  const { data: invoices = [], isError: invoicesMissing } = useInvoices()
  const { data: payments = [] } = usePayments()
  const { data: visits = [] } = useVisits()
  const { data: patients = [] } = usePatients()
  const { data: rates = [] } = useWorkerRates()
  const { data: hours = [] } = useWorkHours()
  const { data: payouts = [] } = useWorkerPayouts()
  const { data: workers = [] } = useClinicProfiles()
  const { data: customers = [] } = useCustomers()

  // "Kõik" spans whatever the data actually covers: the earliest thing on
  // record through today. Every other period is a real calendar window, and
  // `rangeFor` is the only place that decides which.
  const range = useMemo<Range>(() => {
    const fixed = rangeFor(period, window)
    if (fixed) return fixed
    const today = format(new Date(), 'yyyy-MM-dd')
    const earliest = [
      ...jobs.map(jobPeriodDate),
      ...invoices.map(i => i.issue_date ?? ''),
      ...payments.map(p => p.paid_at ?? ''),
    ].filter(Boolean).sort()[0]
    return { start: earliest ?? today, end: today }
  }, [period, window.start, window.end, jobs, invoices, payments])

  const stats = useDashboardStats(jobs, period, visits, patients, window, payments)

  const m = useMemo(() => periodMetrics(
    { jobs, invoices, payments, range },
    { dateAnchor: 'too', includeChanges: true, moneyConcept: 'kaive' },
  ), [jobs, invoices, payments, range])

  // Unit economics is built ON TOP of the finance result, so asking for one
  // asks for the other.
  const wantsFinance = needs.has('finance') || needs.has('unit')
  const today = format(new Date(), 'yyyy-MM-dd')

  const jobsInPeriod = useMemo(() => jobs.filter(j => {
    const d = jobPeriodDate(j)
    return d >= range.start && d <= range.end
  }), [jobs, range])

  const fin = useMemo<FinanceStats>(() => {
    if (!wantsFinance) return EMPTY_FINANCE
    return calculateFinance({
      jobs: jobsInPeriod,
      allJobs: jobs,
      invoices,
      payments,
      payouts,
      rates,
      hours,
      workers: workers.map(w => ({
        id: w.id, full_name: w.full_name, toosuhe: w.toosuhe,
        kiirtoo_kordaja: w.kiirtoo_kordaja,
        tasu_arvestus: w.tasu_arvestus,
        kogumispension_protsent: w.kogumispension_protsent,
        maksuvaba_tulu: w.maksuvaba_tulu,
      })),
      taxRates: {
        tooandjaMaksudProtsent: settings.tooandjaMaksudProtsent,
        tulumaksProtsent: settings.tulumaksProtsent,
        maksuvabaTuluKuus: settings.maksuvabaTuluKuus,
        tootajaTootuskindlustusProtsent: settings.tootajaTootuskindlustusProtsent,
        kogumispensionProtsent: settings.kogumispensionProtsent,
      },
      types: wt.types,
      materialCosts: settings.materialCosts,
      materialPrices: settings.materialPrices,
      fixedCosts: settings.fixedCostsPerJob,
      overheads: settings.yldkulud,
      doneStageKey,
      periodStart: range.start,
      periodEnd: range.end,
      // Rent does not accrue for days that have not happened. Counts use the
      // whole period; overheads use only the elapsed part of it.
      overheadEnd: elapsedEndOf(range),
    })
  }, [
    wantsFinance, jobsInPeriod, jobs, invoices, payments, payouts, rates, hours, workers,
    wt.types, settings.materialCosts, settings.materialPrices, settings.fixedCostsPerJob,
    settings.yldkulud, settings.tooandjaMaksudProtsent, settings.tulumaksProtsent,
    settings.maksuvabaTuluKuus, settings.tootajaTootuskindlustusProtsent,
    settings.kogumispensionProtsent, doneStageKey, range,
  ])

  const profit = useMemo(
    () => profitOf(fin, settings.tooandjaMaksudProtsent),
    [fin, settings.tooandjaMaksudProtsent],
  )

  const EMPTY_INVOICES: InvoiceMetrics = {
    aging: [], agingTotal: 0, notDue: 0, daysToPay: null, daysToPaySample: 0,
    vat: 0, issued: 0, issuedCount: 0, averageInvoice: 0,
  }
  const invoiceStats = useMemo(
    () => (needs.has('invoices')
      ? invoiceMetrics(invoices, today, range)
      : EMPTY_INVOICES),
    [needs, invoices, today, range],
  )

  const unit = useMemo(
    () => unitEconomics(m, fin, profit, range, today),
    [m, fin, profit, range, today],
  )

  // Finished work in the period — the population every flow question is about.
  const done = useMemo(
    () => jobsInPeriod.filter(j => j.status === doneStageKey),
    [jobsInPeriod, doneStageKey],
  )

  const flow = useMemo(() => {
    if (!needs.has('flow')) {
      return {
        turnaround: turnaroundStats([]),
        onTime: onTimeStats([]),
        delivery: deliveryStats([]),
        weekdays: weekdayLoad([], []),
      }
    }
    return {
      turnaround: turnaroundStats(done),
      onTime: onTimeStats(done),
      delivery: deliveryStats(done),
      weekdays: weekdayLoad(jobsInPeriod, done),
    }
  }, [needs, done, jobsInPeriod])

  const customerRollup = useMemo(
    () => (needs.has('customers')
      ? customerStats(jobsInPeriod, jobs, invoices, customers, range, today)
      : { rows: [], active: 0, added: 0, dormant: [] }),
    [needs, jobsInPeriod, jobs, invoices, customers, range, today],
  )

  const debt = useMemo(
    () => (needs.has('debtors')
      ? debtors({ jobs, payments, invoices, today, customers })
      : EMPTY_DEBTORS),
    [needs, jobs, payments, invoices, today, customers],
  )

  // All-time by design: "how many teeth have we made" is a career total. Every
  // panel that shows one prints "kogu aeg" beside it.
  const fun = useMemo(
    () => (needs.has('fun') ? funFacts(jobs, doneStageKey) : funFacts([], doneStageKey)),
    [needs, jobs, doneStageKey],
  )

  return {
    period,
    range,
    rangeLabel: period === 'all' ? 'kogu aeg' : `${range.start} – ${range.end}`,
    m,
    stats,
    fin,
    finReady: wantsFinance,
    profit,
    invoices: invoiceStats,
    unit,
    turnaround: flow.turnaround,
    onTime: flow.onTime,
    delivery: flow.delivery,
    weekdays: flow.weekdays,
    customers: customerRollup,
    debt,
    fun,
    settings,
    wt,
    can,
    invoicesMissing,
  }
}
