/**
 * Where a plan stands. The rule under test is that this reads the INVOICES and
 * never the plan's own numbers: the plan says what was agreed, the invoices say
 * what happened, and when the two disagree the documents are the truth.
 */
import { describe, it, expect } from 'vitest'
import type { InvoiceFull, InvoiceLine, Payment } from './invoice'
import { planProgress, planShape, type PaymentPlan } from './paymentPlan'

let seq = 0

const payment = (amount: number, paidAt = '2026-09-05'): Payment => ({
  id: `pay-${++seq}`,
  clinic_id: 'clinic',
  invoice_id: 'inv',
  job_id: null,
  amount,
  method: 'ulekanne',
  paid_at: paidAt,
  reference: null,
  note: null,
  recorded_by: null,
  created_at: paidAt,
})

// Spelled out rather than computed: `2026-0${8 + no}` turns instalment five
// into month "013", and '2026-013-16' sorts BEFORE '2026-09-30' as a string —
// so the fixture invented overdue instalments the code was right to report.
const MONTHS = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01']

const instalment = (
  no: number,
  gross: number,
  over: Partial<InvoiceFull> = {}
): InvoiceFull => ({
  id: `inv-${no}`,
  clinic_id: 'clinic',
  number: `2026-000${no}`,
  status: 'saadetud',
  patsient: 'Mari Maasikas',
  issue_date: `${MONTHS[no - 1]}-02`,
  due_date: `${MONTHS[no - 1]}-16`,
  net_total: gross,
  vat_total: 0,
  gross_total: gross,
  payment_plan_id: 'plan-1',
  instalment_no: no,
  lines: [] as InvoiceLine[],
  payments: [] as Payment[],
  ...over,
} as unknown as InvoiceFull)

const PLAN = { id: 'plan-1' } as Pick<PaymentPlan, 'id'>

describe('planProgress', () => {
  const five = () => [1, 2, 3, 4, 5].map(no => instalment(no, 1000))

  it('counts nothing paid on a fresh plan', () => {
    const p = planProgress(PLAN, five(), '2026-09-01')
    expect(p.billed).toBe(5000)
    expect(p.paid).toBe(0)
    expect(p.outstanding).toBe(5000)
    expect(p.settledCount).toBe(0)
    expect(p.next?.instalment_no).toBe(1)
  })

  it('advances as instalments are settled', () => {
    const rows = five()
    rows[0] = instalment(1, 1000, { payments: [payment(1000)] })
    rows[1] = instalment(2, 1000, { payments: [payment(1000)] })

    const p = planProgress(PLAN, rows, '2026-11-01')
    expect(p.paid).toBe(2000)
    expect(p.outstanding).toBe(3000)
    expect(p.settledCount).toBe(2)
    expect(p.next?.instalment_no).toBe(3)
  })

  it('has no next instalment once everything is settled', () => {
    const rows = five().map((r, i) => instalment(i + 1, 1000, { payments: [payment(1000)] }))
    const p = planProgress(PLAN, rows, '2027-02-01')
    expect(p.outstanding).toBe(0)
    expect(p.next).toBeNull()
  })

  it('counts an instalment as overdue only once its due date has passed', () => {
    const rows = five()
    // Instalment 1 is due 2026-09-16 and unpaid.
    expect(planProgress(PLAN, rows, '2026-09-15').overdueCount).toBe(0)
    const late = planProgress(PLAN, rows, '2026-09-17')
    expect(late.overdueCount).toBe(1)
    expect(late.overdue).toBe(1000)
  })

  it('does not call a PAID instalment overdue', () => {
    const rows = five()
    rows[0] = instalment(1, 1000, { payments: [payment(1000)] })
    expect(planProgress(PLAN, rows, '2026-09-30').overdueCount).toBe(0)
  })

  it('leaves a cancelled instalment out of every figure', () => {
    // Cancelling the tail of a plan must not keep billing for it — that is the
    // whole point of stopping one.
    const rows = five()
    rows[3] = instalment(4, 1000, { status: 'tuhistatud' })
    rows[4] = instalment(5, 1000, { status: 'tuhistatud' })

    const p = planProgress(PLAN, rows, '2026-09-01')
    expect(p.billed).toBe(3000)
    expect(p.outstanding).toBe(3000)
  })

  it('ignores invoices belonging to another plan or to none', () => {
    const rows = [
      ...five(),
      instalment(1, 999, { id: 'other', payment_plan_id: 'plan-2' } as Partial<InvoiceFull>),
      instalment(1, 500, { id: 'loose', payment_plan_id: null } as Partial<InvoiceFull>),
    ]
    expect(planProgress(PLAN, rows, '2026-09-01').billed).toBe(5000)
  })

  it('returns the instalments in order, whatever order they arrived in', () => {
    const rows = [instalment(3, 1000), instalment(1, 1000), instalment(2, 1000)]
    expect(planProgress(PLAN, rows, '2026-09-01').invoices.map(i => i.instalment_no))
      .toEqual([1, 2, 3])
  })

  it('reports a part-paid instalment as still owing', () => {
    const rows = five()
    rows[0] = instalment(1, 1000, { payments: [payment(400)] })
    const p = planProgress(PLAN, rows, '2026-09-01')
    expect(p.paid).toBe(400)
    expect(p.outstanding).toBe(4600)
    expect(p.settledCount).toBe(0)
    expect(p.next?.instalment_no).toBe(1)
  })
})

describe('planShape', () => {
  it('turns a null arve_paev into "no chosen day", not into a broken one', () => {
    // null would fail the shared module's 1–28 range check and refuse a plan
    // that is perfectly fine.
    const shape = planShape({
      kogusumma: 5000, osamakseid: 5,
      esimene_arve: '2026-09-02', arve_paev: null, maksetahtaeg_paevi: 14,
    })
    expect(shape.dayOfMonth).toBeUndefined()
    expect(shape.total).toBe(5000)
    expect(shape.termDays).toBe(14)
  })

  it('passes a chosen day through', () => {
    expect(planShape({
      kogusumma: 1000, osamakseid: 2,
      esimene_arve: '2026-09-17', arve_paev: 2, maksetahtaeg_paevi: 7,
    }).dayOfMonth).toBe(2)
  })
})
