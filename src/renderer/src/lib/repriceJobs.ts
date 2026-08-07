/**
 * Recalculate stored job prices from the current settings.
 *
 * The prices on old jobs date from when this was a one-technician tool and the
 * default was 15 €/tooth. They are now client prices that invoices are written
 * from, so they have to reflect the real price list.
 *
 * This REWRITES financial fields on existing rows, so it is a planned operation:
 * the plan is computed and shown first, and nothing is written until it is
 * confirmed. Issued invoices are unaffected either way — their lines are copies
 * taken at billing time, which is exactly why they were built that way.
 */
import type { Job } from '../types/job'
import { jobWorkItems } from '../types/job'
import type { WivoSettings } from '../stores/useSettings'
import { priceBookOf } from '../stores/useSettings'
import { quoteJob } from '@shared/pricing/quote'

const round2 = (n: number) => Math.round(n * 100) / 100
const toothCount = (h: string | null | undefined) =>
  (h ?? '').split(',').filter(t => t.trim()).length

export interface RepriceChange {
  job: Job
  oldPrice: number
  newPrice: number
  /**
   * Where the new number came from, so the preview can be audited. `segu` means
   * a multi-item job whose items priced from different sources — one crown off
   * the type list, one bridge off the material table.
   */
  source: 'tüüp' | 'materjal' | 'hambad' | 'segu'
  billed: boolean
}

export interface RepriceSkip {
  job: Job
  reason: string
}

export interface RevisionRepriceChange {
  job: Job
  revId: string
  revIndex: number
  oldPrice: number
  newPrice: number
}

export interface RepricePlan {
  changes: RepriceChange[]
  revisionChanges: RevisionRepriceChange[]
  revisionOldTotal: number
  revisionNewTotal: number
  unchanged: number
  skipped: RepriceSkip[]
  oldTotal: number
  newTotal: number
  billedCount: number
}

export interface RepriceOptions {
  /** Jobs already on an invoice. Their invoice does not change either way. */
  includeBilled: boolean
  billedJobIds: Set<string>
  /**
   * What to do with revision prices.
   *   'skip'   — leave them alone
   *   'zero'   — set every revision to 0 €, for a lab that does not charge for
   *              its own rework
   *   'recalc' — muudatusHambaHind × the revision's teeth
   */
  revisionMode: 'skip' | 'zero' | 'recalc'
}

/**
 * Prices through `quoteJob` — the same function the job form calls, so a
 * repriced job cannot disagree with what the form shows for the same job. This
 * file used to hold its own copy of the rules "mirroring" the form; they had
 * drifted apart by v1.26 and that is why there is now one implementation.
 */
export function planReprice(
  jobs: Job[], settings: WivoSettings, opts: RepriceOptions
): RepricePlan {
  const changes: RepriceChange[] = []
  const revisionChanges: RevisionRepriceChange[] = []
  const skipped: RepriceSkip[] = []
  let unchanged = 0
  let billedCount = 0
  const book = priceBookOf(settings)

  for (const job of jobs) {
    const billed = opts.billedJobIds.has(job.id)
    if (billed) billedCount++
    if (billed && !opts.includeBilled) continue

    // Revisions are priced independently of the job, so they are planned
    // independently too — a lab can zero its rework without touching what the
    // client is charged for the original.
    if (opts.revisionMode !== 'skip') {
      ;(job.revisions ?? []).forEach((rev, i) => {
        const oldPrice = round2(Number(rev.price ?? 0))
        const revTeeth = toothCount(rev.hambad ?? job.hambad)
        const newPrice = opts.revisionMode === 'zero'
          ? 0
          : round2(revTeeth * settings.muudatusHambaHind)
        if (newPrice === oldPrice) return
        revisionChanges.push({ job, revId: rev.id, revIndex: i + 1, oldPrice, newPrice })
      })
    }

    // Each work item is priced on its own, in the material it names. A job
    // still carrying only the old `too`/`hambad` fields yields one legacy item
    // with no material of its own and is quoted from `job.materjal` as before.
    const quote = quoteJob({
      items: jobWorkItems(job).map(i => ({
        too: i.too, hambad: i.hambad, materjal: i.materjal ?? null,
      })),
      materjal: job.materjal,
      kiirtoo: job.kiirtoo ?? false,
    }, book)

    // Any part unpriced skips the WHOLE job. Writing a partial total onto the
    // record would look like a decision rather than a gap.
    if (quote.unpriced.length > 0) {
      skipped.push({ job, reason: quote.unpriced.join('; ') })
      continue
    }

    const sources = new Set(
      quote.lines.filter(l => l.source !== 'kiirtöö').map(l => l.source)
    )
    const source = (sources.size === 1
      ? [...sources][0]
      : 'segu') as RepriceChange['source']

    const newPrice = quote.production
    const oldPrice = round2(Number(job.hind ?? 0))
    if (newPrice === oldPrice) { unchanged++; continue }

    changes.push({ job, oldPrice, newPrice, source, billed })
  }

  return {
    changes,
    revisionChanges,
    revisionOldTotal: round2(revisionChanges.reduce((s, c) => s + c.oldPrice, 0)),
    revisionNewTotal: round2(revisionChanges.reduce((s, c) => s + c.newPrice, 0)),
    unchanged,
    skipped,
    oldTotal: round2(changes.reduce((s, c) => s + c.oldPrice, 0)),
    newTotal: round2(changes.reduce((s, c) => s + c.newPrice, 0)),
    billedCount,
  }
}
