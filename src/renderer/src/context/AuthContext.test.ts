/**
 * The clinic's details, loaded at sign-in. Before the second factor the
 * database refuses them (sql/098) and they are loaded again after it: that
 * refusal is expected, so it never reaches the error log or the debug
 * console as an error. Any other failure still does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const single = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ single }) }) }) },
}))
const { fetchClinic } = await import('./AuthContext')

describe('loading the clinic at sign-in', () => {
  const logged = vi.fn()
  let original: typeof console.error
  beforeEach(() => { original = console.error; console.error = logged; logged.mockReset() })
  afterEach(() => { console.error = original })

  it('refused before the second factor: no error logged', async () => {
    single.mockResolvedValue({ data: null, error: { code: '42501', message: 'Sign in with your second factor first', hint: 'mfa_required' } })
    expect(await fetchClinic('c1')).toBeNull()
    expect(logged).not.toHaveBeenCalled()
  })

  it('any other failure: logged as an error', async () => {
    single.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } })
    expect(await fetchClinic('c1')).toBeNull()
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('kliiniku andmete'), 'no rows')
  })

  it('loaded', async () => {
    single.mockResolvedValue({ data: { id: 'c1', name: 'Kliinik' }, error: null })
    expect(await fetchClinic('c1')).toEqual({ id: 'c1', name: 'Kliinik' })
  })
})
