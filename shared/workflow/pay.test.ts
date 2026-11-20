/**
 * §10: who a job's stages pay, and each person's part. The rules that decide
 * money, so every branch is here: today's rule wherever a stage has nobody,
 * each pay kind on its own, a revision's own people first, and the split adds
 * up to the cent.
 */
import { describe, it, expect } from 'vitest'
import {
  stagePeople, jobPayees, revisionPayees, paysPerson, partOf, payStagesFromRows, type PayStage,
} from './pay'
import type { PayRole } from './workflow'

const st = (stageKey: string, payRole: PayRole | null, people: string[], over: Partial<PayStage> = {}): PayStage =>
  ({ stageKey, position: 0, payRole, skipped: false, people, ...over })

const LAB: PayStage[] = [
  st('vastuvott', null, ['it'], { position: 0 }),
  st('disain', 'disain', ['d1', 'd2'], { position: 1 }),
  st('printimine', 'mudel', ['m1'], { position: 2 }),
  st('freesimine', 'too', ['t1'], { position: 3 }),
  st('parandus', 'muudatus', ['r1', 'r2'], { position: 4 }),
]

describe('stagePeople: the stage rule, or null for today\'s rule', () => {
  it('an old job (no stages, empty list) has no stage rule for any kind', () => {
    for (const role of ['too', 'disain', 'mudel', 'muudatus'] as const) {
      expect(stagePeople(undefined, role)).toBeNull()
      expect(stagePeople(null, role)).toBeNull()
      expect(stagePeople([], role)).toBeNull()
    }
  })

  it('the people on the stage that carries the kind, sorted', () => {
    expect(stagePeople([st('disain', 'disain', ['zed', 'amy'])], 'disain')).toEqual(['amy', 'zed'])
    expect(stagePeople(LAB, 'too')).toEqual(['t1'])
  })

  it('no stage with that kind: null', () => {
    expect(stagePeople([st('disain', 'disain', ['d1'])], 'too')).toBeNull()
  })

  it('a stage with people but no pay kind pays nothing by stage', () => {
    expect(stagePeople([st('vastuvott', null, ['it'])], 'too')).toBeNull()
  })

  it('the stage has nobody: null, so today\'s rule pays', () => {
    expect(stagePeople([st('freesimine', 'too', [])], 'too')).toBeNull()
  })

  it('a skipped stage: null, whoever is on it', () => {
    expect(stagePeople([st('freesimine', 'too', ['t1'], { skipped: true })], 'too')).toBeNull()
  })

  it('the same person twice counts once; empty ids are dropped', () => {
    expect(stagePeople([st('disain', 'disain', ['d1', 'd1', ''])], 'disain')).toEqual(['d1'])
    expect(stagePeople([st('disain', 'disain', [''])], 'disain')).toBeNull()
  })

  it('two stages with one kind (the database prevents it): the first by position decides', () => {
    const two = [st('b', 'too', ['late'], { position: 5 }), st('a', 'too', ['early'], { position: 1 })]
    expect(stagePeople(two, 'too')).toEqual(['early'])
    // ...even when the first one is skipped: it does not fall through to the other.
    const skippedFirst = [st('b', 'too', ['late'], { position: 5 }), st('a', 'too', ['early'], { position: 1, skipped: true })]
    expect(stagePeople(skippedFirst, 'too')).toBeNull()
  })
})

