import { describe, it, expect } from 'vitest'
import { jobMatchesSearch, pickJobForSearch } from './jobSearch'
import type { Job } from '../types/job'

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id, patsient: 'Mari Maasikas', too: 'Kroon', hambad: '11,12', materjal: null,
  print_id: null, mudel_id: null, kirjeldus: null, customer_ref: null, job_code: null,
  ...over,
} as Job)

const JOBS = [
  job('a', { job_code: 'TAL-26-0042', hambad: '42' }),
  job('b', { job_code: 'TAL-26-0142' }),
  job('c', { job_code: 'TAL-26-0007', patsient: 'Jaan Tamm' }),
]

describe('the search finds the job code', () => {
  it('matches the code, in any case and with spaces', () => {
    expect(jobMatchesSearch(JOBS[0], 'tal-26-0042')).toBe(true)
    expect(jobMatchesSearch(JOBS[0], 'TAL 26 0042')).toBe(true)
    expect(jobMatchesSearch(JOBS[2], '0042')).toBe(false)
  })

  it('still matches everything it matched before', () => {
    expect(jobMatchesSearch(JOBS[2], 'tamm')).toBe(true)
    expect(jobMatchesSearch(job('x', { customer_ref: 'K-77' }), 'k-77')).toBe(true)
    expect(jobMatchesSearch(JOBS[0], '')).toBe(true)
  })
})

describe('Enter opens one job or says why not', () => {
  it('opens the whole code', () => {
    expect(pickJobForSearch(JOBS, ' tal-26-0042 ')).toEqual({ kind: 'job', job: JOBS[0] })
  })

  it('opens the only code containing the query', () => {
    expect(pickJobForSearch(JOBS, '0007')).toEqual({ kind: 'job', job: JOBS[2] })
  })

  it('does not guess between two codes', () => {
    // "42" is in both codes (and is a tooth on one of them).
    expect(pickJobForSearch(JOBS, '42')).toEqual({ kind: 'many', count: 2 })
  })

  it('opens the only job matching anything else', () => {
    expect(pickJobForSearch(JOBS, 'tamm')).toEqual({ kind: 'job', job: JOBS[2] })
  })

  it('reports nothing found', () => {
    expect(pickJobForSearch(JOBS, 'TAL-26-9999')).toEqual({ kind: 'none' })
  })

  it('does nothing on an empty box', () => {
    expect(pickJobForSearch(JOBS, '   ')).toBeNull()
  })
})
