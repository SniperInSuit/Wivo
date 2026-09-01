/**
 * The pay engine, which had no tests and decides what people are paid.
 *
 * The cases below are the ones that were actually wrong: a job holding crowns
 * AND a bridge was matched by the first work item alone and then paid across
 * every tooth on the case, so the bridge rule was never consulted and the crown
 * rate was applied to teeth it had nothing to do with.
 */
import { describe, it, expect } from 'vitest'
import type { Job, Revision, WorkItem } from '../types/job'
import type { WorkType } from '../config/workTypes'
import {
  calculateEarnings, diagnoseEarnings, earningsTotal,
  grossFromNet, grossOf, payslipFromGross,
  type WorkerRate, type RateKind, type RateScope, type PayrollTaxRates,
} from './earnings'

const TECH = 'tech-1'
const DESIGNER = 'designer-1'
const DONE = 'valmis'

const TYPES: WorkType[] = [
  { nimi: 'Kroon', hex: '#3B82F6' },
  { nimi: 'Sild', hex: '#8B5CF6' },
  { nimi: 'All-on-X', hex: '#EC4899', match: ['allon'] },
  { nimi: 'Proteez', hex: '#F43F5E' },
]

let seq = 0

function rate(over: Partial<WorkerRate> & { kind: RateKind; amount: number }): WorkerRate {
  return {
    id: `rate-${++seq}`,
    clinic_id: 'clinic',
    profile_id: TECH,
    applies_to: 'too' as RateScope,
    work_type: null,
    priority: 0,
    additive: false,
    label: null,
    pay_revisions: false,
    auto_hours: false,
    hours_per_day: null,
    work_days: '12345',
    active_from: null,
    active_to: null,
    note: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...over,
  }
}

function item(too: string, hambad: string): WorkItem {
  return { id: `item-${++seq}`, too, hambad }
}

function job(over: Partial<Job> = {}): Job {
  return {
    id: `job-${++seq}`,
    status: DONE,
    kuupaev: '2026-08-01',
    patsient: 'Mari Maasikas',
    patient_id: null,
    customer_id: null,
    customer_ref: null,
    too: null,
    materjal: null,
    masina: null,
    print_id: null,
    disain_id: null,
    extra_costs: [],
    varv: null,
    hambad: null,
    kirjeldus: null,
    valmis_aeg: null,
    valmis_kuupaev: '2026-08-10',
    kiirtoo: false,
    delivery_status: 'labor',
    delivered_at: null,
    work_items: [],
    revisions: [],
    markused: [],
    extras: [],
    hind: null,
    disain_hind: null,
    makstud: false,
    makse_kuupaev: null,
    assigned_to: TECH,
    designed_by: null,
    created_at: '2026-08-01',
    updated_at: '2026-08-01',
    ...over,
  }
}

const run = (rates: WorkerRate[], jobs: Job[], profileId = TECH) => calculateEarnings({
  profileId, rates, jobs, hours: [], types: TYPES,
  periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE,
})

describe('legacy jobs are paid exactly as before', () => {
  it('pays a job with no work_items from its denormalised too/hambad', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 15, work_type: 'Kroon' })],
      [job({ too: 'Kroon', hambad: '11,12,13' })]
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].amount).toBe(45)
    expect(lines[0].qty).toBe(3)
    expect(lines[0].rate).toBe(15)
  })

  it('pays nothing when no rule names the job\'s type', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 15, work_type: 'Sild' })],
      [job({ too: 'Kroon', hambad: '11,12' })]
    )
    expect(lines).toHaveLength(0)
  })

  it('ignores work that has not reached the done stage', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 15 })],
      [job({ status: 'disain', too: 'Kroon', hambad: '11' })]
    )
    expect(lines).toHaveLength(0)
  })
})

