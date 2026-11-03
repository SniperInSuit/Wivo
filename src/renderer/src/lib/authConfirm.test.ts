import { describe, it, expect } from 'vitest'
import { isConfirmPath, parseConfirm, isLinkDead, passwordProblem, linkLanguage } from './authConfirm'

describe('the confirm link', () => {
  it('is recognised on its path', () => {
    expect(isConfirmPath('/auth/confirm')).toBe(true)
    expect(isConfirmPath('/auth/confirm/')).toBe(true)
    expect(isConfirmPath('/auth')).toBe(false)
    expect(isConfirmPath('/job/x')).toBe(false)
  })

  it('carries one of three types and a token', () => {
    expect(parseConfirm('?type=invite&token_hash=abc%2B1')).toEqual({ type: 'invite', tokenHash: 'abc+1' })
    expect(parseConfirm('?type=recovery&token_hash=x')).toEqual({ type: 'recovery', tokenHash: 'x' })
    expect(parseConfirm('?type=email_change&token_hash=x')).toEqual({ type: 'email_change', tokenHash: 'x' })
    for (const bad of ['', '?type=invite', '?token_hash=x', '?type=signup&token_hash=x', `?type=invite&token_hash=${'x'.repeat(513)}`]) {
      expect(parseConfirm(bad)).toBeNull()
    }
  })

  it('may say its language', () => {
    expect(linkLanguage('?type=invite&token_hash=x&lang=ru')).toBe('ru')
    expect(linkLanguage('?lang=de')).toBeNull()
    expect(linkLanguage('')).toBeNull()
  })

  it('a used or expired link is told apart from other failures', () => {
    expect(isLinkDead({ code: 'otp_expired', message: 'Email link is invalid or has expired', status: 403 })).toBe(true)
    expect(isLinkDead({ message: 'Token has expired or is invalid' })).toBe(true)
    expect(isLinkDead({ message: 'Failed to fetch', status: 0 })).toBe(false)
    expect(isLinkDead(null)).toBe(false)
  })
})

describe('a new password', () => {
  it('is long enough and typed the same twice', () => {
    expect(passwordProblem('short', 'short')).toBe('tooShort')
    expect(passwordProblem('long enough 1', 'long enough 2')).toBe('differ')
    expect(passwordProblem('long enough 1', 'long enough 1')).toBeNull()
  })
})
