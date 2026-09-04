import './_domStub'
import { describe, it, expect } from 'vitest'
import { jobCosts } from './jobCosts'
import type { JobCostsInput } from './jobCosts'
import type { WorkerRate } from './earnings'
import { DEFAULT_WORK_TYPES } from '@shared/pricing/workTypes'

const TECH = 'tech-1'
const DESIGNER = 'des-1'

const rate = (over: Partial<WorkerRate>): WorkerRate => ({
  id: crypto.randomUUID(),
  profile_id: TECH,
  work_type: 'Kroon',
  kind: 'hammas',
  amount: 10,
  applies_to: 'too',
  additive: false,
  priority: 0,
  valid_from: null,
  valid_to: null,
  label: null,
  ...over,
} as WorkerRate)

function input(over: Partial<JobCostsInput> = {}): JobCostsInput {
  return {
    job: {
      work_items: [{ id: 'a', too: 'Kroon', hambad: '11,12,13' }],
      too: 'Kroon',
      hambad: '11,12,13',
      materjal: '',
      masina: '',
      kiirtoo: false,
      mudel: false,
      assigned_to: TECH,
      designed_by: null,
      extra_costs: [],
      kulu_yle: {},
      hind: 200,
      disain_hind: null,
      ...(over.job ?? {}),
    },
    rates: [rate({})],
    workTypes: DEFAULT_WORK_TYPES,
    materialCosts: {},
    materialPrices: {},
    workers: [{ id: TECH, full_name: 'Tiit Tehnik' }, { id: DESIGNER, full_name: 'Diana Disainija' }],
    on: '2026-09-02',
    ...over,
  } as JobCostsInput
}

const cat = (r: ReturnType<typeof jobCosts>, key: string) =>
  r.categories.find(c => c.key === key)!

describe('jobCosts — what the rules say', () => {
  it('charges the technician rate per tooth', () => {
    const r = jobCosts(input())
    expect(cat(r, 'tehnik').computed).toBe(30)
    expect(cat(r, 'tehnik').lines).toHaveLength(1)
    expect(r.total).toBe(30)
  })

  it('adds the model as its own line, not instead of production', () => {
    // The model is a flag beside "kiirtöö", never a work type. It ADDS to the
    // production rate: printing one is work the technician actually did.
    const r = jobCosts(input({
      job: { ...input().job, mudel: true },
      rates: [rate({}), rate({ applies_to: 'mudel', kind: 'too', amount: 10, work_type: '' })],
    }))
    const t = cat(r, 'tehnik')
    expect(t.lines.map(l => l.label)).toContain('Mudel: 1 × 10 €')
    expect(t.computed).toBe(40)
  })

  it('leaves the model out when nobody has a rule for it', () => {
    // The complaint that started this: a payslip named a model it never paid
    // for. No rule means no line, not a guessed one.
    const r = jobCosts(input({ job: { ...input().job, mudel: true } }))
    expect(cat(r, 'tehnik').lines.map(l => l.label).join()).not.toContain('Mudel')
    expect(cat(r, 'tehnik').computed).toBe(30)
  })

  it('multiplies a rush by the PERSON’s multiplier, not a global one', () => {
    const r = jobCosts(input({
      job: { ...input().job, kiirtoo: true },
      workers: [{ id: TECH, kiirtoo_kordaja: 2, full_name: 'Tiit' }],
    }))
    expect(cat(r, 'tehnik').computed).toBe(60)
  })

  it('bills design per work item, so two designers split one job', () => {
    const r = jobCosts(input({
      job: {
        ...input().job,
        work_items: [
          { id: 'a', too: 'Kroon', hambad: '11,12', designed_by: TECH },
          { id: 'b', too: 'Laminaat', hambad: '21', designed_by: DESIGNER },
        ],
      },
      rates: [
        rate({ profile_id: TECH, applies_to: 'disain', amount: 5, work_type: 'Kroon' }),
        rate({ profile_id: DESIGNER, applies_to: 'disain', amount: 7, work_type: 'Laminaat' }),
      ],
    }))
    expect(cat(r, 'disainija').computed).toBe(17) // 2×5 + 1×7
    expect(cat(r, 'disainija').lines).toHaveLength(2)
  })
})