describe('a job with several work items', () => {
  const crownsAndBridge = () => job({
    too: 'Kroon',
    hambad: '11,12,14,15,16',
    work_items: [item('Kroon', '11,12'), item('Sild', '14,15,16')],
  })

  it('pays each item under its OWN rule and sums them', () => {
    const lines = run(
      [
        rate({ kind: 'hammas', amount: 15, work_type: 'Kroon' }),
        rate({ kind: 'hammas', amount: 25, work_type: 'Sild' }),
      ],
      [crownsAndBridge()]
    )
    // 2 crowns x 15 + 3 bridge units x 25 = 105. The old engine matched only
    // 'Kroon' (the first item) and charged it across all five teeth: 75 €.
    expect(earningsTotal(lines)).toBe(105)
    expect(lines).toHaveLength(1)
    expect(lines[0].qty).toBe(5)
  })

  it('consults the bridge rule even when the bridge is not the first item', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 25, work_type: 'Sild' })],
      [crownsAndBridge()]
    )
    // Only the bridge matches, so only the bridge is paid — 3 x 25.
    expect(earningsTotal(lines)).toBe(75)
  })

  it('names the work types it could not pay for', () => {
    const issues = diagnoseEarnings({
      profileId: TECH,
      rates: [rate({ kind: 'hammas', amount: 15, work_type: 'Kroon' })],
      jobs: [crownsAndBridge()], hours: [], types: TYPES,
      periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE,
    })
    const rule = issues.find(i => i.code === 'reegel')
    expect(rule?.label).toContain('Sild')
  })

  it('pays a flat per-job rule ONCE however many items it covers', () => {
    const lines = run(
      [rate({ kind: 'too', amount: 200 })],
      [job({ work_items: [item('Kroon', '11'), item('Sild', '14,15')] })]
    )
    // One catch-all flat rule covers both items — that is one payment, not two.
    expect(earningsTotal(lines)).toBe(200)
  })

  it('pays two flat rules when two different rules match', () => {
    const lines = run(
      [
        rate({ kind: 'too', amount: 200, work_type: 'All-on-X' }),
        rate({ kind: 'too', amount: 50, work_type: 'Kroon' }),
      ],
      [job({ work_items: [item('All-on-X', ''), item('Kroon', '11')] })]
    )
    expect(earningsTotal(lines)).toBe(250)
  })

  it('splits a percentage by tooth share instead of paying it per rule', () => {
    const lines = run(
      [
        rate({ kind: 'protsent', amount: 10, work_type: 'Kroon' }),
        rate({ kind: 'protsent', amount: 10, work_type: 'Sild' }),
      ],
      [job({
        hind: 1000,
        work_items: [item('Kroon', '11,12'), item('Sild', '14,15,16')],
      })]
    )
    // 10% of 1000 is 100, split 2/5 and 3/5 — not 100 twice.
    expect(earningsTotal(lines)).toBe(100)
  })
})

describe('additive pay — the gum-design case', () => {
  // "Igeme disain 9 €/hammas" is ONE rule: kind 'hammas', scope 'disain'
  // because it IS design, additive because it stacks on the ordinary design
  // rule rather than competing with it, aimed at the gum-carrying types.
  const gumRule = (over: Partial<WorkerRate> = {}) =>
    rate({
      kind: 'hammas', amount: 9, applies_to: 'too', additive: true,
      label: 'Igeme disain', work_type: 'All-on-X|Proteez', ...over,
    })

  const allOn = (hambad: string) => job({ work_items: [item('All-on-X', hambad)] })

  it('pays per tooth, on top of production rather than instead of it', () => {
    const lines = run(
      [rate({ kind: 'too', amount: 200, work_type: 'All-on-X' }), gumRule()],
      [allOn('11,12,13')]
    )
    // 200 for the arch + 3 x 9 for the gum around it.
    expect(earningsTotal(lines)).toBe(227)
    const extra = lines.find(l => l.description.startsWith('Igeme disain'))
    expect(extra?.amount).toBe(27)
    expect(extra?.qty).toBe(3)
    expect(extra?.rate).toBe(9)
  })

  it('can be charged per job instead, when that is how the lab works', () => {
    const lines = run(
      [gumRule({ kind: 'too', amount: 40 })],
      [allOn('11,12,13,14')]
    )
    expect(earningsTotal(lines)).toBe(40)
  })

  it('counts every covered item, so two arches pay for both', () => {
    const lines = run(
      [gumRule()],
      [job({ work_items: [item('All-on-X', '11,12'), item('All-on-X', '31,32')] })]
    )
    expect(earningsTotal(lines)).toBe(36)
  })

  it('pays nothing on work types the rule does not name', () => {
    const lines = run([gumRule()], [job({ work_items: [item('Kroon', '11,12')] })])
    expect(lines).toHaveLength(0)
  })

  it('counts only the teeth of the items it covers on a mixed job', () => {
    const lines = run(
      [gumRule()],
      [job({ work_items: [item('All-on-X', '11,12'), item('Kroon', '21,22,23')] })]
    )
    // The three crowns are not gum work, so they are not counted.
    expect(earningsTotal(lines)).toBe(18)
  })

  it('covers a legacy job with no work items', () => {
    const lines = run([gumRule()], [job({ too: 'Allon4 ülemine', hambad: '11,12' })])
    expect(earningsTotal(lines)).toBe(18)
  })

  it('never competes with the production rule for the same work', () => {
    const lines = run(
      [
        rate({ kind: 'hammas', amount: 15, work_type: 'All-on-X' }),
        gumRule({ work_type: 'All-on-X' }),
      ],
      [allOn('11,12')]
    )
    // Both are paid: 2 x 15 production and 2 x 9 extra. Before the scope
    // existed, the more specific of the two won and the other paid nothing.
    expect(earningsTotal(lines)).toBe(48)
    expect(lines).toHaveLength(2)
  })

  it('stacks on the ordinary DESIGN rule instead of replacing it', () => {
    // The case that broke the previous design: gum design is design, so it
    // needs the design scope — and the designer must still be paid their
    // normal design rate on the same job.
    const lines = run(
      [
        rate({ kind: 'hammas', amount: 4, applies_to: 'disain', profile_id: DESIGNER }),
        gumRule({ applies_to: 'disain', profile_id: DESIGNER }),
      ],
      [job({ work_items: [item('All-on-X', '11,12')], designed_by: DESIGNER })],
      DESIGNER
    )
    // 2 x 4 ordinary design + 2 x 9 gum design.
    expect(earningsTotal(lines)).toBe(26)
    expect(lines).toHaveLength(2)
    expect(lines.some(l => l.description.startsWith('Igeme disain'))).toBe(true)
  })

  it('keeps two different extras as two named lines', () => {
    const lines = run(
      [
        gumRule({ label: 'Igeme disain' }),
        gumRule({ label: 'Kruvikanali sulgemine', amount: 3 }),
      ],
      [job({ work_items: [item('All-on-X', '11,12')] })]
    )
    expect(earningsTotal(lines)).toBe(24)
    expect(lines).toHaveLength(2)
    expect(new Set(lines.map(l => l.key)).size).toBe(2)
  })

  it('never steals the production rule for the same work type', () => {
    const lines = run(
      [
        rate({ kind: 'too', amount: 200, work_type: 'All-on-X' }),
        gumRule({ work_type: 'All-on-X' }),
      ],
      [job({ work_items: [item('All-on-X', '11,12')] })]
    )
    // The additive rule names the same type and is more specific by priority,
    // yet the 200 € arch rate is still paid. That is the point of the flag.
    expect(earningsTotal(lines)).toBe(218)
  })

  it('keys separately, so freezing the job line leaves the extra unpaid', () => {
    const j = allOn('11,12')
    const lines = calculateEarnings({
      profileId: TECH,
      rates: [rate({ kind: 'too', amount: 200 }), gumRule()],
      jobs: [j], hours: [], types: TYPES,
      periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE,
      alreadyPaid: new Set([`job:${j.id}`]),
    })
    expect(earningsTotal(lines)).toBe(18)
  })
})

