import { describe, it, expect } from 'vitest'
import type { Job } from '../types/job'
import type { PartnerJob } from '../hooks/usePartners'
import { phoneLists } from './jobLists'

const job = (o: Partial<Job>): Job => ({ id: crypto.randomUUID(), status: 'disain', patsient: 'Mari Maasikas', too: 'Kroon',
  valmis_aeg: null, assigned_to: null, designed_by: null, work_items: [], job_code: 'TAL-26-0001', ...o } as Job)
const shared = (o: Partial<PartnerJob>): PartnerJob => ({ job_id: crypto.randomUUID(), job_code: 'RIG-26-0007',
  owner_org_name: 'Riga', work_type: 'Sild', status: 'disain', due_at: null, ...o } as PartnerJob)

const base = { me: 'me', doneStage: 'valmis', query: '' }

describe('phoneLists', () => {
  it('"mine" is what is assigned to me or designed by me, unfinished; "active" is all unfinished', () => {
    const jobs = [
      job({ assigned_to: 'me' }), job({ designed_by: 'me' }),
      job({ work_items: [{ id: 'w', too: 'Kroon', hambad: '11', designed_by: 'me' }] }),
      job({ assigned_to: 'other' }), job({ assigned_to: 'me', status: 'valmis' }),
    ]
    const r = phoneLists({ ...base, jobs, shared: [] })
    expect(r.mine).toHaveLength(3)
    expect(r.active).toHaveLength(4)
  })

  it('search finds the job code everywhere, a patient name only on our own jobs', () => {
    const r = phoneLists({ ...base, jobs: [job({ job_code: 'TAL-26-0042', patsient: 'Jaan Tamm' })], shared: [shared({ job_code: 'RIG-26-0042' })], query: '0042' })
    expect(r.active).toHaveLength(1)
    expect(r.shared).toHaveLength(1)
    const byName = phoneLists({ ...base, jobs: [job({ patsient: 'Jaan Tamm' })], shared: [shared({ owner_org_name: 'Jaan' })], query: 'jaan' })
    expect(byName.active).toHaveLength(1)
    expect(byName.shared).toHaveLength(0)
  })

  it('a shared job is titled by its owner organisation, never a patient', () => {
    const r = phoneLists({ ...base, jobs: [], shared: [shared({})] })
    expect(r.shared[0].title).toBe('Riga')
  })

  it('earliest deadline first, none last', () => {
    const r = phoneLists({ ...base, jobs: [job({ valmis_aeg: null, job_code: 'C' }), job({ valmis_aeg: '2026-11-05', job_code: 'B' }), job({ valmis_aeg: '2026-11-03', job_code: 'A' })], shared: [] })
    expect(r.active.map(i => i.code)).toEqual(['A', 'B', 'C'])
  })
})