describe('jobPayees: each kind on its own', () => {
  it('an old job: today\'s rule everywhere', () => {
    expect(jobPayees(undefined)).toEqual({ too: { by: 'legacy' }, disain: { by: 'legacy' }, mudel: { by: 'legacy' } })
    expect(jobPayees([])).toEqual({ too: { by: 'legacy' }, disain: { by: 'legacy' }, mudel: { by: 'legacy' } })
  })

  it('a full lab template: every kind by its stage', () => {
    const p = jobPayees(LAB)
    expect(p.too).toEqual({ by: 'stage', people: ['t1'] })
    expect(p.disain).toEqual({ by: 'stage', people: ['d1', 'd2'] })
    expect(p.mudel).toEqual({ by: 'stage', people: ['m1'] })
  })

  it('no model stage: the model goes with the piece work', () => {
    const p = jobPayees([st('freesimine', 'too', ['t1', 't2'])])
    expect(p.mudel).toEqual({ by: 'stage', people: ['t1', 't2'] })
  })

  it('no model stage and no piece-work stage: the model is today\'s rule too', () => {
    expect(jobPayees([st('disain', 'disain', ['d1'])]).mudel).toEqual({ by: 'legacy' })
  })

  it('design by stage, piece work by today\'s rule, and the other way round', () => {
    expect(jobPayees([st('disain', 'disain', ['d1'])])).toEqual({
      too: { by: 'legacy' }, disain: { by: 'stage', people: ['d1'] }, mudel: { by: 'legacy' },
    })
    expect(jobPayees([st('freesimine', 'too', ['t1'])]).disain).toEqual({ by: 'legacy' })
  })

  it('a skipped model stage: the model falls back to the piece work', () => {
    const p = jobPayees([st('freesimine', 'too', ['t1']), st('printimine', 'mudel', ['m1'], { skipped: true })])
    expect(p.mudel).toEqual({ by: 'stage', people: ['t1'] })
  })
})

describe('revisionPayees: the revision\'s own people first (sql/087)', () => {
  it('its own technician: today\'s rule, whatever the stages say', () => {
    expect(revisionPayees(LAB, { assigned_to: 'own' }).tech).toEqual({ by: 'legacy' })
  })

  it('no technician of its own: the muudatus stage', () => {
    expect(revisionPayees(LAB, {}).tech).toEqual({ by: 'stage', people: ['r1', 'r2'] })
    expect(revisionPayees(LAB, { assigned_to: null }).tech).toEqual({ by: 'stage', people: ['r1', 'r2'] })
  })

  it('no muudatus stage: whoever is paid for the piece work', () => {
    const stages = [st('freesimine', 'too', ['t1'])]
    expect(revisionPayees(stages, {}).tech).toEqual({ by: 'stage', people: ['t1'] })
  })

  it('no muudatus and no piece-work stage: today\'s rule (the job\'s technician)', () => {
    expect(revisionPayees([st('disain', 'disain', ['d1'])], {}).tech).toEqual({ by: 'legacy' })
    expect(revisionPayees(undefined, {}).tech).toEqual({ by: 'legacy' })
  })

  it('its own designer: today\'s rule; else the design stage; else today\'s rule', () => {
    expect(revisionPayees(LAB, { designed_by: 'own' }).design).toEqual({ by: 'legacy' })
    expect(revisionPayees(LAB, {}).design).toEqual({ by: 'stage', people: ['d1', 'd2'] })
    expect(revisionPayees([st('freesimine', 'too', ['t1'])], {}).design).toEqual({ by: 'legacy' })
  })

  it('a skipped muudatus stage falls to the piece work', () => {
    const stages = [st('freesimine', 'too', ['t1']), st('parandus', 'muudatus', ['r1'], { skipped: true })]
    expect(revisionPayees(stages, {}).tech).toEqual({ by: 'stage', people: ['t1'] })
  })
})

describe('paysPerson', () => {
  it('only a stage answers; today\'s rule is the caller\'s own test', () => {
    expect(paysPerson({ by: 'stage', people: ['a', 'b'] }, 'b')).toBe(true)
    expect(paysPerson({ by: 'stage', people: ['a', 'b'] }, 'c')).toBe(false)
    expect(paysPerson({ by: 'legacy' }, 'a')).toBe(false)
  })
})

