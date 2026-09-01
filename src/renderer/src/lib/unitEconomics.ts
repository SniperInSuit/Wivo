/**
 * What one tooth, one job and one working day are worth — and what they cost.
 *
 * These are ratios over figures the aggregators already produced. They live
 * here rather than inside a panel because a ratio is a NAMED number: two cards
 * dividing the same two totals slightly differently is exactly how one screen
 * comes to disagree with another.
 *
 * Every denominator can be zero — a period with no teeth, no jobs, no billing.
 * Each one returns `null` in that case, never NaN and never 0. This app has
 * already shipped an "NaN päeva" average off a single unparseable row; a zero
 * that means "we do not know" is the same lie with better manners.
 */
import type { FinanceStats, ProfitBreakdown } from './finance'
import type { PeriodMetrics } from './periodMetrics'

const round2 = (n: number): number => Math.round(n * 100) / 100

const ratio = (part: number, whole: number): number | null =>
  whole > 0 ? round2(part / whole) : null

const pct = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null

export interface UnitEconomics {
  /** Käive ÷ hambad. Both sides include revision work, consistently. */
  revenuePerTooth: number | null
  /** All costs ÷ hambad. */
  costPerTooth: number | null
  /** The two above, subtracted. */
  marginPerTooth: number | null
  /** Profit ÷ TÖÖD — jobs, not work items and not revisions. */
  profitPerJob: number | null
  /** Käive ÷ ühikud, the same count the numerator is built from. */
  revenuePerJob: number | null
  /** Share of income going to wages, including employer tax. */
  labourSharePct: number | null
  /** Share going to material and consumables. */
  materialSharePct: number | null
  /** Share going to overheads. */
  overheadSharePct: number | null
  /** Käive ÷ working days elapsed in the period. */
  revenuePerWorkingDay: number | null
  workingDays: number
}

/**
 * Mon–Fri days in the window, clamped to today: a month reports what it has
 * actually had, not what it will have. The same reason overheads prorate.
 */
export function workingDaysIn(start: string, end: string, today: string): number {
  const from = Date.parse(start)
  const rawTo = Date.parse(end)
  const now = Date.parse(today)
  if (Number.isNaN(from) || Number.isNaN(rawTo)) return 0
  const to = Number.isNaN(now) ? rawTo : Math.min(rawTo, now)
  if (to < from) return 0
  let n = 0
  for (let t = from; t <= to; t += 86_400_000) {
    const day = new Date(t).getDay()
    if (day !== 0 && day !== 6) n++
  }
  return n
}

export function unitEconomics(
  m: PeriodMetrics,
  fin: FinanceStats,
  profit: ProfitBreakdown,
  range: { start: string; end: string },
  today: string,
): UnitEconomics {
  const costs = profit.costs
  const workingDays = workingDaysIn(range.start, range.end, today)

  return {
    revenuePerTooth: ratio(m.money, m.hambad),
    costPerTooth: ratio(costs, m.hambad),
    marginPerTooth:
      m.hambad > 0 ? round2((m.money - costs) / m.hambad) : null,
    // Divided by TÖÖD deliberately. The per-type table divides by work items
    // and will therefore differ; both are right and the hints say which.
    profitPerJob: ratio(profit.profit, m.tood),
    revenuePerJob: ratio(m.money, m.yksused),
    // Against income (what the work is worth), not against billed: work can be
    // finished and never invoiced, and a share that jumped when somebody raised
    // an invoice would be measuring paperwork.
    labourSharePct: pct(profit.labour, profit.income),
    materialSharePct: pct(profit.material, profit.income),
    overheadSharePct: pct(fin.overheadCost, profit.income),
    revenuePerWorkingDay: ratio(m.money, workingDays),
    workingDays,
  }
}
