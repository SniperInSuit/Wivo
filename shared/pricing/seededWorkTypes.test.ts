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
import {
  DEFAULT_WORK_TYPES, resolveWorkType, seedMissingTypes, seededTypeOf,
  type WorkType,
} from './workTypes'
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

describe('seedMissingTypes — reaching a list that predates a type', () => {
  const wt = (nimi: string, match?: string[]): WorkType =>
    ({ nimi, hex: '#000', ...(match ? { match } : {}) })
  const names = (l: WorkType[]): string[] => l.map(t => t.nimi)
  /** Where a name landed, so a test can assert position without listing the lot. */
  const at = (l: WorkType[], nimi: string): number => names(l).indexOf(nimi)

  it('puts the implant bridge right after the implant crown', () => {
    const out = seedMissingTypes([wt('Implantkroon'), wt('Kroon'), wt('Sild')])
    expect(at(out, 'Implantaadisild')).toBe(at(out, 'Implantkroon') + 1)
  })

  // A real lab's list says "Implantaadi kroon". Matching the literal
  // "implantkroon" missed it and put the new type LAST, where the wizard hides
  // it behind "Näita rohkem" and it reads as never having been added.
  it('finds a renamed neighbour to sit beside', () => {
    const out = seedMissingTypes([wt('Kroon'), wt('Implantaadi kroon'), wt('Sild')])
    expect(at(out, 'Implantaadisild')).toBe(at(out, 'Implantaadi kroon') + 1)
  })

  it('puts the denture beside the other whole-arch work', () => {
    const out = seedMissingTypes([wt('Kroon'), wt('Allon4'), wt('Sild')])
    expect(at(out, 'Proteez')).toBe(at(out, 'Allon4') + 1)
  })

  it('appends when there is no neighbour to sit beside', () => {
    const out = seedMissingTypes([wt('Kroon')])
    expect(names(out)).toContain('Implantaadisild')
    expect(names(out)).toContain('Proteez')
  })

  // It runs on the local list AND again on the clinic row, and those arrive in
  // an order nobody controls.
  it('is idempotent', () => {
    const once = seedMissingTypes([wt('Implantkroon'), wt('Allon4')])
    expect(seedMissingTypes(once)).toEqual(once)
  })

  it('leaves a list that already has one alone', () => {
    const own = seedMissingTypes([wt('Implantkroon'), wt('Implantsild'), wt('Allon4')])
    expect(own.filter(t => seededTypeOf(t) === 'Implantaadisild')).toHaveLength(1)
    const synonym = seedMissingTypes([wt('Meie kate', ['denture']), wt('Kroon')])
    expect(names(synonym)).not.toContain('Proteez')
  })

  // The whole point of tracking removals: a type somebody deleted on purpose
  // must not grow back on the next sync.
  it('never puts back a type the lab deleted', () => {
    const out = seedMissingTypes([wt('Kroon')], ['Proteez'])
    expect(names(out)).not.toContain('Proteez')
    expect(names(out)).toContain('Implantaadisild')
  })

  it('does not match on the plain Sild that every list already has', () => {
    expect(names(seedMissingTypes([wt('Sild')]))).toContain('Implantaadisild')
  })

  // It builds a new array and copies the seed, so the shared DEFAULT list can
  // never be mutated through the list this hands back.
  it('does not hand out the module-level default object', () => {
    const out = seedMissingTypes([wt('Kroon')])
    out.find(t => t.nimi === 'Proteez')!.hex = '#FFFFFF'
    expect(DEFAULT_WORK_TYPES.find(t => t.nimi === 'Proteez')!.hex).toBe('#F43F5E')
  })
})

describe('seededTypeOf — which seeded type an entry IS', () => {
  const wt = (nimi: string, match?: string[]): WorkType =>
    ({ nimi, hex: '#000', ...(match ? { match } : {}) })

  it('recognises the seeded type and its synonyms', () => {
    expect(seededTypeOf(wt('Implantaadisild'))).toBe('Implantaadisild')
    expect(seededTypeOf(wt('Implantsild'))).toBe('Implantaadisild')
    expect(seededTypeOf(wt('Meie oma', ['implant bridge']))).toBe('Implantaadisild')
  })

  // The two neighbours it must never be confused with, or deleting one of them
  // would silently stop the other from ever being offered.
  it('does not claim a plain bridge or an implant crown', () => {
    expect(seededTypeOf(wt('Sild'))).toBeNull()
    expect(seededTypeOf(wt('Implantkroon'))).toBeNull()
    expect(seededTypeOf(wt('Implantaadi kroon'))).toBeNull()
  })

  it('survives nothing', () => {
    expect(seededTypeOf(null)).toBeNull()
    expect(seededTypeOf(undefined)).toBeNull()
  })
})
