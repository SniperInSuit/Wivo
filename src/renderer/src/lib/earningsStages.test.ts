/**
 * The pay engine with stages (§10, docs/WORKFLOW-STAGES.md, shared/workflow/pay).
 *
 * Two promises, both tested here:
 *
 *   1. An old job pays to the cent what it paid before. A job with no stage
 *      people, or stages that pay nobody (no people, skipped, no pay kind),
 *      produces the very same lines as the same job without stages. The
 *      existing earnings.test.ts runs unchanged on top of this.
 *
 *   2. Where a stage carries a pay kind, its people are paid for it and split
 *      it equally; nobody else is, and the parts add up to the whole.
 */
import { describe, it, expect } from 'vitest'
import type { Job, Revision, WorkItem } from '../types/job'
import type { WorkType } from '../config/workTypes'
import type { PayStage } from '@shared/workflow/pay'
import type { PayRole } from '@shared/workflow/workflow'
import {
  calculateEarnings, diagnoseEarnings, earningsTotal, unassignedFinishedJobs, backlogPeriods,
  jobPayeeIds, jobPaysPerson,
  type WorkerRate, type RateKind, type RateScope, type EarningsContext,
} from './earnings'

const DONE = 'valmis'
const TYPES: WorkType[] = [
  { nimi: 'Kroon', hex: '#3B82F6' },
  { nimi: 'Sild', hex: '#8B5CF6' },
  { nimi: 'Mudel', hex: '#10B981' },
]

let seq = 0

function rate(profile_id: string, over: Partial<WorkerRate> & { kind: RateKind; amount: number }): WorkerRate {
  return {
    id: `rate-${++seq}`, clinic_id: 'clinic', profile_id,
    applies_to: 'too' as RateScope, work_type: null, priority: 0, additive: false, label: null,
    pay_revisions: false, auto_hours: false, hours_per_day: null, work_days: '12345',
    active_from: null, active_to: null, note: null, created_at: '2026-01-01', updated_at: '2026-01-01',
    ...over,
  }
}

const item = (too: string, hambad: string, over: Partial<WorkItem> = {}): WorkItem =>
  ({ id: `item-${++seq}`, too, hambad, ...over })

function job(over: Partial<Job> = {}): Job {
  return {
    id: `job-${++seq}`, status: DONE, kuupaev: '2026-08-01', patsient: 'Mari Maasikas',
    patient_id: null, customer_id: null, customer_ref: null, too: null, materjal: null, masina: null,
    print_id: null, disain_id: null, extra_costs: [], varv: null, hambad: null, kirjeldus: null,
    valmis_aeg: null, valmis_kuupaev: '2026-08-10', kiirtoo: false, delivery_status: 'labor',
    delivered_at: null, work_items: [], revisions: [], markused: [], extras: [], hind: null,
    disain_hind: null, makstud: false, makse_kuupaev: null, assigned_to: null, designed_by: null,
    created_at: '2026-08-01', updated_at: '2026-08-01',
    ...over,
  } as Job
}

const stage = (stageKey: string, payRole: PayRole | null, people: string[], over: Partial<PayStage> = {}): PayStage =>
  ({ stageKey, position: 0, payRole, skipped: false, people, ...over })

const ctx = (profileId: string, rates: WorkerRate[], jobs: Job[], over: Partial<EarningsContext> = {}): EarningsContext => ({
  profileId, rates, jobs, hours: [], types: TYPES,
  periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE, ...over,
})
const run = (profileId: string, rates: WorkerRate[], jobs: Job[], over: Partial<EarningsContext> = {}) =>
  calculateEarnings(ctx(profileId, rates, jobs, over))
const total = (profileId: string, rates: WorkerRate[], jobs: Job[]) => earningsTotal(run(profileId, rates, jobs))

// ─── 1. Old work pays exactly as before ──────────────────────────────────────

