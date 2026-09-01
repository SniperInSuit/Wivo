/**
 * What a job is worth to the CLIENT, and what is still owed on it.
 *
 * These tests exist because the same mistake was made twice. `jobTotalValue`
 * has always had the rule right — price + design fee + extras, revision costs
 * excluded because they are the lab's own rework expense — but six screens
 * summed the number by hand instead of calling it, and every one of those
 * copies added the revisions back in.
 *
 * The visible result: a job's read view said 6800 € outstanding and the "Märgi
 * makstuks" dialog on the very same screen opened at 7048 €. Whichever number
 * someone acted on, one of the two was a lie.
 */
import { describe, it, expect } from 'vitest'
import type { Job, Revision } from '../types/job'
import type { InvoiceFull, InvoiceLine, Payment } from '../types/invoice'
import {
  jobTotalValue, jobExtrasTotal, jobPaymentState, paidForJob, jobsPaymentTotals,
} from './jobPayments'

let seq = 0

const job = (over: Partial<Job> = {}): Job => ({
  id: `job-${++seq}`,
  status: 'valmis',
  kuupaev: '2026-08-01',
  patsient: 'Mari Maasikas',
  patient_id: null,
  customer_id: null,
  customer_ref: null,
  too: 'Sild',
  materjal: null,
  masina: null,
  print_id: null,
  disain_id: null,
  extra_costs: [],
  varv: null,
  hambad: null,
  kirjeldus: null,
  valmis_aeg: null,
  valmis_kuupaev: '2026-08-10',
  kiirtoo: false,
  delivery_status: 'labor',
  delivered_at: null,
  work_items: [],
  revisions: [],
  markused: [],
  extras: [],
  hind: null,
  disain_hind: null,
  makstud: false,
  makse_kuupaev: null,
  assigned_to: null,
  designed_by: null,
  created_at: '2026-08-01',
  updated_at: '2026-08-01',
  ...over,
})

const revision = (price: number): Revision => ({
  id: `rev-${++seq}`,
  ts: '2026-08-05T10:00:00Z',
  note: 'Uuesti',
  price,
})

const payment = (jobId: string | null, amount: number): Payment => ({
  id: `pay-${++seq}`,
  clinic_id: 'clinic',
  invoice_id: null,
  job_id: jobId,
  amount,
  method: 'ulekanne',
  paid_at: '2026-08-19',
  reference: null,
  note: null,
  recorded_by: null,
  created_at: '2026-08-19',
})

describe('jobTotalValue', () => {
  it('is price + design fee + extras', () => {
    const j = job({
      hind: 6800,
      disain_hind: 120,
      extras: [{ id: 'e1', nimi: 'Ülesehitus', hind: 60 }],
    })
    expect(jobTotalValue(j)).toBe(6980)
  })

  it('EXCLUDES revision costs — they are the lab’s, not the client’s', () => {
    // The bug, stated as a number: 6800 € of work with 248 € of rework behind
    // it is a 6800 € bill. Every hand-rolled copy of this sum said 7048 €.
    const j = job({ hind: 6800, revisions: [revision(200), revision(48)] })
    expect(jobTotalValue(j)).toBe(6800)
  })

  it('does not fold the design fee into the price', () => {
    // The other half of the same confusion: one copy left `disain_hind` out on
    // the belief that `quoteJob` had already folded it into `hind`. It does not
    // — quoteJob returns `production` and `disain` separately and they land in
    // separate columns.
    expect(jobTotalValue(job({ hind: 400, disain_hind: 50 }))).toBe(450)
  })

  it('counts nothing for a job with no price at all', () => {
    expect(jobTotalValue(job())).toBe(0)
    expect(jobExtrasTotal(job())).toBe(0)
  })
})

