/**
 * What the invoice ledger says about getting paid.
 *
 * Pure and dependency-free on purpose: this is money arithmetic, so it belongs
 * where it can be tested rather than inside a card that renders it. The panels
 * read the result; nothing recomputes it.
 *
 * Every figure here is INVOICE-based and says so. A lab that settles work
 * without invoicing has no invoices to be owed against, and these numbers will
 * read as zero while the work is very much unpaid — which is why "Arveldamata"
 * exists next to them and why the hints on those panels name the difference.
 */
import type { InvoiceFull } from '../types/invoice'
import { outstanding, paidAmount } from '../types/invoice'

const round2 = (n: number): number => Math.round(n * 100) / 100

const daysBetween = (from: string, to: string): number => {
  const a = Date.parse(from)
  const b = Date.parse(to)
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN
  return Math.round((b - a) / 86_400_000)
}

/** Live, not settled: an invoice is cancelled or it counts. */
const countable = (inv: InvoiceFull): boolean => inv.status !== 'tuhistatud'

export interface AgingBucket {
  label: string
  /** Inclusive lower bound in days overdue. */
  from: number
  /** Exclusive upper bound, or null for "and older". */
  to: number | null
  amount: number
  count: number
}

export interface InvoiceMetrics {
  /** Outstanding split by how long it has been overdue. */
  aging: AgingBucket[]
  agingTotal: number
  /** Not yet due — owed, but nobody is late. */
  notDue: number
  /**
   * Average days from issue to payment, weighted by nothing: one invoice, one
   * observation. Only invoices actually settled in the window count, so a month
   * where nothing was paid reports null rather than 0.
   */
  daysToPay: number | null
  daysToPaySample: number
  /** Σ VAT on invoices issued in the period. Owed to the tax office, not income. */
  vat: number
  /** Σ net on invoices issued in the period, and their count. */
  issued: number
  issuedCount: number
  /** Average net value of an invoice issued in the period. */
  averageInvoice: number
}

const BUCKETS: { label: string; from: number; to: number | null }[] = [
  { label: '1–30 p',  from: 1,  to: 31 },
  { label: '31–60 p', from: 31, to: 61 },
  { label: '61–90 p', from: 61, to: 91 },
  { label: '90+ p',   from: 91, to: null },
]

/**
 * @param invoices ALL invoices, not just the period's — debt does not expire
 *                 when a reporting window closes.
 * @param today    The date overdue is measured against.
 * @param period   The window that issuance and settlement figures use.
 */
export function invoiceMetrics(
  invoices: InvoiceFull[],
  today: string,
  period: { start: string; end: string },
): InvoiceMetrics {
  const aging: AgingBucket[] = BUCKETS.map(b => ({ ...b, amount: 0, count: 0 }))
  let notDue = 0

  for (const inv of invoices) {
    if (!countable(inv)) continue
    const owed = outstanding(inv)
    if (owed <= 0) continue
    // No due date means nobody agreed when it was late, so it cannot be.
    const late = inv.due_date ? daysBetween(inv.due_date, today) : 0
    if (!Number.isFinite(late) || late < 1) { notDue += owed; continue }
    const bucket = aging.find(b => late >= b.from && (b.to === null || late < b.to))
    if (bucket) { bucket.amount += owed; bucket.count++ }
  }

  // ── How long payment takes ────────────────────────────────────────────────
  // Measured on invoices whose LAST payment landed in the window, so the figure
  // moves with recent behaviour instead of averaging the whole history forever.
  let daysSum = 0
  let daysN = 0
  for (const inv of invoices) {
    if (!countable(inv) || !inv.issue_date) continue
    if (paidAmount(inv) <= 0 || outstanding(inv) > 0) continue
    const last = (inv.payments ?? [])
      .map(p => p.paid_at)
      .filter(Boolean)
      .sort()
      .pop()
    if (!last || last < period.start || last > period.end) continue
    const d = daysBetween(inv.issue_date, last)
    if (!Number.isFinite(d)) continue
    daysSum += Math.max(0, d)
    daysN++
  }

  // ── Issued in the period ──────────────────────────────────────────────────
  let vat = 0
  let issued = 0
  let issuedCount = 0
  for (const inv of invoices) {
    if (!countable(inv) || !inv.issue_date) continue
    if (inv.issue_date < period.start || inv.issue_date > period.end) continue
    vat += Number(inv.vat_total) || 0
    issued += Number(inv.net_total) || 0
    issuedCount++
  }

  return {
    aging: aging.map(b => ({ ...b, amount: round2(b.amount) })),
    agingTotal: round2(aging.reduce((s, b) => s + b.amount, 0)),
    notDue: round2(notDue),
    daysToPay: daysN > 0 ? Math.round((daysSum / daysN) * 10) / 10 : null,
    daysToPaySample: daysN,
    vat: round2(vat),
    issued: round2(issued),
    issuedCount,
    averageInvoice: issuedCount > 0 ? round2(issued / issuedCount) : 0,
  }
}