describe('a rule covering several work types', () => {
  it('matches any of the types it names', () => {
    const rules = [rate({ kind: 'too', amount: 9, work_type: 'All-on-X|Proteez' })]
    expect(earningsTotal(run(rules, [job({ work_items: [item('All-on-X', '')] })]))).toBe(9)
    expect(earningsTotal(run(rules, [job({ work_items: [item('Proteez', '')] })]))).toBe(9)
  })

  it('does not match a type it leaves out', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 15, work_type: 'Kroon|Sild' })],
      [job({ work_items: [item('Proteez', '11,12')] })]
    )
    expect(lines).toHaveLength(0)
  })

  it('pays once per rule even when several of its types are on one job', () => {
    const lines = run(
      [rate({ kind: 'too', amount: 200, work_type: 'All-on-X|Proteez' })],
      [job({ work_items: [item('All-on-X', ''), item('Proteez', '')] })]
    )
    // One flat rule, one payment — both items pool into the same rule.
    expect(earningsTotal(lines)).toBe(200)
  })

  it('still outranks a catch-all rule', () => {
    const lines = run(
      [
        rate({ kind: 'hammas', amount: 15 }),
        rate({ kind: 'too', amount: 200, work_type: 'All-on-X|Proteez' }),
      ],
      [job({ work_items: [item('All-on-X', '11,12,13')] })]
    )
    expect(earningsTotal(lines)).toBe(200)
  })

  it('reads a rule written before multi-select exactly as it did', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 15, work_type: 'Kroon' })],
      [job({ work_items: [item('Kroon', '11,12')] })]
    )
    expect(earningsTotal(lines)).toBe(30)
  })
})

