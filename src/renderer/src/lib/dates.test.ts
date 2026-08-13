import { describe, it, expect } from 'vitest'
import { toDate, fmtDate, isValidTime, normalizeDateTime, toLocalInput, fromLocalInput } from './dates'

// Not hypothetical: these are what the old Kell field wrote into
// `jobs.valmis_aeg`, one per keystroke, on the way to "12:00".
//
// parseISO is lenient about some of them — '…T12' reads as 12:00 and a bare
// '…T' as midnight — so only these actually produced an Invalid Date. Three of
// the five states between an empty field and "12:00" are in here, which is why
// this was not a rare thing to hit.
const CRASHING = [
  '2026-08-12T1', '2026-08-12T1:', '2026-08-12T12:', '2026-08-12T12:0', '2026-08-12T25:00',
]
/** Parsed, but not what anyone typed on purpose. */
const LENIENT = ['2026-08-12T12', '2026-08-12T']

describe('toDate', () => {
  it('reads a stored deadline', () => {
    expect(toDate('2026-08-12T17:00')?.getHours()).toBe(17)
  })

  it('returns null for absent values rather than an Invalid Date', () => {
    expect(toDate(null)).toBeNull()
    expect(toDate(undefined)).toBeNull()
    expect(toDate('')).toBeNull()
  })

  it.each(CRASHING)('returns null for the half-typed value %s', v => {
    expect(toDate(v)).toBeNull()
  })
})

describe('fmtDate', () => {
  it('formats what it can', () => {
    expect(fmtDate('2026-08-12T17:00', 'dd.MM.yyyy')).toBe('12.08.2026')
  })

  // The whole point. date-fns throws RangeError('Invalid time value') here, and
  // one such row used to take down every view that rendered it.
  it.each(CRASHING)('falls back instead of throwing on %s', v => {
    expect(() => fmtDate(v, 'dd.MM.yyyy HH:mm')).not.toThrow()
    expect(fmtDate(v, 'dd.MM.yyyy HH:mm')).toBe('—')
  })
})

describe('isValidTime', () => {
  it('accepts a complete HH:mm', () => {
    expect(isValidTime('00:00')).toBe(true)
    expect(isValidTime('23:59')).toBe(true)
  })

  it('rejects partials and out-of-range values', () => {
    for (const t of ['1', '12', '12:', '24:00', '12:60', '', ':30']) {
      expect(isValidTime(t)).toBe(false)
    }
  })
})

describe('normalizeDateTime', () => {
  it('keeps a good value untouched', () => {
    expect(normalizeDateTime('2026-08-12T17:00')).toBe('2026-08-12T17:00')
  })

  // A date the user definitely meant, with a time they did not finish typing:
  // the date is kept and the time falls back to the same noon default the
  // deadline field uses. Dropping the whole deadline would lose real intent.
  it.each([...CRASHING, ...LENIENT])('repairs the time but keeps the date in %s', v => {
    expect(normalizeDateTime(v)).toBe('2026-08-12T12:00')
  })

  it('drops values with no usable date', () => {
    expect(normalizeDateTime('')).toBeNull()
    expect(normalizeDateTime(null)).toBeNull()
    expect(normalizeDateTime('rämps')).toBeNull()
    expect(normalizeDateTime('T17:00')).toBeNull()
  })
})

describe('toDate — leniency', () => {
  // Postgres/PostgREST can return a space instead of 'T'. parseISO rejects it,
  // the Date constructor does not, and several call sites used the latter
  // before this helper existed.
  it('accepts the space-separated Postgres form', () => {
    expect(toDate('2026-08-12 17:00:00+00')?.getTime()).toBeTypeOf('number')
  })

  it('accepts a full PostgREST timestamptz', () => {
    expect(toDate('2026-08-12T17:00:00+00:00')?.getTime()).toBeTypeOf('number')
  })
})

describe('local input ⇄ stored instant', () => {
  // The bug this pair exists for: a 15:00 deadline typed in Tallinn was stored
  // naive, read by Postgres as 15:00 UTC, and rendered back as 18:00.
  it('round-trips a wall time through the store', () => {
    const typed = '2026-08-13T15:00'
    const stored = fromLocalInput(typed)
    expect(stored).toMatch(/Z$/)                 // a real instant, offset included
    expect(toLocalInput(stored)).toBe(typed)     // same wall time back
  })

  it('keeps the wall time across a DST boundary', () => {
    for (const typed of ['2026-01-15T15:00', '2026-08-13T15:00']) {
      expect(toLocalInput(fromLocalInput(typed))).toBe(typed)
    }
  })

  it('treats absent and unreadable values as empty rather than throwing', () => {
    expect(toLocalInput(null)).toBe('')
    expect(toLocalInput('2026-08-12T12:')).toBe('')
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('rämps')).toBeNull()
  })
})
