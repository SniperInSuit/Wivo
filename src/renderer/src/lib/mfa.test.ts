import { describe, it, expect } from 'vitest'
import { nextMfaStep, defaultAuthApp, groupKey, isWrongCode, isSessionGone, isMfaRefusal } from './mfa'

describe('the database asking for the second factor first (sql/098)', () => {
  it('is told by its hint, not its words', () => {
    expect(isMfaRefusal({ code: '42501', message: 'Sign in with your second factor first', hint: 'mfa_required' })).toBe(true)
    expect(isMfaRefusal({ code: '42501', message: 'permission denied for table clinics' })).toBe(false)
    expect(isMfaRefusal(null)).toBe(false)
    expect(isMfaRefusal('mfa_required')).toBe(false)
  })
})

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

describe('the setup screen', () => {
  it('explains Passwords first on an iPhone, Google Authenticator elsewhere', () => {
    expect(defaultAuthApp('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)')).toBe('apple')
    expect(defaultAuthApp('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('google')
    expect(defaultAuthApp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/32')).toBe('google')
  })

  it('prints the key in groups of four', () => {
    expect(groupKey('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')
    expect(groupKey('ABCDEF')).toBe('ABCD EF')
    expect(groupKey('AB CD')).toBe('ABCD')
  })

  it('tells a wrong code from a server problem', () => {
    expect(isWrongCode({ code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' })).toBe(true)
    expect(isWrongCode({ code: 'mfa_challenge_expired' })).toBe(true)
    expect(isWrongCode({ message: 'Invalid TOTP code entered' })).toBe(true)
    expect(isWrongCode({ message: 'Failed to fetch' })).toBe(false)
    expect(isWrongCode(null)).toBe(false)
  })
})

describe('isSessionGone', () => {
  it('a session the server ended: 403 session_not_found, or 401', () => {
    expect(isSessionGone({ status: 403, code: 'session_not_found' })).toBe(true)
    expect(isSessionGone({ status: 401 })).toBe(true)
    expect(isSessionGone({ code: 'session_not_found' })).toBe(true)
  })
  it('not a dropped connection or a server error', () => {
    expect(isSessionGone(null)).toBe(false)
    expect(isSessionGone({ message: 'Failed to fetch' })).toBe(false)
    expect(isSessionGone({ status: 0 })).toBe(false)
    expect(isSessionGone({ status: 500 })).toBe(false)
  })
})
