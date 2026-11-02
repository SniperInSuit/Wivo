import { describe, it, expect } from 'vitest'
import { phoneSessionExpired, PHONE_SESSION_HOURS } from './session'

const H = 3_600_000

describe('phoneSessionExpired', () => {
  it('a sign-in lasts 12 hours on the phone', () => {
    const t0 = 1_000_000_000_000
    expect(PHONE_SESSION_HOURS).toBe(12)
    expect(phoneSessionExpired(t0, t0 + 11.9 * H)).toBe(false)
    expect(phoneSessionExpired(t0, t0 + 12 * H)).toBe(true)
  })

  it('no record, garbage, or a time in the future (a changed clock) means sign in again', () => {
    expect(phoneSessionExpired(null, Date.now())).toBe(true)
    expect(phoneSessionExpired(Number.NaN, Date.now())).toBe(true)
    expect(phoneSessionExpired(Date.now() + 2 * H, Date.now())).toBe(true)
  })
})