describe('jobPaymentState', () => {
  it('owes the client total, revisions and all', () => {
    const j = job({ hind: 6800, revisions: [revision(248)] })
    const s = jobPaymentState(j, [])
    expect(s.total).toBe(6800)
    expect(s.outstanding).toBe(6800)
    expect(s.settled).toBe(false)
  })

  it('settles on the client total, so rework cannot leave a phantom debt', () => {
    // Paying the real bill used to leave 248 € "outstanding" against a total
    // that included the lab's own rework, and the job never went green.
    const j = job({ hind: 6800, revisions: [revision(248)] })
    const s = jobPaymentState(j, [payment(j.id, 6800)])
    expect(s.outstanding).toBe(0)
    expect(s.settled).toBe(true)
    expect(s.partial).toBe(false)
  })

  it('reports a part payment as partial', () => {
    const j = job({ hind: 400 })
    const s = jobPaymentState(j, [payment(j.id, 150)])
    expect(s.paid).toBe(150)
    expect(s.outstanding).toBe(250)
    expect(s.partial).toBe(true)
  })

  it('trusts the legacy flag when no payment rows exist', () => {
    const j = job({ hind: 400, makstud: true })
    expect(jobPaymentState(j, []).settled).toBe(true)
  })

  it('ignores payments belonging to other jobs', () => {
    const j = job({ hind: 400 })
    expect(paidForJob(j.id, [payment('someone-else', 400)])).toBe(0)
  })
})

describe('jobsPaymentTotals', () => {
  it('counts only what is STILL owed, not the full price of part-paid jobs', () => {
    // What the Ülevaade card got wrong: it summed the whole list price of every
    // job whose legacy `makstud` flag was false, so 6000 € already in the bank
    // was still being reported as owed.
    const a = job({ hind: 6800 })
    const b = job({ hind: 400 })
    const t = jobsPaymentTotals([a, b], [payment(a.id, 6000)])
    expect(t.total).toBe(7200)
    expect(t.paid).toBe(6000)
    expect(t.outstanding).toBe(1200)
  })

  it('counts a part-paid job in BOTH unpaidCount and partialCount', () => {
    // Deliberate, and the reason the card subtracts one from the other: the
    // three groups on screen have to be disjoint or they sum to more than the
    // jobs that exist.
    const a = job({ hind: 6800 })
    const t = jobsPaymentTotals([a], [payment(a.id, 6000)])
    expect(t.unpaidCount).toBe(1)
    expect(t.partialCount).toBe(1)
  })

  it('ignores jobs with no price — an unpriced job is not a debt', () => {
    const t = jobsPaymentTotals([job(), job({ hind: 400 })], [])
    expect(t.unpaidCount).toBe(1)
    expect(t.outstanding).toBe(400)
  })

  it('never lets an overpayment show as negative debt', () => {
    const a = job({ hind: 400 })
    const t = jobsPaymentTotals([a], [payment(a.id, 500)])
    expect(t.outstanding).toBe(0)
  })
})

// ── Invoice-settled jobs ─────────────────────────────────────────────────────
// The second half of the same story. "Märgi makstuks" writes a payment with a
// `job_id`; the invoice screen writes one with an `invoice_id` and job_id NULL.
// `paidForJob` filtered on `job_id` alone, so money that arrived by invoice was
// visible under Rahandus → Laekunud and reduced nobody's debt. A job billed and
// paid in full still read "Maksmata" on its own panel, forever.

const line = (jobId: string | null, value: number): InvoiceLine => ({
  id: `line-${++seq}`,
  invoice_id: 'inv',
  job_id: jobId,
  revision_id: null,
  description: 'Töö',
  qty: 1,
  unit_price: value,
  sort_order: 0,
  created_at: '2026-08-19',
})

const invoice = (over: Partial<InvoiceFull> & {
  lines: InvoiceLine[]; payments: Payment[]; gross_total: number
}): InvoiceFull => ({
  id: 'inv',
  clinic_id: 'clinic',
  number: '2026-001',
  status: 'saadetud',
  patsient: 'Mari Maasikas',
  issue_date: '2026-08-19',
  due_date: '2026-09-19',
  net_total: over.gross_total,
  vat_total: 0,
  created_at: '2026-08-19',
  updated_at: '2026-08-19',
  ...over,
} as unknown as InvoiceFull)

