import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ONLY_IF_RULES, PAY_ROLES, canMoveStage, materialiseTemplate, previousStage, ruleHolds, rulesHold,
  splitEqually, validateTemplate, type JobStageState, type TemplateStage,
} from './workflow'

const stage = (stageKey: string, position: number, over: Partial<TemplateStage> = {}): TemplateStage => ({
  stageKey, position, task: null, optional: false, defaultOn: false, onlyIf: [], orderer: false, payRole: null, people: [], ...over,
})

describe('the closed lists match the database (sql/122)', () => {
  const sql = readFileSync(join(__dirname, '../../sql/122_workflow_templates.sql'), 'utf8')
  it('only_if', () => {
    const m = /only_if <@ array\[([^\]]+)\]/.exec(sql)
    expect(m?.[1].match(/'([a-z_0-9]+)'/g)?.map(s => s.slice(1, -1))).toEqual([...ONLY_IF_RULES])
  })
  it('pay_role', () => {
    const m = /pay_role is null or pay_role in \(([^)]+)\)/.exec(sql)
    expect(m?.[1].match(/'([a-z_]+)'/g)?.map(s => s.slice(1, -1))).toEqual([...PAY_ROLES])
  })
  it('pay_role is the pay kinds of lib/earnings.ts', () => {
    const src = readFileSync(join(__dirname, '../../src/renderer/src/lib/earnings.ts'), 'utf8')
    const m = /export type RateScope = ([^\n]+)/.exec(src)
    expect(m?.[1].match(/'([a-z]+)'/g)?.map(s => s.slice(1, -1)).sort()).toEqual([...PAY_ROLES].sort())
  })
})

describe('rules (§2.5)', () => {
  it('photogrammetry: digital AND more than one implant', () => {
    const rules = ['digital', 'implants_gt_1'] as const
    expect(rulesHold(rules, { impressionType: 'digital', implantCount: 2 })).toBe(true)
    expect(rulesHold(rules, { impressionType: 'digital', implantCount: 1 })).toBe(false)
    expect(rulesHold(rules, { impressionType: 'conventional', implantCount: 4 })).toBe(false)
    expect(rulesHold(rules, { impressionType: 'digital' })).toBe(false)
  })
  it('a field not filled in makes its rule false; no rules: always', () => {
    for (const r of ONLY_IF_RULES) expect(ruleHolds(r, {})).toBe(false)
    expect(rulesHold([], {})).toBe(true)
  })
  it('each rule reads its own field', () => {
    expect(ruleHolds('conventional', { impressionType: 'conventional' })).toBe(true)
    expect(ruleHolds('print', { productionMethod: 'print' })).toBe(true)
    expect(ruleHolds('mill', { productionMethod: 'print' })).toBe(false)
    expect(ruleHolds('printed_model', { printedModel: true })).toBe(true)
    expect(ruleHolds('printed_model', { printedModel: false })).toBe(false)
  })
})

describe('validating a template', () => {
  it('a pay kind on two stages is refused, naming both', () => {
    expect(validateTemplate([stage('disain', 0, { payRole: 'disain' }), stage('print', 1, { payRole: 'disain' })]))
      .toEqual([{ code: 'pay_role_twice', payRole: 'disain', stageKeys: ['disain', 'print'] }])
  })
  it('each pay kind once, and stages without one: fine', () => {
    expect(validateTemplate([
      stage('vastuvott', 0), stage('disain', 1, { payRole: 'disain' }), stage('print', 2, { payRole: 'too' }),
      stage('mudel', 3, { payRole: 'mudel' }), stage('viimistlus', 4),
    ])).toEqual([])
  })
  it('the other mistakes the database would refuse', () => {
    const codes = validateTemplate([
      stage('a', 0), stage('a', 1), stage('b', 1),
      stage('c', 2, { optional: true, onlyIf: ['digital'] }),
      stage('d', 3, { defaultOn: true }),
      stage('e', 4, { onlyIf: ['someday' as never] }),
      stage('f', 5, { payRole: 'bonus' as never }),
      stage(' ', 6),
    ]).map(p => p.code)
    expect(codes).toEqual(['stage_twice', 'position_twice', 'switch_and_rule', 'default_on_without_switch',
      'unknown_rule', 'unknown_pay_role', 'empty_stage_key'])
  })
})

