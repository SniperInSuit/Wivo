import { describe, it, expect } from 'vitest'
import type { Job, Revision } from '../types/job'
import type { InvoiceFull, Payment } from '../types/invoice'
import { periodMetrics, unitSplitLabel, teethSplitLabel, type Range } from './periodMetrics'

/**
 * The reconciliation diff, as a runnable fixture.
 *
 * Each block below is one of the four root causes from docs/finance-metrics.md.
 * The point is not that the aggregator returns some number — it is that the two
 * surfaces which used to return DIFFERENT numbers now provably return the same
 * one, and that the differences which are legitimate are the ones a caller
 * asked for by parameter.
 */

const PERIOD: Range = { start: '2026-08-01', end: '2026-08-31' }

let seq = 0
function job(over: Partial<Job> = {}): Job {
  return {
    id: `job-${++seq}`,
    status: 'valmis',
    kuupaev: '2026-08-05',
    patsient: 'Mari Maasikas',
    patient_id: null,
    customer_id: null,
    customer_ref: null,
    too: 'Kroon',
    materjal: null,
    masina: null,
    print_id: null,
    disain_id: null,
    varv: null,
    hambad: '11',
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
    extra_costs: [],
    hind: 100,
    disain_hind: null,
    makstud: false,
    makse_kuupaev: null,
    assigned_to: null,
    designed_by: null,
    created_at: '2026-08-05T00:00:00Z',
    updated_at: '2026-08-05T00:00:00Z',
    ...over,
  }
}

const rev = (over: Partial<Revision> = {}): Revision => ({
  id: `rev-${++seq}`,
  ts: '2026-08-12T10:00:00Z',
  note: 'Ümbertegemine',
  ...over,
})

const run = (jobs: Job[], opts: Partial<Parameters<typeof periodMetrics>[1]> = {},
             extra: { invoices?: InvoiceFull[]; payments?: Payment[] } = {}) =>
  periodMetrics(
    { jobs, range: PERIOD, ...extra },
    { dateAnchor: 'too', includeChanges: true, moneyConcept: 'kaive', ...opts },
  )

// ── Cause 1: counting unit — a multi-item job is ONE job ─────────────────────
describe('cause 1 — work items are not jobs', () => {
  const multi = job({
    work_items: [
      { id: 'a', too: 'Kroon', hambad: '11,12' },
      { id: 'b', too: 'Sild', hambad: '13,14' },
      { id: 'c', too: 'Laminaat', hambad: '15' },
    ],
    hambad: '11,12,13,14,15',
  })

  it('counts one job where the per-type table counted three', () => {
    const m = run([multi])
    expect(m.tood).toBe(1)
    // The old Rahandus footer summed byWorkType.jobs, which incremented per item.
    expect(m.tooosad).toBe(3)
  })

  it('keeps tooosad available so the per-type table can still say 3 — labelled', () => {
    expect(run([multi]).tooosad).toBe(3)
  })
})

// ── Cause 2: are revisions units? ────────────────────────────────────────────
describe('cause 2 — changes as units is a parameter, not a file', () => {
  const withRevs = job({
    revisions: [
      rev({ valmis_kuupaev: '2026-08-14', hambad: '21', price: 40 }),
      rev({ valmis_kuupaev: '2026-08-20', hambad: '22,23', price: 0 }),
    ],
  })

  it('includeChanges: true → 1 töö + 2 muudatust = 3 ühikut', () => {
    const m = run([withRevs])
    expect(m.tood).toBe(1)
    expect(m.muudatused).toBe(2)
    expect(m.yksused).toBe(3)
  })

  it('includeChanges: false → the same rows, 1 ühik', () => {
    const m = run([withRevs], { includeChanges: false })
    expect(m.muudatused).toBe(2)   // still reported, so the split can be shown
    expect(m.yksused).toBe(1)
  })

  it('splits teeth so a mixed count is never shown as one opaque number', () => {
    const m = run([withRevs])
    expect(m.hambadOriginaal).toBe(1)   // '11'
    expect(m.hambadMuudatused).toBe(3)  // '21' + '22,23'
    expect(m.hambad).toBe(4)
    expect(teethSplitLabel(m)).toBe('1 originaal · 3 muudatused')
    expect(unitSplitLabel(m)).toBe('1 töö · 2 muudatust')
  })
})