describe('revisions', () => {
  const revision = (over: Partial<Revision> = {}): Revision => ({
    id: `rev-${++seq}`,
    ts: '2026-08-05T10:00:00Z',
    note: 'Uuesti',
    status: DONE,
    valmis_kuupaev: '2026-08-12',
    ...over,
  })

  it('pays a revision under its own work items', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 10, applies_to: 'muudatus', work_type: 'Sild' })],
      [job({
        work_items: [item('Kroon', '11,12')],
        revisions: [revision({ work_items: [item('Sild', '14,15,16')] })],
      })]
    )
    // The revision redid a bridge, so the bridge rule applies to the revision's
    // own teeth — not to the crowns the original job happened to hold.
    expect(earningsTotal(lines)).toBe(30)
  })

  it('does not pay rework unless a rule says it covers it', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 15, work_type: 'Kroon' })],
      [job({
        work_items: [item('Kroon', '11')],
        revisions: [revision({ hambad: '11' })],
      })]
    )
    // Only the original job line — 15 €, with nothing added for the remake.
    expect(earningsTotal(lines)).toBe(15)
  })

  it('falls back to a job rule that opts into covering rework', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 15, work_type: 'Kroon', pay_revisions: true })],
      [job({
        work_items: [item('Kroon', '11')],
        revisions: [revision({ work_items: [item('Kroon', '11')] })],
      })]
    )
    expect(earningsTotal(lines)).toBe(30)
  })

  it('pays the person who actually redid it, not the job\'s technician', () => {
    const other = 'other-tech'
    const rules = [rate({ kind: 'hammas', amount: 10, applies_to: 'muudatus', profile_id: other })]
    const j = job({
      assigned_to: TECH,
      work_items: [item('Kroon', '11')],
      revisions: [revision({ assigned_to: other, work_items: [item('Kroon', '11,12')] })],
    })
    // The remake was picked up by someone else, so it is their 20 €.
    expect(earningsTotal(run(rules, [j], other))).toBe(20)
    // And the job's own technician earns nothing from it.
    expect(run([rate({ kind: 'hammas', amount: 10, applies_to: 'muudatus' })], [j], TECH))
      .toHaveLength(0)
  })

  it('falls back to the job\'s technician when the revision names nobody', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 10, applies_to: 'muudatus' })],
      [job({
        work_items: [item('Kroon', '11')],
        revisions: [revision({ work_items: [item('Kroon', '11,12')] })],
      })]
    )
    expect(earningsTotal(lines)).toBe(20)
  })

  it('does not pay for REDESIGN unless the design rule covers revisions', () => {
    // Rework is unpaid by default and design is not an exception. A plain
    // design rule started paying every revision the moment revisions gained a
    // designer field — the gate was simply missing.
    const lines = run(
      [rate({ kind: 'hammas', amount: 18, applies_to: 'disain', profile_id: DESIGNER })],
      [job({
        designed_by: DESIGNER,
        work_items: [item('Kroon', '11')],
        revisions: [revision({ work_items: [item('Kroon', '11,12')] })],
      })],
      DESIGNER
    )
    // The original design only: 1 tooth x 18. Nothing for the remake.
    expect(earningsTotal(lines)).toBe(18)
  })

  it('pays a revision designer who did no other part of the case', () => {
    const other = 'other-designer'
    const lines = run(
      [rate({
        kind: 'hammas', amount: 6, applies_to: 'disain',
        profile_id: other, pay_revisions: true,
      })],
      [job({
        assigned_to: TECH, designed_by: DESIGNER,
        work_items: [item('Kroon', '11')],
        revisions: [revision({ designed_by: other, work_items: [item('Kroon', '11,12')] })],
      })],
      other
    )
    // Neither the job's technician nor its designer — the guard on the job loop
    // used to skip this person entirely and their rework vanished.
    expect(earningsTotal(lines)).toBe(12)
  })

  it('skips a revision marked as the lab\'s own fault', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 10, applies_to: 'muudatus' })],
      [job({
        work_items: [item('Kroon', '11')],
        revisions: [revision({ work_items: [item('Kroon', '11')], taspidev: false })],
      })]
    )
    expect(lines).toHaveLength(0)
  })
})

describe('already-paid work', () => {
  it('does not pay a job twice', () => {
    const j = job({ work_items: [item('Kroon', '11,12')] })
    const lines = calculateEarnings({
      profileId: TECH,
      rates: [rate({ kind: 'hammas', amount: 15 })],
      jobs: [j], hours: [], types: TYPES,
      periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE,
      alreadyPaid: new Set([`job:${j.id}`]),
    })
    expect(lines).toHaveLength(0)
  })
})

