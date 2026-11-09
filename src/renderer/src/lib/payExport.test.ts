/**
 * The accountant's monthly pay export (payExport.ts).
 *
 * - Only the month's confirmed payouts, split by kind of pay, with hours and
 *   the number of jobs.
 * - The lines by job code: never a patient's name, which the stored
 *   descriptions carry.
 * - Headers in the exporter's language.
 * - docs/riga/: the sample sent to Riga's accountant, made by this code with
 *   made-up people, so its columns are exactly the export's. Rewrite it with
 *   WRITE_PAY_SAMPLE=1 npx vitest run --mode unit src/renderer/src/lib/payExport.test.ts
 */
import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toCsv } from '@shared/export/csv'
import type { WorkerPayout, WorkerPayoutLine } from '../hooks/useWorkerPay'
import { categoryOf, lineColumns, payExportRows, peopleColumns } from './payExport'

const PATIENT = 'Maija Bērziņa'
let seq = 0
const line = (over: Partial<WorkerPayoutLine>): WorkerPayoutLine => ({
  id: `l${++seq}`, payout_id: 'p', job_id: null, revision_id: null, work_hours_id: null,
  kind: 'too', description: `Crown · ${PATIENT}`, qty: 1, rate: 0, amount: 0, line_key: null, ...over,
})
const payout = (profile: string, periodStart: string, lines: WorkerPayoutLine[], status: WorkerPayout['status'] = 'kinnitatud'): WorkerPayout => ({
  id: `p${++seq}`, clinic_id: 'c', profile_id: profile, period_start: periodStart, period_end: periodStart.slice(0, 8) + '28',
  total: lines.reduce((s, l) => s + l.amount, 0), status, paid_at: null, note: null, created_by: null, created_at: '', lines,
})

const jobs = [
  { id: 'job-0001-aaaa', job_code: 'RIG-0042', work_items: [{ id: 'w1', too: 'Crown', hambad: '11,21' }, { id: 'w2', too: 'Bridge', hambad: '14,15,16' }], too: null, hambad: null },
  { id: 'job-0002-bbbb', job_code: null, work_items: [{ id: 'w3', too: 'Splint', hambad: '' }], too: null, hambad: null },
  { id: 'job-0003-cccc', job_code: 'RIG-0043', work_items: [{ id: 'w4', too: 'Crown', hambad: '36' }], too: null, hambad: null },
]
const people = [
  { id: 'anna', name: 'Anna Paraugs', toosuhe: 'tootaja' },
  { id: 'janis', name: 'Jānis Piemērs', toosuhe: 'tootaja' },
  { id: 'ilze', name: 'Ilze Testa SIA', toosuhe: 'ettevote' },
]

/** October 2026, as a Riga clinic might have it. */
const payouts = [
  payout('anna', '2026-10-01', [
    line({ job_id: 'job-0001-aaaa', kind: 'hammas', qty: 5, rate: 18, amount: 90, line_key: 'job:job-0001-aaaa' }),
    line({ job_id: 'job-0001-aaaa', kind: 'too', qty: 1, rate: 25, amount: 25, line_key: 'design:job-0001-aaaa' }),
    line({ job_id: 'job-0003-cccc', kind: 'hammas', qty: 1, rate: 18, amount: 18, line_key: 'rev:job-0003-cccc:r1', revision_id: 'r1' }),
    line({ work_hours_id: 'h1', kind: 'tund', qty: 6.5, rate: 12, amount: 78, line_key: 'hours:h1', description: 'Hours worked' }),
  ]),
  payout('janis', '2026-10-01', [
    line({ kind: 'kuu', qty: 1, rate: 1400, amount: 1400, line_key: 'salary:2026-10-01', description: 'Monthly salary' }),
    line({ job_id: 'job-0002-bbbb', kind: 'too', qty: 1, rate: 15, amount: 15, line_key: 'mudel:job-0002-bbbb' }),
  ]),
  payout('ilze', '2026-10-01', [
    line({ job_id: 'job-0003-cccc', kind: 'protsent', qty: 1, rate: 30, amount: 42, line_key: 'job:job-0003-cccc' }),
    line({ job_id: 'job-0003-cccc', kind: 'too', qty: 1, rate: 10, amount: 10, line_key: 'extra:rule-1:job-0003-cccc' }),
  ], 'makstud'),
  // Another month: not in October's export.
  payout('anna', '2026-09-01', [line({ job_id: 'job-0001-aaaa', kind: 'too', amount: 999, line_key: 'job:job-0001-aaaa' })]),
]

