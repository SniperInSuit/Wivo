import './_domStub'
import { describe, it, expect } from 'vitest'
import { debtors, debtBuckets } from './debtors'
import type { Job } from '../types/job'
import type { InvoiceFull, Payment } from '../types/invoice'

const TODAY = '2026-09-02'

const job = (over: Partial<Job>): Job => ({
  id: 'j1', status: 'valmis', kuupaev: '2026-06-01', patsient: 'Mari Maasikas',
  patient_id: null, customer_id: null, customer_ref: null,
  delivery_status: 'labor', delivered_at: null,
  too: 'Kroon', kirjeldus: '', materjal: '', masina: '', print_id: '', disain_id: '',
  varv: '', kondivarv: '', hambad: '11', work_items: [], revisions: [], markused: [],
  extras: [], extra_costs: [], valmis_aeg: null, valmis_kuupaev: '2026-06-01',
  kiirtoo: false, mudel: false, hind: 100, disain_hind: null, makstud: false,
  makse_kuupaev: null, assigned_to: null, designed_by: null,
  created_at: '', updated_at: '',
  ...over,
} as Job)

const invoice = (over: Partial<InvoiceFull>): InvoiceFull => ({
  id: 'i1', clinic_id: 'c', number: '2026-0001', patient_id: null,
  patsient: 'Mari Maasikas', customer_id: null, bill_to_kind: 'patient',
  period_start: null, period_end: null, status: 'saadetud',
  issue_date: '2026-06-05', due_date: '2026-06-19', vat_rate: 22,
  net_total: 100, vat_total: 22, gross_total: 122, note: null,
  payment_plan_id: null, instalment_no: null, sent_at: null, send_error: null,
  created_at: '', updated_at: '',
  lines: [], payments: [],
  ...over,
} as InvoiceFull)

const line = (jobId: string, price: number) => ({
  id: crypto.randomUUID(), invoice_id: 'i1', job_id: jobId, revision_id: null,
  description: 'Kroon', qty: 1, unit_price: price, sort_order: 0, created_at: '',
})

const payment = (over: Partial<Payment>): Payment => ({
  id: crypto.randomUUID(), clinic_id: 'c', invoice_id: null, job_id: null,
  amount: 0, method: 'ulekanne', paid_at: '2026-07-01', reference: null,
  note: null, recorded_by: null, created_at: '',
  ...over,
} as Payment)

const run = (over: Partial<Parameters<typeof debtors>[0]> = {}) =>
  debtors({ jobs: [], payments: [], invoices: [], today: TODAY, customers: [], ...over })

describe('debtors — who owes what', () => {
  it('leaves a fully paid job out entirely', () => {
    const r = run({ jobs: [job({ makstud: true })] })
    expect(r.rows).toHaveLength(0)
    expect(r.outstanding).toBe(0)
  })

  it('counts a part payment as a part payment, not as nothing', () => {
    // The complaint this list exists for: "mõni osaliselt maksab".
    const r = run({
      jobs: [job({ id: 'j1' })],
      payments: [payment({ job_id: 'j1', amount: 40 })],
    })
    expect(r.rows[0].paid).toBe(40)
    expect(r.rows[0].outstanding).toBe(60)
    expect(r.rows[0].partial).toBe(true)
  })

  it('groups by the paying customer when the job names one', () => {
    const r = run({
      jobs: [
        job({ id: 'a', customer_id: 'cust-1', hind: 100 }),
        job({ id: 'b', customer_id: 'cust-1', hind: 50 }),
      ],
      customers: [{ id: 'cust-1', name: 'Hambakliinik OÜ' }],
    })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].nimi).toBe('Hambakliinik OÜ')
    expect(r.rows[0].liik).toBe('klient')
    expect(r.rows[0].outstanding).toBe(150)
    expect(r.rows[0].jobs).toBe(2)
  })

  it('falls back to the patient when no customer is named', () => {
    const r = run({ jobs: [job({ patsient: 'Mari Maasikas' })] })
    expect(r.rows[0].liik).toBe('patsient')
    expect(r.rows[0].nimi).toBe('Mari Maasikas')
  })

  it('sorts the worst overdue first — a chasing list is read from the top', () => {
    const r = run({
      jobs: [
        job({ id: 'a', patsient: 'Väike', hind: 20 }),
        job({ id: 'b', patsient: 'Suur', hind: 900 }),
      ],
      invoices: [invoice({ id: 'i1', lines: [line('b', 900)], due_date: '2026-07-01' })],
    })
    expect(r.rows[0].nimi).toBe('Suur')
    expect(r.worst?.nimi).toBe('Suur')
  })
})