/** Stages that pay nobody: each must leave every line exactly as it was. */
const INERT: Record<string, PayStage[] | undefined> = {
  'no stages (undefined)': undefined,
  'no stages (empty)': [],
  'stages with pay kinds and nobody on them': [
    stage('disain', 'disain', [], { position: 0 }), stage('freesimine', 'too', [], { position: 1 }),
    stage('printimine', 'mudel', [], { position: 2 }), stage('parandus', 'muudatus', [], { position: 3 }),
  ],
  'every pay stage skipped, people and all': [
    stage('disain', 'disain', ['x', 'y'], { position: 0, skipped: true }),
    stage('freesimine', 'too', ['x'], { position: 1, skipped: true }),
    stage('printimine', 'mudel', ['y'], { position: 2, skipped: true }),
    stage('parandus', 'muudatus', ['x'], { position: 3, skipped: true }),
  ],
  'people on a stage with no pay kind': [stage('vastuvott', null, ['x', 'tech', 'des'])],
}

/** A seeded mix of old jobs: every kind of line the engine writes. */
function oldJobs(): { jobs: Job[]; rates: WorkerRate[] } {
  let s = 7
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
  const people = ['tech', 'des', 'x', 'y']
  const jobs: Job[] = []
  for (let i = 0; i < 120; i++) {
    const items = [item(pick(['Kroon', 'Sild', 'Mudel']), pick(['11', '11,12', '21,22,23', ''])),
      ...(rnd() < 0.4 ? [item('Sild', '24,25', rnd() < 0.5 ? { designed_by: pick(people) } : {})] : [])]
    const revisions: Revision[] = rnd() < 0.4 ? [{
      id: `rev-${++seq}`, ts: '2026-08-05T10:00:00Z', note: '', status: DONE, valmis_kuupaev: '2026-08-20',
      price: 40, mudel: rnd() < 0.5, kiirtoo: rnd() < 0.3, work_items: [item('Kroon', '11,12')],
      ...(rnd() < 0.5 ? { assigned_to: pick(people) } : {}),
      ...(rnd() < 0.3 ? { designed_by: pick(people) } : {}),
    } as Revision] : []
    jobs.push(job({
      work_items: items, revisions, mudel: rnd() < 0.5, kiirtoo: rnd() < 0.3,
      hind: Math.round(rnd() * 50000) / 100, disain_hind: rnd() < 0.5 ? 60 : null,
      assigned_to: rnd() < 0.85 ? pick(people) : null, designed_by: rnd() < 0.6 ? pick(people) : null,
      status: rnd() < 0.85 ? DONE : 'disain', valmis_kuupaev: pick(['2026-08-03', '2026-08-28', '2026-07-30', null]),
    }))
  }
  const rates: WorkerRate[] = people.flatMap(p => [
    rate(p, { kind: 'hammas', amount: 15, work_type: 'Kroon' }),
    rate(p, { kind: 'too', amount: 120, work_type: 'Sild', pay_revisions: true }),
    rate(p, { kind: 'protsent', amount: 10 }),
    rate(p, { kind: 'hammas', amount: 5, applies_to: 'disain', pay_revisions: true }),
    rate(p, { kind: 'too', amount: 12, applies_to: 'mudel', pay_revisions: true }),
    rate(p, { kind: 'hammas', amount: 8, applies_to: 'muudatus' }),
    rate(p, { kind: 'too', amount: 9, applies_to: 'disain', additive: true, label: 'Igeme disain' }),
    rate(p, { kind: 'hammas', amount: 2, applies_to: 'too', additive: true, label: 'Lisatasu' }),
  ])
  return { jobs, rates }
}

