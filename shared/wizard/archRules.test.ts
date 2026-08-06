/**
 * Bridge geometry and the hambad wire format.
 *
 * The cases here are the ones a technician would actually try and that a naive
 * implementation gets wrong: a bridge across the midline (11–21) is normal
 * clinical work, a bridge across the jaws is not, and `fdi % 10` arithmetic
 * gets both backwards.
 */
import { describe, expect, it } from 'vitest'
import {
  archIndex, archOf, archTeeth, archesOf, checkConsecutive, hambadToTeeth, sortTeeth, teethToHambad,
} from './archRules'

describe('archOf / archIndex', () => {
  it('places teeth in the right arch', () => {
    expect(archOf(18)).toBe('upper')
    expect(archOf(21)).toBe('upper')
    expect(archOf(48)).toBe('lower')
    expect(archOf(99)).toBeNull()
  })

  it('indexes by table position, so 11 and 21 are neighbours', () => {
    expect(archIndex(11)).toBe(7)
    expect(archIndex(21)).toBe(8)
    expect(archIndex(99)).toBe(-1)
  })
})

describe('archTeeth', () => {
  it('returns a full arch, or both', () => {
    expect(archTeeth('upper')).toHaveLength(16)
    expect(archTeeth('lower')).toHaveLength(16)
    expect(archTeeth('both')).toHaveLength(32)
    expect(archTeeth('upper')[0]).toBe(18)
  })
})

describe('archesOf', () => {
  // A both-jaw arch job is TWO pieces of work. wizardWorkItems() emits one work
  // item per entry here, which is what stops a per-job-priced All-on-X on both
  // jaws being quoted at the single-arch price.
  it('splits both into two arches and leaves a single arch alone', () => {
    expect(archesOf('both')).toEqual(['upper', 'lower'])
    expect(archesOf('upper')).toEqual(['upper'])
    expect(archesOf('lower')).toEqual(['lower'])
  })

  it('covers the same teeth as archTeeth, however it is split', () => {
    const split = archesOf('both').flatMap(a => archTeeth(a))
    expect(split).toEqual(archTeeth('both'))
  })
})

describe('checkConsecutive', () => {
  it('accepts a run of three in one quadrant', () => {
    expect(checkConsecutive([14, 15, 16])).toEqual({ ok: true, reason: null, missing: [] })
  })

  it('accepts a span across the midline within the upper arch', () => {
    expect(checkConsecutive([11, 21]).ok).toBe(true)
    expect(checkConsecutive([12, 11, 21, 22]).ok).toBe(true)
  })

  it('names the tooth that would close a gap', () => {
    const r = checkConsecutive([14, 16])
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('gap')
    expect(r.missing).toEqual([15])
  })

  it('rejects a span across the two jaws', () => {
    expect(checkConsecutive([16, 46]).reason).toBe('mixed-arch')
  })

  it('rejects one tooth and no teeth, distinguishably', () => {
    expect(checkConsecutive([16]).reason).toBe('too-few')
    expect(checkConsecutive([]).reason).toBe('empty')
  })

  it('ignores order and duplicates', () => {
    expect(checkConsecutive([16, 14, 15, 15]).ok).toBe(true)
  })

  it('treats an unknown number as not being in any arch', () => {
    expect(checkConsecutive([14, 99]).reason).toBe('mixed-arch')
  })
})

describe('hambad round trip', () => {
  // Arch order, NOT numeric order: the chart reads 18→28 left to right, and the
  // bridge connectors in MultiOdontogramPicker are drawn in exactly this order.
  it('sorts into arch order, upper first', () => {
    expect(sortTeeth([46, 11, 18, 31])).toEqual([18, 11, 46, 31])
    expect(teethToHambad([14, 16, 15])).toBe('16,15,14')
  })

  it('parses back, dropping blanks and rubbish', () => {
    expect(hambadToTeeth('14, 15,16')).toEqual([14, 15, 16])
    expect(hambadToTeeth('')).toEqual([])
    expect(hambadToTeeth(null)).toEqual([])
    expect(hambadToTeeth('14,,x,16')).toEqual([14, 16])
  })

  it('survives a round trip', () => {
    expect(hambadToTeeth(teethToHambad([21, 11, 46]))).toEqual([11, 21, 46])
  })
})
