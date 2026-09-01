/**
 * The new metric modules.
 *
 * Deliberately in one file and deliberately NOT importing `lib/finance.ts`:
 * that module pulls in the Supabase client through the settings store, and
 * @supabase/realtime-js needs a native WebSocket that Node 20 does not have —
 * so `finance.test.ts` cannot even be collected on this machine. Everything
 * tested here is reachable without it.
 *
 * The cases are the ones that would ship a confident wrong number: a zero
 * denominator, a cancelled invoice still counted as debt, a job judged on time
 * because nobody set it a deadline.
 */
import { describe, it, expect } from 'vitest'
import type { Job, Revision } from '../types/job'
import type { InvoiceFull, Payment } from '../types/invoice'
import { invoiceMetrics } from './invoiceMetrics'
import { unitEconomics, workingDaysIn } from './unitEconomics'
import { turnaroundStats, onTimeStats, deliveryStats, weekdayLoad } from './throughput'
import { customerStats, UNASSIGNED } from './customerStats'
import { funFacts } from './funFacts'

const TODAY = '2026-09-30'
const PERIOD = { start: '2026-09-01', end: '2026-09-30' }
const DONE = 'valmis'

let seq = 0

function job(over: Partial<Job> = {}): Job {
  seq++
  return {
    id: `job-${seq}`,
    status: DONE,
    kuupaev: '2026-09-01',
    patsient: `Patsient ${seq}`,
    patient_id: null,
    customer_id: null,
    customer_ref: null,
    too: 'Kroon',
    materjal: 'Crown HT A2',
    masina: null,
    print_id: null,
    disain_id: null,
    varv: 'A2',
    hambad: '11,12',
    kirjeldus: null,
    valmis_aeg: null,
    valmis_kuupaev: '2026-09-05',
    kiirtoo: false,
    delivery_status: 'labor',
    delivered_at: null,
    work_items: [],
    revisions: [],
    markused: [],
    extras: [],
    extra_costs: [],
    hind: 100,
    disain_hind: null,
    makstud: false,
    makse_kuupaev: null,
    assigned_to: null,
    designed_by: null,
    ...over,
  } as Job
}

function payment(over: Partial<Payment> = {}): Payment {
  seq++
  return {
    id: `pay-${seq}`, clinic_id: 'c', invoice_id: 'i', job_id: null,
    amount: 100, method: 'ulekanne', paid_at: '2026-09-10',
    reference: null, note: null, recorded_by: null, created_at: '2026-09-10',
    ...over,
  } as Payment
}

function invoice(over: Partial<InvoiceFull> = {}): InvoiceFull {
  seq++
  return {
    id: `inv-${seq}`, clinic_id: 'c', number: `2026-${seq}`,
    patient_id: null, patsient: 'X', customer_id: null, bill_to_kind: 'patient',
    period_start: null, period_end: null,
    issue_date: '2026-09-01', due_date: '2026-09-15',
    status: 'saadetud', vat_rate: 0,
    net_total: 100, vat_total: 0, gross_total: 100,
    lines: [], payments: [],
    ...over,
  } as InvoiceFull
}

// ─────────────────────────────────────────────────────────────────────────────

