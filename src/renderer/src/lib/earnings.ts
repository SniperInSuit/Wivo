/**
 * What a worker earned, from the work that is already in the system.
 *
 * Pure functions over jobs + hours + rules. No fetching, no React — the payouts
 * screen previews with them, and the payout writer freezes their output into
 * `worker_payout_lines`. One implementation, so the preview and the payslip can
 * never disagree.
 *
 * PAY MODEL
 *   A worker has a LIST of rules, because a lab does not pay one way: an
 *   administrator is hourly, a technician may be per tooth on crowns and a flat
 *   fee on full arches, and design is compensated on top of whichever applies.
 *
 *   Per job, exactly ONE production rule applies — per tooth, flat, or a
 *   percentage of the job's price. A rule naming the job's work type beats a
 *   catch-all rule; `priority` breaks ties after that.
 *
 *   The design bonus is not a production rule. It is added when the worker is
 *   the job's designer, on top of whatever production rule matched.
 *
 *   Hourly and monthly are period-level: they have nothing to do with any
 *   single job, so they are computed from logged hours and from the period.
 */
import type { Job, Revision } from '../types/job'
import { resolveWorkType, type WorkType } from '../config/workTypes'

// How the money is calculated. Deliberately ONLY billing methods: "design" used
// to sit in this list, which is a category error — design is a kind of work, not
// a way of paying for it, and having it here meant design could only ever be a
// flat fee. Scope moved to `applies_to`.
export type RateKind = 'tund' | 'hammas' | 'too' | 'protsent' | 'kuu'

/** What the rule pays for: the work, its design, or redoing it. */
export type RateScope = 'too' | 'disain' | 'muudatus'

export const RATE_SCOPE_LABEL: Record<RateScope, string> = {
  too:      'Teostatud töö',
  disain:   'Disain',
  muudatus: 'Muudatus (ümbertegemine)',
}

export const RATE_KIND_LABEL: Record<RateKind, string> = {
  tund:     'Tunnitasu',
  hammas:   'Hamba tasu',
  too:      'Töö tasu (fikseeritud)',
  protsent: '% töö hinnast',
  kuu:      'Kuutasu',
}

export const RATE_KIND_HINT: Record<RateKind, string> = {
  tund:     'Korrutatakse tundidega. Saab lasta ka automaatselt tööpäevade järgi täita.',
  hammas:   'Korrutatakse töö hammaste arvuga.',
  too:      'Sama summa iga töö eest, sõltumata hammaste arvust.',
  protsent: 'Protsent töö hinnast (koos disaini hinnaga).',
  kuu:      'Fikseeritud summa iga arvestusperioodi kohta.',
}

export const RATE_KIND_SUFFIX: Record<RateKind, string> = {
  tund: '€/h', hammas: '€/hammas', too: '€/töö', protsent: '%', kuu: '€/kuu',
}

/** Rules that price a job. The rest are period-level or additive. */
const PRODUCTION_KINDS: RateKind[] = ['hammas', 'too', 'protsent']

