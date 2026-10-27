/**
 * The chart's derivation, tested once for every renderer that will draw it.
 *
 * This used to be computed inline inside the 2D picker. A second renderer is
 * coming, and two of them deriving "who owns tooth 16, what colour, is there a
 * bridge to its neighbour" independently is two implementations of a rule that
 * must never disagree — the chart saying one thing and the 3D model another,
 * on the same job, in the same panel.
 */
import { describe, it, expect } from 'vitest'
import { deriveOdontogramState, shiftHex, pairKey, NO_COLOUR } from './odontogramState'
import type { WorkItem } from '../../types/job'

const item = (over: Partial<WorkItem> = {}): WorkItem =>
  ({ id: 'a', too: 'Kroon', hambad: '11,12', ...over })

const COLOURS = { Kroon: '#3B82F6', Sild: '#8B5CF6' }

describe('deriveOdontogramState — ownership', () => {
  it('maps every tooth to the item that holds it', () => {
    const s = deriveOdontogramState([item({ hambad: '11,12' })], COLOURS)
    expect(s.owners.get('11')?.itemId).toBe('a')
    expect(s.owners.get('12')?.color).toBe('#3B82F6')
    expect(s.totalTeeth).toBe(2)
  })

  it('falls back to grey for a type with no colour', () => {
    const s = deriveOdontogramState([item({ too: 'Tundmatu' })], COLOURS)
    expect(s.owners.get('11')?.color).toBe(NO_COLOUR)
  })

  // Two "Sild" items on one job have to be tellable apart, and the FIRST one
  // must keep exactly the colour the work type was configured with.
  it('hue-shifts the second item of the same type, not the first', () => {
    const s = deriveOdontogramState([
      item({ id: 'a', too: 'Sild', hambad: '11,12' }),
      item({ id: 'b', too: 'Sild', hambad: '21,22' }),
    ], COLOURS)
    expect(s.owners.get('11')?.color).toBe('#8B5CF6')
    expect(s.owners.get('21')?.color).not.toBe('#8B5CF6')
    expect(s.owners.get('11')?.showNum).toBe(true)
    expect(s.owners.get('11')?.num).toBe(1)
    expect(s.owners.get('21')?.num).toBe(2)
  })

  it('does not number a type that has only one item', () => {
    const s = deriveOdontogramState([item()], COLOURS)
    expect(s.owners.get('11')?.showNum).toBe(false)
  })

  it('tolerates spaces and blanks in the tooth string', () => {
    const s = deriveOdontogramState([item({ hambad: ' 11 , ,12, ' })], COLOURS)
    expect(s.totalTeeth).toBe(2)
  })
})

describe('deriveOdontogramState — implants and design', () => {
  it('collects implants across items', () => {
    const s = deriveOdontogramState([
      item({ id: 'a', hambad: '11,12', implantaadid: '11' }),
      item({ id: 'b', hambad: '21,22', implantaadid: '22' }),
    ], COLOURS)
    expect([...s.implants].sort()).toEqual(['11', '22'])
  })

  // An item with nothing marked was designed whole. Marking all of its teeth
  // would paint the violet bar across the overwhelmingly common case.
  it('marks designer teeth only where the item said something', () => {
    const s = deriveOdontogramState([
      item({ id: 'a', hambad: '11,12' }),
      item({ id: 'b', hambad: '21,22', disain_hambad: '21' }),
    ], COLOURS)
    expect([...s.designed]).toEqual(['21'])
  })
})

describe('deriveOdontogramState — bridges', () => {
  const bridge = (hambad: string): WorkItem =>
    ({ id: 'b', too: 'Sild', hambad, bridge: true })

  it('joins adjacent teeth of a bridge', () => {
    const s = deriveOdontogramState([bridge('11,12,13')], COLOURS)
    expect(s.bridgePairs.get(pairKey('11', '12'))).toBe('#8B5CF6')
    expect(s.bridgePairs.get(pairKey('12', '13'))).toBe('#8B5CF6')
  })

  // 11 and 21 are neighbours across the midline. `fdi % 10` says they are both
  // "1" and would miss it; archIndex is the one function that knows.
  it('joins across the midline', () => {
    const s = deriveOdontogramState([bridge('11,21')], COLOURS)
    expect(s.bridgePairs.get(pairKey('11', '21'))).toBe('#8B5CF6')
  })

  // THE trap in this file: archIndex is an index within its OWN arch, so 16 and
  // 46 both answer 2. Joining them would draw a bar through the mouth.
  it('never joins an upper tooth to a lower one', () => {
    const s = deriveOdontogramState([bridge('16,46')], COLOURS)
    expect(s.bridgePairs.size).toBe(0)
  })

  it('does not bridge across a gap', () => {
    const s = deriveOdontogramState([bridge('11,13')], COLOURS)
    expect(s.bridgePairs.size).toBe(0)
  })

  it('ignores an item that is not a bridge', () => {
    const s = deriveOdontogramState([item({ hambad: '11,12' })], COLOURS)
    expect(s.bridgePairs.size).toBe(0)
  })

  // Direction-free: the 2D chart can be mirrored, so "to the right" is a
  // drawing question and must not be baked into the data.
  it('keys a pair the same whichever way round it is asked', () => {
    expect(pairKey('12', '11')).toBe(pairKey('11', '12'))
  })
})

describe('legend', () => {
  it('counts teeth per work type, not items', () => {
    const s = deriveOdontogramState([
      item({ id: 'a', too: 'Kroon', hambad: '11,12' }),
      item({ id: 'b', too: 'Kroon', hambad: '21' }),
      item({ id: 'c', too: 'Sild', hambad: '36,37' }),
    ], COLOURS)
    expect(s.legend).toEqual([
      { too: 'Kroon', color: '#3B82F6', count: 3 },
      { too: 'Sild', color: '#8B5CF6', count: 2 },
    ])
  })
})

describe('shiftHex', () => {
  it('is the identity at index 0', () => {
    expect(shiftHex('#3B82F6', 0)).toBe('#3B82F6')
  })

  it('always returns a valid 7-character hex', () => {
    for (let i = 0; i < 12; i++) {
      expect(shiftHex('#3B82F6', i)).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  // Clamping, not wrapping: a channel pushed past the end must saturate, or a
  // bright type would suddenly render dark.
  it('clamps at both ends instead of wrapping', () => {
    expect(shiftHex('#FFFFFF', 4)).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(shiftHex('#000000', 4)).toMatch(/^#[0-9a-fA-F]{6}$/)
  })
})
