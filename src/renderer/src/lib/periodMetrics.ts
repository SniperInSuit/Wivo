/**
 * The one place a period total is computed.
 *
 * WHY THIS EXISTS
 *   Ülevaade, Statistika→Tootmine and Statistika→Rahandus each aggregated the
 *   same period independently and disagreed: 19 vs 15 tööd, 156 vs 144 hambaid,
 *   Laekunud 21 980 vs Makstud 12 800 for the same "See kuu". Four unaligned
 *   axes caused it — the period's END date, whether a revision is a unit, which
 *   date field bounds the period, and which of four money concepts was being
 *   summed under two labels. See docs/finance-metrics.md for the evidence.
 *
 *   The fix is not "one number": some of those differences are legitimate. It is
 *   that the difference must be a PARAMETER a caller states out loud, not a
 *   property of which file the code happens to live in.
 *
 * WHAT THIS IS NOT
 *   Not a replacement for `calculateFinance`. That module owns cost attribution,
 *   the per-work-type breakdown and the coverage counters, and this one does not
 *   touch its math. `periodMetrics` owns the HEADLINE counts and money totals —
 *   the numbers that appear on more than one screen and therefore have to agree.
 */
import type { Job, Revision } from '../types/job'
import { jobPeriodDate } from '../types/job'
import type { InvoiceFull, Payment } from '../types/invoice'

const round2 = (n: number) => Math.round(n * 100) / 100
const toothCount = (s: string | null | undefined) =>
  (s ?? '').split(',').filter(t => t.trim()).length

/** 'YYYY-MM-DD', both ends inclusive. */
export interface Range { start: string; end: string }

/**
 * Which date field bounds the period.
 *
 * `too` is the production anchor and the only one that applies to counts.
 * `arve` and `laekumine` exist because a document and its money have their own
 * dates: work finished in July can be billed in August and paid in September,
 * and all three statements are true at once.
 */
export type DateAnchor = 'too' | 'arve' | 'laekumine'

/** See the data dictionary in docs/finance-metrics.md. */
export type MoneyConcept = 'tulu' | 'kaive' | 'arveldatud' | 'laekunud'

export const MONEY_LABEL: Record<MoneyConcept, string> = {
  tulu: 'Tulu',
  kaive: 'Käive',
  arveldatud: 'Arveldatud',
  laekunud: 'Laekunud',
}

/** One line of help per concept, shown under the number so the label is not alone. */
export const MONEY_HINT: Record<MoneyConcept, string> = {
  tulu: 'Tööde hinnad, muudatuste tasudeta',
  kaive: 'Tööde hinnad koos muudatuste tasudega',
  arveldatud: 'Arvetele kantud, käibemaksuta',
  laekunud: 'Tegelikult laekunud raha',
}

export interface MetricParams {
  /** Which date field bounds the period for the COUNTS. Always 'too' in practice. */
  dateAnchor: DateAnchor
  /** Do revisions count as units of their own? Tootmine yes, per-type table no. */
  includeChanges: boolean
  moneyConcept: MoneyConcept
}

export interface PeriodMetrics {
  range: Range | null           // null = no period filter at all (all time)
  /** Job rows in the period. One job is one, whatever its work-item count. */
  tood: number
  /** Revisions whose OWN date falls in the period. */
  muudatused: number
  /** What "Töid kokku" shows — tood, plus muudatused when includeChanges. */
  yksused: number
  /** Work items. A 3-crown-plus-bridge job is 4. Only the per-type table uses it. */
  tooosad: number
  hambadOriginaal: number
  hambadMuudatused: number
  hambad: number
  money: number
  moneyConcept: MoneyConcept
  moneyLabel: string
  /** The rows behind the numbers — the P1 drill-down reads these, nothing recomputes. */
  jobRows: Job[]
  changeRows: { job: Job; revision: Revision }[]
}