const october = () => payExportRows({ month: '2026-10', payouts, people, jobs })

describe('what a line paid for', () => {
  it('from its key', () => {
    expect(['job:x', 'design:x', 'mudel:x', 'rev:x:r', 'revdesign:x:r', 'revmudel:x:r', 'extra:a:x', 'hours:h', 'auto:2026-10-01', 'salary:2026-10-01', 'line:1']
      .map(k => categoryOf({ line_key: k, kind: 'too', job_id: 'x', revision_id: null, work_hours_id: null })))
      .toEqual(['jobs', 'design', 'models', 'revisions', 'revisions', 'revisions', 'extras', 'hours', 'hours', 'salary', 'other'])
  })

  it('for a line paid before keys existed, from what it points at', () => {
    const legacy = (over: Partial<WorkerPayoutLine>) => categoryOf({ line_key: null, kind: 'too', job_id: null, revision_id: null, work_hours_id: null, ...over })
    expect(legacy({ work_hours_id: 'h' })).toBe('hours')
    expect(legacy({ kind: 'kuu' })).toBe('salary')
    expect(legacy({ job_id: 'j', revision_id: 'r' })).toBe('revisions')
    expect(legacy({ job_id: 'j' })).toBe('jobs')
    expect(legacy({})).toBe('other')
  })
})

describe('the month\'s rows', () => {
  it('one row per person, split by kind, with hours and the number of jobs; only that month', () => {
    const { people: rows } = october()
    expect(rows.map(r => r.name)).toEqual(['Anna Paraugs', 'Ilze Testa SIA', 'Jānis Piemērs'])
    expect(rows[0]).toMatchObject({ contractor: false, total: 211, hours: 6.5, jobs: 2,
      byCategory: { jobs: 90, design: 25, revisions: 18, hours: 78, models: 0, extras: 0, salary: 0, other: 0 } })
    expect(rows[1]).toMatchObject({ contractor: true, total: 52, jobs: 1, byCategory: { jobs: 42, extras: 10 } })
    expect(rows[2]).toMatchObject({ total: 1415, byCategory: { salary: 1400, models: 15 } })
  })

  it('the lines by job code (the start of the id when a job has none), with the work and teeth', () => {
    const { lines } = october()
    expect(lines.find(l => l.category === 'design')).toMatchObject({ jobCode: 'RIG-0042', work: 'Crown + Bridge', teeth: '11,21,14,15,16', amount: 25 })
    expect(lines.find(l => l.category === 'models')).toMatchObject({ jobCode: 'job-0002', work: 'Splint' })
    expect(lines.find(l => l.category === 'hours')).toMatchObject({ jobCode: '', qty: 6.5, rate: 12, amount: 78 })
  })

  it('never a patient\'s name, though every stored description carries one', () => {
    const { people: rows, lines } = october()
    const files = toCsv(rows, peopleColumns('en')) + toCsv(lines, lineColumns('en'))
    expect(payouts.flatMap(p => p.lines).filter(l => l.description.includes(PATIENT)).length).toBeGreaterThan(5)
    expect(files).not.toContain(PATIENT)
    expect(files).not.toContain('Bērziņa')
  })

  it('headers in the exporter\'s language', () => {
    expect(peopleColumns('en').map(c => c.header).slice(0, 3)).toEqual(['Person', 'Engagement', 'Jobs'])
    expect(peopleColumns('et').map(c => c.header).slice(0, 3)).toEqual(['Isik', 'Suhe', 'Tööd'])
    expect(lineColumns('en').map(c => c.header)).toEqual(['Person', 'Job code', 'Work', 'Teeth', 'Kind of pay', 'Calculated', 'Quantity', 'Rate', 'Amount (gross)'])
  })
})

describe('the sample for Riga\'s accountant (docs/riga/)', () => {
  const dir = join(__dirname, '..', '..', '..', '..', 'docs', 'riga')
  const files = {
    'pay-export-sample-people.csv': () => toCsv(october().people, peopleColumns('en')),
    'pay-export-sample-lines.csv': () => toCsv(october().lines, lineColumns('en')),
  }

  it.each(Object.keys(files))('%s is what the export makes today', name => {
    const made = files[name as keyof typeof files]()
    if (process.env.WRITE_PAY_SAMPLE) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, name), made)
    }
    expect(readFileSync(join(dir, name), 'utf8')).toBe(made)
  })
})
