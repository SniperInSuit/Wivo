import { describe, it, expect } from 'vitest'
import { backupName, describeDevice, securityErrorText, SecurityError } from './accountSecurity'
import { t } from '@/lib/i18n'

describe('backupName', () => {
  it('the next free "Wivo N", whatever the case or spacing of the names taken', () => {
    expect(backupName(['Wivo'])).toBe('Wivo 2')
    expect(backupName(['Wivo', 'wivo 2 ', 'Phone'])).toBe('Wivo 3')
    expect(backupName([])).toBe('Wivo 2')
  })
})

describe('describeDevice', () => {
  const cases: [string, ReturnType<typeof describeDevice>][] = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', { kind: 'iphone', browser: 'Safari' }],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1', { kind: 'ipad', browser: 'Chrome' }],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', { kind: 'android', browser: 'Chrome' }],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', { kind: 'mac', browser: 'Safari' }],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0', { kind: 'windows', browser: 'Edge' }],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', { kind: 'linux', browser: 'Firefox' }],
    ['', { kind: 'other', browser: null }],
  ]
  for (const [ua, expected] of cases) {
    it(`${expected.kind} · ${expected.browser}`, () => expect(describeDevice(ua)).toEqual(expected))
  }
  it('no user agent stored', () => expect(describeDevice(null)).toEqual({ kind: 'other', browser: null }))
})

describe('securityErrorText', () => {
  it('says what to do, in the interface language', () => {
    expect(securityErrorText(new SecurityError('wrong_code'))).toBe(t('mfa.wrongCode'))
    expect(securityErrorText(new SecurityError('wrong_password'))).toBe(t('security.wrongPassword'))
    expect(securityErrorText(new SecurityError('too_many_attempts'))).toBe(t('security.tooManyAttempts'))
    expect(securityErrorText(new SecurityError('mfa_required'))).toBe(t('security.needMfa'))
  })
  it('the database\'s own reason when it gave one', () => {
    expect(securityErrorText(new SecurityError('not_allowed', 'Another owner\'s two-factor sign-in cannot be reset')))
      .toBe('Another owner\'s two-factor sign-in cannot be reset')
    expect(securityErrorText(new SecurityError('not_allowed'))).toBe(t('security.notAllowed'))
  })
})
