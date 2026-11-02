import { describe, it, expect } from 'vitest'
import { supabaseTarget, PRODUCTION_REF } from './testCopy'

const TEST_URL = 'https://jhqyvancrzykxhzwnost.supabase.co'
const PROD_URL = `https://${PRODUCTION_REF}.supabase.co`

describe('supabaseTarget: test mode never reaches production', () => {
  it('outside test mode: the values as they are', () => {
    expect(supabaseTarget('development', PROD_URL, 'k')).toEqual({ url: PROD_URL, key: 'k', problem: null })
  })

  it('test mode with the test copy: connected', () => {
    expect(supabaseTarget('test', TEST_URL, 'k')).toEqual({ url: TEST_URL, key: 'k', problem: null })
  })

  it('test mode pointed at production (or falling back to .env): refused, nowhere', () => {
    const r = supabaseTarget('test', PROD_URL, 'k')
    expect(r.problem).toBe('production')
    expect(r.url).not.toContain(PRODUCTION_REF)
    expect(r.key).not.toBe('k')
  })

  it('test mode with an empty .env.test: not connected', () => {
    for (const [u, k] of [['', 'k'], [TEST_URL, ''], [undefined, undefined], ['  ', 'k']] as const) {
      const r = supabaseTarget('test', u, k)
      expect(r.problem).toBe('missing')
      expect(r.url).toBe('http://127.0.0.1:9')
    }
  })
})