describe('partOf: equal parts, whole cents, adding up exactly', () => {
  it('one person: the amount itself, untouched (not even rounded)', () => {
    expect(partOf(45.005, ['a'], 'a')).toEqual({ amount: 45.005, fraction: 1, heads: 1 })
  })

  it('not among the people: null', () => {
    expect(partOf(10, ['a', 'b'], 'c')).toBeNull()
  })

  it('two people halve it', () => {
    expect(partOf(45, ['a', 'b'], 'a')).toEqual({ amount: 22.5, fraction: 0.5, heads: 2 })
    expect(partOf(45, ['a', 'b'], 'b')).toEqual({ amount: 22.5, fraction: 0.5, heads: 2 })
  })

  it('an odd cent goes to the first in id order, the same every time', () => {
    expect(partOf(45.01, ['b', 'a'], 'a')!.amount).toBe(22.51)
    expect(partOf(45.01, ['b', 'a'], 'b')!.amount).toBe(22.5)
  })

  it('three ways: 100 € is 33.34 + 33.33 + 33.33', () => {
    const people = ['c', 'a', 'b']
    const parts = people.map(p => partOf(100, people, p)!.amount)
    expect(parts.sort()).toEqual([33.33, 33.33, 33.34])
    expect(Math.round(parts.reduce((s, x) => s + x, 0) * 100)).toBe(10000)
  })

  it('the parts add up to the amount for every amount and head count', () => {
    for (let cents = 0; cents <= 2000; cents += 7) {
      for (let heads = 2; heads <= 5; heads++) {
        const people = Array.from({ length: heads }, (_, i) => `p${i}`)
        const sum = people.reduce((s, p) => s + Math.round(partOf(cents / 100, people, p)!.amount * 100), 0)
        expect(sum).toBe(cents)
      }
    }
  })

  it('an amount with float noise is taken to the nearest cent before splitting', () => {
    // 0.1 + 0.2 = 0.30000000000000004
    expect(partOf(0.1 + 0.2, ['a', 'b'], 'a')!.amount).toBe(0.15)
  })

  it('a duplicate id does not make a third head', () => {
    expect(partOf(10, ['a', 'a', 'b'], 'a')).toEqual({ amount: 5, fraction: 0.5, heads: 2 })
  })

  it('one cent among three: the first gets it, the others get nothing', () => {
    expect(partOf(0.01, ['a', 'b', 'c'], 'a')!.amount).toBe(0.01)
    expect(partOf(0.01, ['a', 'b', 'c'], 'c')!.amount).toBe(0)
  })
})

describe('payStagesFromRows: what the jobs query embeds', () => {
  it('reads a row, its people and whether it is skipped', () => {
    expect(payStagesFromRows([
      { stage_key: 'freesimine', position: 3, pay_role: 'too', skipped_at: null, job_stage_person: [{ profile_id: 't1' }, { profile_id: 't2' }] },
      { stage_key: 'disain', position: 1, pay_role: 'disain', skipped_at: '2026-11-20T10:00:00Z', job_stage_person: [] },
    ])).toEqual([
      { stageKey: 'disain', position: 1, payRole: 'disain', skipped: true, people: [] },
      { stageKey: 'freesimine', position: 3, payRole: 'too', skipped: false, people: ['t1', 't2'] },
    ])
  })

  it('no rows, or not an array: no stages (today\'s rule)', () => {
    expect(payStagesFromRows(undefined)).toEqual([])
    expect(payStagesFromRows(null)).toEqual([])
    expect(payStagesFromRows({})).toEqual([])
  })

  it('leaves out a row it cannot read rather than guessing', () => {
    expect(payStagesFromRows([
      null, 'x',
      { stage_key: 'a', position: 0, pay_role: null },          // no pay kind
      { stage_key: 'b', position: 0, pay_role: 'bonus' },       // not a pay kind
      { position: 0, pay_role: 'too' },                          // no key
    ])).toEqual([])
  })

  it('people without an id are dropped; a missing person list is nobody', () => {
    expect(payStagesFromRows([
      { stage_key: 'a', position: 0, pay_role: 'too', skipped_at: null, job_stage_person: [{ profile_id: null }, {}, { profile_id: 'p' }] },
      { stage_key: 'b', position: 1, pay_role: 'disain', skipped_at: null },
    ]).map(s => s.people)).toEqual([['p'], []])
  })
})
