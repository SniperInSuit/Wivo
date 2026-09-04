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
}

/** What a capsule-priced job costs, and how many capsules that is. */
export interface MaterialUnits {
  kapsleid: number
  summa: number
}

/**
 * The price of ONE piece of this material.
 *
 * There is deliberately no separate "capsule price" setting. A capsule material
 * is priced per piece and that price is already here — an owner who typed 21 €
 * typed the price of a capsule. A second field for the same number would be two
 * places to keep in agreement, and they would not stay in agreement.
 *
 * `small` first because it is the base rate; `large` only when a lab has priced
 * molars alone. Nothing else is inferred.
 */
export function materialPiecePrice(p: Pick<MaterialPricing, 'small' | 'large'>): number {
  const s = Number(p?.small)
  if (Number.isFinite(s) && s > 0) return s
  const l = Number(p?.large)
  return Number.isFinite(l) && l > 0 ? l : 0
}

/**
 * Cost of a stated number of capsules. `null` when the number is not usable.
 *
 * A capsule is INDIVISIBLE, and how many one plate takes depends on tooth size,
 * supports and how it was packed — things only the person at the printer can
 * see. So the count is not derived from a capacity figure kept in Seaded; it is
 * READ off the plate and typed on the job. Two teeth on one capsule cost one
 * capsule, and no formula had to be told that.
 *
 * Null rather than 0 when there is no count: "nobody said" and "zero capsules"
 * are different answers, and only the caller knows whether to fall back to the
 * per-tooth price.
 */
export function materialUnitCost(
  p: Pick<MaterialPricing, 'small' | 'large'>,
  kapsleid: number | null | undefined,
): MaterialUnits | null {
  const n = Number(kapsleid)
  // A missing, fractional-negative or non-numeric count is not an instruction.
  if (kapsleid == null || !Number.isFinite(n) || n < 0) return null
  const hind = materialPiecePrice(p)
  if (hind <= 0) return null
  const count = Math.floor(n)
  return { kapsleid: count, summa: Math.round(count * hind * 100) / 100 }
}

/** Flat overhead the lab carries on every job — gloves, disinfection. A COST. */
export interface FixedCost {
  nimi: string    // e.g. "Kindad ja visiirid", "Desinfitseerimine"
  summa: number   // € per job
}

/**
 * How often a recurring cost falls due. Rent is monthly, an insurance premium
 * is yearly, lunch is a WORKING day — not a calendar one, because nobody eats
 * at the bench on Sunday. That distinction is the whole reason `paev` is
 * converted through working days per week and not through 30.44.
 */
export type OverheadPeriood = 'paev' | 'nadal' | 'kuu' | 'aasta'

/**
 * A recurring cost of being open at all — rent, the mill lease, software, food.
 *
 * Deliberately NOT per job: overheads exist whether or not a job was made, and
 * spreading them per job makes a quiet month look profitable. Per-job costs are
 * `FixedCost`, a separate list, and that separation is on purpose.
 *
 * Everything is normalised to a MONTH internally, because that is what the
 * finance period prorates from. The period is only how it was ENTERED.
 */
export interface Overhead {
  nimi: string    // e.g. "Rent", "Freesipingi liising", "Toit"
  summa: number   // € per `periood`
  /**
   * Missing = 'kuu'. Every row saved before this field existed was monthly, so
   * the default is not a guess — it is what those rows meant.
   */
  periood?: OverheadPeriood
}

/** Weeks in a month. 52/12 — not 4, which loses about 8% of every weekly cost. */
const WEEKS_PER_MONTH = 52 / 12

/**
 * One overhead row as € per month, whatever period it was typed in.
 *
 * `toopaevi` is working days per week and only affects `paev` rows. It is a
 * clinic setting rather than a constant because a four-day lab exists, and
 * feeding it 5 would overstate their food bill by a quarter.
 */
export function overheadMonthly(o: Overhead, toopaevi = 5): number {
  const summa = Number(o.summa)
  if (!Number.isFinite(summa) || summa === 0) return 0
  switch (o.periood ?? 'kuu') {
    case 'aasta': return summa / 12
    case 'nadal': return summa * WEEKS_PER_MONTH
    case 'paev': {
      // A nonsense working-week must not silently zero a real cost or invent
      // one. Clamp to a week, and fall back to 5 when it is not a number.
      const d = Number.isFinite(Number(toopaevi)) ? Math.min(7, Math.max(0, Number(toopaevi))) : 5
      return summa * d * WEEKS_PER_MONTH
    }
    default: return summa
  }
}

/** What the whole list costs per month. */
export function overheadsMonthly(overheads: Overhead[], toopaevi = 5): number {
  return (overheads ?? []).reduce((s, o) => s + overheadMonthly(o, toopaevi), 0)
}

/** For labels: "/kuus", "/päev". One place, so screens cannot disagree. */
export const OVERHEAD_PERIOOD_SILT: Record<OverheadPeriood, string> = {
  paev:  '/tööpäev',
  nadal: '/nädal',
  kuu:   '/kuus',
  aasta: '/aasta',
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
