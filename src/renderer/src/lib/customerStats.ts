/**
 * Who sends the work, and how they pay for it.
 *
 * A lab's customer is the ordering PRACTICE (`jobs.customer_id`, migration 035),
 * which is a different question from the referring doctor on a patient card —
 * that one is the clinical side's answer and exists already as `byDoctor`.
 * Until now nothing aggregated by customer at all, despite the column being on
 * both jobs and invoices since 1.28.
 *
 * Jobs with no customer are kept under "Määramata" rather than dropped. A lab
 * that has not filled the field would otherwise see an empty panel and conclude
 * it has no customers, which is worse than an honest bucket.
 */
import type { Job } from '../types/job'
import type { InvoiceFull } from '../types/invoice'
import { paidAmount, outstanding } from '../types/invoice'
import { jobTotalValue } from './jobPayments'

const round2 = (n: number): number => Math.round(n * 100) / 100

export const UNASSIGNED = '__none__'

export interface CustomerRow {
  id: string
  name: string
  jobs: number
  teeth: number
  /** What their work is worth — job prices, revision charges included. */
  revenue: number
  /** Invoiced to them in the period. */
  billed: number
  /** Still owed on their invoices, at any age. */
  outstanding: number
  /** Mean days from invoice to settlement. Null when nothing has settled. */
  daysToPay: number | null
}

export interface CustomerStats {
  rows: CustomerRow[]
  /** Customers with at least one job in the period. */
  active: number
  /** Customer records created inside the period. */
  added: number
  /**
   * On the books, not archived, and no job for `dormantDays`. The number worth
   * a phone call.
   */
  dormant: { id: string; name: string; lastJob: string | null }[]
}

const toothCount = (h: string | null | undefined): number =>
  h ? h.split(',').map(s => s.trim()).filter(Boolean).length : 0

interface CustomerLike {
  id: string
  name: string
  created_at?: string | null
  archived_at?: string | null
}

export function customerStats(
  jobsInPeriod: Job[],
  allJobs: Job[],
  invoices: InvoiceFull[],
  customers: CustomerLike[],
  period: { start: string; end: string },
  today: string,
  dormantDays = 90,
): CustomerStats {
  const nameOf = new Map(customers.map(c => [c.id, c.name]))
  const rows = new Map<string, CustomerRow>()

  const row = (id: string): CustomerRow => {
    let r = rows.get(id)
    if (!r) {
      r = {
        id,
        name: id === UNASSIGNED ? 'Määramata' : nameOf.get(id) ?? 'Tundmatu klient',
        jobs: 0, teeth: 0, revenue: 0, billed: 0, outstanding: 0, daysToPay: null,
      }
      rows.set(id, r)
    }
    return r
  }

  for (const j of jobsInPeriod) {
    const r = row(j.customer_id ?? UNASSIGNED)
    r.jobs++
    r.teeth += toothCount(j.hambad)
    r.revenue += jobTotalValue(j)
  }

  // Invoices are attributed by their own customer, not by their jobs': a
  // monthly statement covers many jobs and is addressed once.
  const settleDays = new Map<string, { sum: number; n: number }>()
  for (const inv of invoices) {
    if (inv.status === 'tuhistatud') continue
    const id = inv.customer_id ?? UNASSIGNED
    const r = row(id)
    if (inv.issue_date && inv.issue_date >= period.start && inv.issue_date <= period.end) {
      r.billed += Number(inv.net_total) || 0
    }
    r.outstanding += outstanding(inv)

    if (inv.issue_date && paidAmount(inv) > 0 && outstanding(inv) <= 0) {
      const last = (inv.payments ?? []).map(p => p.paid_at).filter(Boolean).sort().pop()
      if (last) {
        const d = Math.round((Date.parse(last) - Date.parse(inv.issue_date)) / 86_400_000)
        if (Number.isFinite(d)) {
          const acc = settleDays.get(id) ?? { sum: 0, n: 0 }
          acc.sum += Math.max(0, d)
          acc.n++
          settleDays.set(id, acc)
        }
      }
    }
  }

  for (const [id, acc] of settleDays) {
    const r = rows.get(id)
    if (r && acc.n > 0) r.daysToPay = Math.round((acc.sum / acc.n) * 10) / 10
  }

  // ── Dormant ───────────────────────────────────────────────────────────────
  const lastJob = new Map<string, string>()
  for (const j of allJobs) {
    if (!j.customer_id || !j.kuupaev) continue
    const prev = lastJob.get(j.customer_id)
    if (!prev || j.kuupaev > prev) lastJob.set(j.customer_id, j.kuupaev)
  }
  const cutoff = new Date(Date.parse(today) - dormantDays * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const dormant = customers
    .filter(c => !c.archived_at)
    .map(c => ({ id: c.id, name: c.name, lastJob: lastJob.get(c.id) ?? null }))
    // Never ordered, or not since the cutoff. A customer added yesterday who has
    // not ordered yet is not dormant, so those are excluded by created_at below.
    .filter(c => !c.lastJob || c.lastJob < cutoff)
    .filter(c => {
      const created = customers.find(x => x.id === c.id)?.created_at
      return !created || created.slice(0, 10) < cutoff
    })
    .sort((a, b) => (a.lastJob ?? '').localeCompare(b.lastJob ?? ''))

  const added = customers.filter(
    c => c.created_at && c.created_at.slice(0, 10) >= period.start && c.created_at.slice(0, 10) <= period.end,
  ).length

  return {
    rows: [...rows.values()]
      .map(r => ({
        ...r,
        revenue: round2(r.revenue),
        billed: round2(r.billed),
        outstanding: round2(r.outstanding),
      }))
      .sort((a, b) => b.revenue - a.revenue),
    active: [...rows.values()].filter(r => r.jobs > 0 && r.id !== UNASSIGNED).length,
    added,
    dormant,
  }
}