describe('a job from a template (§2.3–2.6a)', () => {
  const crownLab: TemplateStage[] = [
    stage('skaneering', 0, { orderer: true }),
    stage('vastuvott', 1, { people: ['it'] }),
    stage('fotogramm', 2, { orderer: true, onlyIf: ['digital', 'implants_gt_1'] }),
    stage('vahamudel', 3, { optional: true }),
    stage('disain', 4, { people: ['digi'], payRole: 'disain', task: 'Design the crown' }),
    stage('freesimine', 5, { payRole: 'too' }),
    stage('qc', 6, { optional: true, defaultOn: false }),
    stage('viimistlus', 7, { people: ['hand1', 'hand2'] }),
    stage('valmis', 8),
  ]

  it('rules and switches decide the stages; positions run 0, 1, 2…', () => {
    const plan = materialiseTemplate({ stages: crownLab, facts: { impressionType: 'digital', implantCount: 1 }, orderedBy: 'dr' })
    expect(plan.map(s => s.stageKey)).toEqual(['skaneering', 'vastuvott', 'disain', 'freesimine', 'viimistlus', 'valmis'])
    expect(plan.map(s => s.position)).toEqual([0, 1, 2, 3, 4, 5])
    const withAll = materialiseTemplate({
      stages: crownLab, facts: { impressionType: 'digital', implantCount: 3 }, orderedBy: 'dr',
      switches: { vahamudel: true, qc: true },
    })
    expect(withAll.map(s => s.stageKey)).toContain('fotogramm')
    expect(withAll.map(s => s.stageKey)).toContain('vahamudel')
    expect(withAll.map(s => s.stageKey)).toContain('qc')
  })

  it('a switch stage follows its default when nobody asked', () => {
    const plan = materialiseTemplate({ stages: [stage('qc', 0, { optional: true, defaultOn: true })], facts: {}, orderedBy: null })
    expect(plan.map(s => s.stageKey)).toEqual(['qc'])
    const off = materialiseTemplate({ stages: [stage('qc', 0, { optional: true, defaultOn: true })], facts: {}, orderedBy: null, switches: { qc: false } })
    expect(off).toEqual([])
  })

  it('the orderer is on the orderer stages; named people are copied; nobody → the clinic default', () => {
    const plan = materialiseTemplate({
      stages: crownLab, facts: { impressionType: 'digital', implantCount: 2 }, orderedBy: 'dr',
      clinicDefaults: { freesimine: ['miller'], disain: ['ignored'] },
    })
    const people = Object.fromEntries(plan.map(s => [s.stageKey, s.people]))
    expect(people.skaneering).toEqual(['dr'])
    expect(people.fotogramm).toEqual(['dr'])
    expect(people.vastuvott).toEqual(['it'])
    expect(people.disain).toEqual(['digi'])
    expect(people.freesimine).toEqual(['miller'])
    expect(people.viimistlus).toEqual(['hand1', 'hand2'])
    expect(people.valmis).toEqual([])
    expect(plan.find(s => s.stageKey === 'disain')).toMatchObject({ task: 'Design the crown', payRole: 'disain' })
  })

  it('an old job with no orderer gets nobody on an orderer stage, unless the clinic has a default', () => {
    const plan = materialiseTemplate({ stages: [stage('skaneering', 0, { orderer: true })], facts: {}, orderedBy: null })
    expect(plan[0].people).toEqual([])
    const withDefault = materialiseTemplate({ stages: [stage('skaneering', 0, { orderer: true })], facts: {}, orderedBy: null, clinicDefaults: { skaneering: ['x'] } })
    expect(withDefault[0].people).toEqual(['x'])
  })

  it('a copy: changing the template afterwards does not change the job', () => {
    const tpl = [stage('disain', 0, { people: ['digi'] })]
    const plan = materialiseTemplate({ stages: tpl, facts: {}, orderedBy: null })
    ;(tpl[0].people as string[]).push('someone-else')
    expect(plan[0].people).toEqual(['digi'])
  })
})

