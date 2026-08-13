import './_domStub'
import { describe, it, expect } from 'vitest'
import { calculateFinance } from './finance'
import type { Job } from '../types/job'

const base = (over: Partial<Job>): Job => ({
  id: 'j1', status: 'valmis', kuupaev: '2026-08-01', patsient: 'X',
  patient_id: null, customer_id: null, customer_ref: null,
  too: 'Kroon', materjal: null, masina: null, print_id: null, disain_id: null,
  varv: null, hambad: '', kirjeldus: null, valmis_aeg: null,
  valmis_kuupaev: '2026-08-10', kiirtoo: false, delivery_status: 'labor',
  delivered_at: null, work_items: [], revisions: [], markused: [], extras: [],
  extra_costs: [], hind: 1000, disain_hind: null, makstud: false,
  makse_kuupaev: null, assigned_to: null, designed_by: null,
  created_at: '', updated_at: '', ...over,
} as Job)

const run = (jobs: Job[]) => calculateFinance({
  jobs, allJobs: jobs, invoices: [], payments: [], payouts: [], rates: [], hours: [],
  workers: [], types: [{ nimi: 'Kroon', hex: '#111' }, { nimi: 'Sild', hex: '#222' },
                       { nimi: 'Kaitse', hex: '#333' }] as never,
  materialCosts: {}, fixedCosts: [], overheads: [],
  doneStageKey: 'valmis', periodStart: '2026-08-01', periodEnd: '2026-08-31',
})

const income = (jobs: Job[]) => run(jobs).byWorkType.reduce((s, t) => s + t.income, 0)

/**
 * Tulu — the Rahandus headline — is Σ byWorkType.income.
 *
 * Its one invariant: it must equal the sum of the prices of the jobs it is
 * built from. Nothing else on that page is trustworthy if this is not.
 */
describe('Tulu = Σ byWorkType.income', () => {
  it('single-item job: whole price lands', () => {
    expect(income([base({ hambad: '11,12', hind: 1000 })])).toBe(1000)
  })

  // Regression: shares used to be normalised against job.hambad, which does
  // not equal what the items claim. Both directions cost real money on the
  // Rahandus page, so both stay pinned here.
  it('an item with no teeth does not drop its share of the price', () => {
    const j = base({
      hind: 1000, hambad: '11,12,13,14',
      work_items: [
        { id: 'a', too: 'Kroon', hambad: '11,12' },
        { id: 'b', too: 'Kaitse', hambad: '' },
      ],
    })
    expect(income([j])).toBe(1000)
  })

  it('items sharing an abutment tooth do not bill the price twice over', () => {
    // Bridge 14-16 and a crown on 14. job.hambad is DEDUPLICATED by toJobInput
    // (14,15,16), but the items still claim 3 + 1 = 4 teeth.
    const j = base({
      hind: 1000, hambad: '14,15,16',
      work_items: [
        { id: 'a', too: 'Sild', hambad: '14,15,16' },
        { id: 'b', too: 'Kroon', hambad: '14' },
      ],
    })
    expect(income([j])).toBe(1000)
  })

  it('Tulu counts ONLY jobs in the done stage', () => {
    const j = base({ hambad: '11', hind: 1000, status: 'varvimine' })
    expect(income([j])).toBe(0)
  })
})