describe('old work pays to the cent what it paid before', () => {
  const { jobs, rates } = oldJobs()
  const people = ['tech', 'des', 'x', 'y']

  for (const [name, stages] of Object.entries(INERT)) {
    it(`${name}: every line, every person, identical`, () => {
      const withStages = jobs.map(j => ({ ...j, pay_stages: stages }))
      let lines = 0
      for (const p of people) {
        for (const rush of [1, 1.5]) {
          const before = run(p, rates, jobs, { rushMultiplier: rush })
          expect(run(p, rates, withStages, { rushMultiplier: rush })).toEqual(before)
          lines += before.length
        }
        expect(diagnoseEarnings(ctx(p, rates, withStages, { today: '2026-08-20' })))
          .toEqual(diagnoseEarnings(ctx(p, rates, jobs, { today: '2026-08-20' })))
        expect(backlogPeriods(ctx(p, rates, withStages, { periodStart: '2026-09-01', periodEnd: '2026-09-30' })))
          .toEqual(backlogPeriods(ctx(p, rates, jobs, { periodStart: '2026-09-01', periodEnd: '2026-09-30' })))
      }
      const u = { periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE }
      expect(unassignedFinishedJobs({ ...u, jobs: withStages })).toEqual(unassignedFinishedJobs({ ...u, jobs }))
      // The corpus is not trivially empty: it pays every kind of line.
      expect(lines).toBeGreaterThan(200)
    })
  }

  it('the corpus writes every kind of job line', () => {
    const keys = new Set(people.flatMap(p => run(p, rates, jobs).map(l => l.key.split(':')[0])))
    for (const k of ['job', 'design', 'mudel', 'extra', 'rev', 'revdesign', 'revmudel']) expect(keys).toContain(k)
  })
})

// ─── 2. A stage pays its people ──────────────────────────────────────────────

describe('piece work (too) by stage', () => {
  const crowns = (over: Partial<Job> = {}) => job({ work_items: [item('Kroon', '11,12,13')], ...over })

  it('one person on the stage: the whole line, as if they were the technician', () => {
    const r = [rate('t1', { kind: 'hammas', amount: 15 })]
    const lines = run('t1', r, [crowns({ pay_stages: [stage('freesimine', 'too', ['t1'])] })])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ amount: 45, qty: 3, rate: 15 })
    expect(lines[0].description).not.toContain('jagatud')
  })

  it('two people split it equally; the parts add up to the whole', () => {
    const r = [rate('t1', { kind: 'hammas', amount: 15 }), rate('t2', { kind: 'hammas', amount: 15 })]
    const j = crowns({ pay_stages: [stage('freesimine', 'too', ['t1', 't2'])] })
    const a = run('t1', r, [j])
    const b = run('t2', r, [j])
    expect(a[0]).toMatchObject({ amount: 22.5, qty: 1.5, rate: 15, key: `job:${j.id}` })
    expect(b[0]).toMatchObject({ amount: 22.5, qty: 1.5, rate: 15, key: `job:${j.id}` })
    expect(a[0].description).toContain(' · jagatud 2 vahel')
  })

  it('an odd cent goes to one of them, never lost and never doubled', () => {
    const r = ['t1', 't2', 't3'].map(p => rate(p, { kind: 'too', amount: 100 }))
    const j = crowns({ pay_stages: [stage('freesimine', 'too', ['t3', 't1', 't2'])] })
    const parts = ['t1', 't2', 't3'].map(p => total(p, r, [j]))
    expect(parts).toEqual([33.34, 33.33, 33.33])
    expect(Math.round(parts.reduce((s, x) => s + x, 0) * 100)).toBe(10000)
  })

  it('different rules: each takes their own half of their own price', () => {
    const r = [rate('t1', { kind: 'hammas', amount: 15 }), rate('t2', { kind: 'hammas', amount: 10 })]
    const j = crowns({ pay_stages: [stage('freesimine', 'too', ['t1', 't2'])] })
    expect(total('t1', r, [j])).toBe(22.5)
    expect(total('t2', r, [j])).toBe(15)
  })

  it('the technician in assigned_to gets nothing when the stage names others', () => {
    const r = [rate('old', { kind: 'hammas', amount: 15 }), rate('t1', { kind: 'hammas', amount: 15 })]
    const j = crowns({ assigned_to: 'old', pay_stages: [stage('freesimine', 'too', ['t1'])] })
    expect(run('old', r, [j])).toEqual([])
    expect(total('t1', r, [j])).toBe(45)
  })

  it('...and is paid as before when the stage is skipped or has nobody', () => {
    const r = [rate('old', { kind: 'hammas', amount: 15 }), rate('t1', { kind: 'hammas', amount: 15 })]
    for (const st of [stage('freesimine', 'too', ['t1'], { skipped: true }), stage('freesimine', 'too', [])]) {
      const j = crowns({ assigned_to: 'old', pay_stages: [st] })
      expect(total('old', r, [j])).toBe(45)
      expect(run('t1', r, [j])).toEqual([])
    }
  })

  it('a rush uplift is shared the same way', () => {
    const r = [rate('t1', { kind: 'hammas', amount: 10 }), rate('t2', { kind: 'hammas', amount: 10 })]
    const j = crowns({ kiirtoo: true, pay_stages: [stage('freesimine', 'too', ['t1', 't2'])] })
    // 3 teeth × 10 × 1.5 = 45, halved.
    expect(run('t1', r, [j], { rushMultiplier: 1.5 })[0].amount).toBe(22.5)
  })

  it('a piece-work extra is split among the same people', () => {
    const r = ['t1', 't2'].map(p => rate(p, { kind: 'hammas', amount: 3, additive: true, label: 'Lisatasu' }))
    const j = crowns({ pay_stages: [stage('freesimine', 'too', ['t1', 't2'])] })
    const extra = run('t1', r, [j]).find(l => l.key.startsWith('extra:'))!
    expect(extra).toMatchObject({ amount: 4.5, qty: 1.5 })
  })

  it('only finished work in the period counts, as before', () => {
    const r = [rate('t1', { kind: 'hammas', amount: 15 })]
    const stages = [stage('freesimine', 'too', ['t1'])]
    expect(run('t1', r, [crowns({ status: 'disain', pay_stages: stages })])).toEqual([])
    expect(run('t1', r, [crowns({ valmis_kuupaev: '2026-07-31', pay_stages: stages })])).toEqual([])
  })

  it('a line already paid to this person is not offered again; the other still gets theirs', () => {
    const r = ['t1', 't2'].map(p => rate(p, { kind: 'hammas', amount: 15 }))
    const j = crowns({ pay_stages: [stage('freesimine', 'too', ['t1', 't2'])] })
    expect(run('t1', r, [j], { alreadyPaid: new Set([`job:${j.id}`]) })).toEqual([])
    expect(total('t2', r, [j])).toBe(22.5)
  })
})