describe('invoiceMetrics — võlgnevus ja laekumisaeg', () => {
  it('buckets debt by how long it has been overdue', () => {
    const m = invoiceMetrics([
      invoice({ due_date: '2026-10-10' }),                    // not due yet
      invoice({ due_date: '2026-10-10', gross_total: 50 }),   // not due yet
      invoice({ due_date: '2026-10-10', gross_total: 200 }),  // not due yet
      invoice({ due_date: '2026-09-10', gross_total: 300 }),  // 20 days late
      invoice({ due_date: '2026-08-20', gross_total: 400 }),  // 41 days late
      invoice({ due_date: '2026-05-01', gross_total: 500 }),  // 152 days late
    ], TODAY, PERIOD)

    expect(m.notDue).toBe(350)
    expect(m.aging.find(b => b.label === '1–30 p')!.amount).toBe(300)
    expect(m.aging.find(b => b.label === '31–60 p')!.amount).toBe(400)
    expect(m.aging.find(b => b.label === '90+ p')!.amount).toBe(500)
    expect(m.agingTotal).toBe(1200)
  })

  it('never counts a cancelled invoice as debt', () => {
    const m = invoiceMetrics(
      [invoice({ status: 'tuhistatud', due_date: '2026-01-01', gross_total: 999 })],
      TODAY, PERIOD,
    )
    expect(m.agingTotal).toBe(0)
    expect(m.notDue).toBe(0)
  })

  it('treats an invoice with no due date as not late rather than 150 days late', () => {
    const m = invoiceMetrics([invoice({ due_date: null, gross_total: 100 })], TODAY, PERIOD)
    expect(m.notDue).toBe(100)
    expect(m.agingTotal).toBe(0)
  })

  it('measures days to pay only on invoices actually settled in the window', () => {
    const m = invoiceMetrics([
      invoice({ issue_date: '2026-09-01', payments: [payment({ paid_at: '2026-09-11' })] }),
      invoice({ issue_date: '2026-09-01', payments: [payment({ paid_at: '2026-09-21' })] }),
      // Settled in August — outside the window, so it must not drag the average.
      invoice({ issue_date: '2026-08-01', payments: [payment({ paid_at: '2026-08-02' })] }),
      // Half paid: not settled, so not an observation of how long paying takes.
      invoice({ payments: [payment({ amount: 40 })] }),
    ], TODAY, PERIOD)
    expect(m.daysToPaySample).toBe(2)
    expect(m.daysToPay).toBe(15)
  })

  it('reports null, not zero, when nothing settled', () => {
    expect(invoiceMetrics([invoice()], TODAY, PERIOD).daysToPay).toBeNull()
  })

  it('sums VAT and sizes the average invoice over the period only', () => {
    const m = invoiceMetrics([
      invoice({ issue_date: '2026-09-02', net_total: 100, vat_total: 22 }),
      invoice({ issue_date: '2026-09-03', net_total: 300, vat_total: 66 }),
      invoice({ issue_date: '2026-08-30', net_total: 999, vat_total: 999 }),
    ], TODAY, PERIOD)
    expect(m.vat).toBe(88)
    expect(m.issuedCount).toBe(2)
    expect(m.averageInvoice).toBe(200)
  })
})

describe('unitEconomics — iga jagatis peab taluma nulli', () => {
  const fin = { overheadCost: 100 } as never
  const profit = { costs: 600, profit: 400, income: 1000, labour: 300, material: 200 } as never

  it('returns null for every ratio when there is nothing to divide by', () => {
    const empty = { money: 0, hambad: 0, tood: 0, yksused: 0 } as never
    const u = unitEconomics(empty, fin, { ...(profit as object), income: 0 } as never, PERIOD, TODAY)
    expect(u.revenuePerTooth).toBeNull()
    expect(u.costPerTooth).toBeNull()
    expect(u.marginPerTooth).toBeNull()
    expect(u.profitPerJob).toBeNull()
    expect(u.labourSharePct).toBeNull()
    // Never NaN, never a confident 0.
    expect(Object.values(u).some(v => typeof v === 'number' && Number.isNaN(v))).toBe(false)
  })

  it('divides profit by JOBS and revenue by units, not by each other', () => {
    const m = { money: 2000, hambad: 100, tood: 8, yksused: 10 } as never
    const u = unitEconomics(m, fin, profit, PERIOD, TODAY)
    expect(u.revenuePerTooth).toBe(20)
    expect(u.costPerTooth).toBe(6)
    expect(u.marginPerTooth).toBe(14)
    expect(u.profitPerJob).toBe(50)     // 400 / 8 tööd
    expect(u.revenuePerJob).toBe(200)   // 2000 / 10 ühikut
  })

  it('expresses cost shares against income', () => {
    const m = { money: 1000, hambad: 10, tood: 1, yksused: 1 } as never
    const u = unitEconomics(m, fin, profit, PERIOD, TODAY)
    expect(u.labourSharePct).toBe(30)
    expect(u.materialSharePct).toBe(20)
    expect(u.overheadSharePct).toBe(10)
  })

  it('counts Mon–Fri and stops at today', () => {
    // 1.–30. september 2026 has 22 working days; clamped to the 10th it has 8.
    expect(workingDaysIn('2026-09-01', '2026-09-30', '2026-09-30')).toBe(22)
    expect(workingDaysIn('2026-09-01', '2026-09-30', '2026-09-10')).toBe(8)
    expect(workingDaysIn('2026-09-30', '2026-09-01', TODAY)).toBe(0)
  })
})

