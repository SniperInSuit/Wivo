import { describe, it, expect } from 'vitest'
import { productKey, suggestProducts, existingProduct, type ProductEntry } from './stockProducts'
import type { ProductLevel } from './stockWarnings'

const p = (over: Partial<ProductLevel>): ProductLevel => ({
  product_key: '', category: 'implant', manufacturer: null, system: null, size: null, product: null,
  qty: 1, lots: 1, min_qty: null, ...over,
})
const withKey = (x: ProductLevel): ProductLevel => ({
  ...x,
  product_key: productKey({ category: x.category, manufacturer: x.manufacturer ?? '', system: x.system ?? '', size: x.size ?? '', product: x.product ?? '' }),
})

const NOBEL = withKey(p({ manufacturer: 'Nobel', system: 'Active', size: '4.3x10', qty: 6 }))
const NOBEL_SMALL = withKey(p({ manufacturer: 'Nobel', system: 'Active', size: '3.5x10', qty: 2 }))
const STRAUMANN = withKey(p({ manufacturer: 'Straumann', system: 'BLT', size: '4.1x10', qty: 9 }))
const MEMBRANE = withKey(p({ category: 'membrane', manufacturer: 'Geistlich', product: 'Bio-Gide 25x25', qty: 3 }))
const ALL = [NOBEL, NOBEL_SMALL, STRAUMANN, MEMBRANE]

const entry = (over: Partial<ProductEntry>): ProductEntry => ({ category: 'implant', manufacturer: '', system: '', size: '', product: '', ...over })

describe('productKey: the same key as the database (sql/093)', () => {
  it('category, then each field lower-cased and trimmed, joined by |', () => {
    expect(productKey(entry({ manufacturer: ' Nobel ', system: 'Active', size: '4.3x10' }))).toBe('implant|nobel|active|4.3x10|')
    expect(productKey(entry({ category: 'membrane', product: 'Bio-Gide 25x25' }))).toBe('membrane||||bio-gide 25x25')
  })
})

describe('suggestProducts', () => {
  it('nothing until something is typed (two characters)', () => {
    expect(suggestProducts(ALL, entry({}))).toEqual([])
    expect(suggestProducts(ALL, entry({ manufacturer: 'N' }))).toEqual([])
  })

  it('a new spelling finds the existing product: case, spaces and punctuation do not matter, across fields', () => {
    expect(suggestProducts(ALL, entry({ product: 'NobelActive' }))).toEqual([NOBEL, NOBEL_SMALL])
    expect(suggestProducts(ALL, entry({ manufacturer: 'nobel', size: '4.3 x 10' }))).toEqual([NOBEL])
    expect(suggestProducts(ALL, entry({ product: 'biogide' }))).toEqual([MEMBRANE])
  })

  it('every filled field must fit', () => {
    expect(suggestProducts(ALL, entry({ manufacturer: 'Nobel', system: 'BLT' }))).toEqual([])
  })

  it('the same category first, then more in stock', () => {
    const geistlichImplant = withKey(p({ manufacturer: 'Geistlich', product: 'Bio-Oss', qty: 50 }))
    expect(suggestProducts([...ALL, geistlichImplant], entry({ category: 'membrane', manufacturer: 'geistlich' })))
      .toEqual([MEMBRANE, geistlichImplant])
  })

  it('the product typed exactly is not suggested; existingProduct finds it', () => {
    const exact = entry({ manufacturer: 'Nobel', system: 'Active', size: '4.3x10' })
    expect(suggestProducts(ALL, exact)).toEqual([])  // the other size does not fit "4.3x10"
    expect(existingProduct(ALL, exact)).toBe(NOBEL)
    expect(existingProduct(ALL, entry({ manufacturer: 'Nobel', system: 'Active', size: '5.0x10' }))).toBeNull()
  })
})
