/**
 * The gate on every step, and the exact Estonian the user is shown.
 *
 * The message strings are asserted verbatim: they are the product surface, and
 * a builder who reworded one in a component would otherwise ship two different
 * ways of saying the same thing without anything failing.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_WORK_TYPES } from '../pricing/workTypes'
import { isStepSkipped, maxReachableStep, nextStep, prevStep, stepStatus } from './steps'
import type { NewJobState } from './types'
import { createEmptyNewJobState } from './types'
import { canContinue, canCreate, validateAll, validateStep } from './validation'
import { jobRules } from './workTypeRules'

const TYPES = DEFAULT_WORK_TYPES

const state = (over: Partial<NewJobState> = {}): NewJobState => ({
  ...createEmptyNewJobState({ date: '2026-08-06' }),
  ...over,
})

/** A job that validates end to end, so each test can break exactly one thing. */
const valid = (over: Partial<NewJobState> = {}): NewJobState => state({
  jobTypes: ['Kroon'],
  selectedTeeth: { Kroon: [11] },
  materialByType: { Kroon: 'Crown HT' },
  patient: { name: 'Mari Maasikas', patientId: null },
  ...over,
})

const messages = (out: ReturnType<typeof validateStep>): string[] => out.map(e => e.message)

describe('step 1 — töö tüüp', () => {
  it('blocks with nothing chosen', () => {
    expect(messages(validateStep(1, state(), TYPES))).toEqual(['Vali vähemalt üks töö tüüp.'])
    expect(canContinue(1, state(), TYPES)).toBe(false)
  })

  it('passes with one type', () => {
    expect(canContinue(1, state({ jobTypes: ['Kroon'] }), TYPES)).toBe(true)
  })
})

describe('step 2 — hambad', () => {
  it('asks for teeth by the work type name', () => {
    const s = state({ jobTypes: ['Kroon'] })
    expect(messages(validateStep(2, s, TYPES))).toEqual(['Vali hambad tööle „Kroon".'])
  })

  it('demands two teeth for a bridge', () => {
    const s = state({ jobTypes: ['Sild'], selectedTeeth: { Sild: [14] } })
    expect(messages(validateStep(2, s, TYPES))).toEqual(['„Sild" on sild — vali vähemalt kaks hammast.'])
  })

  it('demands consecutive teeth for a bridge, and names the gap', () => {
    const s = state({ jobTypes: ['Sild'], selectedTeeth: { Sild: [14, 16] } })
    expect(messages(validateStep(2, s, TYPES)))
      .toEqual(['„Sild" on sild — vali järjestikused hambad ühes lõualuus. Puudu: 15.'])
  })

  it('lists every missing tooth up to the cap', () => {
    const s = state({ jobTypes: ['Sild'], selectedTeeth: { Sild: [13, 16] } })
    expect(messages(validateStep(2, s, TYPES)))
      .toEqual(['„Sild" on sild — vali järjestikused hambad ühes lõualuus. Puudu: 15, 14.'])
  })

  // Fourteen numbers is not an instruction — past the cap the message stays
  // the plain sentence rather than becoming a wall of digits.
  it('drops the list when the gap is too wide to read', () => {
    const s = state({ jobTypes: ['Sild'], selectedTeeth: { Sild: [18, 28] } })
    expect(messages(validateStep(2, s, TYPES)))
      .toEqual(['„Sild" on sild — vali järjestikused hambad ühes lõualuus.'])
  })

  it('demands one arch for a bridge', () => {
    const s = state({ jobTypes: ['Sild'], selectedTeeth: { Sild: [16, 46] } })
    expect(messages(validateStep(2, s, TYPES)))
      .toEqual(['„Sild" on sild — hambad peavad olema samas lõualuus.'])
  })

  it('accepts a bridge across the midline', () => {
    const s = state({ jobTypes: ['Sild'], selectedTeeth: { Sild: [12, 11, 21] } })
    expect(canContinue(2, s, TYPES)).toBe(true)
  })

  it('warns but never blocks on a multi-tooth crown', () => {
    const s = state({ jobTypes: ['Kroon'], selectedTeeth: { Kroon: [11, 12] } })
    const out = validateStep(2, s, TYPES)
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('warning')
    expect(out[0].message).toBe('„Kroon" jaoks on valitud rohkem kui üks hammas.')
    expect(canContinue(2, s, TYPES)).toBe(true)
  })

  it('asks an arch job for a jaw, once', () => {
    const s = state({ jobTypes: ['All-on-X', 'Proteez'] })
    expect(messages(validateStep(2, s, TYPES)))
      .toEqual(['Vali lõualuu: ülemine, alumine või mõlemad.'])
    expect(canContinue(2, state({ jobTypes: ['All-on-X'], selectedArch: 'upper' }), TYPES)).toBe(true)
  })

  it('asks an appliance job for nothing', () => {
    const s = state({ jobTypes: ['Kaitse / splint'] })
    expect(validateStep(2, s, TYPES)).toEqual([])
  })
})