describe('throughput — plaan ja tegelikkus', () => {
  it('measures to the completion date, never to the deadline', () => {
    const t = turnaroundStats([
      job({ kuupaev: '2026-09-01', valmis_kuupaev: '2026-09-03', valmis_aeg: '2026-09-20' }),
      job({ kuupaev: '2026-09-01', valmis_kuupaev: '2026-09-11' }),
    ])
    // 2 and 10 days — the 19-day deadline must not appear anywhere.
    expect(t.average).toBe(6)
    expect(t.median).toBe(6)
    expect(t.fastest!.days).toBe(2)
    expect(t.slowest!.days).toBe(10)
  })

  it('reports jobs it could not measure instead of dropping them', () => {
    const t = turnaroundStats([job(), job({ valmis_kuupaev: null })])
    expect(t.coverage).toEqual({ total: 2, covered: 1, missing: 1 })
  })

  it('excludes deadline-less jobs from on-time rather than calling them on time', () => {
    const o = onTimeStats([
      job({ valmis_aeg: '2026-09-10', valmis_kuupaev: '2026-09-08' }),   // early
      job({ valmis_aeg: '2026-09-10', valmis_kuupaev: '2026-09-10' }),   // exactly
      job({ valmis_aeg: '2026-09-10', valmis_kuupaev: '2026-09-14' }),   // 4 late
      job({ valmis_aeg: null }),                                         // unjudgeable
    ])
    expect(o.onTime).toBe(2)
    expect(o.late).toBe(1)
    expect(o.ratePct).toBe(66.7)
    expect(o.averageDaysLate).toBe(4)
    expect(o.coverage.missing).toBe(1)
  })

  it('reports no on-time rate at all when nothing carries a deadline', () => {
    expect(onTimeStats([job({ valmis_aeg: null })]).ratePct).toBeNull()
  })

  it('counts delivery states and the wait between finished and handed over', () => {
    const d = deliveryStats([
      job({ delivery_status: 'labor' }),
      job({ delivery_status: 'teel' }),
      job({
        delivery_status: 'yle_antud',
        valmis_kuupaev: '2026-09-05', delivered_at: '2026-09-08',
      }),
    ])
    expect(d.buckets.map(b => b.count)).toEqual([1, 1, 1])
    expect(d.waiting).toBe(1)
    expect(d.averageLagDays).toBe(3)
  })

  it('starts the week on Monday', () => {
    // 2026-09-07 is a Monday, 2026-09-13 a Sunday.
    const rows = weekdayLoad([job({ kuupaev: '2026-09-07' })], [job({ valmis_kuupaev: '2026-09-13' })])
    expect(rows[0]).toEqual({ weekday: 'E', received: 1, finished: 0 })
    expect(rows[6]).toEqual({ weekday: 'P', received: 0, finished: 1 })
  })
})