export interface WorkerRate {
  id: string
  clinic_id: string
  profile_id: string
  kind: RateKind
  applies_to: RateScope
  amount: number
  work_type: string | null
  priority: number
  pay_revisions: boolean
  // Hourly rules only: fill the period from the working calendar instead of
  // making someone type an identical row every day.
  auto_hours: boolean
  hours_per_day: number | null
  work_days: string        // '12345' = Mon–Fri, 1 = Monday … 7 = Sunday
  active_from: string | null
  active_to: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export type WorkerRateInput = Omit<WorkerRate, 'id' | 'clinic_id' | 'created_at' | 'updated_at'>

export interface WorkHours {
  id: string
  clinic_id: string
  profile_id: string
  work_date: string
  hours: number
  note: string | null
  recorded_by: string | null
  created_at: string
}

export type WorkHoursInput = Omit<WorkHours, 'id' | 'clinic_id' | 'created_at'>

export interface EarningLine {
  key: string
  job_id: string | null
  revision_id: string | null
  work_hours_id: string | null
  kind: RateKind
  description: string
  qty: number
  rate: number
  amount: number
  earned_on: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Every yyyy-MM-dd from start to end, inclusive. */
function eachDay(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  // Guard against a reversed or absurd range producing an endless list.
  let guard = 0
  while (d <= last && guard++ < 400) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const toothCount = (h: string | null | undefined) =>
  (h ?? '').split(',').filter(t => t.trim()).length

function activeOn(rate: WorkerRate, isoDate: string): boolean {
  if (rate.active_from && isoDate < rate.active_from) return false
  if (rate.active_to && isoDate > rate.active_to) return false
  return true
}

/**
 * The production rule that applies to this job.
 *
 * Specific beats general: a rule naming the job's work type outranks one that
 * names none, whatever the priorities are. Without that, adding a catch-all
 * "15 €/tooth" rule would silently start competing with the deliberate
 * "Allon4 = 200 € flat" rule the owner set up first.
 */
export function pickProductionRate(
  rates: WorkerRate[], job: Job, isoDate: string, types: WorkType[],
  scope: RateScope = 'too'
): WorkerRate | null {
  const jobType = resolveWorkType(job.too, types).nimi.toLowerCase()
  const raw = (job.too ?? '').toLowerCase()

  const matches = rates.filter(r => {
    if (!PRODUCTION_KINDS.includes(r.kind)) return false
    if ((r.applies_to ?? 'too') !== scope) return false
    if (!activeOn(r, isoDate)) return false
    if (!r.work_type) return true
    const wanted = r.work_type.trim().toLowerCase()
    return wanted === jobType || raw.includes(wanted)
  })
  if (matches.length === 0) return null

  return matches.sort((a, b) => {
    const spec = (a.work_type ? 1 : 0) - (b.work_type ? 1 : 0)
    if (spec !== 0) return -spec
    return b.priority - a.priority
  })[0]
}

function amountFor(rate: WorkerRate, opts: { teeth: number; price: number }): { qty: number; amount: number } {
  switch (rate.kind) {
    case 'hammas':   return { qty: opts.teeth, amount: round2(opts.teeth * rate.amount) }
    case 'too':      return { qty: 1, amount: round2(rate.amount) }
    case 'protsent': return { qty: 1, amount: round2(opts.price * rate.amount / 100) }
    default:         return { qty: 1, amount: 0 }
  }
}

/**
 * The date a job counts as earned on.
 *
 * The COMPLETION date first. `valmis_aeg` is the deadline — a plan — and using
 * it meant a job due in June but finished in July earned nothing in either
 * month. The deadline is only a fallback for rows that predate the completion
 * field, and the received date a fallback after that.
 */
const jobEarnedOn = (job: Job): string =>
  (job.valmis_kuupaev ?? job.valmis_aeg ?? job.kuupaev ?? '').slice(0, 10)

// Same rule as jobs: when it was FINISHED first, the deadline only as a
// fallback. A revision due last month but redone this month has to land in the
// month the work actually happened.
const revisionEarnedOn = (rev: Revision): string =>
  (rev.valmis_kuupaev ?? rev.deadline ?? rev.ts ?? '').slice(0, 10)

export interface EarningsContext {
  profileId: string
  rates: WorkerRate[]
  jobs: Job[]
  hours: WorkHours[]
  types: WorkType[]
  periodStart: string   // inclusive, yyyy-MM-dd
  periodEnd: string     // inclusive
  doneStageKey: string
  /** Job/revision/hours keys already frozen into an earlier payout. */
  alreadyPaid?: Set<string>
  /** Count part-periods of a monthly salary — off by default, see below. */
  includeMonthly?: boolean
}

/**
 * Everything this worker earned in the period.
 *
 * Only FINISHED work counts. Paying for a job still on the bench would mean
 * clawing it back if it is scrapped, and this system has no negative lines by
 * design.
 */
export function calculateEarnings(ctx: EarningsContext): EarningLine[] {
  const {
    profileId, rates, jobs, hours, types, periodStart, periodEnd,
    doneStageKey, alreadyPaid = new Set(), includeMonthly = true,
  } = ctx

  const mine = rates.filter(r => r.profile_id === profileId)
  const inPeriod = (d: string) => !!d && d >= periodStart && d <= periodEnd
  const lines: EarningLine[] = []

  // ── Production: per job ───────────────────────────────────────────────────
  for (const job of jobs) {
    const isTech = job.assigned_to === profileId
    const isDesigner = job.designed_by === profileId
    if (!isTech && !isDesigner) continue

    const earnedOn = jobEarnedOn(job)
    const jobDone = job.status === doneStageKey

    if (isTech && jobDone && inPeriod(earnedOn) && !alreadyPaid.has(`job:${job.id}`)) {
      const rate = pickProductionRate(mine, job, earnedOn, types)
      if (rate) {
        const price = Number(job.hind ?? 0) + Number(job.disain_hind ?? 0)
        const { qty, amount } = amountFor(rate, { teeth: toothCount(job.hambad), price })
        if (amount > 0) {
          lines.push({
            key: `job:${job.id}`,
            job_id: job.id, revision_id: null, work_hours_id: null,
            kind: rate.kind,
            description: `${job.too?.trim() || 'Töö'} · ${job.patsient}`,
            qty, rate: rate.amount, amount, earned_on: earnedOn,
          })
        }
      }
    }

    // Design — its own scope, priced by whichever method the rule uses. A lab
    // buys design per tooth as often as per job, which the old flat-only design
    // rule could not express. Added on top of the production line, and payable
    // to someone who did no other part of the job.
    if (isDesigner && jobDone && inPeriod(earnedOn) && !alreadyPaid.has(`design:${job.id}`)) {
      const design = pickProductionRate(mine, job, earnedOn, types, 'disain')
      if (design) {
        const price = Number(job.disain_hind ?? 0) || Number(job.hind ?? 0)
        const { qty, amount } = amountFor(design, { teeth: toothCount(job.hambad), price })
        if (amount > 0) {
          lines.push({
            key: `design:${job.id}`,
            job_id: job.id, revision_id: null, work_hours_id: null,
            kind: design.kind,
            description: `Disain: ${job.too?.trim() || 'Töö'} · ${job.patsient}`,
            qty, rate: design.amount, amount, earned_on: earnedOn,
          })
        }
      }
    }

    // ── Revisions ───────────────────────────────────────────────────────────
    // Only when the matching rule says rework is paid. Default is unpaid: the
    // usual case is a revision caused by the lab's own error.
    if (!isTech) continue
    for (const [i, rev] of (job.revisions ?? []).entries()) {
      const revDate = revisionEarnedOn(rev)
      const revDone = (rev.status ?? '') === doneStageKey
      if (!revDone || !inPeriod(revDate)) continue
      if (alreadyPaid.has(`rev:${job.id}:${rev.id}`)) continue

      // A revision-specific rule wins. Only when there is none does the job's
      // own rule apply, and then only if it says it covers rework — which is
      // how this behaved before revisions could be priced separately.
      const revRate = pickProductionRate(mine, job, revDate, types, 'muudatus')
      const jobRate = pickProductionRate(mine, job, revDate, types, 'too')
      const rate = revRate ?? (jobRate?.pay_revisions ? jobRate : null)
      if (!rate) continue

      const { qty, amount } = amountFor(rate, {
        teeth: toothCount(rev.hambad ?? job.hambad),
        price: Number(rev.price ?? 0),
      })
      if (amount <= 0) continue
      lines.push({
        key: `rev:${job.id}:${rev.id}`,
        job_id: job.id, revision_id: rev.id, work_hours_id: null,
        kind: rate.kind,
        description: `Muudatus #${i + 1}: ${job.too?.trim() || 'Töö'} · ${job.patsient}`,
        qty, rate: rate.amount, amount, earned_on: revDate,
      })
    }
  }

  // ── Hourly ────────────────────────────────────────────────────────────────
  const hourRate = mine
    .filter(r => r.kind === 'tund')
    .sort((a, b) => b.priority - a.priority)[0]
  if (hourRate) {
    // Automatic hours: an administrator on a monthly hourly contract should not
    // have to type twenty-one identical rows. A manually logged day always wins
    // over the generated one — that is how an exception (sick day, overtime) is
    // entered once and stays entered.
    if (hourRate.auto_hours && (hourRate.hours_per_day ?? 0) > 0) {
      const manualDays = new Set(
        hours.filter(h => h.profile_id === profileId).map(h => h.work_date)
      )
      const workDays = hourRate.work_days || '12345'
      for (const day of eachDay(periodStart, periodEnd)) {
        if (manualDays.has(day)) continue
        if (!activeOn(hourRate, day)) continue
        if (alreadyPaid.has(`auto:${day}`)) continue
        // getUTCDay: 0 = Sunday. The stored string uses 1 = Monday … 7 = Sunday,
        // which is how a Estonian week is written down.
        const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
        const isoDow = dow === 0 ? 7 : dow
        if (!workDays.includes(String(isoDow))) continue
        const h = Number(hourRate.hours_per_day)
        lines.push({
          key: `auto:${day}`,
          job_id: null, revision_id: null, work_hours_id: null,
          kind: 'tund',
          description: 'Tööpäev (automaatne)',
          qty: h, rate: hourRate.amount, amount: round2(h * hourRate.amount),
          earned_on: day,
        })
      }
    }

    for (const h of hours) {
      if (h.profile_id !== profileId) continue
      if (!inPeriod(h.work_date)) continue
      if (alreadyPaid.has(`hours:${h.id}`)) continue
      if (!activeOn(hourRate, h.work_date)) continue
      const amount = round2(Number(h.hours) * hourRate.amount)
      if (amount <= 0) continue
      lines.push({
        key: `hours:${h.id}`,
        job_id: null, revision_id: null, work_hours_id: h.id,
        kind: 'tund',
        description: h.note?.trim() || 'Töötunnid',
        qty: Number(h.hours), rate: hourRate.amount, amount, earned_on: h.work_date,
      })
    }
  }

  // ── Monthly salary ────────────────────────────────────────────────────────
  // One line per period, not pro-rated. A period that is not a whole month
  // would need a rule about part-months that nobody has stated, so it is paid
  // in full and the label says which period it covers — visible and easy to
  // correct, rather than a silent fraction.
  if (includeMonthly) {
    const monthly = mine
      .filter(r => r.kind === 'kuu' && (activeOn(r, periodStart) || activeOn(r, periodEnd)))
      .sort((a, b) => b.priority - a.priority)[0]
    if (monthly && monthly.amount > 0 && !alreadyPaid.has(`salary:${periodStart}`)) {
      lines.push({
        key: `salary:${periodStart}`,
        job_id: null, revision_id: null, work_hours_id: null,
        kind: 'kuu',
        description: `Kuutasu ${periodStart} – ${periodEnd}`,
        qty: 1, rate: monthly.amount, amount: round2(monthly.amount), earned_on: periodEnd,
      })
    }
  }

  return lines.sort((a, b) => a.earned_on.localeCompare(b.earned_on))
}

/**
 * Why a worker's total is zero.
 *
 * Added because "0 €" with a rate configured and finished jobs assigned is an
 * unanswerable screen — the reason is always one of a handful of things, and
 * the app knows which. Diagnosing that by reading the code is not something a
 * clinic owner should have to do.
 */
export interface EarningsIssue {
  code: 'periood' | 'pooleli' | 'reegel' | 'hambad' | 'hind' | 'makstud'
  label: string
  count: number
  examples: string[]
}

export function diagnoseEarnings(ctx: EarningsContext): EarningsIssue[] {
  const {
    profileId, rates, jobs, types, periodStart, periodEnd, doneStageKey,
    alreadyPaid = new Set(),
  } = ctx
  const mine = rates.filter(r => r.profile_id === profileId)
  const inPeriod = (d: string) => !!d && d >= periodStart && d <= periodEnd

  const buckets = new Map<EarningsIssue['code'], EarningsIssue>()
  const add = (code: EarningsIssue['code'], label: string, job: Job) => {
    const b = buckets.get(code) ?? { code, label, count: 0, examples: [] }
    b.count++
    if (b.examples.length < 3) {
      b.examples.push(`${job.too?.trim() || 'Töö'} · ${job.patsient}`)
    }
    buckets.set(code, b)
  }

  for (const job of jobs) {
    const isTech = job.assigned_to === profileId
    const isDesigner = job.designed_by === profileId
    if (!isTech && !isDesigner) continue

    if (job.status !== doneStageKey) {
      add('pooleli', 'Töö ei ole veel valmis-etapis — tasu arvestatakse alles siis', job)
      continue
    }
    const earnedOn = jobEarnedOn(job)
    if (!inPeriod(earnedOn)) {
      add('periood', `Töö valmimiskuupäev (${earnedOn || 'puudub'}) jääb sellest perioodist välja`, job)
      continue
    }
    if (alreadyPaid.has(`job:${job.id}`) || alreadyPaid.has(`design:${job.id}`)) {
      add('makstud', 'Juba varasema väljamaksega kaetud', job)
      continue
    }
    if (isTech) {
      const rate = pickProductionRate(mine, job, earnedOn, types, 'too')
      if (!rate) {
        add('reegel', 'Ühtegi tasureeglit ei sobi selle tööga (kontrolli "Mille eest" ja "Ainult töö tüübile")', job)
        continue
      }
      if (rate.kind === 'hammas' && toothCount(job.hambad) === 0) {
        add('hambad', 'Tasu on hamba kohta, aga tööl ei ole hambaid valitud', job)
        continue
      }
      if (rate.kind === 'protsent' && Number(job.hind ?? 0) === 0) {
        add('hind', 'Tasu on protsent hinnast, aga tööl ei ole hinda', job)
        continue
      }
      // Revisions are diagnosed separately — they have their own status, their
      // own date and now their own rate, so a job that earned fine can still
      // have rework that silently earned nothing.
      for (const [i, rev] of (job.revisions ?? []).entries()) {
        const label = `Muudatus #${i + 1}: ${job.too?.trim() || 'Töö'} · ${job.patsient}`
        const revJob = { ...job, too: label } as Job
        if ((rev.status ?? '') !== doneStageKey) {
          add('pooleli', 'Muudatus ei ole valmis-etapis', revJob)
          continue
        }
        const revDate = revisionEarnedOn(rev)
        if (!inPeriod(revDate)) {
          add('periood', `Muudatuse kuupäev (${revDate || 'puudub'}) jääb sellest perioodist välja`, revJob)
          continue
        }
        if (alreadyPaid.has(`rev:${job.id}:${rev.id}`)) continue
        const revRate = pickProductionRate(mine, job, revDate, types, 'muudatus')
        const jobRate = pickProductionRate(mine, job, revDate, types, 'too')
        const rate = revRate ?? (jobRate?.pay_revisions ? jobRate : null)
        if (!rate) {
          add('reegel', 'Muudatuste eest ei maksta — lisa "Muudatus" reegel või märgi tööreeglil "Muudatused tasustatud"', revJob)
          continue
        }
        if (rate.kind === 'hammas' && toothCount(rev.hambad ?? job.hambad) === 0) {
          add('hambad', 'Muudatuse tasu on hamba kohta, aga hambaid ei ole valitud', revJob)
        }
        if (rate.kind === 'protsent' && Number(rev.price ?? 0) === 0) {
          add('hind', 'Muudatuse tasu on protsent hinnast, aga muudatusel ei ole hinda', revJob)
        }
      }
    } else if (isDesigner) {
      // A designer with no design-scoped rule earns nothing and would otherwise
      // vanish from the reckoning without a word.
      const design = pickProductionRate(mine, job, earnedOn, types, 'disain')
      if (!design) {
        add('reegel', 'Disainijaks on määratud, aga disaini eest makstavat reeglit ei ole', job)
        continue
      }
      if (design.kind === 'hammas' && toothCount(job.hambad) === 0) {
        add('hambad', 'Disaini tasu on hamba kohta, aga tööl ei ole hambaid valitud', job)
        continue
      }
    }
  }

  return [...buckets.values()].sort((a, b) => b.count - a.count)
}

export const earningsTotal = (lines: EarningLine[]): number =>
  round2(lines.reduce((s, l) => s + l.amount, 0))

/**
 * What the gross pay actually costs the employer, once their share of payroll
 * taxes is on top. The rate comes from settings and defaults to 0 — a tax rate
 * this app invented would be worse than an obviously missing one.
 */
export const employerCost = (gross: number, employerTaxPct: number): number =>
  round2(gross * (1 + (employerTaxPct || 0) / 100))

export const employerTaxAmount = (gross: number, employerTaxPct: number): number =>
  round2(gross * (employerTaxPct || 0) / 100)