describe('step 3 — materjal', () => {
  it('blocks on an empty material list', () => {
    expect(messages(validateStep(3, state(), TYPES))).toEqual(['Vali materjal või lisa oma materjal.'])
  })

  it('does not accept whitespace as a material', () => {
    const one = { jobTypes: ['Kroon'] }
    expect(canContinue(3, state({ ...one, materialByType: { Kroon: '  ' } }), TYPES)).toBe(false)
    expect(canContinue(3, state({ ...one, materialByType: { Kroon: 'Crown HT' } }), TYPES)).toBe(true)
  })
})

describe('step 4 — tootmine', () => {
  it('refuses a deadline before the job arrived', () => {
    const s = state({ date: '2026-08-06', deadline: '2026-08-05' })
    expect(messages(validateStep(4, s, TYPES)))
      .toEqual(['Tähtaeg ei saa olla enne töö vastuvõtu kuupäeva.'])
  })

  it('refuses a time with no date', () => {
    const s = state({ time: '14:00' })
    expect(messages(validateStep(4, s, TYPES)))
      .toEqual(['Määra tähtaja kuupäev või eemalda kellaaeg.'])
  })

  it('warns about kiirtöö without blocking', () => {
    const s = state({ priority: 'kiirtoo' })
    expect(messages(validateStep(4, s, TYPES))).toEqual(['Kiirtöö kahekordistab tootmishinna.'])
    expect(canContinue(4, s, TYPES)).toBe(true)
  })

  it('is otherwise entirely optional', () => {
    expect(validateStep(4, state(), TYPES)).toEqual([])
  })
})

describe('step 5 — patsient', () => {
  it('requires a patient name', () => {
    expect(messages(validateStep(5, state(), TYPES))).toEqual(['Patsiendi nimi on kohustuslik.'])
    expect(canContinue(5, state({ patient: { name: '   ', patientId: null } }), TYPES)).toBe(false)
    expect(canContinue(5, state({ patient: { name: 'Mari', patientId: null } }), TYPES)).toBe(true)
  })
})

describe('step 6 — kontroll', () => {
  it('repeats every earlier blocker, in step order', () => {
    const out = validateStep(6, state(), TYPES)
    expect(messages(out)).toEqual([
      'Vali vähemalt üks töö tüüp.',
      'Vali materjal või lisa oma materjal.',
      'Patsiendi nimi on kohustuslik.',
    ])
    expect(out).toEqual(validateAll(state(), TYPES))
  })

  it('lets a complete job be created', () => {
    expect(canCreate(valid(), TYPES)).toBe(true)
    expect(canCreate(valid({ patient: null }), TYPES)).toBe(false)
  })

  it('a kiirtöö warning never stops creation', () => {
    expect(canCreate(valid({ priority: 'kiirtoo' }), TYPES)).toBe(true)
  })
})

describe('navigation', () => {
  it('skips step 2 for an appliance-only job, and only step 2', () => {
    const rules = jobRules(['Kaitse / splint'], TYPES)
    expect(isStepSkipped(2, rules)).toBe(true)
    expect(isStepSkipped(3, rules)).toBe(false)
    expect(nextStep(1, rules)).toBe(3)
    expect(prevStep(3, rules)).toBe(1)
  })

  it('walks straight through when teeth are needed', () => {
    const rules = jobRules(['Kroon'], TYPES)
    expect(nextStep(1, rules)).toBe(2)
    expect(nextStep(6, rules)).toBe(6)
    expect(prevStep(1, rules)).toBe(1)
  })

  it('stops forward travel at the first unanswered step', () => {
    expect(maxReachableStep(state(), TYPES)).toBe(1)
    expect(maxReachableStep(state({ jobTypes: ['Kroon'] }), TYPES)).toBe(2)
    expect(maxReachableStep(valid({ patient: null }), TYPES)).toBe(5)
    expect(maxReachableStep(valid(), TYPES)).toBe(6)
  })

  it('does not let a skipped step 2 hold the user back', () => {
    const s = state({ jobTypes: ['Kaitse / splint'] })
    expect(maxReachableStep(s, TYPES)).toBe(3)   // 2 is skipped, 3 wants a material
  })

  it('marks a skipped step as skipped, not as done', () => {
    const s = valid({ jobTypes: ['Kaitse / splint'], currentStep: 3 })
    expect(stepStatus(2, s, TYPES)).toBe('skipped')
    expect(stepStatus(1, s, TYPES)).toBe('done')
    expect(stepStatus(3, s, TYPES)).toBe('current')
    expect(stepStatus(4, s, TYPES)).toBe('todo')
  })
})
