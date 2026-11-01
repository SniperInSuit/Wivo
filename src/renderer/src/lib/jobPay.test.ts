import { describe, it, expect } from 'vitest'
import type { Job } from '../types/job'
import type { WorkType } from '../config/workTypes'
import type { WorkerRate } from './earnings'
import { projectedJobPay } from './jobPay'

const TYPES: WorkType[] = [{ nimi: 'Kroon', hex: '#3B82F6' }]

const rate = (over: Partial<WorkerRate>): WorkerRate => ({
  id: 'r1', clinic_id: 'c', profile_id: 'tech', applies_to: 'too', work_type: null, priority: 0,
  kind: 'hammas', amount: 15, label: null, pay_revisions: false, auto_hours: false, hours_per_day: null,
  work_days: '12345', active_from: null, active_to: null, note: null,
  created_at: '2026-01-01', updated_at: '2026-01-01', ...over,
} as WorkerRate)

const job = (over: Partial<Job> = {}): Job => ({
  id: 'job-1', status: 'disain', kuupaev: '2026-11-01', patsient: 'X', patient_id: null, customer_id: null,
  customer_ref: null, too: 'Kroon', materjal: null, masina: null, print_id: null, disain_id: null,
  extra_costs: [], varv: null, hambad: '11,12,13', kirjeldus: null, valmis_aeg: null, valmis_kuupaev: null,
  kiirtoo: false, delivery_status: 'labor', delivered_at: null, work_items: [], revisions: [], markused: [],
  extras: [], hind: null, disain_hind: null, makstud: false, makse_kuupaev: null,
  assigned_to: 'tech', designed_by: null, created_at: '2026-11-01', updated_at: '2026-11-01', ...over,
} as Job)

const base = { profileId: 'tech', types: TYPES, doneStageKey: 'valmis', today: '2026-11-01' }

describe('projectedJobPay', () => {
  it('an unfinished job shows what it will pay: 3 teeth × 15 €', () => {
    expect(projectedJobPay({ ...base, job: job(), rates: [rate({})] }).amount).toBe(45)
  })

  it('the rush share applies, as on the payslip', () => {
    const j = job({ kiirtoo: true })
    expect(projectedJobPay({ ...base, job: j, rates: [rate({})], rushMultiplier: 1.5 }).amount).toBe(67.5)
  })

  it('someone else\'s job, or no rule: nothing', () => {
    expect(projectedJobPay({ ...base, job: job({ assigned_to: 'other' }), rates: [rate({})] }).amount).toBe(0)
    expect(projectedJobPay({ ...base, job: job(), rates: [] }).amount).toBe(0)
  })
})
