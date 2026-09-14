/**
 * "Implantaadisild" — a type that belongs to two families at once.
 *
 * Two things are pinned here. First, that the new type does not STEAL anything:
 * resolveWorkType sorts by name length and also matches in reverse
 * (`nimi.includes(asked)`), so a long name containing a short one can quietly
 * capture the short one's jobs. Every existing input is checked, not reasoned
 * about. Second, that it lands in both keyword families — a bridge that sits on
 * implants needs consecutive teeth AND an abutment code per unit.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_WORK_TYPES, resolveWorkType, seedImplantBridge, type WorkType } from './workTypes'
import { workTypeRules } from '../wizard/workTypeRules'

const T = DEFAULT_WORK_TYPES
const nameOf = (s: string) => resolveWorkType(s, T).nimi

describe('Implantaadisild — resolution', () => {
  it('resolves its own name and synonyms', () => {
    expect(nameOf('Implantaadisild')).toBe('Implantaadisild')
    expect(nameOf('implantsild')).toBe('Implantaadisild')
    expect(nameOf('Implant bridge')).toBe('Implantaadisild')
  })

  // The capture risk, one case per existing type that could plausibly be taken.
  // "Sild" is exact-matched before the length sort runs, which is the only
  // reason a 4-letter name survives beside a 15-letter one containing it.
  it.each([
    ['Sild', 'Sild'],
    ['sild', 'Sild'],
    ['Sild 14-16', 'Sild'],
    ['Zirkoonsild', 'Sild'],
    ['Implantkroon', 'Implantkroon'],
    ['abutmendile', 'Implantkroon'],
    ['Kroon', 'Kroon'],
    ['All-on-X', 'All-on-X'],
    ['IBT', 'IBT'],
  ])('leaves %s resolving to %s', (asked, expected) => {
    expect(nameOf(asked)).toBe(expected)
  })
})

describe('Implantaadisild — rules', () => {
  const r = workTypeRules('Implantaadisild', T)

  it('picks individual teeth, like any bridge', () => {
    expect(r.toothMode).toBe('tooth')
    expect(r.requiresTeeth).toBe(true)
  })

  it('is a bridge — consecutive teeth in one arch', () => {
    expect(r.isBridge).toBe(true)
  })

  // The whole reason this type is worth having its own entry: the abutment
  // field is what carries the implant hardware, and a plain Sild has none.
  it('offers an abutment code, which a plain bridge does not', () => {
    expect(r.supportsAbutment).toBe(true)
    expect(workTypeRules('Sild', T).supportsAbutment).toBe(false)
  })

  it('never offers the single-tooth shortcut', () => {
    expect(r.suggestSingleTooth).toBe(false)
  })

  it('still takes a shade', () => {
    expect(r.supportsShade).toBe(true)
  })
})

describe('seedImplantBridge — reaching a list that predates the type', () => {
  const wt = (nimi: string, match?: string[]): WorkType =>
    ({ nimi, hex: '#000', ...(match ? { match } : {}) })

  it('inserts it right after Implantkroon, where the buttons expect it', () => {
    const out = seedImplantBridge([wt('Implantkroon'), wt('Kroon'), wt('Sild')])
    expect(out.map(t => t.nimi)).toEqual(['Implantkroon', 'Implantaadisild', 'Kroon', 'Sild'])
  })

  it('appends when there is no Implantkroon to sit beside', () => {
    const out = seedImplantBridge([wt('Kroon')])
    expect(out.map(t => t.nimi)).toEqual(['Kroon', 'Implantaadisild'])
  })

  // A lab that already has this work under its own name gets nothing added —
  // two entries for one kind of work is worse than the wrong label.
  it('leaves a list that already has one alone', () => {
    const own = [wt('Implantkroon'), wt('Implantsild')]
    expect(seedImplantBridge(own)).toEqual(own)
    const synonym = [wt('Meie sild', ['implantsild'])]
    expect(seedImplantBridge(synonym)).toEqual(synonym)
  })

  it('does not match on the plain Sild that every list already has', () => {
    const out = seedImplantBridge([wt('Sild')])
    expect(out.map(t => t.nimi)).toContain('Implantaadisild')
  })

  // It builds a new array and copies the seed, so the shared DEFAULT list can
  // never be mutated through the list this hands back.
  it('does not hand out the module-level default object', () => {
    const out = seedImplantBridge([wt('Kroon')])
    const added = out.find(t => t.nimi === 'Implantaadisild')!
    added.hex = '#FFFFFF'
    expect(DEFAULT_WORK_TYPES.find(t => t.nimi === 'Implantaadisild')!.hex).toBe('#D946EF')
  })
})