describe('two designers on one job', () => {
  const OTHER = 'designer-2'
  // The case that prompted this: crowns and laminates on one job, designed by
  // different people. `designed_by` was a single name, so one of them was paid
  // for the whole case and the other for none of it.
  const split = () => job({
    assigned_to: TECH,
    designed_by: DESIGNER,
    work_items: [
      item('Kroon', '11,12,13'),
      { ...item('Sild', '24,25'), designed_by: OTHER },
    ],
  })

  it('pays each designer only for the items they designed', () => {
    const rates = [
      rate({ kind: 'hammas', amount: 5, applies_to: 'disain', profile_id: DESIGNER }),
      rate({ kind: 'hammas', amount: 5, applies_to: 'disain', profile_id: OTHER }),
    ]
    const j = split()
    expect(earningsTotal(run(rates, [j], DESIGNER))).toBe(15)  // 3 crowns
    expect(earningsTotal(run(rates, [j], OTHER))).toBe(10)     // 2 bridge units
  })

  it("names only that designer’s own work on the line", () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 5, applies_to: 'disain', profile_id: OTHER })],
      [split()], OTHER
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].description).toContain('Sild')
    expect(lines[0].description).not.toContain('Kroon')
  })

  it('splits a percentage design fee by teeth instead of paying it twice', () => {
    const rates = [
      rate({ kind: 'protsent', amount: 50, applies_to: 'disain', profile_id: DESIGNER }),
      rate({ kind: 'protsent', amount: 50, applies_to: 'disain', profile_id: OTHER }),
    ]
    const j = job({
      assigned_to: TECH,
      designed_by: DESIGNER,
      disain_hind: 100,
      work_items: [
        item('Kroon', '11,12,13'),
        { ...item('Sild', '24,25'), designed_by: OTHER },
      ],
    })
    // 100 € of design, 5 teeth: 3/5 of it against one rule, 2/5 against the
    // other. Both taking the full 100 € would pay the design out twice.
    expect(earningsTotal(run(rates, [j], DESIGNER))).toBe(30)
    expect(earningsTotal(run(rates, [j], OTHER))).toBe(20)
  })

  it("pays the job’s designer for items that name nobody", () => {
    // The whole back-compat guarantee in one case: an item with no designer of
    // its own belongs to the job's, which is what every row written before this
    // field existed means.
    const lines = run(
      [rate({ kind: 'hammas', amount: 5, applies_to: 'disain', profile_id: DESIGNER })],
      [job({ designed_by: DESIGNER, work_items: [item('Kroon', '11,12')] })],
      DESIGNER
    )
    expect(earningsTotal(lines)).toBe(10)
  })

  it('treats an explicit null as nobody, not as "inherit"', () => {
    // The job page hides the job-level Disainija field once a job is split, so
    // "these laminates were outsourced" has to be sayable on the item. `??`
    // would have collapsed that back into the job's designer and paid them.
    const lines = run(
      [rate({ kind: 'hammas', amount: 5, applies_to: 'disain', profile_id: DESIGNER })],
      [job({
        designed_by: DESIGNER,
        work_items: [
          item('Kroon', '11,12'),
          { ...item('Laminaat', '21,22'), designed_by: null },
        ],
      })],
      DESIGNER
    )
    expect(earningsTotal(lines)).toBe(10)  // the crowns only
  })

  it('leaves a designer who owns no item unpaid', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 5, applies_to: 'disain', profile_id: DESIGNER })],
      [job({
        designed_by: DESIGNER,
        work_items: [{ ...item('Kroon', '11,12'), designed_by: OTHER }],
      })],
      DESIGNER
    )
    expect(lines).toHaveLength(0)
  })

  it("gives an additive design rule only that designer’s items", () => {
    const lines = run(
      [
        rate({ kind: 'hammas', amount: 5, applies_to: 'disain', profile_id: OTHER }),
        rate({
          kind: 'hammas', amount: 2, applies_to: 'disain', profile_id: OTHER,
          additive: true, label: 'Igeme disain',
        }),
      ],
      [split()], OTHER
    )
    // Two bridge units: 2 × 5 design + 2 × 2 gum. The crowns are not theirs.
    expect(earningsTotal(lines)).toBe(14)
  })

  it('diagnoses a missing rule only against the parts they designed', () => {
    const issues = diagnoseEarnings({
      profileId: OTHER,
      rates: [rate({
        kind: 'hammas', amount: 5, applies_to: 'disain',
        profile_id: OTHER, work_type: 'Kroon',
      })],
      jobs: [split()], hours: [], types: TYPES,
      periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE,
    })
    // Their item is the bridge and their only rule names crowns.
    expect(issues.some(i => i.code === 'reegel')).toBe(true)
  })
})

