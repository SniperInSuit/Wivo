import { describe, expect, it } from 'vitest'
import { joinMaterials, materialList, splitMaterials } from './materials'
import { calcProduction } from './priceBook'

describe('two materials in one string', () => {
  it('splits a denture into base and teeth, shades kept', () => {
    expect(splitMaterials('Apex Base + Apex Teeth A2')).toEqual(['Apex Base', 'Apex Teeth A2'])
    expect(splitMaterials('Crown HT A1')).toEqual(['Crown HT A1', ''])
    expect(splitMaterials(null)).toEqual(['', ''])
  })

  it('joins without a dangling separator', () => {
    expect(joinMaterials('Apex Base', 'Apex Teeth')).toBe('Apex Base + Apex Teeth')
    expect(joinMaterials('Apex Base', '')).toBe('Apex Base')
    // The first cleared: the second is all that is left, not " + Apex Teeth".
    expect(joinMaterials('', 'Apex Teeth')).toBe('Apex Teeth')
    expect(joinMaterials(null, undefined)).toBe('')
  })

  it('round-trips', () => {
    const v = joinMaterials('Apex Base', 'Apex Teeth')
    expect(joinMaterials(...splitMaterials(v))).toBe(v)
    expect(materialList(v)).toEqual(['Apex Base', 'Apex Teeth'])
    expect(materialList('')).toEqual([])
  })
})

describe('calcProduction with two materials', () => {
  const prices = { 'Apex Base': { small: 2, large: 3 }, 'Apex Teeth': { small: 1, large: 1 } }

  it('charges both materials for every tooth', () => {
    // 11,12 small; 16 large: base 2+2+3, teeth 1+1+1.
    expect(calcProduction('11,12,16', 'Apex Base + Apex Teeth', prices)).toBe(10)
  })

  it('is unchanged for one material', () => {
    expect(calcProduction('11,12,16', 'Apex Base', prices)).toBe(7)
    expect(calcProduction('11', 'Tundmatu', prices)).toBe(0)
  })
})
