/**
 * Which lines a confirmed payout actually covers.
 *
 * The bug: `paidKeysFrom` RECONSTRUCTED each line's key from `job_id`,
 * `revision_id` and `kind`. One job yields up to ten distinct payable lines and
 * only four of those key shapes were recoverable, so design, model and every
 * additive line came back as `job:<id>` — a key none of them ever had. The
 * payout therefore did not cover them, they reappeared as unpaid, and
 * confirming again would have paid them a SECOND time.
 *
 * Seen on real data 02.09.2026: a 42-line payout was confirmed and seven
 * "Hamba Disain" lines worth 135 € stood unpaid immediately after it, all seven
 * already inside those 42.
 */
import { describe, it, expect } from 'vitest'
import { paidKeysFrom } from './useWorkerPay'
import type { WorkerPayout, WorkerPayoutLine } from './useWorkerPay'
import type { WorkerRate } from '../lib/earnings'

const JOB = 'job-1'
const REV = 'rev-1'
const RULE = 'rule-1'

const line = (over: Partial<WorkerPayoutLine>): WorkerPayoutLine => ({
  id: crypto.randomUUID(), payout_id: 'p1',
  job_id: JOB, revision_id: null, work_hours_id: null,
  kind: 'hammas', description: '', qty: 1, rate: 10, amount: 10,
  line_key: null,
  ...over,
})

const payout = (lines: WorkerPayoutLine[]): WorkerPayout => ({
  id: 'p1', clinic_id: 'c', profile_id: 'w1',
  period_start: '2026-08-01', period_end: '2026-08-31',
  total: 0, status: 'kinnitatud', paid_at: null, note: null,
  created_by: null, created_at: '', lines,
} as WorkerPayout)

const RATES: WorkerRate[] = [
  { id: RULE, profile_id: 'w1', additive: true, label: 'Hamba Disain' } as WorkerRate,
]

const keys = (lines: WorkerPayoutLine[], rates: WorkerRate[] = RATES) =>
  paidKeysFrom([payout(lines)], 'w1', rates)

describe('paidKeysFrom — a line paid once stays paid', () => {
  it('reads the stored key and does not guess', () => {
    const k = keys([line({ line_key: `extra:${RULE}:${JOB}`, description: 'ükskõik mis' })])
    expect(k.has(`extra:${RULE}:${JOB}`)).toBe(true)
    // Crucially NOT the reconstructed one: guessing is what caused the bug.
    expect(k.has(`job:${JOB}`)).toBe(false)
  })

  it('keeps every distinct line of one job apart', () => {
    // The failure in one assertion: all four of these used to collapse into
    // `job:<id>`, so three of them were offered again after being paid.
    const k = keys([
      line({ line_key: `job:${JOB}` }),
      line({ line_key: `design:${JOB}` }),
      line({ line_key: `mudel:${JOB}` }),
      line({ line_key: `extra:${RULE}:${JOB}` }),
    ])
    expect(k.size).toBe(4)
  })

  it('ignores another person’s payout', () => {
    const other = { ...payout([line({ line_key: `job:${JOB}` })]), profile_id: 'w2' }
    expect(paidKeysFrom([other], 'w1', RATES).size).toBe(0)
  })
})

describe('paidKeysFrom — lines paid before migration 058', () => {
  it('recognises a design line by its description', () => {
    const k = keys([line({ description: 'Disain: Kroon · Mari Maasikas' })])
    expect(k.has(`design:${JOB}`)).toBe(true)
    expect(k.has(`job:${JOB}`)).toBe(false)
  })

  it('recognises a model line', () => {
    expect(keys([line({ description: 'Mudel · Mari Maasikas' })]).has(`mudel:${JOB}`)).toBe(true)
  })

  it('recognises an additive line by its rule label', () => {
    // The label is the user's own text, which is why the rules are consulted.
    // This is the exact line that came back: "Hamba Disain: Kroon · …".
    const k = keys([line({ description: 'Hamba Disain: Kroon · Laura Viliko' })])
    expect(k.has(`extra:${RULE}:${JOB}`)).toBe(true)
  })

  it('does not mistake an additive line for one when no rule matches', () => {
    // Without the rule in hand there is nothing to recognise, so it keeps the
    // old answer rather than inventing a rule id.
    const k = keys([line({ description: 'Hamba Disain: Kroon · Laura Viliko' })], [])
    expect(k.has(`job:${JOB}`)).toBe(true)
  })

  it('tells the three revision lines apart', () => {
    const k = keys([
      line({ revision_id: REV, description: 'Muudatus #1: Kroon · Mari' }),
      line({ revision_id: REV, description: 'Disain, muudatus #1: Kroon · Mari' }),
      line({ revision_id: REV, description: 'Mudel, muudatus #1 · Mari' }),
      line({ revision_id: REV, description: 'Hamba Disain (muudatus #1) · Mari' }),
    ])
    expect(k.has(`rev:${JOB}:${REV}`)).toBe(true)
    expect(k.has(`revdesign:${JOB}:${REV}`)).toBe(true)
    expect(k.has(`revmudel:${JOB}:${REV}`)).toBe(true)
    expect(k.has(`extra:${RULE}:${JOB}:${REV}`)).toBe(true)
    expect(k.size).toBe(4)
  })

  it('still handles hours and the monthly salary', () => {
    const k = keys([
      line({ job_id: null, work_hours_id: 'h1' }),
      line({ job_id: null, kind: 'kuu', description: 'Kuutasu 2026-08-01 – 2026-08-31' }),
    ])
    expect(k.has('hours:h1')).toBe(true)
    expect(k.has('salary:2026-08-01')).toBe(true)
  })

  it('falls back to job: for a plain production line, as before', () => {
    expect(keys([line({ description: 'Kroon · Mari Maasikas' })]).has(`job:${JOB}`)).toBe(true)
  })
})