describe('kiirtöö uplift', () => {
  // Same shape as the one in `revisions` above; scoped per describe so a change
  // to one block's fixture cannot quietly retune another's expectations.
  const revision = (over: Partial<Revision> = {}): Revision => ({
    id: `rev-${++seq}`,
    ts: '2026-08-05T10:00:00Z',
    note: 'Uuesti',
    status: DONE,
    valmis_kuupaev: '2026-08-12',
    ...over,
  })

  const rush = (rates: WorkerRate[], jobs: Job[], rushMultiplier: number, profileId = TECH) =>
    calculateEarnings({
      profileId, rates, jobs, hours: [], types: TYPES,
      periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE,
      rushMultiplier,
    })

  it('multiplies a per-tooth rate on a rush job', () => {
    const lines = rush(
      [rate({ kind: 'hammas', amount: 15 })],
      [job({ kiirtoo: true, work_items: [item('Kroon', '11,12,13')] })],
      2
    )
    expect(earningsTotal(lines)).toBe(90)   // 3 × 15 × 2
    // qty × rate has to reach the amount, or the line cannot be checked.
    expect(lines[0].qty * lines[0].rate).toBe(90)
    expect(lines[0].description).toContain('kiirtöö ×2')
  })

  it('multiplies a flat per-job rate too', () => {
    const lines = rush(
      [rate({ kind: 'too', amount: 200 })],
      [job({ kiirtoo: true, work_items: [item('All-on-X', '11,12')] })],
      1.5
    )
    expect(earningsTotal(lines)).toBe(300)
  })

  it('leaves a percentage rule alone — the price already carries the rush', () => {
    // quoteJob multiplies production by the clinic multiplier BEFORE the price
    // is stored, so a percentage of that price has the uplift in it already.
    const lines = rush(
      [rate({ kind: 'protsent', amount: 40 })],
      [job({ kiirtoo: true, hind: 200, work_items: [item('Kroon', '11,12')] })],
      2
    )
    expect(earningsTotal(lines)).toBe(80)   // 40% of 200, not of 400
  })

  it('does not touch an ordinary job', () => {
    const lines = rush(
      [rate({ kind: 'hammas', amount: 15 })],
      [job({ kiirtoo: false, work_items: [item('Kroon', '11,12') ] })],
      2
    )
    expect(earningsTotal(lines)).toBe(30)
    expect(lines[0].description).not.toContain('kiirtöö')
  })

  it('changes nothing for a worker with no multiplier of their own', () => {
    // The whole back-compat guarantee: 1 is the default, so shipping this moved
    // nobody's pay until somebody was given a number.
    const lines = run(
      [rate({ kind: 'hammas', amount: 15 })],
      [job({ kiirtoo: true, work_items: [item('Kroon', '11,12')] })]
    )
    expect(earningsTotal(lines)).toBe(30)
  })

  it('follows the revision’s own rush flag, not the job’s', () => {
    const lines = rush(
      [rate({ kind: 'hammas', amount: 10, applies_to: 'muudatus' })],
      [job({
        kiirtoo: false,
        work_items: [item('Kroon', '11')],
        revisions: [revision({ kiirtoo: true, work_items: [item('Kroon', '11,12')] })],
      })],
      2
    )
    expect(earningsTotal(lines)).toBe(40)   // 2 teeth × 10 × 2
  })
})