describe('design by stage', () => {
  const twoItems = (over: Partial<Job> = {}) => job({
    work_items: [item('Kroon', '11,12,13', { designed_by: 'someone' }), item('Sild', '24,25', { designed_by: null })],
    ...over,
  })

  it('the design stage\'s people split the whole design; item designers are not asked', () => {
    const r = ['d1', 'd2', 'someone'].map(p => rate(p, { kind: 'hammas', amount: 4, applies_to: 'disain' }))
    const j = twoItems({ pay_stages: [stage('disain', 'disain', ['d1', 'd2'])] })
    // 5 teeth × 4 = 20, halved.
    expect(run('d1', r, [j])[0]).toMatchObject({ key: `design:${j.id}`, amount: 10, qty: 2.5, rate: 4 })
    expect(total('d2', r, [j])).toBe(10)
    expect(run('someone', r, [j])).toEqual([])
  })

  it('the teeth marked as designed still decide (disain_hambad), as for one designer today', () => {
    const r = [rate('d1', { kind: 'hammas', amount: 4, applies_to: 'disain' })]
    const j = job({ work_items: [item('Kroon', '11,12,13', { disain_hambad: '11' })], pay_stages: [stage('disain', 'disain', ['d1'])] })
    expect(total('d1', r, [j])).toBe(4)
  })

  it('a percentage of the design price: the full price, then split', () => {
    const r = ['d1', 'd2'].map(p => rate(p, { kind: 'protsent', amount: 50, applies_to: 'disain' }))
    const j = twoItems({ disain_hind: 80, pay_stages: [stage('disain', 'disain', ['d1', 'd2'])] })
    expect(total('d1', r, [j])).toBe(20)
    expect(total('d2', r, [j])).toBe(20)
  })

  it('piece-work people get nothing of the design, and the designers nothing of the piece work', () => {
    const r = [
      rate('t1', { kind: 'hammas', amount: 15 }), rate('t1', { kind: 'hammas', amount: 4, applies_to: 'disain' }),
      rate('d1', { kind: 'hammas', amount: 15 }), rate('d1', { kind: 'hammas', amount: 4, applies_to: 'disain' }),
    ]
    const j = twoItems({ pay_stages: [stage('freesimine', 'too', ['t1']), stage('disain', 'disain', ['d1'])] })
    expect(run('t1', r, [j]).map(l => l.key.split(':')[0])).toEqual(['job'])
    expect(run('d1', r, [j]).map(l => l.key.split(':')[0])).toEqual(['design'])
  })

  it('a design extra (gum design) is split among the design stage', () => {
    const r = ['d1', 'd2'].map(p => rate(p, { kind: 'too', amount: 9, applies_to: 'disain', additive: true, label: 'Igeme disain' }))
    const j = twoItems({ pay_stages: [stage('disain', 'disain', ['d1', 'd2'])] })
    // A flat extra pays per covered item: 2 × 9 = 18, halved.
    expect(run('d1', r, [j]).find(l => l.key.startsWith('extra:'))!.amount).toBe(9)
  })

  it('no design stage: the item designers are paid exactly as before', () => {
    const r = ['someone', 'tech'].map(p => rate(p, { kind: 'hammas', amount: 4, applies_to: 'disain' }))
    const j = twoItems({ pay_stages: [stage('freesimine', 'too', ['tech'])] })
    expect(total('someone', r, [j])).toBe(12)
  })
})

