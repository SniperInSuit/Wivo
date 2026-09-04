/**
 * Overhead periods. The subject is one conversion that everything downstream
 * trusts, and the failure mode is silent: a wrong factor does not throw, it
 * just moves the profit line.
 */
import { describe, it, expect } from 'vitest'
import { overheadMonthly, overheadsMonthly, type Overhead } from './priceBook'

const o = (summa: number, periood?: Overhead['periood']): Overhead =>
  ({ nimi: 'x', summa, periood })

describe('overheadMonthly', () => {
  it('leaves a monthly cost alone', () => {
    expect(overheadMonthly(o(2000, 'kuu'))).toBe(2000)
  })

  // The reason the field is optional: every row saved before it existed was
  // monthly, and reading them as anything else would rewrite history.
  it('reads a row with no period as monthly', () => {
    expect(overheadMonthly({ nimi: 'Rent', summa: 2000 })).toBe(2000)
  })

  it('divides a yearly cost by twelve', () => {
    expect(overheadMonthly(o(1200, 'aasta'))).toBe(100)
  })

  // 52/12 = 4.333, not 4. Using 4 loses a month's worth of coffee a year.
  it('uses 52/12 weeks per month, not 4', () => {
    expect(overheadMonthly(o(12, 'nadal'))).toBeCloseTo(52, 6)
    expect(overheadMonthly(o(12, 'nadal'))).not.toBe(48)
  })

  // The case this feature was built for: lunch at 5 €/working day.
  it('converts a working-day cost through the working week', () => {
    expect(overheadMonthly(o(5, 'paev'), 5)).toBeCloseTo(108.33, 2)
  })

  // Not 5 × 30.44 = 152.20. Nobody eats at the bench on Sunday, and the whole
  // point of 'paev' meaning a WORKING day is that this number stays out.
  it('does not prorate a working-day cost over calendar days', () => {
    expect(overheadMonthly(o(5, 'paev'), 5)).toBeLessThan(5 * 30.44)
  })

  it('follows a four-day week', () => {
    expect(overheadMonthly(o(5, 'paev'), 4)).toBeCloseTo(86.67, 2)
  })

  it('defaults to a five-day week when not told', () => {
    expect(overheadMonthly(o(5, 'paev'))).toBeCloseTo(overheadMonthly(o(5, 'paev'), 5), 6)
  })

  // A broken setting must not invent or erase a cost.
  it('clamps a nonsense working week instead of trusting it', () => {
    expect(overheadMonthly(o(5, 'paev'), 99)).toBeCloseTo(overheadMonthly(o(5, 'paev'), 7), 6)
    expect(overheadMonthly(o(5, 'paev'), -3)).toBe(0)
    expect(overheadMonthly(o(5, 'paev'), NaN)).toBeCloseTo(overheadMonthly(o(5, 'paev'), 5), 6)
  })

  it('treats an unparseable sum as nothing, not NaN', () => {
    expect(overheadMonthly({ nimi: 'x', summa: NaN, periood: 'kuu' })).toBe(0)
    expect(overheadMonthly({ nimi: 'x', summa: undefined as unknown as number })).toBe(0)
  })

  it('keeps a zero at zero in every period', () => {
    for (const p of ['paev', 'nadal', 'kuu', 'aasta'] as const) {
      expect(overheadMonthly(o(0, p))).toBe(0)
    }
  })
})

describe('overheadsMonthly', () => {
  it('adds mixed periods on one monthly scale', () => {
    // 2000 rent + 5 €/working day lunch + 1200/yr insurance
    const total = overheadsMonthly([o(2000, 'kuu'), o(5, 'paev'), o(1200, 'aasta')], 5)
    expect(total).toBeCloseTo(2000 + 108.333 + 100, 2)
  })

  it('survives an empty or missing list', () => {
    expect(overheadsMonthly([])).toBe(0)
    expect(overheadsMonthly(undefined as unknown as Overhead[])).toBe(0)
  })
})
