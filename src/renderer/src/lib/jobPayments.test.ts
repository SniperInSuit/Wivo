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
import type { Payment } from '../types/invoice'
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
