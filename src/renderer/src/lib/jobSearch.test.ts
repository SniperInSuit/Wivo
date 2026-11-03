import { describe, it, expect } from 'vitest'
import {
  containsPattern, jobCodeCandidates, jobMatchesSearch, partialCodePattern, pickJobForSearch, rankSearchResults,
} from './jobSearch'
import type { Job } from '../types/job'

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id, patsient: 'Mari Maasikas', too: 'Kroon', hambad: '11,12', materjal: null,
  print_id: null, mudel_id: null, kirjeldus: null, customer_ref: null, job_code: null,
  created_at: '2026-11-01T00:00:00Z',
  ...over,
} as Job)

describe('the code, however it was typed', () => {
  it('puts the dashes back', () => {
    expect(jobCodeCandidates('tal-26-0042')).toEqual(['TAL-26-0042'])
    expect(jobCodeCandidates('TAL260042')).toEqual(['TAL-26-0042'])
    expect(jobCodeCandidates(' TAL-26-0042 ')).toEqual(['TAL-26-0042'])
    expect(jobCodeCandidates('tal 26-0042')).toEqual(['TAL-26-0042'])
    expect(jobCodeCandidates('TAL--26--0042')).toEqual(['TAL-26-0042'])
  })

  it('tries every split when the prefix ends in a digit', () => {
    expect(jobCodeCandidates('TAL2260042')).toEqual(['TAL-22-60042', 'TAL2-26-0042'])
  })

  it('a number past four digits is not padded', () => {
    // Every split that could be a code is asked for; only the real one exists.
    expect(jobCodeCandidates('TAL2612345')).toEqual(['TAL-26-12345', 'TAL2-61-2345'])
    expect(jobCodeCandidates('TAL26012345')).not.toContain('TAL-26-012345')
  })

  it('is not a code without a prefix and six digits', () => {
    expect(jobCodeCandidates('0042')).toEqual([])
    expect(jobCodeCandidates('Mari')).toEqual([])
    expect(jobCodeCandidates('TAL-26-004')).toEqual([])
  })

  it('takes the user’s % and _ literally', () => {
    expect(containsPattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%')
  })

  it('matches a partial code with or without its dash', () => {
    expect(partialCodePattern('26 0042')).toBe('%26-0042%')
    expect(partialCodePattern('260042')).toBe('%26-0042%')
    expect(partialCodePattern('0042')).toBe('%0042%')
  })
})

describe('the view filter finds the code', () => {
  it('matches the code, in any case, with or without dashes', () => {
    const j = job('a', { job_code: 'TAL-26-0042' })
    expect(jobMatchesSearch(j, 'tal-26-0042')).toBe(true)
    expect(jobMatchesSearch(j, 'TAL260042')).toBe(true)
    expect(jobMatchesSearch(j, 'TAL 26 0042')).toBe(true)
    expect(jobMatchesSearch(j, '0043')).toBe(false)
  })

  it('still matches everything it matched before', () => {
    expect(jobMatchesSearch(job('c', { patsient: 'Jaan Tamm' }), 'tamm')).toBe(true)
    expect(jobMatchesSearch(job('x', { customer_ref: 'K-77' }), 'k-77')).toBe(true)
    expect(jobMatchesSearch(job('x'), '')).toBe(true)
  })
})

describe('ranking the database’s answers', () => {
  const exact = job('a', { job_code: 'TAL-26-0042', created_at: '2026-01-01T00:00:00Z' })
  const other = job('b', { job_code: 'TAL-26-0142', created_at: '2026-10-01T00:00:00Z' })
  const byName = job('c', { job_code: 'TAL-26-0007', patsient: 'Tal Tamm', created_at: '2026-11-01T00:00:00Z' })

  it('puts the exact code first, then codes, then names; each job once', () => {
    const r = rankSearchResults([byName, other, exact, other], 'tal-26-0042')
    expect(r.map(j => j.id)).toEqual(['a'])
    expect(rankSearchResults([byName, other, exact], '0042').map(j => j.id)).toEqual(['a'])
  })

  it('newest first within a group', () => {
    const r = rankSearchResults([exact, other], '42')
    expect(r.map(j => j.id)).toEqual(['b', 'a'])
  })

  it('names come after codes', () => {
    const r = rankSearchResults([byName, exact], 'tal')
    expect(r.map(j => j.id)).toEqual(['c', 'a'])
  })

  it('stops at twenty', () => {
    const many = Array.from({ length: 30 }, (_, i) => job(`j${i}`, { patsient: 'Mari' }))
    expect(rankSearchResults(many, 'mari')).toHaveLength(20)
  })
})

describe('Enter opens one job or says why not', () => {
  const a = job('a', { job_code: 'TAL-26-0042' })
  const b = job('b', { job_code: 'TAL-26-0142' })

  it('opens the exact code even among others', () => {
    expect(pickJobForSearch([a, b], 'TAL260042')).toEqual({ kind: 'job', job: a })
  })

  it('opens the only result', () => {
    expect(pickJobForSearch([b], '0142')).toEqual({ kind: 'job', job: b })
  })

  it('does not guess between two', () => {
    expect(pickJobForSearch([a, b], '42')).toEqual({ kind: 'many', count: 2 })
  })

  it('reports nothing found, and does nothing on an empty box', () => {
    expect(pickJobForSearch([], 'TAL-26-9999')).toEqual({ kind: 'none' })
    expect(pickJobForSearch([a], '   ')).toBeNull()
  })
})
