/**
 * The schedule is money and dates, which is the pair this project has already
 * been bitten by twice: `sql/044` (a naive local time stored as UTC) and
 * v1.41.0 (six screens summing a total by hand). Both rules are written down
 * here rather than left in a comment.
 */
import { describe, it, expect } from 'vitest'
import {
  instalmentSchedule, scheduleProblems, scheduleTotal, splitAmount,
  type PaymentPlanShape,
} from './instalments'

const plan = (over: Partial<PaymentPlanShape> = {}): PaymentPlanShape => ({
  total: 5000,
  count: 5,
  firstIssue: '2026-09-02',
  dayOfMonth: 2,
  termDays: 14,
  ...over,
})

describe('splitAmount', () => {
  it('splits evenly when it can', () => {
    expect(splitAmount(5000, 5)).toEqual([1000, 1000, 1000, 1000, 1000])
  })

  it('gives the remainder to the LAST part, never to every part', () => {
    // Rounding each part up would total 1000.02 — a cent nobody agreed to and
    // that no line on the invoice could account for.
    const parts = splitAmount(1000, 3)
    expect(parts).toEqual([333.33, 333.33, 333.34])
    expect(parts.reduce((s, p) => s + p, 0)).toBeCloseTo(1000, 10)
  })

  it('always adds back up to the whole', () => {
    for (const [total, count] of [[6800, 7], [248.55, 4], [99.99, 6], [1, 3]] as const) {
      const sum = splitAmount(total, count).reduce((s, p) => s + p, 0)
      expect(Math.round(sum * 100) / 100).toBe(Math.round(total * 100) / 100)
    }
  })

  it('returns the whole for a single instalment', () => {
    expect(splitAmount(6800, 1)).toEqual([6800])
  })
})

describe('instalmentSchedule', () => {
  it('lays out 5 × 1000 € from the second of each month', () => {
    const rows = instalmentSchedule(plan())
    expect(rows).toHaveLength(5)
    expect(rows.map(r => r.issueDate)).toEqual([
      '2026-09-02', '2026-10-02', '2026-11-02', '2026-12-02', '2027-01-02',
    ])
    expect(scheduleTotal(rows)).toBe(5000)
  })

  it('rolls the year over', () => {
    const rows = instalmentSchedule(plan({ count: 6, firstIssue: '2026-11-02' }))
    expect(rows[rows.length - 1].issueDate).toBe('2027-04-02')
  })

  it('puts the due date termDays after the issue date', () => {
    const rows = instalmentSchedule(plan({ termDays: 21 }))
    expect(rows[0].dueDate).toBe('2026-09-23')
    // Across a month boundary, not 30-and-something of the same month.
    expect(rows[1].dueDate).toBe('2026-10-23')
  })

  it('moves the FIRST instalment onto the chosen day too', () => {
    // Typed on the 17th, plan says the 2nd: the plan wins, or the patient's
    // first invoice arrives a fortnight before every other one.
    const rows = instalmentSchedule(plan({ firstIssue: '2026-09-17', dayOfMonth: 2 }))
    expect(rows[0].issueDate).toBe('2026-09-02')
  })

  it('keeps the typed day when no day is chosen, clamping into short months', () => {
    const rows = instalmentSchedule(
      plan({ count: 3, firstIssue: '2026-12-31', dayOfMonth: undefined })
    )
    // January has a 31st, February does not. Clamped, never rolled into March.
    expect(rows.map(r => r.issueDate)).toEqual(['2026-12-31', '2027-01-31', '2027-02-28'])
  })

  it('does not drift once it has been clamped', () => {
    // The clamp reads the ORIGINAL day each time, so February does not make
    // every later instalment the 28th.
    const rows = instalmentSchedule(
      plan({ count: 4, firstIssue: '2027-01-30', dayOfMonth: undefined })
    )
    expect(rows.map(r => r.issueDate)).toEqual(
      ['2027-01-30', '2027-02-28', '2027-03-30', '2027-04-30']
    )
  })

  it('handles a leap February', () => {
    const rows = instalmentSchedule(
      plan({ count: 2, firstIssue: '2028-01-31', dayOfMonth: undefined })
    )
    expect(rows[1].issueDate).toBe('2028-02-29')
  })

  it('is a single row for a one-off', () => {
    const rows = instalmentSchedule(plan({ total: 400, count: 1 }))
    expect(rows).toEqual([
      { no: 1, issueDate: '2026-09-02', dueDate: '2026-09-16', amount: 400 },
    ])
  })
})

describe('scheduleProblems — a broken plan is refused, not approximated', () => {
  it('accepts a sound plan', () => {
    expect(scheduleProblems(plan())).toEqual([])
  })

  it.each([
    ['no total', { total: 0 }],
    ['negative total', { total: -100 }],
    ['zero instalments', { count: 0 }],
    ['more than 60 instalments', { count: 61 }],
    ['a missing date', { firstIssue: '' }],
    ['a half-typed date', { firstIssue: '2026-09' }],
    ['a date that does not exist', { firstIssue: '2026-02-30' }],
    ['a day of month past 28', { dayOfMonth: 31 }],
    ['a negative term', { termDays: -1 }],
  ])('rejects %s', (_label, over) => {
    expect(scheduleProblems(plan(over as Partial<PaymentPlanShape>)).length).toBeGreaterThan(0)
  })

  it('refuses a plan finer than money', () => {
    expect(scheduleProblems(plan({ total: 0.05, count: 10 }))).toContain(
      'Osamakse jääks alla sendi — vähenda osamaksete arvu.'
    )
  })

  it('generates NOTHING when the plan is broken, even if asked directly', () => {
    // The guard is in the generator too, so a caller that skips the check
    // cannot write a half-sane run of documents.
    expect(instalmentSchedule(plan({ firstIssue: '2026-02-30' }))).toEqual([])
    expect(instalmentSchedule(plan({ total: 0 }))).toEqual([])
  })
})