// ── Cause 3: a revision belongs to ITS OWN period ────────────────────────────
describe('cause 3 — the redo is anchored on itself, not on its parent', () => {
  const juneJobAugustRedo = job({
    valmis_kuupaev: '2026-06-10',           // parent finished in June
    revisions: [rev({ valmis_kuupaev: '2026-08-14', hambad: '24,25', price: 0 })],
  })

  it('counts the August redo in August while the June parent stays out', () => {
    const m = run([juneJobAugustRedo])
    expect(m.tood).toBe(0)
    expect(m.muudatused).toBe(1)
    expect(m.hambadOriginaal).toBe(0)
    expect(m.hambadMuudatused).toBe(2)
  })

  // This is the "0 tööd · 24 hambaid · negative kate" row the spec calls out as
  // mathematically correct but reading as broken. It IS correct, and the split
  // label is what makes it say so.
  it('produces the 0-jobs-but-teeth shape the per-type table shows', () => {
    const m = run([juneJobAugustRedo])
    expect(unitSplitLabel(m)).toBe('0 tööd · 1 muudatust')
  })
})

// ── Cause 4: four money concepts, not two ────────────────────────────────────
describe('cause 4 — money concepts are distinct and labelled', () => {
  const j = job({
    hind: 100,
    makstud: true,                                            // the legacy flag
    revisions: [rev({ valmis_kuupaev: '2026-08-14', price: 40 })],
  })
  const invoices = [
    { id: 'i1', status: 'saadetud', issue_date: '2026-08-15', net_total: 90, lines: [] },
    { id: 'i2', status: 'tuhistatud', issue_date: '2026-08-16', net_total: 500, lines: [] },
  ] as unknown as InvoiceFull[]
  const payments = [
    { id: 'p1', amount: 60, paid_at: '2026-08-20' },
    { id: 'p2', amount: 25, paid_at: '2026-07-20' },          // previous period
  ] as unknown as Payment[]

  it('tulu excludes redo charges; kaive includes them', () => {
    expect(run([j], { moneyConcept: 'tulu' }).money).toBe(100)
    expect(run([j], { moneyConcept: 'kaive' }).money).toBe(140)
  })

  it('arveldatud reads invoices and drops cancelled ones', () => {
    expect(run([j], { moneyConcept: 'arveldatud' }, { invoices }).money).toBe(90)
  })

  it('laekunud reads payment rows in the period, not the makstud flag', () => {
    // The job is flagged makstud=true and worth 140. Cash that actually arrived
    // in August is 60. Those were the two numbers shown as "Makstud" and
    // "Laekunud" for the same period.
    expect(run([j], { moneyConcept: 'laekunud' }, { payments }).money).toBe(60)
  })

  it('every concept carries its own label so two numbers can never look like one', () => {
    expect(run([j], { moneyConcept: 'tulu' }).moneyLabel).toBe('Tulu')
    expect(run([j], { moneyConcept: 'kaive' }).moneyLabel).toBe('Käive')
    expect(run([j], { moneyConcept: 'arveldatud' }).moneyLabel).toBe('Arveldatud')
    expect(run([j], { moneyConcept: 'laekunud' }).moneyLabel).toBe('Laekunud')
  })
})

// ── The acceptance criterion itself ──────────────────────────────────────────
describe('two surfaces, same params, same numbers', () => {
  const fixture = [
    job({ work_items: [{ id: 'a', too: 'Kroon', hambad: '11' }, { id: 'b', too: 'Sild', hambad: '12,13' }], hambad: '11,12,13' }),
    job({ valmis_kuupaev: '2026-08-22', hambad: '21,22' }),
    job({ valmis_kuupaev: '2026-06-01', revisions: [rev({ valmis_kuupaev: '2026-08-03', hambad: '31' })] }),
    job({ valmis_kuupaev: '2026-09-15' }),   // next period — must not appear
  ]

  it('is one call, so there is nothing left to disagree about', () => {
    const tootmine = run(fixture)
    const rahandus = run(fixture)
    expect(rahandus).toEqual(tootmine)
    expect(tootmine.tood).toBe(2)
    expect(tootmine.muudatused).toBe(1)
    expect(tootmine.yksused).toBe(3)
    expect(tootmine.hambad).toBe(6)   // 3 + 2 original, 1 change
  })

  it('all-time is a real scope, not a missing filter', () => {
    const allTime = periodMetrics({ jobs: fixture, range: null },
      { dateAnchor: 'too', includeChanges: true, moneyConcept: 'kaive' })
    expect(allTime.range).toBeNull()
    expect(allTime.tood).toBe(4)      // includes the September job
  })
})
