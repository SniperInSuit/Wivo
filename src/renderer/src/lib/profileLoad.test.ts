/**
 * Which refusal means "update Wivo", and which means something else.
 *
 * Worth testing because getting it wrong is worse than the silence it
 * replaces: telling someone mid-sign-in to update the app, when the only
 * thing missing is their second factor, sends them to reinstall software that
 * was never the problem.
 */
import { describe, it, expect } from 'vitest'
import { classifyProfileError, meansAppIsBehind, worthShowing } from './profileLoad'

describe('classifyProfileError', () => {
  it('calls a revoked table-wide SELECT a schema mismatch', () => {
    // The one that actually happened: sql/117 revoked it, and a build still
    // asking for `select *` reads no profile at all.
    expect(classifyProfileError({ code: '42501', message: 'permission denied' })).toBe('schema')
  })

  it('calls a column or table this build names and the schema lost a mismatch', () => {
    expect(classifyProfileError({ code: '42703' })).toBe('schema')
    expect(classifyProfileError({ code: '42P01' })).toBe('schema')
    expect(classifyProfileError({ code: 'PGRST204' })).toBe('schema')
  })

  it('calls a bare 403 a schema mismatch too', () => {
    expect(classifyProfileError({ status: 403 })).toBe('schema')
  })

  it('REFUSES to call the second factor a schema mismatch', () => {
    // sql/098 refuses nearly everything before it, and the sign-in that
    // follows loads the profile. "Update Wivo" here would be a lie, and the
    // person would act on it.
    expect(classifyProfileError({ hint: 'mfa_required', code: '42501' })).toBe('mfa')
  })

  it('calls an empty result missing, not refused', () => {
    expect(classifyProfileError({ code: 'PGRST116' })).toBe('missing')
  })

  it('calls no code and no status offline', () => {
    expect(classifyProfileError({ message: 'Failed to fetch' })).toBe('offline')
  })

  it('does not guess at anything else', () => {
    expect(classifyProfileError({ code: '23505', status: 409 })).toBe('unknown')
    expect(classifyProfileError(null)).toBe('unknown')
    expect(classifyProfileError(undefined)).toBe('unknown')
  })
})

describe('meansAppIsBehind', () => {
  it('is true only for a schema mismatch', () => {
    expect(meansAppIsBehind('schema')).toBe(true)
    for (const f of ['missing', 'mfa', 'offline', 'unknown'] as const) {
      expect(meansAppIsBehind(f), f).toBe(false)
    }
  })
})

describe('worthShowing', () => {
  it('stays quiet during the second factor and speaks for the rest', () => {
    expect(worthShowing('mfa')).toBe(false)
    for (const f of ['schema', 'missing', 'offline', 'unknown'] as const) {
      expect(worthShowing(f), f).toBe(true)
    }
  })
})
