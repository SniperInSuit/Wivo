/**
 * Implants through the WIZARD's path.
 *
 * The wizard keeps teeth as numbers per work type and derives `WorkItem`s on
 * read; the job form edits `WorkItem`s directly. Two data paths to the same
 * field, and only one of them was wired the first time — the chart in the
 * wizard had no way to mark anything at all. These pin the derivation.
 */
import { describe, it, expect } from 'vitest'
import { wizardWorkItems } from './workItems'
import { createEmptyNewJobState } from '@shared/wizard'
import { DEFAULT_WORK_TYPES } from '@shared/pricing/workTypes'
import type { NewJobState } from '@shared/wizard'

const T = DEFAULT_WORK_TYPES

const state = (over: Partial<NewJobState> = {}): NewJobState => ({
  ...createEmptyNewJobState(),
  jobTypes: ['Implantaadisild'],
  selectedTeeth: { Implantaadisild: [14, 15, 16, 17, 18] },
  ...over,
})

const item = (s: NewJobState) => wizardWorkItems(s, T)[0]

describe('wizardWorkItems — implants', () => {
  // Anatomical order, the same order `hambad` is in — sortTeeth puts 18 before
  // 14 in the upper right. Asserted against the item's own teeth rather than a
  // literal, so the two can never drift apart without this failing.
  it('carries the marked teeth onto the work item, in the same order as hambad', () => {
    const i = item(state({ implantsByType: { Implantaadisild: [14, 18] } }))
    const order = i.hambad.split(',')
    expect(i.implantaadid!.split(',')).toEqual(order.filter(t => t === '18' || t === '14'))
    expect(i.implantaadid).toBe('18,14')
  })

  // Absent, not empty: an empty string in the row would read as a deliberate
  // "no implants" and stop the cost falling back to counting teeth.
  it('leaves the field off when nothing is marked', () => {
    expect(item(state()).implantaadid).toBeUndefined()
    expect(item(state({ implantsByType: { Implantaadisild: [] } })).implantaadid).toBeUndefined()
  })

  // Unticking a tooth on step 2 must take its implant with it, or the job is
  // created with a screw charged against a unit that is not being made.
  it('drops an implant on a tooth that is no longer selected', () => {
    const i = item(state({
      selectedTeeth: { Implantaadisild: [14, 15] },
      implantsByType: { Implantaadisild: [14, 18] },
    }))
    expect(i.implantaadid).toBe('14')
  })

  // A plain bridge has no implants to mark, and a stale draft must not smuggle
  // one through on a type that cannot carry it.
  it('ignores marks on a work type that sits on no implant', () => {
    const i = item(state({
      jobTypes: ['Sild'],
      selectedTeeth: { Sild: [14, 15, 16] },
      implantsByType: { Sild: [14] },
    }))
    expect(i.too).toBe('Sild')
    expect(i.implantaadid).toBeUndefined()
  })

  it('still marks the item as a bridge', () => {
    expect(item(state({ implantsByType: { Implantaadisild: [14] } })).bridge).toBe(true)
  })
})