describe('who may move a job (§5)', () => {
  const stages: JobStageState[] = [
    { stageKey: 'vastuvott', position: 0, skipped: false, people: ['it'] },
    { stageKey: 'fotogramm', position: 1, skipped: true, people: ['dr'] },
    { stageKey: 'disain', position: 2, skipped: false, people: ['digi'] },
    { stageKey: 'print', position: 3, skipped: false, people: ['digi'] },
    { stageKey: 'viimistlus', position: 4, skipped: false, people: ['hand'] },
    { stageKey: 'valmis', position: 5, skipped: false, people: [] },
  ]
  const ask = (from: string, to: string, actor: string, actorIsOwner = false) =>
    canMoveStage({ stages, from, to, actor, actorIsOwner })

  it('the current stage\'s person: yes', () => {
    expect(ask('vastuvott', 'disain', 'it')).toBe('allowed')
  })
  it('the target stage\'s person pulls from the stage right before it, skipped stages not counted', () => {
    expect(ask('vastuvott', 'disain', 'digi')).toBe('allowed')
    expect(ask('print', 'viimistlus', 'hand')).toBe('allowed')
  })
  it('…but not from further back', () => {
    expect(ask('disain', 'viimistlus', 'hand')).toBe('refused')
    expect(ask('vastuvott', 'viimistlus', 'hand')).toBe('refused')
  })
  it('…and not from a skipped stage', () => {
    expect(ask('fotogramm', 'disain', 'digi')).toBe('refused')
  })
  it('nobody moves a job into a skipped stage or one it does not have; the owner moves it anywhere else', () => {
    expect(ask('vastuvott', 'fotogramm', 'it')).toBe('refused')
    expect(ask('vastuvott', 'fotogramm', 'boss', true)).toBe('refused')
    expect(ask('vastuvott', 'nowhere', 'boss', true)).toBe('refused')
    expect(ask('vastuvott', 'valmis', 'boss', true)).toBe('allowed')
  })
  it('somebody else, even with jobs.write: no', () => {
    expect(ask('disain', 'print', 'hand')).toBe('refused')
  })
  it('a job with nobody on any stage: today\'s rule (the caller\'s)', () => {
    const legacy = stages.map(s => ({ ...s, people: [] }))
    expect(canMoveStage({ stages: legacy, from: 'disain', to: 'print', actor: 'x', actorIsOwner: false })).toBe('legacy')
    expect(canMoveStage({ stages: [], from: 'disain', to: 'print', actor: 'x', actorIsOwner: false })).toBe('legacy')
  })
  it('previousStage skips skipped stages', () => {
    expect(previousStage(stages, stages[2])?.stageKey).toBe('vastuvott')
    expect(previousStage(stages, stages[0])).toBeNull()
  })
})

describe('an equal split among the people of one stage (§10)', () => {
  it('the parts add up to the amount exactly', () => {
    for (const cents of [0, 1, 2, 100, 1001, 99999, 12345, -7, -100]) {
      for (const n of [1, 2, 3, 7]) {
        const people = Array.from({ length: n }, (_, i) => `p${i}`)
        const parts = splitEqually(cents, people)
        expect(parts.reduce((s, p) => s + p.cents, 0)).toBe(cents)
        expect(Math.max(...parts.map(p => p.cents)) - Math.min(...parts.map(p => p.cents))).toBeLessThanOrEqual(1)
      }
    }
  })
  it('the left-over cents go to the first ids, so the same split comes out every time', () => {
    expect(splitEqually(1000, ['c', 'a', 'b'])).toEqual([
      { profileId: 'a', cents: 334 }, { profileId: 'b', cents: 333 }, { profileId: 'c', cents: 333 },
    ])
    expect(splitEqually(1000, ['b', 'c', 'a'])).toEqual(splitEqually(1000, ['a', 'b', 'c']))
  })
  it('a person listed twice is one person; nobody: no shares; not whole cents: refused', () => {
    expect(splitEqually(100, ['a', 'a'])).toEqual([{ profileId: 'a', cents: 100 }])
    expect(splitEqually(100, [])).toEqual([])
    expect(() => splitEqually(10.5, ['a'])).toThrow()
  })
  it('no -0 for a small negative amount', () => {
    expect(splitEqually(-1, ['a', 'b']).map(p => Object.is(p.cents, -0))).toEqual([false, false])
  })
})
