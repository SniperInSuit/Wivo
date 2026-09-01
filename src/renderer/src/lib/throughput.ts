/**
 * How work moves: how long it takes, whether it lands on time, where it is.
 *
 * `valmis_aeg` is the DEADLINE and `valmis_kuupaev` is when the work was
 * actually finished. Every function here measures against the second one. That
 * distinction is the same one payroll is built on, and getting it backwards is
 * what made "Ø läbiaeg" report the plan instead of reality until 1.56.
 */
import type { Job } from '../types/job'
import type { Coverage } from './finance'

const parse = (iso: string | null | undefined): number => {
  if (!iso) return NaN
  return Date.parse(iso)
}

const days = (from: string, to: string): number =>
  Math.round((parse(to) - parse(from)) / 86_400_000)

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10
}

const percentile = (xs: number[], p: number): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]
}

export interface TurnaroundStats {
  /** Mean days from arrival to actual completion. */
  average: number | null
  /** The one to quote: half of everything is faster than this. */
  median: number | null
  /** What "a slow one" costs — 9 out of 10 finish inside this. */
  p90: number | null
  fastest: { days: number; label: string } | null
  slowest: { days: number; label: string } | null
  /** Finished jobs that could not be measured, and why it matters. */
  coverage: Coverage
}

export interface OnTimeStats {
  /** Share of measurable jobs finished on or before the deadline. */
  ratePct: number | null
  onTime: number
  late: number
  /** Average days late, counting only the ones that were. */
  averageDaysLate: number | null
  /** Jobs with no deadline cannot be judged, and are reported, not counted. */
  coverage: Coverage
}

export interface DeliveryStats {
  buckets: { key: string; label: string; count: number }[]
  /** Mean days from finished to handed over. */
  averageLagDays: number | null
  /** Finished but still sitting in the lab. */
  waiting: number
}

export interface WeekdayLoad {
  /** Monday first, matching the board, the table filter and payroll. */
  weekday: string
  received: number
  finished: number
}

const DELIVERY_LABEL: Record<string, string> = {
  labor: 'Laboris',
  teel: 'Teel',
  yle_antud: 'Üle antud',
}

const WEEKDAYS = ['E', 'T', 'K', 'N', 'R', 'L', 'P']

/** @param done Finished jobs in the period. */
export function turnaroundStats(done: Job[]): TurnaroundStats {
  const measured: { d: number; label: string }[] = []
  for (const j of done) {
    if (!j.kuupaev || !j.valmis_kuupaev) continue
    const d = days(j.kuupaev, j.valmis_kuupaev)
    if (!Number.isFinite(d)) continue
    measured.push({ d: Math.max(0, d), label: j.patsient || j.too || 'Töö' })
  }
  const xs = measured.map(x => x.d)
  const sorted = [...measured].sort((a, b) => a.d - b.d)
  return {
    average: xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null,
    median: median(xs),
    p90: percentile(xs, 0.9),
    fastest: sorted[0] ? { days: sorted[0].d, label: sorted[0].label } : null,
    slowest: sorted.length ? { days: sorted[sorted.length - 1].d, label: sorted[sorted.length - 1].label } : null,
    coverage: { total: done.length, covered: measured.length, missing: done.length - measured.length },
  }
}

export function onTimeStats(done: Job[]): OnTimeStats {
  let onTime = 0
  let late = 0
  let lateDaysSum = 0
  let measured = 0
  for (const j of done) {
    // Both ends required: a job with no deadline was never promised a date, and
    // counting it as on time would flatter every lab that forgets to set one.
    if (!j.valmis_aeg || !j.valmis_kuupaev) continue
    const d = days(j.valmis_aeg, j.valmis_kuupaev)
    if (!Number.isFinite(d)) continue
    measured++
    if (d <= 0) onTime++
    else { late++; lateDaysSum += d }
  }
  return {
    ratePct: measured > 0 ? Math.round((onTime / measured) * 1000) / 10 : null,
    onTime,
    late,
    averageDaysLate: late > 0 ? Math.round((lateDaysSum / late) * 10) / 10 : null,
    coverage: { total: done.length, covered: measured, missing: done.length - measured },
  }
}

export function deliveryStats(done: Job[]): DeliveryStats {
  const counts = new Map<string, number>()
  let lagSum = 0
  let lagN = 0
  for (const j of done) {
    const key = j.delivery_status ?? 'labor'
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if (j.valmis_kuupaev && j.delivered_at) {
      const d = days(j.valmis_kuupaev, j.delivered_at)
      if (Number.isFinite(d)) { lagSum += Math.max(0, d); lagN++ }
    }
  }
  return {
    buckets: ['labor', 'teel', 'yle_antud'].map(key => ({
      key,
      label: DELIVERY_LABEL[key] ?? key,
      count: counts.get(key) ?? 0,
    })),
    averageLagDays: lagN > 0 ? Math.round((lagSum / lagN) * 10) / 10 : null,
    waiting: counts.get('labor') ?? 0,
  }
}

/**
 * Arrival and completion by weekday. Monday first — the same week start the
 * board, the table filter and the payroll period all use.
 */
export function weekdayLoad(jobs: Job[], done: Job[]): WeekdayLoad[] {
  const rows: WeekdayLoad[] = WEEKDAYS.map(w => ({ weekday: w, received: 0, finished: 0 }))
  const bucket = (iso: string | null | undefined): number => {
    const t = parse(iso)
    if (Number.isNaN(t)) return -1
    return (new Date(t).getDay() + 6) % 7
  }
  for (const j of jobs) {
    const i = bucket(j.kuupaev)
    if (i >= 0) rows[i].received++
  }
  for (const j of done) {
    const i = bucket(j.valmis_kuupaev)
    if (i >= 0) rows[i].finished++
  }
  return rows
}
