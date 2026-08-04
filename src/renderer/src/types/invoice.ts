import type { BillToKind } from './customer'
// Invoicing (Phase 4, migration 020).
//
// An invoice line copies its description and price from the job at billing
// time rather than joining to it. Editing a job afterwards must not silently
// restate a document that has already gone to a customer.

export type InvoiceStatus = 'mustand' | 'saadetud' | 'makstud' | 'tuhistatud'

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  mustand:    'Mustand',
  saadetud:   'Saadetud',
  makstud:    'Makstud',
  tuhistatud: 'Tühistatud',
}

export const INVOICE_STATUS_HEX: Record<InvoiceStatus, string> = {
  mustand:    '#94A3B8',
  saadetud:   '#0EA5E9',
  makstud:    '#22C55E',
  tuhistatud: '#EF4444',
}

export type PaymentMethod = 'ulekanne' | 'sularaha' | 'kaart' | 'muu'

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  ulekanne: 'Ülekanne',
  sularaha: 'Sularaha',
  kaart:    'Kaart',
  muu:      'Muu',
}

export interface InvoiceLine {
  id: string
  invoice_id: string
  job_id: string | null
  revision_id: string | null
  description: string
  qty: number
  unit_price: number
  sort_order: number
  created_at: string
}

export type InvoiceLineInput = Omit<InvoiceLine, 'id' | 'created_at'>

export interface Payment {
  id: string
  clinic_id: string
  invoice_id: string | null
  job_id: string | null
  amount: number
  method: PaymentMethod
  paid_at: string        // date (YYYY-MM-DD)
  reference: string | null
  note: string | null
  recorded_by: string | null
  created_at: string
}

export type PaymentInput = Omit<Payment, 'id' | 'clinic_id' | 'created_at'>

export interface Invoice {
  id: string
  clinic_id: string
  number: string
  patient_id: string | null
  /**
   * The name this document is addressed to, as text.
   *
   * Named `patsient` for history: before migration 035 the only addressee a lab
   * could bill was a patient. It now holds a patient's OR a customer's name and
   * `bill_to_kind` says which — that is what let customers arrive without
   * restating a single existing document. Do not rename it; every issued
   * invoice, print view and export reads this column.
   */
  patsient: string
  // Who this is billed to (migration 035). 'patient' on everything issued
  // before customers existed, which is what it was.
  customer_id: string | null
  bill_to_kind: BillToKind
  // Which month a statement covers. Null on per-job invoices, which cover
  // whatever their lines say and nothing more.
  period_start: string | null
  period_end: string | null
  status: InvoiceStatus
  issue_date: string     // date
  due_date: string | null
  // Rate as it stood when the invoice was issued — never re-read from settings,
  // or a rate change would restate every historical document.
  vat_rate: number
  net_total: number
  vat_total: number
  gross_total: number
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** An invoice with everything the list and the detail view need in one object. */
export interface InvoiceFull extends Invoice {
  lines: InvoiceLine[]
  payments: Payment[]
}

export const lineTotal = (l: Pick<InvoiceLine, 'qty' | 'unit_price'>): number =>
  Math.round(l.qty * l.unit_price * 100) / 100

export const paidAmount = (inv: Pick<InvoiceFull, 'payments'>): number =>
  Math.round(inv.payments.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100

/**
 * What is still owed. Cancelled invoices owe nothing regardless of what was
 * billed — otherwise they keep showing up in the unpaid total forever.
 */
export function outstanding(inv: InvoiceFull): number {
  if (inv.status === 'tuhistatud') return 0
  return Math.round((Number(inv.gross_total) - paidAmount(inv)) * 100) / 100
}

export function isOverdue(inv: InvoiceFull, now = new Date()): boolean {
  if (!inv.due_date || inv.status === 'makstud' || inv.status === 'tuhistatud') return false
  if (outstanding(inv) <= 0) return false
  return new Date(inv.due_date) < new Date(now.toDateString())
}
