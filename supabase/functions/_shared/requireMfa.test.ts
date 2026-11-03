import { describe, it, expect } from 'vitest'
import { sessionHasMfa } from './requireMfa'

const answer = (data: unknown, error: unknown = null) => async () => ({ data, error })

describe('sessionHasMfa', () => {
  it('asks has_mfa and believes only a plain true', async () => {
    const asked: string[] = []
    expect(await sessionHasMfa(async fn => { asked.push(fn); return { data: true, error: null } })).toBe(true)
    expect(asked).toEqual(['has_mfa'])
    expect(await sessionHasMfa(answer(false))).toBe(false)
    expect(await sessionHasMfa(answer('true'))).toBe(false)
    expect(await sessionHasMfa(answer(null))).toBe(false)
  })

  it('says no on any error: refused (aal1, 403), or the call failing', async () => {
    expect(await sessionHasMfa(answer(true, { message: 'Sign in with your second factor first' }))).toBe(false)
    expect(await sessionHasMfa(async () => { throw new Error('network') })).toBe(false)
  })
})