describe('the model', () => {
  const withModel = (stages: PayStage[] | undefined, over: Partial<Job> = {}) =>
    job({ mudel: true, work_items: [item('Kroon', '11')], pay_stages: stages, ...over })
  const modelRates = ['t1', 't2', 'm1', 'old'].map(p => rate(p, { kind: 'too', amount: 12, applies_to: 'mudel' }))

  it('no model stage: it goes with the piece work, split the same way', () => {
    const j = withModel([stage('freesimine', 'too', ['t1', 't2'])], { assigned_to: 'old' })
    expect(run('t1', modelRates, [j])[0]).toMatchObject({ key: `mudel:${j.id}`, amount: 6 })
    expect(run('old', modelRates, [j])).toEqual([])
  })

  it('a model stage: its own people, and only them', () => {
    const j = withModel([stage('freesimine', 'too', ['t1']), stage('printimine', 'mudel', ['m1'])])
    expect(total('m1', modelRates, [j])).toBe(12)
    expect(run('t1', modelRates, [j])).toEqual([])
  })

  it('a model stage alone pays its person even with no technician anywhere', () => {
    const j = withModel([stage('printimine', 'mudel', ['m1'])], { assigned_to: null })
    expect(total('m1', modelRates, [j])).toBe(12)
  })

  it('no model on the job: nothing, stage or not', () => {
    const j = withModel([stage('printimine', 'mudel', ['m1'])], { mudel: false })
    expect(run('m1', modelRates, [j])).toEqual([])
  })

  it('the old technician keeps the model when only design is by stage', () => {
    const j = withModel([stage('disain', 'disain', ['d1'])], { assigned_to: 'old' })
    expect(total('old', modelRates, [j])).toBe(12)
  })
})