describe('jobCosts — the hand-typed override', () => {
  it('replaces the category total and says what it replaced', () => {
    const r = jobCosts(input({ job: { ...input().job, kulu_yle: { tehnik: 45 } } }))
    const t = cat(r, 'tehnik')
    expect(t.computed).toBe(30)   // still known, so the screen can show both
    expect(t.override).toBe(45)
    expect(t.amount).toBe(45)
    expect(r.total).toBe(45)
  })

  it('treats 0 as a decision, not as a missing value', () => {
    // Absent = "compute from the rules"; 0 = "this job cost nothing here".
    // Collapsing the two would make an override impossible to take back.
    const zero = jobCosts(input({ job: { ...input().job, kulu_yle: { tehnik: 0 } } }))
    expect(cat(zero, 'tehnik').override).toBe(0)
    expect(cat(zero, 'tehnik').amount).toBe(0)
    expect(zero.total).toBe(0)

    const absent = jobCosts(input({ job: { ...input().job, kulu_yle: {} } }))
    expect(cat(absent, 'tehnik').override).toBeNull()
    expect(cat(absent, 'tehnik').amount).toBe(30)
  })

  it('overrides one category without touching the others', () => {
    const r = jobCosts(input({
      job: {
        ...input().job,
        kulu_yle: { materjal: 12 },
        extra_costs: [{ nimi: 'Kruvi', summa: 3 }],
      },
    }))
    expect(cat(r, 'tehnik').amount).toBe(30)
    expect(cat(r, 'materjal').amount).toBe(12)
    expect(r.adHocTotal).toBe(3)
    expect(r.total).toBe(45)
  })

  it('ignores a key nobody recognises', () => {
    // The column is jsonb: anything can end up in it. An unknown key must not
    // silently join the total.
    const r = jobCosts(input({ job: { ...input().job, kulu_yle: { vabatekst: 999 } } }))
    expect(r.total).toBe(30)
  })
})

describe('jobCosts — the margin', () => {
  it('takes revenue from the job price plus the design fee', () => {
    const r = jobCosts(input({ job: { ...input().job, hind: 200, disain_hind: 50 } }))
    expect(r.revenue).toBe(250)
    expect(r.margin).toBe(220)
    expect(r.marginPct).toBe(88)
  })

  it('refuses a percentage rather than dividing by zero', () => {
    const r = jobCosts(input({ job: { ...input().job, hind: null, disain_hind: null } }))
    expect(r.revenue).toBe(0)
    expect(r.marginPct).toBeNull()
  })

  it('goes negative when the job cost more than it sold for', () => {
    const r = jobCosts(input({ job: { ...input().job, hind: 20 } }))
    expect(r.margin).toBe(-10)
  })
})

// ─── The whole case, remakes included ────────────────────────────────────────

import { jobTotalCosts } from './jobCosts'
import type { Job, Revision } from '../types/job'
import type { JobTotalInput } from './jobCosts'

const DONE = 'valmis'

const revision = (over: Partial<Revision> = {}): Revision => ({
  id: crypto.randomUUID(),
  ts: '2026-08-01T10:00:00Z',
  note: 'Uuesti',
  status: DONE,
  valmis_kuupaev: '2026-08-05',
  work_items: [{ id: 'r1', too: 'Kroon', hambad: '11' }],
  ...over,
} as Revision)

function totalInput(over: Partial<JobTotalInput> = {}): JobTotalInput {
  const base = input()
  return {
    ...base,
    job: { ...(base.job as object), id: 'job-1', patsient: 'Test', revisions: [] } as unknown as Job,
    doneStageKey: DONE,
    ...over,
  } as JobTotalInput
}

