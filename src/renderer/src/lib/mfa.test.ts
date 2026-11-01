import { describe, it, expect } from 'vitest'
import { nextMfaStep } from './mfa'

describe('nextMfaStep', () => {
  it('signed in with a second factor: nothing to do', () => {
    expect(nextMfaStep({ currentLevel: 'aal2', nextLevel: 'aal2' }, true)).toBe('ok')
  })
  it('has an authenticator but signed in with the password only: enter the code', () => {
    expect(nextMfaStep({ currentLevel: 'aal1', nextLevel: 'aal2' }, true)).toBe('verify')
  })
  it('no authenticator yet: must add one', () => {
    expect(nextMfaStep({ currentLevel: 'aal1', nextLevel: 'aal1' }, true)).toBe('enroll')
  })
  it('the project cannot do TOTP: let them in rather than lock everyone out', () => {
    expect(nextMfaStep({ currentLevel: 'aal1', nextLevel: 'aal1' }, false)).toBe('disabled')
  })
  it('a code is still required even when enrolment would be unavailable', () => {
    expect(nextMfaStep({ currentLevel: 'aal1', nextLevel: 'aal2' }, false)).toBe('verify')
  })
})
