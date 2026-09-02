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
