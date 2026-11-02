import { describe, it, expect } from 'vitest'
import {
  lotWarnings, stockWarnings, isRed, isLow, isExpired, freshWarnings, warningKey, stockItemLabel, NEEDS_JOB,
  type StockLevel, type ProductLevel,
} from './stockWarnings'

const today = new Date('2026-11-02T10:00:00')

const row = (p: Partial<StockLevel> = {}): StockLevel => ({
  id: 'i1', owner_org: null, owner_supplier: null, category: 'implant', manufacturer: 'Straumann', system: 'BLT',
  size: '4.1x10', product: null, product_key: 'implant|straumann|blt|4.1x10|', lot: 'L1', expiry_date: '2028-01-31',
  consignment_due: null, archived_at: null, created_at: '2026-10-01T00:00:00Z', qty: 5, ...p,
})

const product = (p: Partial<ProductLevel> = {}): ProductLevel => ({
  product_key: 'implant|straumann|blt|4.1x10|', category: 'implant', manufacturer: 'Straumann', system: 'BLT',
  size: '4.1x10', product: null, qty: 5, lots: 2, min_qty: null, ...p,
})

describe('lot warnings', () => {
  it('nothing for a lot far from its dates', () => {
    expect(lotWarnings(row(), today)).toEqual([])
  })

  it('consignment turns red a month before it is due, and stays red after', () => {
    expect(lotWarnings(row({ consignment_due: '2026-12-03' }), today)).toEqual([])
    expect(lotWarnings(row({ consignment_due: '2026-12-02' }), today)).toEqual(['consignment'])
    expect(lotWarnings(row({ consignment_due: '2026-10-01' }), today)).toEqual(['consignment'])
  })

  it('expiry within a month, or past', () => {
    expect(lotWarnings(row({ expiry_date: '2026-12-01' }), today)).toEqual(['expiry'])
    expect(lotWarnings(row({ expiry_date: '2026-01-01' }), today)).toEqual(['expiry'])
  })

  it('a lot at zero, or archived, never warns', () => {
    expect(lotWarnings(row({ qty: 0, consignment_due: '2026-11-01', expiry_date: '2026-11-01' }), today)).toEqual([])
    expect(lotWarnings(row({ archived_at: '2026-10-01', expiry_date: '2026-11-01' }), today)).toEqual([])
  })
})

describe('product warning: the total of all lots against one threshold', () => {
  it('low below the threshold, not at it; no threshold, never low', () => {
    expect(isLow(product({ qty: 3, min_qty: 3 }))).toBe(false)
    expect(isLow(product({ qty: 2, min_qty: 3 }))).toBe(true)
    expect(isLow(product({ qty: 0, min_qty: null }))).toBe(false)
  })

  it('a product with every lot used up is still low', () => {
    expect(isLow(product({ qty: 0, lots: 0, min_qty: 1 }))).toBe(true)
  })
})

describe('stockWarnings and isRed', () => {
  it('lists low products and red lots; red is consignment or expiry', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', consignment_due: '2026-11-20', expiry_date: '2026-11-20' })]
    expect(stockWarnings(rows, [product({ min_qty: 9 })], today)).toEqual([
      { kind: 'low', productKey: 'implant|straumann|blt|4.1x10|' },
      { kind: 'consignment', itemId: 'b' }, { kind: 'expiry', itemId: 'b' },
    ])
    expect(isRed(rows[0], today)).toBe(false)
    expect(isRed(rows[1], today)).toBe(true)
  })
})

describe('isExpired: from the day after the expiry date', () => {
  it('usable on the day itself', () => {
    expect(isExpired({ expiry_date: '2026-11-02' }, today)).toBe(false)
    expect(isExpired({ expiry_date: '2026-11-01' }, today)).toBe(true)
  })
})

describe('freshWarnings: the sound plays once per warning', () => {
  const a = { kind: 'low' as const, productKey: 'p1' }
  const b = { kind: 'expiry' as const, itemId: 'b' }

  it('only what was not seen is fresh', () => {
    const { fresh, nextSeen } = freshWarnings([a, b], new Set([warningKey(a)]))
    expect(fresh).toEqual([b])
    expect([...nextSeen].sort()).toEqual(['b:expiry', 'product:p1:low'])
  })

  it('a warning that went away and came back is fresh again', () => {
    const gone = freshWarnings([b], new Set([warningKey(a), warningKey(b)]))
    expect(gone.fresh).toEqual([])
    expect(freshWarnings([a, b], gone.nextSeen).fresh).toEqual([a])
  })
})

it('the categories that need a job, and the label', () => {
  expect([...NEEDS_JOB].sort()).toEqual(['abutment', 'bone', 'implant', 'membrane'])
  expect(stockItemLabel({ manufacturer: 'Straumann', system: 'BLT', size: null, product: 'RC' })).toBe('Straumann BLT RC')
})
