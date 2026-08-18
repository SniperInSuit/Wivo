/**
 * The price inputs, as one plain object.
 *
 * The desktop reads these out of the settings store; the web order form will
 * receive them over the wire from the portal function, with the lab's COST
 * fields (`WorkType.kulud`, material costs) stripped server-side — those are
 * margin, and they must never leave the database.
 *
 * Having one named type for "everything needed to quote a job" is what lets
 * `quoteJob` take a snapshot rather than reach into a store: the same inputs
 * always produce the same number, whoever is asking.
 */
import type { PriceMode, WorkType } from './workTypes'
import { resolveWorkType } from './workTypes'
import { countLargeTeeth, countSmallTeeth } from './teeth'

/** €/tooth for a material, split by FDI position class. */
export interface MaterialPricing {
  small: number   // €/tooth for positions 1–5 (incisors, canines, premolars)
  large: number   // €/tooth for positions 6–8 (molars)
}

/** Flat overhead the lab carries on every job — gloves, disinfection. A COST. */
export interface FixedCost {
  nimi: string    // e.g. "Kindad ja visiirid", "Desinfitseerimine"
  summa: number   // € per job
}

/**
 * A recurring cost of being open at all — rent, the mill lease, software.
 *
 * Monthly, because that is how they are invoiced and how anyone thinks about
 * them. Deliberately NOT per job: overheads exist whether or not a job was
 * made, and spreading them per job makes a quiet month look profitable.
 */
export interface Overhead {
  nimi: string    // e.g. "Rent", "Freesipingi liising", "Tarkvara"
  summa: number   // € per month
}

/** An add-on the customer can be charged for. Revenue, not cost. */
export interface ExtraService {
  id: string      // crypto.randomUUID()
  nimi: string    // e.g. "Ülesehitus", "Ajutine kroon", "Wax-up"
  hind: number    // € default price
}

/** Everything `quoteJob` is allowed to know. No cost fields — see the header. */
export interface PriceBook {
  workTypes: WorkType[]
  materialPrices: Record<string, MaterialPricing>
  /** Last-resort €/tooth when neither the type nor the material has a price. */
  hambaHind: number
  /** Multiplier applied to the production total when a job is marked rush. */
  kiirtooKordaja: number
  /** Default design fee. Added on top, never multiplied by the rush factor. */
  designFee: number
  /**
   * What a printed model costs the customer. Added when the job carries the
   * `mudel` flag — the toggle next to Kiirtöö, not a work type.
   *
   * A model is something a case HAS alongside its crowns, not a kind of work
   * instead of them, which is why it is a flag on the job and a flat fee here.
   * Treated like the design fee: added on top, never multiplied by the rush.
   */
  mudeliHind: number
}

export interface WorkTypePriceResult {
  /** Final € for this job — already multiplied out for per-tooth types. */
  amount: number
  /** The configured unit price, before any multiplication. */
  unit: number
  mode: PriceMode
  discounted: boolean
  /** Whether a discount price exists at all, so the UI can offer the choice. */
  hasDiscount: boolean
}

/**
 * What the configured work type says this costs.
 *
 * Resolves through exactly the same matcher that picks the calendar colour, so
 * a job priced as an Allon4 is also coloured as one. `too` is free text
 * ("Allon4 ülemine", "D14 abutmendile kroon"), and that matcher is what knows
 * those belong to a configured type at all.
 *
 * Returns null rather than 0 when it cannot say — see the per-tooth case below.
 */
export function workTypePriceFor(
  too: string | null | undefined,
  types: WorkType[],
  teeth: number,
  useDiscount = false
): WorkTypePriceResult | null {
  const t = resolveWorkType(too, types)
  const full = typeof t.hind === 'number' && t.hind > 0 ? t.hind : null
  const discount = typeof t.soodushind === 'number' && t.soodushind > 0 ? t.soodushind : null
  const unit = useDiscount && discount != null ? discount : full
  if (unit == null) return null

  const mode: PriceMode = t.hinnaTyyp ?? 'too'
  // A per-tooth price with no teeth picked yet is not zero — it is "not known
  // yet", and returning 0 would stamp a free job onto the form.
  if (mode === 'hammas' && teeth <= 0) return null

  return {
    amount: Math.round((mode === 'hammas' ? unit * teeth : unit) * 100) / 100,
    unit,
    mode,
    discounted: useDiscount && discount != null,
    hasDiscount: discount != null,
  }
}

/** What the material costs to produce across these teeth. 0 = no price set. */
export function calcProduction(
  hambad: string,
  material: string,
  prices: Record<string, MaterialPricing>
): number {
  const p = prices[material]
  if (!p) return 0
  return countSmallTeeth(hambad) * p.small + countLargeTeeth(hambad) * p.large
}