/**
 * A revision's own date. Never the parent job's: a redo finished in August
 * belongs to August even when the original shipped in June, and attributing it
 * to the parent is what made the per-type table's "0 tööd · 24 hambaid" row
 * look broken when it was in fact correct.
 */
export const revisionPeriodDate = (rev: Revision): string =>
  (rev.valmis_kuupaev ?? rev.deadline ?? rev.ts ?? '').slice(0, 10)

/** Teeth on a revision, including the legacy `rev_hambad` on never-opened imports. */
function revisionTeeth(job: Job, rev: Revision | null): number {
  if (rev) return toothCount(rev.hambad)
  return toothCount(job.rev_hambad)
}

const within = (iso: string, range: Range | null): boolean =>
  !range ? !!iso : !!iso && iso >= range.start && iso <= range.end

export interface MetricInput {
  jobs: Job[]
  /** Empty is fine — only 'arveldatud' reads these. */
  invoices?: InvoiceFull[]
  /** Empty is fine — only 'laekunud' reads these. */
  payments?: Payment[]
  /** null = all time. The caller must then LABEL the surface as all-time. */
  range: Range | null
}

/**
 * The period's headline numbers.
 *
 * Pure and synchronous — every caller already holds the rows, and re-querying
 * per surface is exactly how the three drifted apart in the first place.
 */
export function periodMetrics(input: MetricInput, params: MetricParams): PeriodMetrics {
  const { jobs, invoices = [], payments = [], range } = input
  const { includeChanges, moneyConcept } = params

  // ── Which jobs and which revisions are in the window ──────────────────────
  const jobRows = jobs.filter(j => within(jobPeriodDate(j), range))

  // Revisions are scanned across ALL jobs, not just the in-period ones: the
  // parent may be from an earlier period and the redo still happened now.
  const changeRows: { job: Job; revision: Revision }[] = []
  for (const j of jobs) {
    for (const r of j.revisions ?? []) {
      if (within(revisionPeriodDate(r), range)) changeRows.push({ job: j, revision: r })
    }
  }

  // ── Counts ────────────────────────────────────────────────────────────────
  const tood = jobRows.length
  const muudatused = changeRows.length
  const tooosad = jobRows.reduce(
    (n, j) => n + Math.max(1, (Array.isArray(j.work_items) ? j.work_items.length : 0)), 0
  )

  const hambadOriginaal = jobRows.reduce((n, j) => n + toothCount(j.hambad), 0)
  // Legacy imports carry their single revision in `rev_hambad` with an empty
  // `revisions` array. Counted once per such JOB, never per change row, or a
  // job with a real revision list would be double counted.
  const legacyChangeTeeth = jobRows.reduce(
    (n, j) => n + ((j.revisions ?? []).length === 0 ? revisionTeeth(j, null) : 0), 0
  )
  const hambadMuudatused =
    changeRows.reduce((n, c) => n + revisionTeeth(c.job, c.revision), 0) + legacyChangeTeeth

  // ── Money ─────────────────────────────────────────────────────────────────
  let money = 0
  if (moneyConcept === 'tulu') {
    money = jobRows.reduce((s, j) => s + Number(j.hind ?? 0), 0)
  } else if (moneyConcept === 'kaive') {
    // Job prices anchored on the job, revision charges anchored on the revision.
    // Summing `j.hind + Σ rev.price` over in-period JOBS instead would put an
    // August redo's charge into June, which is what Tootmine used to do.
    money = jobRows.reduce((s, j) => s + Number(j.hind ?? 0), 0)
      + changeRows.reduce((s, c) => s + Number(c.revision.price ?? 0), 0)
  } else if (moneyConcept === 'arveldatud') {
    money = invoices
      .filter(i => i.status !== 'tuhistatud' && within((i.issue_date ?? '').slice(0, 10), range))
      .reduce((s, i) => s + Number(i.net_total), 0)
  } else {
    money = payments
      .filter(p => within((p.paid_at ?? '').slice(0, 10), range))
      .reduce((s, p) => s + Number(p.amount), 0)
  }

  return {
    range,
    tood,
    muudatused,
    yksused: includeChanges ? tood + muudatused : tood,
    tooosad,
    hambadOriginaal,
    hambadMuudatused,
    hambad: hambadOriginaal + hambadMuudatused,
    money: round2(money),
    moneyConcept,
    moneyLabel: MONEY_LABEL[moneyConcept],
    jobRows,
    changeRows,
  }
}

