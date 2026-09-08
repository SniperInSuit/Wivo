/**
 * Which printers work from capsules.
 *
 * This predicate exists because the job form once refused to save a finished
 * Pro2 job until somebody entered a capsule count — on a machine that has no
 * capsules. The rule had been keyed off the MATERIAL, and no material can
 * answer the question: the same resin is a cartridge on one printer and a
 * bottle on the next.
 */
import { describe, it, expect } from 'vitest'
import { usesCapsules } from './priceBook'

describe('usesCapsules', () => {
  it('is true for a machine on the list', () => {
    expect(usesCapsules('Midas', ['Midas'])).toBe(true)
  })

  // The bug, as a test. A Pro2 must never be asked for capsules just because
  // Midas is configured somewhere.
  it('is false for a machine that is not on it', () => {
    expect(usesCapsules('Pro2', ['Midas'])).toBe(false)
  })

  // The default. A lab that has configured nothing must not be blocked by a
  // feature it has never heard of.
  it('is false when nothing is configured', () => {
    expect(usesCapsules('Midas', [])).toBe(false)
    expect(usesCapsules('Midas', null)).toBe(false)
    expect(usesCapsules('Midas', undefined)).toBe(false)
  })

  // "No machine" is not a capsule machine — a job that never went near a
  // printer did not print from a capsule.
  it('is false when the job has no machine', () => {
    expect(usesCapsules('', ['Midas'])).toBe(false)
    expect(usesCapsules(null, ['Midas'])).toBe(false)
    expect(usesCapsules('   ', ['Midas'])).toBe(false)
  })

  // Machine names are typed by hand in Seaded and picked as buttons on the job,
  // so a stray space or a different capital must not silently turn the rule off.
  it('ignores case and surrounding space', () => {
    expect(usesCapsules(' midas ', ['Midas'])).toBe(true)
    expect(usesCapsules('MIDAS', ['midas'])).toBe(true)
  })

  it('does not match a machine whose name merely contains another', () => {
    expect(usesCapsules('Midas Pro', ['Midas'])).toBe(false)
    expect(usesCapsules('Pro2', ['Pro'])).toBe(false)
  })
})
