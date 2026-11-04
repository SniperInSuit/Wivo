import { describe, it, expect } from 'vitest'
import { resetTarget, resetOutcome } from './passwordReset'

describe('what "Forgot password?" does with what was typed', () => {
  it('a real address gets a link', () => {
    expect(resetTarget('  mari@kliinik.ee ')).toEqual({ kind: 'email', email: 'mari@kliinik.ee' })
  })

  it('a bare username, a username at a clinic or a stand-in: the administrator resets it', () => {
    expect(resetTarget('tehnik')).toEqual({ kind: 'username' })
    expect(resetTarget('Tehnik Kask')).toEqual({ kind: 'username' })
    expect(resetTarget('tehnik@tal')).toEqual({ kind: 'username' })
    expect(resetTarget('tehnik.tal@nomail.wivodent.com')).toEqual({ kind: 'username' })
    expect(resetTarget('vana@example.com')).toEqual({ kind: 'username' })
  })

  it('nothing, or an address cut short: not an address', () => {
    expect(resetTarget('   ')).toEqual({ kind: 'invalid' })
    expect(resetTarget('mari@')).toEqual({ kind: 'invalid' })
    expect(resetTarget('@kliinik')).toEqual({ kind: 'invalid' })
  })
})

describe('what the person is told after asking', () => {
  it('sent, whether or not the address has an account', () => {
    expect(resetOutcome(null)).toBe('sent')
    // GoTrue fails to send only for an account that exists: telling that apart would give it away.
    expect(resetOutcome({ name: 'AuthApiError', message: 'Error sending recovery email', status: 500 })).toBe('sent')
    expect(resetOutcome({ name: 'AuthApiError', message: 'For security purposes, you can only request this after 52 seconds.', status: 429 })).toBe('sent')
    expect(resetOutcome({ name: 'AuthRetryableFetchError', message: 'Gateway Timeout', status: 504 })).toBe('sent')
  })

  it('too many requests', () => {
    expect(resetOutcome({ name: 'AuthApiError', message: 'email rate limit exceeded', status: 429 })).toBe('too_often')
  })

  it('Wivo never reached: nothing was asked, so nothing is given away', () => {
    expect(resetOutcome({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 })).toBe('no_connection')
  })
})
