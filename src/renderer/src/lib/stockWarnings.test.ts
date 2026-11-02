import { describe, it, expect } from 'vitest'
import { itemWarnings, stockWarnings, isRed, freshWarnings, warningKey, stockItemLabel, type StockLevel } from './stockWarnings'

const today = new Date('2026-11-02T10:00:00')

const row = (p: Partial<StockLevel> = {}): StockLevel => ({
  id: 'i1', owner_org: null, owner_supplier: null, category: 'implant', manufacturer: 'Straumann', system: 'BLT',
  size: '4.1x10', product: null, lot: 'L1', expiry_date: '2028-01-31', consignment_due: null, min_qty: null,
  archived_at: null, created_at: '2026-10-01T00:00:00Z', qty: 5, ...p,
})

describe('itemWarnings', () => {
  it('nothing for a well-stocked item far from its dates', () => {
    expect(itemWarnings(row(), today)).toEqual([])
  })

  it('low: fewer than the threshold, not equal to it', () => {
    expect(itemWarnings(row({ min_qty: 5 }), today)).toEqual([])
    expect(itemWarnings(row({ min_qty: 6 }), today)).toEqual(['low'])
    expect(itemWarnings(row({ min_qty: 1, qty: 0 }), today)).toEqual(['low'])
  })

  it('consignment turns red a month before it is due, and stays red after', () => {
    expect(itemWarnings(row({ consignment_due: '2026-12-03' }), today)).toEqual([])
    expect(itemWarnings(row({ consignment_due: '2026-12-02' }), today)).toEqual(['consignment'])
    expect(itemWarnings(row({ consignment_due: '2026-10-01' }), today)).toEqual(['consignment'])
  })

  it('expiry within a month, or past', () => {
    expect(itemWarnings(row({ expiry_date: '2026-12-01' }), today)).toEqual(['expiry'])
    expect(itemWarnings(row({ expiry_date: '2026-01-01' }), today)).toEqual(['expiry'])
  })

  it('an empty item is only ever low; an archived one never warns', () => {
    expect(itemWarnings(row({ qty: 0, consignment_due: '2026-11-01', expiry_date: '2026-11-01' }), today)).toEqual([])
    expect(itemWarnings(row({ archived_at: '2026-10-01', min_qty: 9 }), today)).toEqual([])
  })
})

describe('stockWarnings and isRed', () => {
  it('lists every warning per item; red is consignment or expiry, not low', () => {
    const rows = [row({ id: 'a', min_qty: 9 }), row({ id: 'b', consignment_due: '2026-11-20', expiry_date: '2026-11-20' })]
    expect(stockWarnings(rows, today)).toEqual([
      { itemId: 'a', kind: 'low' }, { itemId: 'b', kind: 'consignment' }, { itemId: 'b', kind: 'expiry' },
    ])
    expect(isRed(rows[0], today)).toBe(false)
    expect(isRed(rows[1], today)).toBe(true)
  })
})

describe('freshWarnings: the sound plays once per warning', () => {
  const a = { itemId: 'a', kind: 'low' as const }
  const b = { itemId: 'b', kind: 'expiry' as const }

  it('only what was not seen is fresh', () => {
    const { fresh, nextSeen } = freshWarnings([a, b], new Set([warningKey(a)]))
    expect(fresh).toEqual([b])
    expect([...nextSeen].sort()).toEqual(['a:low', 'b:expiry'])
  })

  it('a warning that went away and came back is fresh again', () => {
    const gone = freshWarnings([b], new Set([warningKey(a), warningKey(b)]))
    expect(gone.fresh).toEqual([])
    expect(freshWarnings([a, b], gone.nextSeen).fresh).toEqual([a])
  })
})

it('stockItemLabel joins what is known', () => {
  expect(stockItemLabel({ manufacturer: 'Straumann', system: 'BLT', size: null, product: 'RC' })).toBe('Straumann BLT RC')
})
