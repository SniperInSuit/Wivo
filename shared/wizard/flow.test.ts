/**
 * Whole-journey tests: can a job of this shape actually be finished?
 *
 * The per-module tests check one rule at a time. These check the thing that
 * only shows up when the rules are composed — a step whose Continue can never
 * go green, which is the one failure mode a wizard must not have. Every case
 * below was a real dead end during integration.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_WORK_TYPES } from '../pricing/workTypes'
import { archTeeth } from './archRules'
import { maxReachableStep, nextStep } from './steps'
import { createEmptyNewJobState, type NewJobState } from './types'
import { canCreate, validateStep } from './validation'
import { jobRules } from './workTypeRules'

const TYPES = DEFAULT_WORK_TYPES

/** A state that answers everything steps 3-5 ask, so tests can focus on 1-2. */
const filled = (patch: Partial<NewJobState>): NewJobState => ({
  ...createEmptyNewJobState({ date: '2026-01-10' }),
  materials: ['Zirkoon'],
  patient: { name: 'Mari Maasikas', patientId: null },
  ...patch,
})

describe('a job can always be finished', () => {
  it('crown on one tooth', () => {
    const state = filled({ jobTypes: ['Kroon'], selectedTeeth: { Kroon: [16] } })
    expect(canCreate(state, TYPES)).toBe(true)
    expect(maxReachableStep(state, TYPES)).toBe(6)
  })

  it('All-on-X AND a crown — the arch must not swallow every tooth', () => {
    // The arch type covers the whole upper jaw. If arch work owned individual
    // teeth, the crown could never be given one and step 2 would be a wall.
    const state = filled({
      jobTypes: ['All-on-X', 'Kroon'],
      selectedArch: 'both',
      selectedTeeth: { 'All-on-X': archTeeth('both'), Kroon: [16] },
    })
    expect(validateStep(2, state, TYPES).filter(e => e.severity === 'error')).toEqual([])
    expect(canCreate(state, TYPES)).toBe(true)
  })

  it('a nightguard skips step 2 entirely and still reaches the end', () => {
    const state = filled({ jobTypes: ['Kaitse / splint'] })
    const rules = jobRules(state.jobTypes, TYPES)
    expect(rules.needsTeethStep).toBe(false)
    expect(nextStep(1, rules)).toBe(3)
    expect(canCreate(state, TYPES)).toBe(true)
  })

  it('a bridge is blocked while gapped and clears once it is contiguous', () => {
    const gapped = filled({ jobTypes: ['Sild'], selectedTeeth: { Sild: [14, 16] } })
    expect(canCreate(gapped, TYPES)).toBe(false)
    // Blocked AT step 2, not somewhere later — the user is sent to the right screen.
    expect(maxReachableStep(gapped, TYPES)).toBe(2)

    const closed = { ...gapped, selectedTeeth: { Sild: [14, 15, 16] } }
    expect(canCreate(closed, TYPES)).toBe(true)
  })

  it('a lab type that resolves to a broader one is still keyed by its own name', () => {
    // "Zirkoonkroon" contains "kroon", so resolveWorkType() lands on Kroon.
    // The teeth must still be found under the name the user actually picked.
    const LAB = [...TYPES, { nimi: 'Zirkoonkroon', hex: '#111111' }]
    const state = filled({ jobTypes: ['Zirkoonkroon'], selectedTeeth: { Zirkoonkroon: [21] } })
    expect(validateStep(2, state, LAB).filter(e => e.severity === 'error')).toEqual([])
    expect(canCreate(state, LAB)).toBe(true)
  })

  it('a rush job warns but is never blocked by the warning', () => {
    const state = filled({
      jobTypes: ['Kroon'], selectedTeeth: { Kroon: [16] }, priority: 'kiirtoo',
    })
    const step4 = validateStep(4, state, TYPES)
    expect(step4.some(e => e.severity === 'warning')).toBe(true)
    expect(step4.some(e => e.severity === 'error')).toBe(false)
    expect(canCreate(state, TYPES)).toBe(true)
  })

  it('no patient blocks creation, and points at step 5', () => {
    const state = filled({ jobTypes: ['Kroon'], selectedTeeth: { Kroon: [16] }, patient: null })
    expect(canCreate(state, TYPES)).toBe(false)
    expect(maxReachableStep(state, TYPES)).toBe(5)
  })
})
