/**
 * The accountant's monthly pay export (docs/ARCHITECTURE-INSTANCES.md §9,
 * "Riga's workers and pay", option a). The clinic's accountant makes the
 * payslips and the tax report from it, outside Wivo: in a clinic outside
 * Estonia, Wivo shows pay gross, "before tax", and does no tax itself.
 *
 * Two files, from the month's CONFIRMED payouts only. Their lines are frozen,
 * so the numbers the accountant gets can't change afterwards:
 *   people  one row per person: employee or contractor, gross pay split by
 *           kind, hours, the number of jobs, the total;
 *   lines   the lines behind it: job code, work, teeth, how it was
 *           calculated, the amount.
 * Job codes only, never a patient's name: a line's description names the
 * patient, so it is not exported. The headers are in the language of the
 * person exporting.
 *
 * Pure: PayrollView passes what is on screen, and the test makes the sample
 * file sent to Riga's accountant (docs/riga/).
 */
import { translate, type Lang } from '@shared/i18n'
import type { CsvColumn } from '@shared/export/csv'
import type { Job } from '../types/job'
import { jobAllTeeth, jobWorkItems } from '../types/job'
import type { WorkerPayout, WorkerPayoutLine } from '../hooks/useWorkerPay'

export type PayCategory = 'jobs' | 'design' | 'models' | 'revisions' | 'extras' | 'hours' | 'salary' | 'other'

export const PAY_CATEGORIES: PayCategory[] = ['jobs', 'design', 'models', 'revisions', 'extras', 'hours', 'salary', 'other']

/**
 * What a line paid for, from its key (sql/058: 'design:<job>', 'rev:<job>:<rev>',
 * …). A line paid before that column existed falls back on what it points at.
 */
export function categoryOf(line: Pick<WorkerPayoutLine, 'line_key' | 'kind' | 'job_id' | 'revision_id' | 'work_hours_id'>): PayCategory {
  const prefix = line.line_key?.split(':')[0]
  switch (prefix) {
    case 'job': return 'jobs'
    case 'design': return 'design'
    case 'mudel': return 'models'
    case 'rev': case 'revdesign': case 'revmudel': return 'revisions'
    case 'extra': return 'extras'
    case 'hours': case 'auto': return 'hours'
    case 'salary': return 'salary'
    case undefined: break
    default: return 'other'
  }
  if (line.work_hours_id) return 'hours'
  if (line.kind === 'kuu' && !line.job_id) return 'salary'
  if (line.revision_id) return 'revisions'
  return line.job_id ? 'jobs' : 'other'
}

export interface PayPerson {
  id: string
  name: string
  /** profiles.toosuhe: 'ettevote' invoices the clinic; anything else is on the payroll. */
  toosuhe: string | null
}

export interface PeopleRow {
  name: string
  contractor: boolean
  byCategory: Record<PayCategory, number>
  hours: number
  jobs: number
  total: number
}

export interface LineRow {
  name: string
  jobCode: string
  work: string
  teeth: string
  category: PayCategory
  kind: string
  qty: number
  rate: number
  amount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The month's confirmed payouts, as the two files' rows. `month` is
 * 'yyyy-MM': a payout belongs to the month its period starts in, as on the
 * Payroll screen.
 */
export function payExportRows(input: {
  month: string
  payouts: WorkerPayout[]
  people: PayPerson[]
  jobs: Pick<Job, 'id' | 'job_code' | 'work_items' | 'too' | 'hambad'>[]
}): { people: PeopleRow[]; lines: LineRow[] } {
  const jobs = new Map(input.jobs.map(j => [j.id, j]))
  const personOf = new Map(input.people.map(p => [p.id, p]))
  const inMonth = input.payouts.filter(p => p.period_start.slice(0, 7) === input.month)

  const people = new Map<string, PeopleRow & { jobIds: Set<string> }>()
  const lines: LineRow[] = []
  for (const payout of inMonth) {
    const person = personOf.get(payout.profile_id)
    const name = person?.name ?? ''
    const row = people.get(payout.profile_id) ?? {
      name, contractor: person?.toosuhe === 'ettevote',
      byCategory: Object.fromEntries(PAY_CATEGORIES.map(c => [c, 0])) as Record<PayCategory, number>,
      hours: 0, jobs: 0, total: 0, jobIds: new Set<string>(),
    }
    for (const l of payout.lines) {
      const category = categoryOf(l)
      const amount = Number(l.amount)
      row.byCategory[category] = round2(row.byCategory[category] + amount)
      row.total = round2(row.total + amount)
      if (category === 'hours') row.hours = round2(row.hours + Number(l.qty))
      if (l.job_id) row.jobIds.add(l.job_id)
      const job = l.job_id ? jobs.get(l.job_id) : undefined
      lines.push({
        name,
        // A job made before job codes existed has none: the start of its id still finds it.
        jobCode: job ? (job.job_code ?? job.id.slice(0, 8)) : '',
        work: job ? [...new Set(jobWorkItems(job).map(i => i.too).filter(Boolean))].join(' + ') : '',
        teeth: job ? jobAllTeeth(job) : '',
        category, kind: l.kind, qty: Number(l.qty), rate: Number(l.rate), amount,
      })
    }
    row.jobs = row.jobIds.size
    people.set(payout.profile_id, row)
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  return {
    people: [...people.values()].map(({ jobIds: _, ...r }) => r).sort(byName),
    lines: lines.sort(byName),
  }
}

const CATEGORY_KEY: Record<PayCategory, Parameters<typeof translate>[1]> = {
  jobs: 'payExport.jobs', design: 'payExport.design', models: 'payExport.models', revisions: 'payExport.revisions',
  extras: 'payExport.extras', hours: 'payExport.hoursPay', salary: 'payExport.salary', other: 'payExport.other',
}

const KIND_KEY: Record<string, Parameters<typeof translate>[1]> = {
  tund: 'payExport.perHour', hammas: 'payExport.perTooth', too: 'payExport.perJob', protsent: 'payExport.percent', kuu: 'payExport.monthly',
}

export function peopleColumns(lang: Lang): CsvColumn<PeopleRow>[] {
  const L = (k: Parameters<typeof translate>[1]) => translate(lang, k)
  return [
    { header: L('payExport.person'), value: r => r.name },
    { header: L('payExport.engagement'), value: r => L(r.contractor ? 'payExport.contractor' : 'payExport.employee') },
    ...PAY_CATEGORIES.map(c => ({ header: L(CATEGORY_KEY[c]), value: (r: PeopleRow) => r.byCategory[c] })),
    { header: L('payExport.totalGross'), value: r => r.total },
    { header: L('payExport.hours'), value: r => r.hours },
    { header: L('payExport.jobCount'), value: r => r.jobs },
  ]
}

export function lineColumns(lang: Lang): CsvColumn<LineRow>[] {
  const L = (k: Parameters<typeof translate>[1]) => translate(lang, k)
  return [
    { header: L('payExport.person'), value: r => r.name },
    { header: L('payExport.jobCode'), value: r => r.jobCode },
    { header: L('payExport.work'), value: r => r.work },
    { header: L('payExport.teeth'), value: r => r.teeth },
    { header: L('payExport.kindOfPay'), value: r => L(CATEGORY_KEY[r.category]) },
    { header: L('payExport.calculation'), value: r => (KIND_KEY[r.kind] ? L(KIND_KEY[r.kind]) : r.kind) },
    { header: L('payExport.quantity'), value: r => r.qty },
    { header: L('payExport.rate'), value: r => r.rate },
    { header: L('payExport.amount'), value: r => r.amount },
  ]
}
