import { useMemo } from 'react'
import { startOfMonth, startOfQuarter, startOfYear, isAfter, isBefore, parseISO, differenceInDays } from 'date-fns'
import type { Job } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'

export type Period = 'month' | 'quarter' | 'year' | 'all'

function periodStart(p: Period): Date | null {
  const now = new Date()
  if (p === 'month') return startOfMonth(now)
  if (p === 'quarter') return startOfQuarter(now)
  if (p === 'year') return startOfYear(now)
  return null
}

function filterByPeriod(jobs: Job[], period: Period): Job[] {
  const start = periodStart(period)
  if (!start) return jobs
  // Use kuupaev (the actual received date) — not created_at which is the import timestamp.
  // Inclusive of the first day: a strict isAfter dropped every job dated 1. of the
  // month/quarter/year from the stats entirely, while the patient page counted it.
  return jobs.filter((j) => j.kuupaev && !isBefore(parseISO(j.kuupaev), start))
}

// Parse comma-sep tooth string → count
function toothCount(s: string | null): number {
  if (!s) return 0
  return s.split(',').filter((t) => t.trim()).length
}

export function useDashboardStats(jobs: Job[], period: Period) {
  const { stages, doneStageKey } = usePipeline()

  return useMemo(() => {
    // Total price for a job = main price + all revision prices
    const jobTotal = (j: Job) =>
      (j.hind ?? 0) + (j.revisions ?? []).reduce((s, r) => s + (r.price ?? 0), 0)

    const filtered = filterByPeriod(jobs, period)
    const completed = filtered.filter((j) => j.status === doneStageKey)
    const inProduction = filtered.filter((j) => j.status !== doneStageKey)
    const now = new Date()
    const overdue = filtered.filter(
      (j) => j.valmis_aeg && isBefore(parseISO(j.valmis_aeg), now) && j.status !== doneStageKey
    )
    const withRevision = filtered.filter((j) => (j.revisions?.length ?? 0) > 0 || !!j.muudatused)
    const totalRevisions = filtered.reduce((sum, j) => sum + (j.revisions?.length ?? 0), 0)
    const totalWork = filtered.length + totalRevisions
    // Revision teeth. A CSV-imported job that has never been opened+saved still
    // carries its revision in the legacy rev_hambad field with revisions = [],
    // so count that instead — otherwise the dashboard undercounts exactly the
    // rows the patient page counts, and the two screens disagree.
    const revTeethOf = (j: Job) => {
      const revs = j.revisions ?? []
      return revs.length === 0
        ? toothCount(j.rev_hambad ?? null)
        : revs.reduce((s, r) => s + toothCount(r.hambad ?? null), 0)
    }
    const totalTeeth = filtered.reduce((sum, j) => sum + toothCount(j.hambad) + revTeethOf(j), 0)
    const avgTeethPerJob = filtered.length > 0 ? totalTeeth / filtered.length : 0
    const revisionRate = filtered.length > 0 ? (withRevision.length / filtered.length) * 100 : 0

    // Kiirtöö stats
    const kiirtooJobs = filtered.filter((j) => j.kiirtoo)
    const kiirtooRevenue = kiirtooJobs.reduce((sum, j) => sum + jobTotal(j), 0)

    // Machine breakdown
    const machineCounts: Record<string, number> = {}
    filtered.forEach((j) => {
      const m = j.masina || 'Määramata'
      machineCounts[m] = (machineCounts[m] ?? 0) + 1
    })
    const machineStats = Object.entries(machineCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    // Top patients by total tooth count (original + revision teeth)
    const patientTeeth: Record<string, number> = {}
    filtered.forEach((j) => {
      const p = j.patsient || 'Tundmatu'
      const teeth = toothCount(j.hambad) + revTeethOf(j)
      patientTeeth[p] = (patientTeeth[p] ?? 0) + teeth
    })
    const topPatients = Object.entries(patientTeeth)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    // Avg turnaround: days from kuupaev to valmis_aeg for completed jobs
    const completedWithDates = completed.filter((j) => j.kuupaev && j.valmis_aeg)
    const avgTurnaround = completedWithDates.length > 0
      ? completedWithDates.reduce((sum, j) => {
          const days = differenceInDays(parseISO(j.valmis_aeg!), parseISO(j.kuupaev))
          return sum + Math.max(0, days)
        }, 0) / completedWithDates.length
      : 0

    // Teeth by work type
    const teethByType: Record<string, number> = {}
    filtered.forEach((j) => {
      if (!j.too || !j.hambad) return
      const type = j.too.split(' ')[0]
      teethByType[type] = (teethByType[type] ?? 0) + toothCount(j.hambad)
    })
    const teethByWorkType = Object.entries(teethByType)
      .map(([name, teeth]) => ({ name, teeth }))
      .sort((a, b) => b.teeth - a.teeth)
      .slice(0, 8)

    // Payment stats — include revision prices in every revenue figure
    const totalRevenue = filtered.reduce((sum, j) => sum + jobTotal(j), 0)
    const paid = filtered.filter((j) => j.makstud)
    const unpaid = filtered.filter((j) => !j.makstud && jobTotal(j) > 0)
    const paidRevenue = paid.reduce((sum, j) => sum + jobTotal(j), 0)
    const unpaidRevenue = unpaid.reduce((sum, j) => sum + jobTotal(j), 0)
    const jobsWithPrice = filtered.filter((j) => jobTotal(j) > 0)
    const avgPrice = jobsWithPrice.length > 0 ? totalRevenue / jobsWithPrice.length : 0
    const avgPricePerTooth = totalTeeth > 0 ? totalRevenue / totalTeeth : 0

    // Revenue by month (last 6 months) — include revision prices
    const monthBuckets: Record<string, number> = {}
    filtered.forEach((j) => {
      const d = parseISO(j.kuupaev)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthBuckets[key] = (monthBuckets[key] ?? 0) + jobTotal(j)
    })
    const revenueByMonth = Object.entries(monthBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, revenue]) => ({
        month: month.slice(5) + '/' + month.slice(2, 4),
        revenue: Math.round(revenue * 100) / 100
      }))

    // Material stats
    const materialCounts: Record<string, { count: number; teeth: number }> = {}
    filtered.forEach((j) => {
      const m = j.materjal ?? 'Muu'
      if (!materialCounts[m]) materialCounts[m] = { count: 0, teeth: 0 }
      materialCounts[m].count++
      materialCounts[m].teeth += toothCount(j.hambad)
    })
    const materialStats = Object.entries(materialCounts)
      .map(([name, { count, teeth }]) => ({ name, count, teeth }))
      .sort((a, b) => b.count - a.count)

    // Jobs per month (throughput)
    const throughputBuckets: Record<string, number> = {}
    completed.forEach((j) => {
      const d = parseISO(j.kuupaev)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      throughputBuckets[key] = (throughputBuckets[key] ?? 0) + 1
    })
    const throughput = Object.entries(throughputBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({
        month: month.slice(5) + '/' + month.slice(2, 4),
        count
      }))

    // Current WIP by stage
    const wipByStage = stages.map((s) => ({
      name: s.label,
      count: jobs.filter((j) => j.status === s.key).length,
      hex: s.hex
    }))

    // Most/least common individual teeth (FDI numbers)
    const toothFreq: Record<string, number> = {}
    filtered.forEach(j => {
      if (!j.hambad) return
      j.hambad.split(',').forEach(t => {
        const tooth = t.trim()
        if (tooth) toothFreq[tooth] = (toothFreq[tooth] ?? 0) + 1
      })
    })
    const toothFreqSorted = Object.entries(toothFreq)
      .map(([tooth, count]) => ({ tooth, count }))
      .sort((a, b) => b.count - a.count)
    const weakestTeeth = toothFreqSorted.slice(0, 10)   // most treated = weakest
    const strongestTeeth = toothFreqSorted.slice(-10).reverse()  // least treated = strongest

    // Original vs revision teeth
    const originalTeeth = filtered.reduce((sum, j) => sum + toothCount(j.hambad), 0)
    const revisionTeeth = filtered.reduce((sum, j) => sum + revTeethOf(j), 0)

    return {
      filtered,
      completed,
      inProduction,
      overdue,
      withRevision,
      totalRevisions,
      totalWork,
      totalTeeth,
      avgTeethPerJob,
      revisionRate,
      kiirtooJobs,
      kiirtooRevenue,
      machineStats,
      topPatients,
      avgTurnaround,
      teethByWorkType,
      totalRevenue,
      paidRevenue,
      unpaidRevenue,
      avgPrice,
      avgPricePerTooth,
      revenueByMonth,
      materialStats,
      throughput,
      wipByStage,
      weakestTeeth,
      strongestTeeth,
      originalTeeth,
      revisionTeeth
    }
  }, [jobs, period, stages, doneStageKey])
}
