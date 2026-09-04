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
import { resolveWorkType, tierFor } from './workTypes'
import type { PriceTier } from './workTypes'
import { countLargeTeeth, countSmallTeeth } from './teeth'

/** €/tooth for a material, split by FDI position class. */
export interface MaterialPricing {
  small: number   // €/tooth for positions 1–5 (incisors, canines, premolars)
  large: number   // €/tooth for positions 6–8 (molars)

  /**
   * A capsule or cartridge is INDIVISIBLE, and a per-tooth price cannot say so.
   *
   * The intent was always there — `finance.ts` has carried the comment "Midas →
   * tooth per capsule (1 large, up to 3 small)" for a long time — but expressing
   * it as a price difference between `small` and `large` is linear, and a
   * capsule is not. Linear is wrong in both directions:
   *
   *   5 small teeth  → 5 × small, when two capsules actually covered them
   *   2 small teeth  → 2 × small, when you opened a whole capsule regardless
   *
   * With these fields the cost becomes `ceil(slots / mahutavus) × hind`, which
   * is what the bench sees on the print plate.
   *
   * ABSENT = the old linear behaviour, unchanged. Nothing about a lab that has
   * not filled this in moves.
   */
  yhikHind?: number       // € for one capsule
  yhikMahutavus?: number  // how many "slots" fit in one capsule
  /**
   * Slots a molar consumes. Defaults to the whole capsule — one big tooth fills
   * it — which is exactly what the old comment described. A small tooth is
   * always 1 slot; a second knob for that would be a setting nobody could
   * check against anything real.
   */
  yhikSuurSlot?: number
}

/** What one capsule-priced material costs, and how many capsules that is. */
export interface MaterialUnits {
  kapsleid: number
  summa: number
}

/**
 * Capsule cost for a given tooth mix, or null when this material is not priced
 * by capsule at all.
 *
 * Null rather than 0 on purpose: "no capsule price configured" and "this job
 * needs no capsules" are different answers, and only the caller knows whether
 * to fall back to the per-tooth price or to report nothing.
 *
 * Rounds UP, because half a capsule cannot be bought or returned. Zero teeth is
 * the one case that rounds to zero — an empty job opens nothing.
 */
export function materialUnitCost(
  p: Pick<MaterialPricing, 'yhikHind' | 'yhikMahutavus' | 'yhikSuurSlot'>,
  small: number,
  large: number,
): MaterialUnits | null {
  const hind = Number(p.yhikHind)
  const mahutavus = Number(p.yhikMahutavus)
  // A capacity of zero would divide by zero and a negative one would return a
  // negative count. Either means the setting is not usable, so the caller falls
  // back to the per-tooth price rather than getting a nonsense number.
  if (!Number.isFinite(hind) || hind <= 0) return null
  if (!Number.isFinite(mahutavus) || mahutavus <= 0) return null

  const suurSlot = Number.isFinite(Number(p.yhikSuurSlot)) && Number(p.yhikSuurSlot)! > 0
    ? Number(p.yhikSuurSlot)
    : mahutavus

  const s = Math.max(0, Math.floor(small))
  const l = Math.max(0, Math.floor(large))
  const slots = s * 1 + l * suurSlot
  if (slots <= 0) return { kapsleid: 0, summa: 0 }

  const kapsleid = Math.ceil(slots / mahutavus)
  return { kapsleid, summa: Math.round(kapsleid * hind * 100) / 100 }
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
  /**
   * The volume tier that set `unit`, or null when the type's base price did.
   *
   * Carried out so the form can say WHY the price changed — "6+ hammast:
   * 340 €/hammas" — instead of the number quietly moving when a seventh tooth
   * is clicked and nobody being able to explain it to the dentist.
   */
  tier: PriceTier | null
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
  // A volume tier REPLACES the base price at this quantity — flat, not
  // progressive: six crowns at the "6+" rate means all six at that rate. See
  // PriceTier for why. `hind` stays the price from quantity 1, so the tier list
  // only ever holds the exceptions to it.
  const tier = tierFor(t, teeth)
  const base = typeof t.hind === 'number' && t.hind > 0 ? t.hind : null
  const full = tier ? tier.hind : base
  // A tier without its own discount falls back to the type's, rather than
  // silently losing the discount at higher volumes.
  const tierDiscount = tier && typeof tier.soodushind === 'number' && tier.soodushind > 0
    ? tier.soodushind
    : null
  const typeDiscount = typeof t.soodushind === 'number' && t.soodushind > 0 ? t.soodushind : null
  const discount = tierDiscount ?? typeDiscount
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
    /** The tier that set this unit price, so the form can say WHY. Null = base. */
    tier,
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
