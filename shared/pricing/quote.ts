/**
 * What a job costs. THE implementation — see `shared/README.md`.
 *
 * This replaces two copies that had already drifted apart: the job form's live
 * auto-price and `lib/repriceJobs.ts`. Where they disagreed, this file follows
 * the repricer, because the repricer's behaviour is the one consistent with
 * what HANDOFF.md asks of anything that handles money:
 *
 *   > Prefer a number that admits what it cannot see over one that looks
 *   > complete and is wrong.
 *
 * Two behaviours therefore differ from what the job form used to do:
 *
 *  1. **An unpriceable job reports `unpriced`, it does not quote 0 €.** With
 *     `hambaHind = 0` and a material that has no price, the form used to
 *     compute `teeth * 0` and stamp a free job onto the record. The repricer
 *     refused. Refusing is right — nobody meant that work to be free.
 *
 *  2. **Every work item is priced, not just the first.** Both copies read the
 *     denormalised `too` / `hambad` fields, so a job holding 10 crowns and 4
 *     bridges was quoted as one work type spread across all 14 teeth. Items
 *     are separate pieces of work and each one costs what its own type costs.
 *     A job that still has no `work_items` passes a single legacy item and is
 *     therefore quoted exactly as before.
 */
import type { PriceBook } from './priceBook'
import { calcProduction, workTypePriceFor } from './priceBook'
import { toothCount } from './teeth'

/** One piece of work: a type, the teeth it covers, and what it is made of. */
export interface QuoteItem {
  /** Free text as typed — resolved against the work-type list, not matched exactly. */
  too: string
  /** FDI numbers, comma separated. */
  hambad: string
  /**
   * What THIS piece of work is made of. Falls back to the job-level material.
   *
   * `WorkItem.materjal` has existed since work items did, and nothing priced it:
   * a case of crowns in Ceramic Crown and bridges in OnX Tough 2 was quoted as
   * if all of it were the first material. Same class of mistake as pricing every
   * item as one work TYPE, which this file already fixed — the material half was
   * simply left behind.
   */
  materjal?: string | null
}

export interface QuoteInput {
  /**
   * One entry per work item. A job with no `work_items` passes exactly one
   * entry built from its `too` / `hambad` — see `jobWorkItems()` in types/job.
   */
  items: QuoteItem[]
  /** Job-level material, used for the per-tooth fallback on every item. */
  materjal?: string | null
  /** Rush job — multiplies production only, never the design fee or extras. */
  kiirtoo?: boolean
  /** Use the work type's discount price where one is configured. */
  useDiscount?: boolean
  /** Design fee as it stands on the job. Added on top; not a production cost. */
  disainHind?: number | null
  /** Extra services already chosen for this job. */
  extras?: { nimi: string; hind: number }[]
}

export type QuoteSource = 'tüüp' | 'materjal' | 'hambad' | 'kiirtöö' | 'disain' | 'lisateenus'

export interface QuoteLine {
  source: QuoteSource
  label: string
  amount: number
}

export interface Quote {
  /** Production price — this is what belongs in `job.hind`. Rush included. */
  production: number
  /** Design fee, unchanged from the input. Belongs in `job.disain_hind`. */
  disain: number
  /** Extras total. Belongs alongside `job.extras`. */
  lisateenused: number
  /** What the customer owes: production + design + extras. */
  total: number
  /** Every component, in the order it was applied. For showing the maths. */
  lines: QuoteLine[]
  rush: boolean
  /**
   * Human-readable reasons a part of this job could not be priced.
   *
   * **Non-empty means do not stamp a price.** `production` still holds whatever
   * *could* be worked out, so a caller can show "400 € + 1 tööosa hinnata" —
   * but writing that partial number onto the job as if it were the price is
   * exactly the bug this function exists to stop.
   */
  unpriced: string[]
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** What one item costs before the rush multiplier, or null if unknowable. */
function priceItem(
  item: QuoteItem,
  materjal: string | null | undefined,
  book: PriceBook,
  useDiscount: boolean
): { amount: number; source: QuoteSource } | null {
  const teeth = toothCount(item.hambad)

  // 1. The configured work type. Applies even with no teeth picked when the
  //    type is priced per job — that is the point of quoting a case.
  const typePrice = workTypePriceFor(item.too, book.workTypes, teeth, useDiscount)
  if (typePrice) return { amount: typePrice.amount, source: 'tüüp' }

  // 2. What this material costs across these teeth. The item's own material
  //    first — the job-level one is only the answer for items that name none.
  const mat = item.materjal?.trim() || materjal
  if (mat && teeth > 0) {
    const p = calcProduction(item.hambad, mat, book.materialPrices)
    if (p > 0) return { amount: p, source: 'materjal' }
  }

  // 3. Last resort €/tooth. Guarded: a rate of 0 is not a price of 0, it is a
  //    rate nobody has set yet.
  if (teeth > 0 && book.hambaHind > 0) {
    return { amount: teeth * book.hambaHind, source: 'hambad' }
  }

  return null
}

export function quoteJob(input: QuoteInput, book: PriceBook): Quote {
  const useDiscount = input.useDiscount ?? false
  const rush = input.kiirtoo ?? false
  const lines: QuoteLine[] = []
  const unpriced: string[] = []

  let base = 0
  let priced = 0

  for (const item of input.items) {
    const label = item.too?.trim() || 'Määramata töö'
    const result = priceItem(item, input.materjal, book, useDiscount)
    if (!result) {
      unpriced.push(
        toothCount(item.hambad) === 0
          ? `${label}: hambaid ei ole valitud ja töö tüübil pole hinda`
          : `${label}: hinda ei õnnestu arvutada`
      )
      continue
    }
    base += result.amount
    priced++
    lines.push({ source: result.source, label, amount: round2(result.amount) })
  }

  // Nothing at all could be priced — say so rather than reporting a zero total
  // that reads like a decision someone made.
  if (priced === 0 && input.items.length > 0) {
    base = 0
  }

  let production = round2(base)
  if (rush && production > 0) {
    const uplift = round2(production * book.kiirtooKordaja - production)
    lines.push({ source: 'kiirtöö', label: `Kiirtöö ×${book.kiirtooKordaja}`, amount: uplift })
    production = round2(production * book.kiirtooKordaja)
  }

  const disain = round2(Number(input.disainHind ?? 0))
  if (disain > 0) lines.push({ source: 'disain', label: 'Disain', amount: disain })

  let lisateenused = 0
  for (const e of input.extras ?? []) {
    const amount = round2(Number(e.hind ?? 0))
    if (amount === 0) continue
    lisateenused = round2(lisateenused + amount)
    lines.push({ source: 'lisateenus', label: e.nimi || 'Lisateenus', amount })
  }

  return {
    production,
    disain,
    lisateenused,
    total: round2(production + disain + lisateenused),
    lines,
    rush,
    unpriced,
  }
}