describe('customerStats', () => {
  const CUSTOMERS = [
    { id: 'c1', name: 'Kliinik Üks', created_at: '2025-01-01', archived_at: null },
    { id: 'c2', name: 'Kliinik Kaks', created_at: '2025-01-01', archived_at: null },
    { id: 'c3', name: 'Arhiveeritud', created_at: '2025-01-01', archived_at: '2026-01-01' },
  ]

  it('keeps jobs with no customer instead of dropping them', () => {
    const s = customerStats(
      [job({ customer_id: 'c1', hind: 300 }), job({ customer_id: null, hind: 100 })],
      [], [], CUSTOMERS, PERIOD, TODAY,
    )
    const none = s.rows.find(r => r.id === UNASSIGNED)
    expect(none?.name).toBe('Määramata')
    expect(none?.revenue).toBe(100)
    // …but "Määramata" is not a customer, so it is not counted as active.
    expect(s.active).toBe(1)
  })

  it('ranks by revenue and carries teeth and job counts', () => {
    const s = customerStats(
      [
        job({ customer_id: 'c1', hind: 100, hambad: '11' }),
        job({ customer_id: 'c2', hind: 900, hambad: '11,12,13' }),
      ],
      [], [], CUSTOMERS, PERIOD, TODAY,
    )
    expect(s.rows[0].name).toBe('Kliinik Kaks')
    expect(s.rows[0].teeth).toBe(3)
    expect(s.rows[1].jobs).toBe(1)
  })

  it('averages settlement days per customer', () => {
    const s = customerStats([], [], [
      invoice({ customer_id: 'c1', issue_date: '2026-09-01', payments: [payment({ paid_at: '2026-09-11' })] }),
      invoice({ customer_id: 'c1', issue_date: '2026-09-01', payments: [payment({ paid_at: '2026-09-21' })] }),
    ], CUSTOMERS, PERIOD, TODAY)
    expect(s.rows.find(r => r.id === 'c1')!.daysToPay).toBe(15)
  })

  it('calls a customer dormant only after the cutoff, and never an archived one', () => {
    const s = customerStats(
      [],
      [job({ customer_id: 'c1', kuupaev: '2026-09-20' })],   // recent
      [], CUSTOMERS, PERIOD, TODAY,
    )
    const ids = s.dormant.map(d => d.id)
    expect(ids).not.toContain('c1')   // ordered this month
    expect(ids).not.toContain('c3')   // archived
    expect(ids).toContain('c2')       // on the books, never ordered
  })
})

describe('funFacts', () => {
  const revision = (over: Partial<Revision> = {}): Revision =>
    ({ id: `r${++seq}`, ts: '2026-09-09', hambad: '21', reasons: ['Värv'], ...over }) as Revision

  it('counts every tooth, remakes included, and converts to mouths', () => {
    const f = funFacts([
      job({ hambad: '11,12,13,14,15,16,17,18' }),
      job({ hambad: '21,22,23,24,25,26,27,28', revisions: [revision({ hambad: '21,22' })] }),
    ], DONE)
    expect(f.teethAllTime).toBe(18)
    expect(f.mouthsAllTime).toBe(0.6)
    expect(f.teethPerJob).toBe(9)
  })

  it('finds the biggest job and the busiest day', () => {
    const f = funFacts([
      job({ hambad: '11,12', valmis_kuupaev: '2026-09-05', patsient: 'Väike' }),
      job({ hambad: '21,22,23,24', valmis_kuupaev: '2026-09-06', patsient: 'Suur' }),
      job({ hambad: '31,32', valmis_kuupaev: '2026-09-06' }),
    ], DONE)
    expect(f.biggestJob!.label).toBe('Suur')
    expect(f.biggestJob!.value).toBe(4)
    expect(f.busiestDay!.label).toBe('2026-09-06')
    expect(f.busiestDay!.value).toBe(6)
  })

  it('breaks the clean streak on a revision and remembers the longest run', () => {
    const f = funFacts([
      job({ valmis_kuupaev: '2026-09-01' }),
      job({ valmis_kuupaev: '2026-09-02' }),
      job({ valmis_kuupaev: '2026-09-03', revisions: [revision()] }),
      job({ valmis_kuupaev: '2026-09-04' }),
    ], DONE)
    expect(f.cleanStreak).toBe(2)
  })

  it('counts weekend finishes and rush share', () => {
    // 2026-09-12 is a Saturday.
    const f = funFacts([
      job({ valmis_kuupaev: '2026-09-12' }),
      job({ valmis_kuupaev: '2026-09-14', kiirtoo: true }),
    ], DONE)
    expect(f.weekendJobs).toBe(1)
    expect(f.rushPct).toBe(50)
  })

  it('names the favourite shade and the most loyal patient', () => {
    const f = funFacts([
      job({ varv: 'A2', patsient: 'Mari' }),
      job({ varv: 'A2', patsient: 'Mari' }),
      job({ varv: 'B1', patsient: 'Jüri' }),
    ], DONE)
    expect(f.favouriteShade).toEqual({ label: 'A2', value: 2 })
    expect(f.loyalPatient!.value).toBe(2)
  })

  it('survives an empty lab without inventing anything', () => {
    const f = funFacts([], DONE)
    expect(f.teethAllTime).toBe(0)
    expect(f.busiestDay).toBeNull()
    expect(f.biggestJob).toBeNull()
    expect(f.daysInBusiness).toBeNull()
    expect(f.teethPerJob).toBeNull()
  })
})
