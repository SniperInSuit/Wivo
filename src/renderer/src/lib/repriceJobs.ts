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
import type { WivoSettings } from '../stores/useSettings'
import { workTypePriceFor, calcProduction } from '../stores/useSettings'

const round2 = (n: number) => Math.round(n * 100) / 100
const toothCount = (h: string | null | undefined) =>
  (h ?? '').split(',').filter(t => t.trim()).length

export interface RepriceChange {
  job: Job
  oldPrice: number
  newPrice: number
  /** Where the new number came from, so the preview can be audited. */
  source: 'tüüp' | 'materjal' | 'hambad'
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
 * Mirrors the job form's auto-calculation exactly — work-type price first, then
 * the material table, then the flat €/tooth fallback, with the rush multiplier
 * on top. If the two ever diverge, a repriced job would disagree with what the
 * form shows for the same job.
 */
export function planReprice(
  jobs: Job[], settings: WivoSettings, opts: RepriceOptions
): RepricePlan {
  const changes: RepriceChange[] = []
  const revisionChanges: RevisionRepriceChange[] = []
  const skipped: RepriceSkip[] = []
  let unchanged = 0
  let billedCount = 0

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

    const teeth = toothCount(job.hambad)
    const typePrice = workTypePriceFor(job.too, settings.tooTuubid, teeth)

    let base: number | null = null
    let source: RepriceChange['source'] = 'tüüp'

    if (typePrice) {
      base = typePrice.amount
      source = 'tüüp'
    } else if (job.materjal && teeth > 0) {
      const p = calcProduction(job.hambad ?? '', job.materjal, settings.materialPrices)
      if (p > 0) { base = p; source = 'materjal' }
    }
    if (base == null && teeth > 0 && settings.hambaHind > 0) {
      base = teeth * settings.hambaHind
      source = 'hambad'
    }

    if (base == null) {
      skipped.push({
        job,
        reason: teeth === 0 && !typePrice
          ? 'hambaid ei ole valitud ja töö tüübil pole hinda'
          : 'hinda ei õnnestu arvutada',
      })
      continue
    }

    const newPrice = round2(job.kiirtoo ? base * settings.kiirtooKordaja : base)
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