describe('paidForJob, through an invoice', () => {
  it('settles a job whose invoice was paid in full', () => {
    const j = job({ hind: 400 })
    const inv = invoice({
      gross_total: 400,
      lines: [line(j.id, 400)],
      payments: [payment(null, 400)],
    })
    expect(paidForJob(j.id, [], [inv])).toBe(400)
    expect(jobPaymentState(j, [], [inv]).settled).toBe(true)
  })

  it('splits a part-paid invoice across its jobs by value', () => {
    // Nobody pays an invoice LINE, so which job the money was "for" is a
    // question the data cannot answer. Pro-rata is the only honest split.
    const a = job({ hind: 300 })
    const b = job({ hind: 100 })
    const inv = invoice({
      gross_total: 400,
      lines: [line(a.id, 300), line(b.id, 100)],
      payments: [payment(null, 200)],   // half
    })
    expect(paidForJob(a.id, [], [inv])).toBe(150)
    expect(paidForJob(b.id, [], [inv])).toBe(50)
  })

  it('does not over-credit a job by the VAT on its invoice', () => {
    // The ratio is taken against gross and applied to net line values, so a
    // fully paid 22% VAT invoice settles the job exactly, not 122% of it.
    const j = job({ hind: 400 })
    const inv = invoice({
      gross_total: 488,
      net_total: 400,
      vat_total: 88,
      lines: [line(j.id, 400)],
      payments: [payment(null, 488)],
    })
    expect(paidForJob(j.id, [], [inv])).toBe(400)
  })

  it('ignores a cancelled invoice', () => {
    const j = job({ hind: 400 })
    const inv = invoice({
      status: 'tuhistatud',
      gross_total: 400,
      lines: [line(j.id, 400)],
      payments: [payment(null, 400)],
    })
    expect(paidForJob(j.id, [], [inv])).toBe(0)
  })

  it('adds a direct payment and an invoice payment together', () => {
    const j = job({ hind: 400 })
    const inv = invoice({
      gross_total: 400,
      lines: [line(j.id, 400)],
      payments: [payment(null, 100)],
    })
    expect(paidForJob(j.id, [payment(j.id, 250)], [inv])).toBe(350)
  })

  it('never counts a row carrying both ids twice', () => {
    const j = job({ hind: 400 })
    const both: Payment = { ...payment(j.id, 400), invoice_id: 'inv' }
    const inv = invoice({ gross_total: 400, lines: [line(j.id, 400)], payments: [both] })
    expect(paidForJob(j.id, [both], [inv])).toBe(400)
  })

  it('leaves the Ülevaade total counting only what is genuinely owed', () => {
    const a = job({ hind: 6800 })
    const b = job({ hind: 400 })
    const inv = invoice({
      gross_total: 6800,
      lines: [line(a.id, 6800)],
      payments: [payment(null, 6800)],
    })
    const t = jobsPaymentTotals([a, b], [], [inv])
    expect(t.outstanding).toBe(400)
    expect(t.unpaidCount).toBe(1)
  })
})

describe('a job billed as a payment plan', () => {
  // Five monthly instalments over one 5000 € job. `InvoiceForm` used to put the
  // `job_id` on instalment 1 ONLY, so `paidForJob` — which credits a job from
  // its invoice LINES — saw nothing for instalments 2..5. A job paid off over
  // five months stayed 1/5 paid on its own panel, on the patient page and in
  // the Ülevaade total, permanently.
  const instalmentInvoice = (jobId: string, no: number, amount: number): InvoiceFull =>
    invoice({
      gross_total: amount,
      lines: [{ ...line(jobId, amount), invoice_id: `inv-${no}` }],
      payments: [],
    })

  it('credits the job for EVERY instalment paid, not just the first', () => {
    const j = job({ hind: 5000 })
    const invoices = [1, 2, 3, 4, 5].map(no => instalmentInvoice(j.id, no, 1000))
    // Only the third one has been settled.
    invoices[2] = { ...invoices[2], payments: [payment(null, 1000)] }

    expect(paidForJob(j.id, [], invoices)).toBe(1000)
    expect(jobPaymentState(j, [], invoices).outstanding).toBe(4000)
  })

  it('settles the job once the last instalment lands', () => {
    const j = job({ hind: 5000 })
    const invoices = [1, 2, 3, 4, 5].map(no => ({
      ...instalmentInvoice(j.id, no, 1000),
      payments: [payment(null, 1000)],
    }))
    const state = jobPaymentState(j, [], invoices)
    expect(state.paid).toBe(5000)
    expect(state.settled).toBe(true)
  })

  it('reports a half-run plan as partial, not as unpaid', () => {
    const j = job({ hind: 5000 })
    const invoices = [1, 2, 3, 4, 5].map(no => instalmentInvoice(j.id, no, 1000))
    invoices[0] = { ...invoices[0], payments: [payment(null, 1000)] }
    invoices[1] = { ...invoices[1], payments: [payment(null, 1000)] }

    const state = jobPaymentState(j, [], invoices)
    expect(state.paid).toBe(2000)
    expect(state.partial).toBe(true)
    expect(state.settled).toBe(false)
  })
})
