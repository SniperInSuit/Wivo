/**
 * Adaptive behaviour per work type.
 *
 * The case that matters most is the RENAMED type: the work-type list is edited
 * by the lab, and a rule keyed on the literal string 'Kaitse / splint' would
 * start demanding teeth for a nightguard the day someone renames it. Every
 * assertion below goes through the user's list, never through a constant.
 */
import { describe, expect, it } from 'vitest'
import type { WorkType } from '../pricing/workTypes'
import { DEFAULT_WORK_TYPES } from '../pricing/workTypes'
import { jobRules, workTypeRules } from './workTypeRules'

const TYPES = DEFAULT_WORK_TYPES

describe('workTypeRules — tooth-level work', () => {
  it('a crown asks for teeth and suggests keeping it to one', () => {
    const r = workTypeRules('Kroon', TYPES)
    expect(r.toothMode).toBe('tooth')
    expect(r.requiresTeeth).toBe(true)
    expect(r.suggestSingleTooth).toBe(true)
    expect(r.isBridge).toBe(false)
    expect(r.supportsShade).toBe(true)
    expect(r.supportsGlaze).toBe(true)
  })

  it('a bridge asks for teeth but never for a single one', () => {
    const r = workTypeRules('Sild', TYPES)
    expect(r.isBridge).toBe(true)
    expect(r.requiresTeeth).toBe(true)
    expect(r.suggestSingleTooth).toBe(false)
  })

  it('resolves free text through the same matcher as pricing', () => {
    // 'abutmendile' is an Implantkroon synonym, and it contains 'kroon' too —
    // resolution order decides, exactly as it does for the price.
    const r = workTypeRules('D14 abutmendile kroon', TYPES)
    expect(r.nimi).toBe('Implantkroon')
    expect(r.toothMode).toBe('tooth')
  })
})

describe('workTypeRules — arch-level work', () => {
  it('All-on-X takes a whole arch, not individual teeth', () => {
    const r = workTypeRules('All-on-X', TYPES)
    expect(r.toothMode).toBe('arch')
    expect(r.requiresArch).toBe(true)
    expect(r.requiresTeeth).toBe(false)
    expect(r.autoFullArch).toBe(true)
  })

  it('a denture is arch work, not an appliance', () => {
    // 'Proteez' would also hit the appliance family through nothing here, but
    // the arch test runs first on purpose — it is a full-arch piece of work.
    expect(workTypeRules('Proteez', TYPES).toothMode).toBe('arch')
  })
})

describe('workTypeRules — appliances never force a tooth selection', () => {
  it.each(['Kaitse / splint', 'Retainer', 'IBT'])('%s needs no teeth', (name) => {
    const r = workTypeRules(name, TYPES)
    expect(r.toothMode).toBe('none')
    expect(r.requiresTeeth).toBe(false)
    expect(r.requiresArch).toBe(false)
    expect(r.supportsShade).toBe(false)
  })

  it('a surgical guide keeps its teeth but loses the shade', () => {
    const r = workTypeRules('Kirurgiline', TYPES)
    expect(r.toothMode).toBe('tooth')
    expect(r.supportsShade).toBe(false)
    expect(r.supportsGlaze).toBe(false)
  })
})

