/**
 * What the patient's selection costs — the website calculator's whole brain.
 *
 * ── Why the number is computed on the SERVER ─────────────────────────────────
 * The widget could multiply teeth by a price itself. It must not. A price shown
 * on a public page is a commercial statement, and a figure that two pieces of
 * code arrive at separately will one day disagree — usually after a price
 * change, usually in the customer's favour, always in front of a patient. So
 * this function runs behind the edge function and the widget renders the
 * PRE-FORMATTED strings it returns. `wivo-booking.js` contains no arithmetic.
 *
 * ── An estimate, and it says so ──────────────────────────────────────────────
 * `siduv: false` on every result, and `hoiatus` carries the sentence the page
 * must show. A dentist cannot price a mouth they have not looked in: the tooth
 * that needs a build-up, the root that turns out to be cracked. A calculator
 * that reads as a binding quote would be a promise the clinic cannot keep, and
 * the first argument about it costs more than the calculator ever earned.
 *
 * ── It prices what the PATIENT asked for, not what they need ─────────────────
 * The patient selects teeth and a service. Nothing here decides that a tooth
 * needs a crown — that is a diagnosis, and a website making one would be a
 * different regulated product entirely (see `project_no_patient_portal`).
 *
 * The `shared/` contract applies: no dependencies at all. See shared/README.md.
 */
import type { PublicService, PublicPriceTier, PublicAddOn } from './publicService.ts'

const round2 = (n: number): number => Math.round(n * 100) / 100

/** One line of what the patient picked. */
export interface CalculatorSelection {
  serviceId: string
  /** FDI numbers. The count is what prices; the numbers are for the clinic. */
  hambad: string[]
  /** `PublicAddOn.id` values the patient ticked. */
  lisad?: string[]
}

export interface CalculatorLine {
  serviceId: string
  nimi: string
  hambaid: number
  /** Per-tooth price actually used, after any volume tier. */
  hambaHind: number
  /** Set when a volume tier beat the base price — worth telling the patient. */
  astmeAlates?: number
  lisad: { nimi: string; summa: number }[]
  summa: number
  /** "3 × 250.00 € = 750.00 €" — the widget prints this, it does not build it. */
  tekst: string
}

export interface CalculatorResult {
  read: CalculatorLine[]
  kokku: number
  /** "1 340.00 €". Formatted here so the page cannot format it differently. */
  kokkuTekst: string
  kmSisaldub: boolean
  /** Always false. A website cannot quote a mouth it has not seen. */
  siduv: false
  /** Shown beside the total, always. */
  hoiatus: string
  /**
   * Why part of the selection could not be priced. Non-empty means the total
   * is INCOMPLETE and the page must say so rather than showing a confident
   * number that silently omits something.
   */
  probleemid: string[]
}

export const HOIATUS =
  'Hinnanguline maksumus. Täpne hind selgub vastuvõtul, kui arst on suu üle '
  + 'vaadanud — mõni hammas vajab rohkem tööd, kui pildilt paista saab.'

