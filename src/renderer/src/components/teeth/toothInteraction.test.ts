/**
 * The click rules, tested once for both charts.
 *
 * These decide whether hardware lands on an invoice and whether a tooth lands
 * on somebody's payslip, so the cases that matter most here are the REFUSALS —
 * a mark that should not have been allowed is money nobody can account for
 * later, and it leaves no visible trace on the chart.
 */
import { describe, it, expect } from 'vitest'
import { decideToothClick, decideDragPaint, ownsTooth } from './toothInteraction'
import type { ClickContext } from './toothInteraction'
import type { ToothOwner } from './odontogramState'

const owner = (itemId: string): ToothOwner =>
  ({ itemId, color: '#3B82F6', num: 1, showNum: false })

/** Tooth 11 belongs to item `a`, tooth 21 to item `b`. */
const OWNERS = new Map<string, ToothOwner>([
  ['11', owner('a')],
  ['21', owner('b')],
])

const ctx = (over: Partial<ClickContext> = {}): ClickContext =>
  ({ owners: OWNERS, activeItemId: 'a', markMode: null, ...over })

describe('ownsTooth', () => {
  it('is true only for the item being edited', () => {
    expect(ownsTooth(OWNERS, 11, 'a')).toBe(true)
    expect(ownsTooth(OWNERS, 21, 'a')).toBe(false)
    expect(ownsTooth(OWNERS, 13, 'a')).toBe(false)
  })

  it('is false when nothing is being edited', () => {
    expect(ownsTooth(OWNERS, 11, null)).toBe(false)
  })
})

describe('decideToothClick — picking teeth', () => {
  it('toggles any tooth when no mode is active', () => {
    expect(decideToothClick(13, ctx())).toBe('toggle')
    expect(decideToothClick(11, ctx())).toBe('toggle')
  })

  it('does nothing with no active item', () => {
    expect(decideToothClick(11, ctx({ activeItemId: null }))).toBe('none')
  })

  it('does nothing when disabled', () => {
    expect(decideToothClick(11, ctx({ disabled: true }))).toBe('none')
  })
})

describe('decideToothClick — marking', () => {
  it('marks a tooth this item already has', () => {
    expect(decideToothClick(11, ctx({ markMode: 'implant' }))).toBe('implant')
    expect(decideToothClick(11, ctx({ markMode: 'design' }))).toBe('design')
  })

  it('refuses a tooth nobody is making', () => {
    expect(decideToothClick(13, ctx({ markMode: 'implant' }))).toBe('none')
  })

  it('refuses a tooth belonging to a DIFFERENT item on the same job', () => {
    // 21 is owned, just not by us. Marking it would attach hardware to work
    // this item is not doing.
    expect(decideToothClick(21, ctx({ markMode: 'implant' }))).toBe('none')
    expect(decideToothClick(21, ctx({ markMode: 'design' }))).toBe('none')
  })

  it('never falls through to toggling', () => {
    // The dangerous failure: a refused mark quietly removing the tooth instead.
    expect(decideToothClick(13, ctx({ markMode: 'design' }))).not.toBe('toggle')
  })
})

describe('decideDragPaint', () => {
  it('does nothing when no drag is under way', () => {
    expect(decideDragPaint(13, ctx(), null)).toBe('none')
  })

  it('adds only teeth this item does not already have', () => {
    expect(decideDragPaint(13, ctx(), 'add')).toBe('toggle')
    expect(decideDragPaint(11, ctx(), 'add')).toBe('none')
  })

  it('removes only teeth this item has', () => {
    expect(decideDragPaint(11, ctx(), 'remove')).toBe('toggle')
    expect(decideDragPaint(13, ctx(), 'remove')).toBe('none')
  })

  it('never marks, in either mode', () => {
    for (const markMode of ['implant', 'design'] as const) {
      expect(decideDragPaint(11, ctx({ markMode }), 'add')).toBe('none')
      expect(decideDragPaint(11, ctx({ markMode }), 'remove')).toBe('none')
    }
  })
})
