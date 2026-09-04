/**
 * Capsule cost. The count is TYPED, never derived.
 *
 * An earlier version of this file tested a capacity model — capsules per plate
 * worked out from tooth sizes. It was replaced because how many teeth fit on
 * one plate depends on supports and packing, which no setting can know and the
 * technician can simply see. What is left is one multiplication, and these
 * tests exist for what happens around its edges.
 */
import { describe, it, expect } from 'vitest'
import { materialUnitCost, materialPiecePrice, type MaterialPricing } from './priceBook'

const MIDAS: MaterialPricing = { small: 21, large: 21 }

describe('materialPiecePrice', () => {
  it('takes the base rate', () => {
    expect(materialPiecePrice({ small: 21, large: 21 })).toBe(21)
  })

  // A lab that only priced molars still has a price; refusing it would send a
  // real cost to zero.
  it('falls back to the molar rate when only that is set', () => {
    expect(materialPiecePrice({ small: 0, large: 25 })).toBe(25)
  })

  it('is zero when the material has no price at all', () => {
    expect(materialPiecePrice({ small: 0, large: 0 })).toBe(0)
  })
})

describe('materialUnitCost', () => {
  // The case the owner reported: two teeth managed on one capsule.
  it('charges one capsule for two teeth when one is what was used', () => {
    expect(materialUnitCost(MIDAS, 1)).toEqual({ kapsleid: 1, summa: 21 })
  })

  it('charges what was actually opened, however many teeth', () => {
    expect(materialUnitCost(MIDAS, 2)).toEqual({ kapsleid: 2, summa: 42 })
    expect(materialUnitCost(MIDAS, 5)).toEqual({ kapsleid: 5, summa: 105 })
  })

  // Zero is an ANSWER — "this job opened nothing" — and must not be confused
  // with never having been asked.
  it('accepts a deliberate zero', () => {
    expect(materialUnitCost(MIDAS, 0)).toEqual({ kapsleid: 0, summa: 0 })
  })

  // Null means "nobody said", so the caller falls back to the per-tooth price.
  it('returns null when no count was given', () => {
    expect(materialUnitCost(MIDAS, null)).toBeNull()
    expect(materialUnitCost(MIDAS, undefined)).toBeNull()
  })

  it('refuses a negative or unparseable count rather than inventing one', () => {
    expect(materialUnitCost(MIDAS, -1)).toBeNull()
    expect(materialUnitCost(MIDAS, NaN)).toBeNull()
    expect(materialUnitCost(MIDAS, Infinity)).toBeNull()
  })

  it('refuses when the material has no price — 0 € would look like a free job', () => {
    expect(materialUnitCost({ small: 0, large: 0 }, 2)).toBeNull()
  })

  it('floors a fractional count; half a capsule cannot be bought', () => {
    expect(materialUnitCost(MIDAS, 2.7)).toEqual({ kapsleid: 2, summa: 42 })
  })

  it('rounds money to cents', () => {
    expect(materialUnitCost({ small: 20.555, large: 0 }, 3)!.summa).toBe(61.67)
  })
})
