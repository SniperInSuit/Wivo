import { describe, it, expect, vi, beforeEach } from 'vitest'

// A fake PostgREST builder: records every call, answers with the rows given.
const calls: string[][] = []
let rows: Record<string, unknown[]> = {}
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const log: string[] = [`from:${table}`]
      calls.push(log)
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'is', 'limit', 'in', 'ilike', 'order', 'eq']) {
        b[m] = (...a: unknown[]) => { log.push(`${m}:${a.map(x => JSON.stringify(x)).join(',')}`); return b }
      }
      b.then = (ok: (v: unknown) => void) => {
        const key = log.find(l => l.startsWith('in:') || l.startsWith('ilike:')) ?? ''
        ok({ data: rows[key] ?? [], error: null })
      }
      return b
    },
  },
}))

import { searchJobs } from './useJobSearch'

beforeEach(() => { calls.length = 0; rows = {} })

describe('searchJobs asks the database', () => {
  it('for the exact code, codes containing it and patient names; never deleted; capped', async () => {
    await searchJobs(' tal260042 ')
    expect(calls).toHaveLength(3)
    for (const c of calls) {
      expect(c[0]).toBe('from:jobs')
      expect(c).toContain('is:"deleted_at",null')
      expect(c).toContain('limit:20')
    }
    expect(calls[0]).toContain('in:"job_code",["TAL-26-0042"]')
    expect(calls[1]).toContain('ilike:"job_code","%tal260042%"')
    expect(calls[2]).toContain('ilike:"patsient","%tal260042%"')
  })

  it('skips the exact query when the text cannot be a code', async () => {
    await searchJobs('Mari')
    expect(calls).toHaveLength(2)
    expect(calls.some(c => c.some(l => l.startsWith('in:')))).toBe(false)
  })

  it('returns the exact code first, each job once', async () => {
    const exact = { id: 'a', job_code: 'TAL-26-0042', patsient: 'X', created_at: '2026-01-01' }
    const near = { id: 'b', job_code: 'TAL-26-00420', patsient: 'Y', created_at: '2026-11-01' }
    rows['in:"job_code",["TAL-26-0042"]'] = [exact]
    rows['ilike:"job_code","%TAL-26-0042%"'] = [near, exact]
    const r = await searchJobs('TAL-26-0042')
    expect(r.map(j => j.id)).toEqual(['a', 'b'])
  })

  it('asks nothing for an empty box', async () => {
    expect(await searchJobs('  ')).toEqual([])
    expect(calls).toHaveLength(0)
  })
})
