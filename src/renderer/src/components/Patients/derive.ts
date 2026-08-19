// Every number shown on the patient page is computed here, so the header, the
// stat strip, the tooth chart and the ARVED panel can never disagree.
import type { Job } from '../../types/job'
import type { Payment } from '../../types/invoice'
import { jobsPaymentTotals, jobTotalValue } from '../../lib/jobPayments'
import type { Patient } from '../../types/patient'

// Count comma-separated FDI tokens. Trims first: `filter(Boolean)` (TableView.tsx:188)
// counts a trailing " " as a tooth, so "11,21," reports 3.
export const toothCount = (s: string | null | undefined) =>
  s ? s.split(',').filter(t => t.trim()).length : 0

/**
 * What a job is worth to the patient. Straight through to `jobTotalValue`.
 *
 * It used to add every revision price and leave `disain_hind` out, on the
 * belief that the price calculator folds the design fee into `hind`. It does
 * not — `quoteJob` returns `production` and `disain` separately and they land
 * in separate columns. So this over-reported by the lab's own rework cost and
 * under-reported by the design fee, on the patient's own history panel.
 */
export const jobTotal = (j: Job): number => jobTotalValue(j)

// Linked by id, or by name for rows the backfill has not touched yet. The name
// fallback is REQUIRED because every CSV-imported row has patient_id = null.
export function jobsForPatient(jobs: Job[], p: Patient): Job[] {
  const key = p.nimi.trim().toLowerCase()
  return jobs.filter(j =>
    j.patient_id === p.id || (!j.patient_id && j.patsient?.trim().toLowerCase() === key))
}

export function patientInitials(nimi: string): string {
  const parts = nimi.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  return parts.slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

// (C) Order reference — DERIVED FOR DISPLAY ONLY, never written to the DB.
// Format: initials-YYYY-NN, NN = this patient's nth job in that calendar year.
// Katrin Mägi's first 2026 job → "KM-2026-01".
export function buildOrderRefs(patient: Patient, patientJobs: Job[]): Map<string, string> {
  const ini = patientInitials(patient.nimi)
  const byYear = new Map<string, Job[]>()
  for (const j of patientJobs) {
    const y = (j.kuupaev ?? '').slice(0, 4)
    if (y.length !== 4) continue
    ;(byYear.get(y) ?? byYear.set(y, []).get(y)!).push(j)
  }
  const out = new Map<string, string>()
  for (const [y, list] of byYear) {
    // Ascending, stable: kuupaev → created_at → id. MUST be computed over the
    // patient's full year, not the sorted display slice.
    list.sort((a, b) =>
      a.kuupaev.localeCompare(b.kuupaev) ||
      (a.created_at ?? '').localeCompare(b.created_at ?? '') ||
      a.id.localeCompare(b.id))
    list.forEach((j, i) => out.set(j.id, `${ini}-${y}-${String(i + 1).padStart(2, '0')}`))
  }
  return out
}

// (D) Teeth ever worked on = jobs + revisions + un-migrated legacy rev_hambad.
export function derivedTeeth(patientJobs: Job[]): Set<string> {
  const set = new Set<string>()
  const add = (s?: string | null) =>
    (s ?? '').split(',').forEach(t => { const v = t.trim(); if (v) set.add(v) })
  for (const j of patientJobs) {
    add(j.hambad)
    ;(j.revisions ?? []).forEach(r => add(r.hambad))
    if ((j.revisions?.length ?? 0) === 0) add(j.rev_hambad)  // legacy imported revision
  }
  return set
}

// All patient-page totals in one pass.
export function patientStats(patientJobs: Job[], payments: Payment[] = []) {
  const jobCount = patientJobs.length
  // Matches useDashboardStats:45 — a legacy un-migrated revision has no entry in
  // the array, so it is not counted as a revision, only as revision teeth below.
  const revisionCount = patientJobs.reduce((s, j) => s + (j.revisions?.length ?? 0), 0)

  const latestJobDate =
    patientJobs.map(j => j.kuupaev).filter(d => !!d).sort((a, b) => b.localeCompare(a))[0] ?? null

  const originalTeeth = patientJobs.reduce((s, j) => s + toothCount(j.hambad), 0)
  // Legacy correction that no existing code applies: an imported job that was
  // never opened+saved still carries its single revision in rev_hambad. Count it
  // only when revisions is empty — JobDetailPanel migrates it in memory and
  // nulls it on save, so counting both would double the teeth.
  const revisionTeeth = patientJobs.reduce((s, j) => {
    const revs = j.revisions ?? []
    if (revs.length === 0) return s + toothCount(j.rev_hambad)
    return s + revs.reduce((n, r) => n + toothCount(r.hambad), 0)
  }, 0)
  const totalTeeth = originalTeeth + revisionTeeth

  // Reads the payment ROWS, not just the `makstud` flag: since part payments
  // exist a job can be flagged unpaid and still be half settled, and a panel
  // that ignored that would report a debt the patient has already reduced.
  const totals = jobsPaymentTotals(patientJobs, payments)
  const totalInvoiced = totals.total
  const paidTotal = totals.paid
  // By subtraction, NOT by summing the unpaid jobs: an unpaid job with a total of
  // 0 would otherwise make arveldatud ≠ makstud + tasumata in the ARVED panel.
  const unpaidTotal = totals.outstanding
  // The Dashboard rule — the `> 0` guard keeps priceless jobs from being counted
  // as outstanding invoices (PatientsView:161 omits it and over-reports).
  const unpaidCount = totals.unpaidCount
  const partialCount = totals.partialCount

  return {
    jobCount,
    revisionCount,
    latestJobDate,
    totalTeeth,
    originalTeeth,
    revisionTeeth,
    totalInvoiced,
    paidTotal,
    unpaidTotal,
    unpaidCount,
    partialCount
  }
}

// Which record produced the newest timestamp — shown next to the value so the
// user can tell a note edit from real work.
export type LastModifiedSource = 'patsient' | 'töö' | 'muudatus' | 'märkus'

export interface LastModifiedEntry {
  ts: string
  source: LastModifiedSource
}

export function lastModifiedEntry(p: Patient, patientJobs: Job[]): LastModifiedEntry | null {
  const candidates: LastModifiedEntry[] = []
  const add = (ts: string | null | undefined, source: LastModifiedSource) => {
    if (ts) candidates.push({ ts, source })
  }

  add(p.updated_at, 'patsient')
  // markused is undefined on rows fetched before migration 003
  ;(p.markused ?? []).forEach(n => add(n.ts, 'märkus'))
  for (const j of patientJobs) {
    add(j.updated_at, 'töö')
    ;(j.revisions ?? []).forEach(r => add(r.ts, 'muudatus'))
  }

  // Lexicographic compare is valid on ISO-8601 (same assumption as TableView:495)
  candidates.sort((a, b) => b.ts.localeCompare(a.ts))
  return candidates[0] ?? null
}

// Label this "Viimati muudetud", never "Viimane tegevus" — for CSV-imported rows
// updated_at is the import timestamp, not the date the work happened.
export function lastModified(p: Patient, patientJobs: Job[]): string | null {
  return lastModifiedEntry(p, patientJobs)?.ts ?? null
}
