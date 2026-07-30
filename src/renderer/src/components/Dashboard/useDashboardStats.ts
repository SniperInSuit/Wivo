import { useMemo } from 'react'
import { startOfMonth, startOfQuarter, startOfYear, isAfter, isBefore, parseISO, differenceInDays } from 'date-fns'
import type { Job } from '../../types/job'
import type { Visit } from '../../types/visit'
import type { Patient } from '../../types/patient'
import { usePipeline } from '../../context/PipelineContext'
import { useWorkTypes } from '../../stores/useSettings'

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

// Visits, patients and referring doctors are optional: the hook is also used by
// the Ülevaade with jobs only, and the visits table may not exist yet.
export function useDashboardStats(
  jobs: Job[],
  period: Period,
  visits: Visit[] = [],
  patients: Patient[] = []
) {
  const { stages, doneStageKey } = usePipeline()
  const wt = useWorkTypes()

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

    // Top patients by total tooth count (original + revision teeth split)
    const patientTeeth: Record<string, { original: number; revision: number }> = {}
    filtered.forEach((j) => {
      const p = j.patsient || 'Tundmatu'
      const cur = patientTeeth[p] ?? { original: 0, revision: 0 }
      cur.original += toothCount(j.hambad)
      cur.revision += revTeethOf(j)
      patientTeeth[p] = cur
    })
    const topPatients = Object.entries(patientTeeth)
      .map(([name, v]) => ({ name, original: v.original, revision: v.revision, count: v.original + v.revision }))
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

    // Work by work type — counted PER JOB, not per tooth. A single Allon4 with
    // 14 teeth is one job's worth of work, not fourteen; counting teeth made the
    // full-arch types tower over everything else and hid how the caseload is
    // actually distributed. Tooth totals still live in `totalTeeth` / topPatients.
    const jobsByType: Record<string, { original: number; revision: number }> = {}
    filtered.forEach((j) => {
      const type = wt.label(j.too)
      const cur = jobsByType[type] ?? { original: 0, revision: 0 }
      cur.original += 1
      cur.revision += (j.revisions ?? []).length || (j.muudatused ? 1 : 0)
      jobsByType[type] = cur
    })
    const workByType = Object.entries(jobsByType)
      .map(([name, v]) => ({ name, original: v.original, revision: v.revision, total: v.original + v.revision }))
      .filter(t => t.total > 0)
      .sort((a, b) => b.total - a.total)
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

    // ─── Visits ───────────────────────────────────────────────────────────
    const start = periodStart(period)
    const visitsIn = start
      ? visits.filter(v => v.algus && !isBefore(parseISO(v.algus), start))
      : visits
    const byStatus = (st: string) => visitsIn.filter(v => v.staatus === st).length
    const visitStats = {
      total: visitsIn.length,
      planeeritud: byStatus('planeeritud'),
      saabunud: byStatus('saabunud'),
      toimunud: byStatus('toimunud'),
      eiTulnud: byStatus('ei_tulnud'),
      tuhistatud: byStatus('tuhistatud'),
      // Share of visits that were expected to happen and did not. Cancellations
      // are excluded from the denominator: a cancelled visit was called off, a
      // no-show wasted the slot.
      noShowRate: 0,
      avgKestus: visitsIn.length > 0
        ? visitsIn.reduce((n, v) => n + v.kestus_min, 0) / visitsIn.length
        : 0
    }
    const attended = visitStats.saabunud + visitStats.toimunud
    const noShowBase = attended + visitStats.eiTulnud
    visitStats.noShowRate = noShowBase > 0 ? (visitStats.eiTulnud / noShowBase) * 100 : 0

    // Visits per weekday — when the lab is actually busy. 1 = Monday.
    const dayNames = ['P', 'E', 'T', 'K', 'N', 'R', 'L']
    const weekdayBuckets = Array.from({ length: 7 }, (_, i) => ({ name: dayNames[i], count: 0 }))
    visitsIn.forEach(v => {
      const d = parseISO(v.algus)
      weekdayBuckets[d.getDay()].count++
    })
    // Re-ordered Mon…Sun, which is how the week reads here
    const visitsByWeekday = [...weekdayBuckets.slice(1), weekdayBuckets[0]]

    // ─── Referring doctors ────────────────────────────────────────────────
    // Who actually sends the work. Resolved through the patient record, since
    // the doctor lives there and not on the job.
    const patientById = new Map(patients.map(p => [p.id, p]))
    const patientByName = new Map(patients.map(p => [p.nimi.trim().toLowerCase(), p]))
    const doctorOf = (j: Job): string => {
      const p = (j.patient_id ? patientById.get(j.patient_id) : undefined)
        ?? patientByName.get((j.patsient ?? '').trim().toLowerCase())
      return p?.arst?.trim() || p?.kliinik?.trim() || 'Määramata'
    }
    const doctorBuckets = new Map<string, { jobs: number; revenue: number }>()
    filtered.forEach(j => {
      const key = doctorOf(j)
      const cur = doctorBuckets.get(key) ?? { jobs: 0, revenue: 0 }
      cur.jobs++
      cur.revenue += jobTotal(j)
      doctorBuckets.set(key, cur)
    })
    const byDoctor = [...doctorBuckets.entries()]
      .map(([name, v]) => ({ name, ...v, revenue: Math.round(v.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)

    // ─── Work types ───────────────────────────────────────────────────────
    // Proper classification, not the old "first word of the too field" split.
    const typeBuckets = new Map<string, { count: number; revisions: number; teeth: number; revenue: number }>()
    filtered.forEach(j => {
      const key = wt.label(j.too)
      const cur = typeBuckets.get(key) ?? { count: 0, revisions: 0, teeth: 0, revenue: 0 }
      cur.count++
      cur.revisions += (j.revisions ?? []).length
      cur.teeth += toothCount(j.hambad) + revTeethOf(j)
      cur.revenue += jobTotal(j)
      typeBuckets.set(key, cur)
    })
    const byWorkType = [...typeBuckets.entries()]
      .map(([name, v]) => ({
        name, ...v,
        revenue: Math.round(v.revenue * 100) / 100,
        avgPrice: v.count > 0 ? Math.round((v.revenue / v.count) * 100) / 100 : 0
      }))
      .sort((a, b) => b.revenue - a.revenue)

    // ─── Revision reasons ─────────────────────────────────────────────────
    const reasonBuckets = new Map<string, number>()
    filtered.forEach(j => {
      ;(j.revisions ?? []).forEach(r => {
        const reason = r.reason?.trim() || 'Määramata'
        reasonBuckets.set(reason, (reasonBuckets.get(reason) ?? 0) + 1)
      })
    })
    const revisionReasons = [...reasonBuckets.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    // ─── Patients ─────────────────────────────────────────────────────────
    const newPatients = start
      ? patients.filter(p => p.created_at && !isBefore(parseISO(p.created_at), start)).length
      : patients.length
    const jobCountByPatient = new Map<string, number>()
    filtered.forEach(j => {
      const k = (j.patsient ?? '').trim().toLowerCase()
      if (k) jobCountByPatient.set(k, (jobCountByPatient.get(k) ?? 0) + 1)
    })
    const repeatPatients = [...jobCountByPatient.values()].filter(n => n > 1).length
    const patientStatsSummary = {
      total: patients.length,
      newPatients,
      repeatPatients,
      repeatRate: jobCountByPatient.size > 0
        ? (repeatPatients / jobCountByPatient.size) * 100
        : 0
    }

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
      workByType,
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
      revisionTeeth,
      visitStats,
      visitsByWeekday,
      byDoctor,
      byWorkType,
      revisionReasons,
      patientSummary: patientStatsSummary
    }
  // wt.types, not wt: the hook returns fresh closures every render, so depending
  // on it would recompute every stat on every render. The list identity only
  // changes when a work type is actually edited.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, period, stages, doneStageKey, visits, patients, wt.types])
}