describe('mudel', () => {
  // Same shape as the one in `revisions` above; scoped per describe so a change
  // to one block's fixture cannot quietly retune another's expectations.
  const revision = (over: Partial<Revision> = {}): Revision => ({
    id: `rev-${++seq}`,
    ts: '2026-08-05T10:00:00Z',
    note: 'Uuesti',
    status: DONE,
    valmis_kuupaev: '2026-08-12',
    ...over,
  })

  it('pays a flat model rule once on a job with a model', () => {
    const lines = run(
      [
        rate({ kind: 'hammas', amount: 15 }),
        rate({ kind: 'too', amount: 5, applies_to: 'mudel' }),
      ],
      [job({ mudel: true, work_items: [item('Kroon', '11,12'), item('Sild', '24,25')] })]
    )
    // The model adds to the production line, it does not replace it: 4 × 15 + 5.
    expect(earningsTotal(lines)).toBe(65)
    expect(lines.some(l => l.description.startsWith('Mudel ·'))).toBe(true)
  })

  it('reads the FLAG, not a "Mudel" work type', () => {
    // Two places said "model": the toggle next to Kiirtöö and a work type in
    // the grid. Pay keys on the flag alone, so deleting that work type takes
    // nothing with it.
    const withFlag = run(
      [rate({ kind: 'too', amount: 5, applies_to: 'mudel' })],
      [job({ mudel: true, work_items: [item('Kroon', '11')] })]
    )
    expect(earningsTotal(withFlag)).toBe(5)

    const asWorkType = run(
      [rate({ kind: 'too', amount: 5, applies_to: 'mudel' })],
      [job({ mudel: false, work_items: [item('Kroon', '11'), item('Mudel', '')] })]
    )
    expect(earningsTotal(asWorkType)).toBe(0)
  })

  it('pays a flat model rule on a job that names no work at all', () => {
    // A model is something the job HAS, not one of its work items — without a
    // stand-in there is nothing for the rule to match and it silently pays 0.
    const lines = run(
      [rate({ kind: 'too', amount: 5, applies_to: 'mudel' })],
      [job({ mudel: true, work_items: [] })]
    )
    expect(earningsTotal(lines)).toBe(5)
  })

  it('pays nothing for a model when the job has none', () => {
    const lines = run(
      [rate({ kind: 'too', amount: 5, applies_to: 'mudel' })],
      [job({ mudel: false, work_items: [item('Kroon', '11')] })]
    )
    expect(lines).toHaveLength(0)
  })

  it('does not let a model rule compete with the production rule', () => {
    // Its own scope, so pickRateFor never sees it while choosing how the work
    // itself is paid — the failure a fourth "kind" would have caused.
    const lines = run(
      [
        rate({ kind: 'hammas', amount: 15 }),
        rate({ kind: 'too', amount: 500, applies_to: 'mudel', priority: 99 }),
      ],
      [job({ mudel: false, work_items: [item('Kroon', '11,12')] })]
    )
    expect(earningsTotal(lines)).toBe(30)
  })

  it('leaves a model on a remake unpaid unless the rule covers rework', () => {
    const j = () => job({
      work_items: [item('Kroon', '11')],
      revisions: [revision({ mudel: true, work_items: [item('Kroon', '11')] })],
    })
    expect(earningsTotal(run(
      [rate({ kind: 'too', amount: 5, applies_to: 'mudel' })], [j()]
    ))).toBe(0)
    expect(earningsTotal(run(
      [rate({ kind: 'too', amount: 5, applies_to: 'mudel', pay_revisions: true })], [j()]
    ))).toBe(5)
  })

  it('names a model recorded as a work item instead of the flag', () => {
    const issues = diagnoseEarnings({
      profileId: TECH,
      rates: [
        rate({ kind: 'hammas', amount: 15 }),
        rate({ kind: 'too', amount: 10, applies_to: 'mudel' }),
      ],
      jobs: [job({ mudel: false, work_items: [item('Kroon', '11'), item('Mudel', '')] })],
      hours: [], types: TYPES,
      periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE,
    })
    expect(issues.some(i => i.label.includes('tööosana'))).toBe(true)
  })

  it('stays quiet about work-item models for someone with no model rate', () => {
    const issues = diagnoseEarnings({
      profileId: TECH,
      rates: [rate({ kind: 'hammas', amount: 15 })],
      jobs: [job({ mudel: false, work_items: [item('Kroon', '11'), item('Mudel', '')] })],
      hours: [], types: TYPES,
      periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE,
    })
    expect(issues.some(i => i.label.includes('tööosana'))).toBe(false)
  })

  it('keeps two different reasons apart even though both are "reegel"', () => {
    // They used to share one bucket keyed by code, so only the first message
    // survived and the rest were counted under a heading about something else.
    const issues = diagnoseEarnings({
      profileId: TECH,
      rates: [
        rate({ kind: 'hammas', amount: 15, work_type: 'Kroon' }),
        rate({ kind: 'too', amount: 10, applies_to: 'mudel' }),
      ],
      jobs: [
        job({ mudel: true, work_items: [item('Kroon', '11')] }),
        job({ mudel: false, work_items: [item('Kroon', '11'), item('Mudel', '')] }),
      ],
      hours: [], types: TYPES,
      periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE,
    })
    const reegel = issues.filter(i => i.code === 'reegel')
    expect(reegel.length).toBeGreaterThan(1)
    expect(new Set(reegel.map(i => i.label)).size).toBe(reegel.length)
  })

  it('names a missing model rule in the diagnostics', () => {
    const issues = diagnoseEarnings({
      profileId: TECH,
      rates: [rate({ kind: 'hammas', amount: 15 })],
      jobs: [job({ mudel: true, work_items: [item('Kroon', '11')] })],
      hours: [], types: TYPES,
      periodStart: '2026-08-01', periodEnd: '2026-08-31', doneStageKey: DONE,
    })
    expect(issues.some(i => i.label.includes('mudel'))).toBe(true)
  })
})

describe('a payslip line names only what it paid for', () => {
  // "Disain: Kroon + Sild + Mudel · Elena Lund — 23 × 18.00 €" was the report.
  // The Mudel work item had no teeth, so a per-tooth rule paid exactly nothing
  // for it — but the line named it anyway, and the only way to find out that no
  // money had moved was to read the engine.
  it('leaves out a work item that earned nothing under a per-tooth rule', () => {
    const lines = run(
      [rate({ kind: 'hammas', amount: 18, applies_to: 'disain', profile_id: DESIGNER })],
      [job({
        designed_by: DESIGNER,
        work_items: [item('Kroon', '11,12'), item('Sild', '24,25'), item('Mudel', '')],
      })],
      DESIGNER
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].amount).toBe(72)          // 4 teeth, the model adds none
    expect(lines[0].description).toContain('Kroon')
    expect(lines[0].description).toContain('Sild')
    expect(lines[0].description).not.toContain('Mudel')
  })

  it('KEEPS an item that a per-tooth rule genuinely paid for', () => {
    // The other outcome of the same check: teeth on the model item ARE money,
    // and hiding the name would then be the dishonest half.
    const lines = run(
      [rate({ kind: 'hammas', amount: 18, applies_to: 'disain', profile_id: DESIGNER })],
      [job({
        designed_by: DESIGNER,
        work_items: [item('Kroon', '11,12'), item('Mudel', '21,22')],
      })],
      DESIGNER
    )
    expect(lines[0].amount).toBe(72)
    expect(lines[0].description).toContain('Mudel')
  })

  it('keeps a toothless item when the rule is flat, because that one does pay', () => {
    const lines = run(
      [rate({ kind: 'too', amount: 50, work_type: 'Proteez' })],
      [job({ work_items: [item('Proteez', '')] })]
    )
    expect(lines[0].amount).toBe(50)
    expect(lines[0].description).toContain('Proteez')
  })

  it('names only the types an additive rule covered', () => {
    const lines = run(
      [
        rate({ kind: 'hammas', amount: 18 }),
        rate({
          kind: 'hammas', amount: 9, additive: true,
          label: 'Igeme tasu', work_type: 'All-on-X',
        }),
      ],
      [job({ work_items: [item('Kroon', '11,12'), item('All-on-X', '21,22')] })]
    )
    const extra = lines.find(l => l.description.startsWith('Igeme tasu'))
    expect(extra).toBeDefined()
    expect(extra!.description).toContain('All-on-X')
    expect(extra!.description).not.toContain('Kroon')
  })
})