describe('jobTotalCosts — original plus remakes', () => {
  it('equals the plain job cost when there are no revisions', () => {
    const t = jobTotalCosts(totalInput())
    expect(t.revisionTotal).toBe(0)
    expect(t.total).toBe(t.base.total)
    expect(t.margin).toBe(t.base.margin)
  })

  // The whole point: the margin on the job page was overstating itself by
  // exactly the cost of the remakes, which were shown but never added.
  it('adds a remake to the total and takes it off the margin', () => {
    const job = totalInput().job
    const rev = revision()
    const t = jobTotalCosts(totalInput({
      job: { ...job, revisions: [rev] } as Job,
      // A rate scoped to revisions — otherwise rework is unpaid, see below.
      rates: [rate({}), rate({ applies_to: 'muudatus', amount: 8 })],
    }))
    expect(t.revisions).toHaveLength(1)
    expect(t.revisions[0].labour).toBe(8)          // 1 tooth × 8 €
    expect(t.total).toBe(round(t.base.total + 8))
    expect(t.margin).toBe(round(t.base.revenue - t.total))
  })

  // Rework is UNPAID unless a rule says otherwise. This is the payroll rule,
  // and the reason labour is asked of calculateEarnings instead of re-derived:
  // a formula written here would have paid the ordinary Kroon rate.
  it('pays nothing for a remake when no rule covers rework', () => {
    const job = totalInput().job
    const t = jobTotalCosts(totalInput({
      job: { ...job, revisions: [revision()] } as Job,
      rates: [rate({})],   // plain 'too' rate, pay_revisions not set
    }))
    expect(t.revisions[0].labour).toBe(0)
  })

  it('pays nothing when the remake is the lab\u2019s own fault', () => {
    const job = totalInput().job
    const t = jobTotalCosts(totalInput({
      job: { ...job, revisions: [revision({ taspidev: false })] } as Job,
      rates: [rate({}), rate({ applies_to: 'muudatus', amount: 8 })],
    }))
    expect(t.revisions[0].labour).toBe(0)
    expect(t.revisions[0].tasustatav).toBe(false)
  })

  // An unfinished remake has consumed resin but earned nobody anything yet.
  it('carries an unfinished remake\u2019s material but not its labour', () => {
    const job = totalInput().job
    const t = jobTotalCosts(totalInput({
      job: { ...job, materjal: 'Crown HT', revisions: [revision({ status: 'disain' })] } as Job,
      materialCosts: { 'Crown HT': { small: 7, large: 7 } },
      rates: [rate({}), rate({ applies_to: 'muudatus', amount: 8 })],
    }))
    expect(t.revisions[0].valmis).toBe(false)
    expect(t.revisions[0].labour).toBe(0)
    expect(t.revisions[0].material).toBe(7)        // one tooth of resin, still spent
  })

  it('counts a remake\u2019s own extra costs', () => {
    const job = totalInput().job
    const t = jobTotalCosts(totalInput({
      job: {
        ...job,
        revisions: [revision({ extra_costs: [{ nimi: 'Uus kruvi', summa: 12.5 }] })],
      } as Job,
    }))
    expect(t.revisions[0].extras).toBe(12.5)
    expect(t.revisionTotal).toBe(12.5)
  })

  it('numbers remakes the way the job page chips do', () => {
    const job = totalInput().job
    const t = jobTotalCosts(totalInput({
      job: { ...job, revisions: [revision(), revision(), revision()] } as Job,
    }))
    expect(t.revisions.map(r => r.nr)).toEqual([1, 2, 3])
  })

  it('reports no percentage when the job has no price to take one of', () => {
    const job = totalInput().job
    const t = jobTotalCosts(totalInput({
      job: { ...job, hind: null, disain_hind: null, revisions: [revision()] } as Job,
    }))
    expect(t.marginPct).toBeNull()
  })
})

const round = (n: number) => Math.round(n * 100) / 100

describe('jobTotalCosts — what a remake does NOT re-buy', () => {
  // The bug this test exists for: the work type's consumables were charged in
  // full on every revision, so five remakes of a 1200 € Allon4 added 6000 € of
  // screws and abutments that were already in the patient's mouth. Every remake
  // read the same ~1313 € whatever had actually been redone.
  const KULUKAS = [{
    nimi: 'Allon4', hex: '#000', match: 'allon4',
    kulud: [{ nimi: 'Abutmendid', summa: 100, tyyp: 'hammas' as const }],
  }] as unknown as JobTotalInput['workTypes']

  const base = () => totalInput({
    job: {
      ...totalInput().job,
      too: 'Allon4',
      work_items: [{ id: 'a', too: 'Allon4', hambad: '11,12,13' }],
      hambad: '11,12,13',
      revisions: [revision({ work_items: [{ id: 'r', too: 'Allon4', hambad: '11,12,13' }] })],
    } as Job,
    workTypes: KULUKAS,
    rates: [rate({ work_type: 'Allon4' }), rate({ work_type: 'Allon4', applies_to: 'muudatus', amount: 8 })],
  })

  it('charges the consumables once, on the original', () => {
    const t = jobTotalCosts(base())
    expect(cat(t.base, 'tarvikud').amount).toBe(300)   // 3 teeth × 100 €
    expect(t.revisions[0].material).toBe(0)            // no resin priced, no screws
  })

  it('does not put a second set of hardware on the remake', () => {
    const t = jobTotalCosts(base())
    // 3 × 8 € rework labour and nothing else. If consumables leak back in this
    // becomes 324 and the case total is 300 € too high.
    expect(t.revisions[0].total).toBe(24)
  })

  // The escape hatch that makes the conservative default safe: a remake that
  // really did eat a screw records it, and then it counts.
  it('counts hardware the remake really did consume', () => {
    const b = base()
    const job = b.job
    const t = jobTotalCosts({
      ...b,
      job: {
        ...job,
        revisions: [revision({
          work_items: [{ id: 'r', too: 'Allon4', hambad: '11,12,13' }],
          extra_costs: [{ nimi: 'Murdunud kruvi', summa: 100 }],
        })],
      } as Job,
    })
    expect(t.revisions[0].extras).toBe(100)
    expect(t.revisions[0].total).toBe(124)
  })
})