/**
 * "12 tööd · 3 muudatust" — the split every count that mixes the two must show.
 *
 * A single function so Ülevaade, Tootmine and Rahandus cannot phrase it three
 * ways, which is half of why 19 vs 15 was not self-explaining.
 */
export function unitSplitLabel(m: Pick<PeriodMetrics, 'tood' | 'muudatused'>): string {
  const parts = [`${m.tood} ${m.tood === 1 ? 'töö' : 'tööd'}`]
  if (m.muudatused > 0) parts.push(`${m.muudatused} muudatust`)
  return parts.join(' · ')
}

/** "108 originaal · 36 muudatused". Empty when there are no revision teeth. */
export function teethSplitLabel(m: Pick<PeriodMetrics, 'hambadOriginaal' | 'hambadMuudatused'>): string {
  return m.hambadMuudatused > 0
    ? `${m.hambadOriginaal} originaal · ${m.hambadMuudatused} muudatused`
    : `${m.hambadOriginaal} originaal`
}

// ─── The period window ────────────────────────────────────────────────────────

/**
 * One window per period name, for every surface.
 *
 * The end is the END OF THE PERIOD, not today. Tootmine used the former and
 * Rahandus the latter, so for most of any month the same "See kuu" button
 * counted two different sets of work — the single largest contributor to the
 * 19-vs-15 gap and completely invisible in the UI.
 *
 * Rahandus's reason for ending at today was real but narrower than the change
 * it made: a full month's overheads charged against three days of work reads as
 * a catastrophic loss. That is an OVERHEAD concern, so it is solved by
 * `elapsedEndOf` below rather than by shrinking everybody's counting window.
 */
export function rangeFor(
  period: 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom' | 'kuu',
  custom: { start: string; end: string } | null | undefined,
  now: Date = new Date(),
): Range | null {
  // 'kuu' — a month picked by name — arrives as a ready-made range, exactly
  // like a typed one. Nothing downstream needs to know which of the two it was.
  if (period === 'custom' || period === 'kuu') {
    if (!custom?.start || !custom?.end) return null
    return custom.start <= custom.end
      ? { start: custom.start, end: custom.end }
      : { start: custom.end, end: custom.start }
  }
  if (period === 'all') return null

  const y = now.getFullYear()
  const m = now.getMonth()
  const iso = (d: Date): string => {
    const p = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  if (period === 'week') {
    // Monday, matching the board, the table filter and the payroll working week.
    const day = (now.getDay() + 6) % 7
    const start = new Date(y, m, now.getDate() - day)
    return { start: iso(start), end: iso(new Date(y, m, now.getDate() - day + 6)) }
  }
  if (period === 'month')   return { start: iso(new Date(y, m, 1)),                 end: iso(new Date(y, m + 1, 0)) }
  if (period === 'quarter') {
    const q = Math.floor(m / 3) * 3
    return { start: iso(new Date(y, q, 1)), end: iso(new Date(y, q + 3, 0)) }
  }
  return { start: iso(new Date(y, 0, 1)), end: iso(new Date(y, 11, 31)) }
}

/**
 * The window for anything charged BY ELAPSED TIME — overheads, and only those.
 *
 * Counts use the whole period; rent does not accrue for days that have not
 * happened. Clamping here keeps the two concerns separate instead of letting
 * the overhead rule quietly redefine what "this month" means for everything.
 */
export function elapsedEndOf(range: Range, now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
  return today < range.end ? today : range.end
}
