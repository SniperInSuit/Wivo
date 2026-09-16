/**
 * Which teeth of an item the DESIGNER did.
 *
 * SprintRay's AI will not design a third molar, so a two-crown item is one
 * tooth the technician designed himself and one he handed over. Design was per
 * item, so naming a designer paid them for both.
 *
 * The load-bearing rule is the fallback: an item with nothing marked must
 * answer with ALL its teeth, or turning this on would restate every past
 * payslip.
 */
import { describe, it, expect } from 'vitest'
import { designTeeth, designIsPartial, toggleDesignTooth, type WorkItem } from '../types/job'

const item = (over: Partial<WorkItem> = {}): WorkItem =>
  ({ id: 'a', too: 'Kroon', hambad: '17,18', ...over })

describe('designTeeth', () => {
  it('is every tooth when nothing is marked', () => {
    expect(designTeeth(item())).toBe('17,18')
    expect(designTeeth(item({ disain_hambad: '' }))).toBe('17,18')
  })

  it('is the marked subset when there is one', () => {
    expect(designTeeth(item({ disain_hambad: '18' }))).toBe('18')
  })

  it('keeps the item\u2019s own tooth order', () => {
    expect(designTeeth(item({ hambad: '17,18', disain_hambad: '18,17' }))).toBe('17,18')
  })

  // A mark left on a tooth the item lost is nobody's answer, so it falls back
  // to the whole item rather than paying for a tooth that is not there.
  it('falls back to the whole item when the mark no longer applies', () => {
    expect(designTeeth(item({ disain_hambad: '26' }))).toBe('17,18')
  })

  it('survives an item with no teeth at all', () => {
    expect(designTeeth(item({ hambad: '' }))).toBe('')
  })
})

describe('designIsPartial', () => {
  it('is true only when some but not all were designed', () => {
    expect(designIsPartial(item({ disain_hambad: '18' }))).toBe(true)
    expect(designIsPartial(item())).toBe(false)
    expect(designIsPartial(item({ disain_hambad: '17,18' }))).toBe(false)
    expect(designIsPartial(item({ hambad: '' }))).toBe(false)
  })
})

describe('toggleDesignTooth', () => {
  // Starts from "all of them", so the first click REMOVES a tooth — which is
  // what actually happens at the bench: the designer had the lot, and the
  // technician takes one back.
  it('first click takes one tooth away from the designer', () => {
    expect(toggleDesignTooth(item(), 17)).toBe('18')
  })

  it('clicking it again gives it back', () => {
    expect(toggleDesignTooth(item({ disain_hambad: '18' }), 17)).toBeUndefined()
  })

  // Undefined, not the full string: "all of them" has to stay unsaid, or a
  // tooth added to the item later would silently arrive unassigned.
  it('stores nothing when the designer has everything', () => {
    expect(toggleDesignTooth(item({ disain_hambad: '18' }), 17)).toBeUndefined()
    expect(toggleDesignTooth(item({ hambad: '17', disain_hambad: undefined }), 17)).toBeUndefined()
  })

  it('refuses a tooth the item does not have', () => {
    expect(toggleDesignTooth(item({ disain_hambad: '18' }), 26)).toBe('18')
  })
})