/** Estonian money formatting, in ONE place. 1234.5 → "1 234.50 €". */
export function money(v: number): string {
  const n = round2(Number.isFinite(v) ? v : 0)
  const [whole, cents] = n.toFixed(2).split('.')
  // Non-breaking spaces BOTH inside the number and before the sign: on a page
  // whose width nobody controls, "1 234.50 €" must never break across a line
  // as "1" / "234.50" or leave a lonely "€". The tests spell it  .
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${cents} €`
}

/**
 * The tier that applies at this quantity, or null when the base price does.
 *
 * Highest `alates` at or below the quantity wins, so the list may be written in
 * any order and a tier added later cannot be shadowed by one above it. Quantity
 * 0 never matches — "no teeth picked" is not a quantity.
 *
 * Same rule as the lab price book's `tierFor`, restated rather than imported;
 * see `PublicPriceTier` for why.
 */
export function publicTierFor(
  astmed: PublicPriceTier[] | undefined, quantity: number,
): PublicPriceTier | null {
  if (!Array.isArray(astmed) || astmed.length === 0) return null
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  let best: PublicPriceTier | null = null
  for (const t of astmed) {
    if (!t || !Number.isFinite(t.alates) || !(t.hind > 0)) continue
    if (t.alates > quantity) continue
    if (!best || t.alates > best.alates) best = t
  }
  return best
}

/** Services the calculator can offer — the rest are range-priced only. */
export function calculableServices(services: PublicService[]): PublicService[] {
  return (services ?? []).filter(s =>
    s.avalik && !!s.kalkulaator && s.kalkulaator.hambaHind > 0)
}

function addOnsFor(
  pricing: NonNullable<PublicService['kalkulaator']>, picked: string[], teeth: number,
): { nimi: string; summa: number }[] {
  const byId = new Map((pricing.lisad ?? []).map((a: PublicAddOn) => [a.id, a]))
  const out: { nimi: string; summa: number }[] = []
  for (const id of new Set(picked)) {
    const a = byId.get(id)
    if (!a || !(a.hind > 0)) continue
    out.push({
      nimi: a.nimi,
      summa: round2(a.hambaKohta ? a.hind * teeth : a.hind),
    })
  }
  return out
}

export function calculatePublic(
  services: PublicService[],
  selection: CalculatorSelection[],
): CalculatorResult {
  const byId = new Map((services ?? []).map(s => [s.id, s]))
  const read: CalculatorLine[] = []
  const probleemid: string[] = []
  // Whether VAT is included is a property of the price list, not of a line. If
  // services ever disagree the page must not average them into a half-truth.
  const kmFlags = new Set<boolean>()

  for (const sel of selection ?? []) {
    const s = byId.get(sel.serviceId)
    const teeth = new Set((sel.hambad ?? []).map(t => String(t).trim()).filter(Boolean))
    const n = teeth.size

    if (!s || !s.avalik) { probleemid.push('Valitud teenust ei ole.'); continue }
    const p = s.kalkulaator
    if (!p || !(p.hambaHind > 0)) {
      probleemid.push(`${s.nimi}: hinda ei saa veebis arvutada, küsi meilt.`)
      continue
    }
    if (n === 0) continue   // nothing picked for this service yet: not an error

    if (p.maxHambaid && n > p.maxHambaid) {
      // Refuse the number rather than produce a confident wrong one.
      probleemid.push(
        `${s.nimi}: ${n} hammast on rohkem, kui veebis arvutada saab. `
        + 'Võta ühendust, teeme personaalse pakkumise.')
      continue
    }

    const tier = publicTierFor(p.astmed, n)
    const hambaHind = round2(tier ? tier.hind : p.hambaHind)
    const lisad = addOnsFor(p, sel.lisad ?? [], n)
    const summa = round2(hambaHind * n + lisad.reduce((t, a) => t + a.summa, 0))

    kmFlags.add(!!s.kmSisaldub)
    read.push({
      serviceId: s.id,
      nimi: s.nimi,
      hambaid: n,
      hambaHind,
      ...(tier ? { astmeAlates: tier.alates } : {}),
      lisad,
      summa,
      tekst: `${n} × ${money(hambaHind)} = ${money(round2(hambaHind * n))}`,
    })
  }

  if (kmFlags.size > 1) {
    probleemid.push('Osa hindu sisaldab käibemaksu ja osa mitte — küsi meilt täpsustust.')
  }

  const kokku = round2(read.reduce((t, l) => t + l.summa, 0))
  return {
    read,
    kokku,
    kokkuTekst: money(kokku),
    // One flag, and only when every line agrees. `true` is the sane default for
    // an empty selection: Estonian consumer prices include VAT.
    kmSisaldub: kmFlags.size === 1 ? [...kmFlags][0] : true,
    siduv: false,
    hoiatus: HOIATUS,
    probleemid,
  }
}