/**
 * The net→gross wedge. Every number below is checked against kalkulaator.ee's
 * 2026 palgakalkulaator, because a payroll figure this app derived on its own
 * is only worth having if it agrees with the one the accountant will produce.
 */
describe('palgamaksud', () => {
  const EE_2026: PayrollTaxRates = {
    tooandjaMaksudProtsent: 33.8,
    tulumaksProtsent: 22,
    maksuvabaTuluKuus: 700,
    tootajaTootuskindlustusProtsent: 1.6,
    kogumispensionProtsent: 2,
  }

  it('grosses 1600 € net up to the figure kalkulaator.ee gives', () => {
    expect(grossFromNet(1600, EE_2026)).toBe(1923.08)
  })

  it('costs the employer 2573.08 € to pay 1600 € net', () => {
    const slip = payslipFromGross(grossFromNet(1600, EE_2026), EE_2026)
    expect(slip.tooandjaMaksud).toBe(650.0)  // 1923.08 × 33.8%
    expect(slip.employerCost).toBe(2573.08)
  })

  it('splits the payslip the way the tax office does', () => {
    const slip = payslipFromGross(1923.08, EE_2026)
    expect(slip.kogumispension).toBe(38.46)
    expect(slip.tootuskindlustus).toBe(30.77)
    expect(slip.tulumaks).toBe(253.85)
    expect(slip.net).toBe(1600.0)
  })

  it('round-trips gross → net → gross', () => {
    for (const gross of [700, 1200, 1790.08, 1923.08, 4000]) {
      const net = payslipFromGross(gross, EE_2026).net
      expect(Math.abs(grossFromNet(net, EE_2026) - gross)).toBeLessThan(0.02)
    }
  })

  it('charges no income tax below the tax-free income', () => {
    // 500 € net: only the two withholdings stand between net and gross.
    const gross = grossFromNet(500, EE_2026)
    expect(gross).toBe(518.67)   // 500 / 0.964
    expect(payslipFromGross(gross, EE_2026).tulumaks).toBe(0)
  })

  it("uses the person's own second-pillar rate over the clinic default", () => {
    // 6% withheld instead of 2% means a higher gross is needed for the same
    // take-home — the case that makes this a per-person field.
    expect(grossFromNet(1600, EE_2026, { kogumispensionProtsent: 6 }))
      .toBeGreaterThan(grossFromNet(1600, EE_2026))
    expect(grossFromNet(1600, EE_2026, { kogumispensionProtsent: 0 }))
      .toBeLessThan(grossFromNet(1600, EE_2026))
  })

  it('distinguishes an opted-out zero from an unset null', () => {
    const optedOut = grossFromNet(1600, EE_2026, { kogumispensionProtsent: 0 })
    const unset = grossFromNet(1600, EE_2026, { kogumispensionProtsent: null })
    expect(unset).toBe(grossFromNet(1600, EE_2026))
    expect(optedOut).not.toBe(unset)
  })

  it('grosses up more for someone with no tax-free income', () => {
    // Second job: the allowance is used at the other employer.
    expect(grossFromNet(1600, EE_2026, { maksuvabaTulu: 0 })).toBe(2127.89)
  })

  it('leaves a gross-entered figure alone', () => {
    expect(grossOf(1600, 'bruto', EE_2026)).toBe(1600)
    expect(grossOf(1600, null, EE_2026)).toBe(1600)
    expect(grossOf(1600, 'neto', EE_2026)).toBe(1923.08)
  })

  it('reads unset tax rates as no tax rather than exploding', () => {
    const none: PayrollTaxRates = {
      tooandjaMaksudProtsent: 0, tulumaksProtsent: 0, maksuvabaTuluKuus: 0,
      tootajaTootuskindlustusProtsent: 0, kogumispensionProtsent: 0,
    }
    expect(grossFromNet(1600, none)).toBe(1600)
    expect(payslipFromGross(1600, none).employerCost).toBe(1600)
  })
})