describe('workTypeRules — the user edits the list', () => {
  it('a RENAMED splint still classifies through its synonyms', () => {
    const renamed: WorkType[] = [
      { nimi: 'Öine kaitse', hex: '#06B6D4', match: ['nightguard', 'splint'] },
    ]
    const r = workTypeRules('Öine kaitse', renamed)
    expect(r.nimi).toBe('Öine kaitse')
    expect(r.toothMode).toBe('none')
    expect(r.requiresTeeth).toBe(false)
  })

  it('a renamed bridge still validates as a bridge', () => {
    const renamed: WorkType[] = [{ nimi: 'Sillakonstruktsioon', hex: '#8B5CF6', match: ['bridge'] }]
    expect(workTypeRules('Sillakonstruktsioon', renamed).isBridge).toBe(true)
  })

  it('a brand-new type gets the permissive default, not a wrong rule', () => {
    const custom: WorkType[] = [{ nimi: 'Kapa', hex: '#000' }]
    const r = workTypeRules('Kapa', custom)
    expect(r.unknown).toBe(false)
    expect(r.toothMode).toBe('tooth')
    expect(r.requiresTeeth).toBe(true)
  })

  it('an unresolvable type demands nothing at all', () => {
    const r = workTypeRules('Midagi täiesti muud', [])
    expect(r.unknown).toBe(true)
    expect(r.requiresTeeth).toBe(false)
    expect(r.requiresArch).toBe(false)
    expect(r.supportsShade).toBe(true)
    expect(r.supportsGlaze).toBe(false)
  })
})

describe('jobRules — the whole job', () => {
  it('skips the teeth step only when nothing on the job has teeth', () => {
    expect(jobRules(['Kaitse / splint', 'Retainer'], TYPES).needsTeethStep).toBe(false)
    expect(jobRules(['Kaitse / splint', 'Kroon'], TYPES).needsTeethStep).toBe(true)
  })

  it('an arch-only job still shows the step, in arch mode', () => {
    const r = jobRules(['All-on-X'], TYPES)
    expect(r.teethStepMode).toBe('arch')
    expect(r.needsTeethStep).toBe(true)
    expect(r.autoFullArchTypes).toEqual(['All-on-X'])
  })

  it('a mixed job shows the odontogram — the crown needs it', () => {
    const r = jobRules(['All-on-X', 'Kroon'], TYPES)
    expect(r.teethStepMode).toBe('tooth')
    expect(r.toothTypes).toEqual(['Kroon'])
    expect(r.archTypes).toEqual(['All-on-X'])
  })

  it('shade support is an OR: one type that needs it keeps the block visible', () => {
    expect(jobRules(['Kaitse / splint'], TYPES).supportsShade).toBe(false)
    expect(jobRules(['Kaitse / splint', 'Kroon'], TYPES).supportsShade).toBe(true)
  })
})

describe('workTypeRules — identity is the asked-for name, not the resolved one', () => {
  // resolveWorkType() is a first-match SUBSTRING matcher over a user-edited
  // list, so a lab type listed after a broader one resolves to the broader one.
  // The classification that comes back is right; the NAME is not. Everything
  // that keys state — selectedTeeth, colorMap, WorkItem.too — must therefore
  // travel on `too`, or step 2 writes to one key while validation reads another
  // and the wizard can never be completed.
  const LAB: WorkType[] = [
    ...DEFAULT_WORK_TYPES,
    { nimi: 'Zirkoonkroon', hex: '#111111' },
    { nimi: 'Kroonisild', hex: '#222222' },
  ]

  it('keeps the asked-for string as the state key', () => {
    const r = workTypeRules('Zirkoonkroon', LAB)
    expect(r.nimi).toBe('Kroon')   // resolved — where the rules came from
    expect(r.too).toBe('Zirkoonkroon') // asked — what selectedTeeth is keyed by
  })

  it('jobRules lists the asked-for strings, so they can be used as keys', () => {
    const r = jobRules(['Zirkoonkroon'], LAB)
    expect(r.toothTypes).toEqual(['Zirkoonkroon'])
    expect(r.perType[0].nimi).toBe('Kroon')
  })

  it('classifies on the asked-for name too, so a lab bridge is still a bridge', () => {
    // 'Kroonisild' contains 'kroon' and Kroon is listed before Sild, so it
    // resolves to Kroon. Its own name is what reveals it as a bridge.
    const r = workTypeRules('Kroonisild', LAB)
    expect(r.nimi).toBe('Kroon')
    expect(r.isBridge).toBe(true)
    expect(r.suggestSingleTooth).toBe(false)
  })
})