describe('debtors — the three ages of debt', () => {
  it('calls a passed due date overdue, and counts the days from it', () => {
    const r = run({
      jobs: [job({ id: 'j1' })],
      invoices: [invoice({ lines: [line('j1', 100)], due_date: '2026-08-03' })],
    })
    expect(r.overdue).toBe(100)
    expect(r.uninvoiced).toBe(0)
    expect(r.rows[0].oldestDue).toBe('2026-08-03')
    expect(r.rows[0].daysLate).toBe(30)
  })

  it('does NOT call uninvoiced work overdue', () => {
    // Nobody was ever sent a bill. That is our omission, not their lateness —
    // and putting them on a chasing list for it would be a false accusation.
    const r = run({ jobs: [job({ id: 'j1' })] })
    expect(r.uninvoiced).toBe(100)
    expect(r.overdue).toBe(0)
    expect(r.rows[0].daysLate).toBe(0)
  })

  it('keeps an in-date invoice out of the overdue figure', () => {
    const r = run({
      jobs: [job({ id: 'j1' })],
      invoices: [invoice({ lines: [line('j1', 100)], due_date: '2026-12-31' })],
    })
    expect(r.notYetDue).toBe(100)
    expect(r.overdue).toBe(0)
  })

  it('treats an invoice with no due date as issued but never late', () => {
    const r = run({
      jobs: [job({ id: 'j1' })],
      invoices: [invoice({ lines: [line('j1', 100)], due_date: null })],
    })
    expect(r.notYetDue).toBe(100)
    expect(r.overdue).toBe(0)
    expect(r.uninvoiced).toBe(0)
  })

  it('sends a cancelled invoice’s job back to uninvoiced', () => {
    // A cancelled invoice is not a bill. The work is still owed for, but it is
    // owed for as unbilled work, and nothing about it is late.
    const r = run({
      jobs: [job({ id: 'j1' })],
      invoices: [invoice({
        status: 'tuhistatud', lines: [line('j1', 100)], due_date: '2026-01-01',
      })],
    })
    expect(r.overdue).toBe(0)
    expect(r.uninvoiced).toBe(100)
  })

  it('splits one debtor’s balance across all three ages', () => {
    const r = run({
      jobs: [
        job({ id: 'a', patsient: 'Mari', hind: 100 }),
        job({ id: 'b', patsient: 'Mari', hind: 200 }),
        job({ id: 'c', patsient: 'Mari', hind: 300 }),
      ],
      invoices: [
        invoice({ id: 'i1', lines: [line('a', 100)], due_date: '2026-08-01' }),
        invoice({ id: 'i2', lines: [line('b', 200)], due_date: '2026-12-01' }),
      ],
    })
    const row = r.rows[0]
    expect(row.overdue).toBe(100)
    expect(row.notYetDue).toBe(200)
    expect(row.uninvoiced).toBe(300)
    expect(row.outstanding).toBe(600)
  })
})

describe('debtBuckets — how old the overdue money is', () => {
  it('bands by days late, measured from the due date', () => {
    const stats = run({
      jobs: [
        job({ id: 'a', patsient: 'Uus', hind: 100 }),
        job({ id: 'b', patsient: 'Vana', hind: 500 }),
      ],
      invoices: [
        invoice({ id: 'i1', lines: [line('a', 100)], due_date: '2026-08-20' }), // 13 p
        invoice({ id: 'i2', lines: [line('b', 500)], due_date: '2026-01-02' }), // 243 p
      ],
    })
    const b = debtBuckets(stats)
    expect(b.find(x => x.label === '1–30 p')?.amount).toBe(100)
    expect(b.find(x => x.label === '90+ p')?.amount).toBe(500)
    expect(b.find(x => x.label === '31–60 p')?.amount).toBe(0)
  })

  it('is all zeros when nothing has been billed late', () => {
    const stats = run({ jobs: [job({})] })
    expect(debtBuckets(stats).every(b => b.amount === 0)).toBe(true)
  })
})