describe('revisions (muudatus)', () => {
  const rev = (over: Partial<Revision> & { assigned_to?: string | null; designed_by?: string | null } = {}): Revision =>
    ({ id: `rev-${++seq}`, ts: '2026-08-05T10:00:00Z', note: '', status: DONE, valmis_kuupaev: '2026-08-20', price: 50, ...over } as Revision)
  const revRates = ['r1', 'r2', 't1', 'own', 'old'].map(p => rate(p, { kind: 'too', amount: 30, applies_to: 'muudatus' }))
  const LAB = [stage('freesimine', 'too', ['t1'], { position: 1 }), stage('parandus', 'muudatus', ['r1', 'r2'], { position: 2 })]

  it('its own technician (sql/087) is paid in full, whatever the stages say', () => {
    const r = rev({ assigned_to: 'own' })
    const j = job({ too: 'Kroon', hambad: '11', revisions: [r], pay_stages: LAB })
    expect(run('own', revRates, [j])[0]).toMatchObject({ key: `rev:${j.id}:${r.id}`, amount: 30 })
    expect(run('r1', revRates, [j])).toEqual([])
  })

  it('no technician of its own: the muudatus stage splits it', () => {
    const r = rev()
    const j = job({ too: 'Kroon', hambad: '11', revisions: [r], assigned_to: 'old', pay_stages: LAB })
    expect(run('r1', revRates, [j])[0]).toMatchObject({ key: `rev:${j.id}:${r.id}`, amount: 15, qty: 0.5 })
    expect(total('r2', revRates, [j])).toBe(15)
    expect(run('old', revRates, [j])).toEqual([])
    expect(run('t1', revRates, [j])).toEqual([])
  })

  it('no muudatus stage: whoever is paid for the piece work', () => {
    const r = rev()
    const j = job({ too: 'Kroon', hambad: '11', revisions: [r], assigned_to: 'old', pay_stages: [stage('freesimine', 'too', ['t1'])] })
    expect(total('t1', revRates, [j])).toBe(30)
    expect(run('old', revRates, [j])).toEqual([])
  })

  it('a muudatus person who did nothing else on the job is still paid for it', () => {
    const r = rev()
    const j = job({ too: 'Kroon', hambad: '11', revisions: [r], status: 'disain', pay_stages: LAB })
    // The job itself is not finished; its revision is.
    expect(total('r1', revRates, [j])).toBe(15)
  })

  it('the remake\'s model goes to the remake\'s people', () => {
    const r = rev({ mudel: true })
    const rates = ['r1', 'r2'].map(p => rate(p, { kind: 'too', amount: 10, applies_to: 'mudel', pay_revisions: true }))
    const j = job({ too: 'Kroon', hambad: '11', revisions: [r], pay_stages: LAB })
    expect(run('r1', rates, [j]).find(l => l.key.startsWith('revmudel:'))!.amount).toBe(5)
  })

  it('a remake extra is split among the remake\'s people', () => {
    const r = rev()
    const rates = ['r1', 'r2'].map(p => rate(p, { kind: 'too', amount: 8, applies_to: 'muudatus', additive: true, label: 'Igeme' }))
    const j = job({ too: 'Kroon', hambad: '11', revisions: [r], pay_stages: LAB })
    expect(run('r1', rates, [j]).find(l => l.key.startsWith('extra:'))!.amount).toBe(4)
  })

  it('the lab\'s own fault (taspidev false) pays nobody, stage or not', () => {
    const j = job({ too: 'Kroon', hambad: '11', revisions: [rev({ taspidev: false })], pay_stages: LAB })
    expect(run('r1', revRates, [j])).toEqual([])
  })

  it('redesign: its own designer, else the design stage, split', () => {
    const designRates = ['d1', 'd2', 'own'].map(p => rate(p, { kind: 'too', amount: 20, applies_to: 'disain', pay_revisions: true }))
    const stages = [stage('disain', 'disain', ['d1', 'd2'])]
    const mine = rev({ designed_by: 'own' })
    const open = rev()
    const j = job({ too: 'Kroon', hambad: '11', revisions: [mine, open], pay_stages: stages })
    const ownLines = run('own', designRates, [j]).filter(l => l.key.startsWith('revdesign:'))
    expect(ownLines.map(l => [l.revision_id, l.amount])).toEqual([[mine.id, 20]])
    const d1Lines = run('d1', designRates, [j]).filter(l => l.key.startsWith('revdesign:'))
    expect(d1Lines.map(l => [l.revision_id, l.amount])).toEqual([[open.id, 10]])
  })
})

