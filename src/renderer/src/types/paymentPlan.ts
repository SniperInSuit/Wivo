/**
 * A payment plan: one agreement that a patient pays a treatment off in monthly
 * parts, and the invoices that agreement produced.
 *
 * The invoices ARE the schedule — they are generated up front as real documents
 * because nothing runs behind a desktop app that is closed. This row is what
 * says the five of them belong together: which rule made them, how far along
 * they are, and whether the agreement is still live. See sql/049.
 */
import type { InvoiceFull, Payment } from './invoice'
import { outstanding, paidAmount } from './invoice'
import type { PaymentPlanShape } from '@shared/billing/instalments'

export type PaymentPlanStatus = 'aktiivne' | 'lopetatud' | 'tuhistatud'

export const PAYMENT_PLAN_STATUS_LABEL: Record<PaymentPlanStatus, string> = {
  aktiivne:   'Aktiivne',
  lopetatud:  'Lõpetatud',
  tuhistatud: 'Tühistatud',
}

export const PAYMENT_PLAN_STATUS_HEX: Record<PaymentPlanStatus, string> = {
  aktiivne:   '#0EA5E9',
  lopetatud:  '#22C55E',
  tuhistatud: '#94A3B8',
}

export interface PaymentPlan {
  id: string
  clinic_id: string
  /** Null once the patient card is gone; `patsient` still names the agreement. */
  patient_id: string | null
  patsient: string
  kogusumma: number
  osamakseid: number
  /** 'YYYY-MM-DD' — when instalment 1 is issued. */
  esimene_arve: string
  /** Day of month for every instalment, 1–28. Null = keep the first one's day. */
  arve_paev: number | null
  maksetahtaeg_paevi: number
  staatus: PaymentPlanStatus
  markus: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type PaymentPlanInput =
  Omit<PaymentPlan, 'id' | 'clinic_id' | 'created_at' | 'updated_at'>

export const EMPTY_PAYMENT_PLAN: PaymentPlanInput = {
  patient_id: null,
  patsient: '',
  kogusumma: 0,
  osamakseid: 5,
  esimene_arve: '',
  arve_paev: 2,
  maksetahtaeg_paevi: 14,
  staatus: 'aktiivne',
  markus: null,
  created_by: null,
}

/**
 * The plan in the shape `shared/billing` speaks, so the preview, the generator
 * and (later) the sender all lay it out with one function.
 *
 * `arve_paev` is null-to-undefined rather than passed through: the shared module
 * treats "no chosen day" as absent, and `null` there would fail its own range
 * check and refuse a perfectly good plan.
 */
export const planShape = (plan: Pick<PaymentPlan,
  'kogusumma' | 'osamakseid' | 'esimene_arve' | 'arve_paev' | 'maksetahtaeg_paevi'
>): PaymentPlanShape => ({
  total: Number(plan.kogusumma ?? 0),
  count: Number(plan.osamakseid ?? 0),
  firstIssue: plan.esimene_arve ?? '',
  dayOfMonth: plan.arve_paev ?? undefined,
  termDays: Number(plan.maksetahtaeg_paevi ?? 0),
})

const round2 = (n: number) => Math.round(n * 100) / 100

export interface PlanProgress {
  /** Invoices this plan produced, in instalment order. */
  invoices: InvoiceFull[]
  /** What has been billed so far — cancelled invoices excluded. */
  billed: number
  paid: number
  /** Still owed on the invoices that EXIST. Not the same as the plan's total
   *  minus paid: an instalment not yet issued is not yet a debt. */
  outstanding: number
  /** Instalments whose due date has passed with money still on them. */
  overdue: number
  overdueCount: number
  /** How many instalments are fully settled. */
  settledCount: number
  /** The next instalment still owing anything, or null when the plan is done. */
  next: InvoiceFull | null
}

/**
 * Where a plan stands. Reads the INVOICES, never the plan's own numbers —
 * the plan says what was agreed, the invoices say what happened, and when the
 * two disagree the documents are the truth.
 */
export function planProgress(
  plan: Pick<PaymentPlan, 'id'>,
  allInvoices: InvoiceFull[],
  today = new Date().toISOString().slice(0, 10)
): PlanProgress {
  const invoices = allInvoices
    .filter(i => i.payment_plan_id === plan.id)
    .sort((a, b) => (a.instalment_no ?? 0) - (b.instalment_no ?? 0))

  const live = invoices.filter(i => i.status !== 'tuhistatud')
  const billed = round2(live.reduce((s, i) => s + Number(i.gross_total ?? 0), 0))
  const paid = round2(live.reduce((s, i) => s + paidAmount(i), 0))
  const owing = live.filter(i => outstanding(i) > 0.005)
  const late = owing.filter(i => !!i.due_date && i.due_date < today)

  return {
    invoices,
    billed,
    paid,
    outstanding: round2(live.reduce((s, i) => s + outstanding(i), 0)),
    overdue: round2(late.reduce((s, i) => s + outstanding(i), 0)),
    overdueCount: late.length,
    settledCount: live.length - owing.length,
    next: owing[0] ?? null,
  }
}

/** Payments recorded against any of this plan's invoices. For the history list. */
export const planPayments = (progress: PlanProgress): Payment[] =>
  progress.invoices.flatMap(i => i.payments ?? [])
    .sort((a, b) => (a.paid_at ?? '').localeCompare(b.paid_at ?? ''))