describe('who a job concerns: the lists that must agree with the pay', () => {
  const stages = [stage('freesimine', 'too', ['t1']), stage('disain', 'disain', ['d1', 'd2'])]

  it('jobPayeeIds: the stage people, today\'s rule where no stage says', () => {
    expect(jobPayeeIds(job({ assigned_to: 'old', designed_by: 'des' }))).toEqual(['old', 'des'])
    expect(jobPayeeIds(job({ assigned_to: 'old', designed_by: 'des', pay_stages: stages }))).toEqual(['t1', 'd1', 'd2'])
    expect(jobPayeeIds(job({ assigned_to: 'old', pay_stages: [stage('printimine', 'mudel', ['m1'])] }))).toEqual(['old', 'm1'])
    expect(jobPaysPerson(job({ pay_stages: stages }), 'd2')).toBe(true)
    expect(jobPaysPerson(job({ assigned_to: 'old', pay_stages: stages }), 'old')).toBe(false)
  })

  it('a finished job with nobody in assigned_to but people on its stages is somebody\'s', () => {
    const u = { periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE }
    expect(unassignedFinishedJobs({ ...u, jobs: [job({ pay_stages: stages })] })).toEqual([])
    expect(unassignedFinishedJobs({ ...u, jobs: [job({ pay_stages: [stage('freesimine', 'too', [])] })] })).toHaveLength(1)
  })

  it('the diagnostics speak to the stage person, not to the old technician', () => {
    const j = job({ assigned_to: 'old', work_items: [item('Kroon', '11')], pay_stages: [stage('freesimine', 'too', ['t1'])] })
    const issues = (p: string) => diagnoseEarnings(ctx(p, [], [j], { today: '2026-08-20' })).map(i => i.code)
    expect(issues('t1')).toContain('reegel')
    expect(issues('old')).toEqual([])
  })

  it('an earlier month owed to a stage person is offered to them', () => {
    const r = [rate('t1', { kind: 'hammas', amount: 15 })]
    const j = job({ work_items: [item('Kroon', '11')], valmis_kuupaev: '2026-07-10', pay_stages: [stage('freesimine', 'too', ['t1'])] })
    const periods = backlogPeriods(ctx('t1', r, [j], { periodStart: '2026-08-01', periodEnd: '2026-08-31' }))
    expect(periods.map(p => p.periodStart)).toEqual(['2026-07-01'])
  })
})

describe('what the clinic pays in all does not change by splitting', () => {
  it('with equal rules, the parts of every line add up to the one-person line', () => {
    const r = (p: string) => [
      rate(p, { kind: 'hammas', amount: 13.37 }),
      rate(p, { kind: 'protsent', amount: 7, applies_to: 'disain' }),
      rate(p, { kind: 'too', amount: 11.11, applies_to: 'mudel' }),
    ]
    const base = { work_items: [item('Kroon', '11,12,13,14,15,16,17')], mudel: true, hind: 333.33, disain_hind: 99.99 }
    const solo = job({ ...base, pay_stages: [stage('f', 'too', ['a']), stage('d', 'disain', ['a'])] })
    const whole = total('a', r('a'), [solo])
    for (const heads of [2, 3, 4]) {
      const people = ['a', 'b', 'c', 'd'].slice(0, heads)
      const shared = job({ ...base, pay_stages: [stage('f', 'too', people), stage('d', 'disain', people)] })
      const rates = people.flatMap(r)
      const sum = people.reduce((s, p) => s + Math.round(total(p, rates, [shared]) * 100), 0)
      expect(sum).toBe(Math.round(whole * 100))
    }
  })
})
