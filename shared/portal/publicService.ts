/**
 * The patient-facing service catalogue.
 *
 * WHY THIS IS NOT `WorkType`
 *   `work_types` is the LABORATORY's catalogue and it cannot carry this job:
 *
 *   - Its ORDER is match order. `resolveWorkType()` walks the list and the first
 *     hit wins, which is why "Implantkroon" must sit above "Kroon". Reordering it
 *     to please a marketing page would recolour the calendar and reprice jobs.
 *   - It carries `kulud` — cost, i.e. margin. Keeping the public catalogue in a
 *     different column means the public query never names that column at all.
 *     A structural guarantee beats a filtering discipline.
 *   - The relationship is n:m. Whitening and hygiene involve no lab work; `IBT`
 *     and `Retainer` are lab vocabulary no patient shops for; "one implant" is a
 *     surgical visit plus a temporary plus an `Implantkroon`.
 *   - `WorkType.hind` is what the LAB charges the clinic. The patient price
 *     includes chair time and the clinic's margin. Two different numbers.
 *
 * WHY IT LIVES IN `shared/portal/` AND NOT `shared/pricing/`
 *   So that "the public surface never imports a PriceBook" is visible in the
 *   directory listing rather than only in a comment. Nothing in here may import
 *   from `../pricing/priceBook.ts`.
 *
 * The `shared/` contract applies: no dependencies at all. See shared/README.md.
 */

/** One visit in the GENERIC plan. Identical for every patient, always. */
export interface PublicPlanStep {
  pealkiri: string
  kirjeldus?: string
  /** Chair time for this visit. */
  kestusMin?: number
  /** Typical wait BEFORE this step — healing, lab turnaround. */
  ootaegPaevad?: number
  /** Which Dentas appointment type books this particular visit. */
  dentasService?: string
}

/**
 * How much proof the booking demands before it is accepted.
 *
 * Default is `'puudub'` because Dentas takes a payment at booking time, and a
 * payment is a stronger filter than an identity check: proving who you are costs
 * an abuser nothing, paying costs them money. Raise it only for a service that
 * genuinely needs an isikukood before the patient arrives — which is data
 * minimisation, not caution.
 */
export type PublicConfirmation = 'puudub' | 'kood' | 'smart-id'

export interface PublicService {
  /**
   * Stable slug — the URL key, and the join key to Dentas.
   *
   * Never regenerated from `nimi`. Renaming a service for the website must not
   * silently orphan every booking that referenced it.
   */
  id: string
  /** Patient vocabulary: "Hambaimplantaat (üks hammas)", not "Implantkroon". */
  nimi: string
  luhikirjeldus?: string
  kategooria?: string
  /** Lets the existing coloured-row settings editor be reused unchanged. */
  hex?: string

  /** Published. `false` = draft, invisible to the website. */
  avalik: boolean
  /** Display order — deliberately NOT `work_types`' match order. */
  jarjekord: number

  // ── Price, always a range ────────────────────────────────────────────────
  hinnaAlates: number
  hinnaKuni: number
  /**
   * Recorded as a fact rather than left to habit. Estonian consumer pricing
   * shows what the consumer pays, so this should normally be true — but a page
   * that is wrong about it is a complaint, so it is stored, not assumed.
   */
  kmSisaldub: boolean
  hinnaMarkus?: string

  // ── The generic treatment plan ───────────────────────────────────────────
  samm: PublicPlanStep[]
  /**
   * Free text on purpose: "u 4 kuud".
   *
   * Summing `ootaegPaevad` gives "127 päeva", which is false precision on a
   * marketing page. The desktop preview OFFERS the computed figure; the owner
   * writes what actually goes on the site.
   */
  kestusKokkuTekst?: string
  /** 0-based index into `samm` — which visit the website actually books. */
  broneeritavSamm: number
  dentasServiceId?: string

  // ── Tiered friction ──────────────────────────────────────────────────────
  kinnitus: PublicConfirmation

  /**
   * INTERNAL ONLY. Never serialised outward.
   *
   * Nested under one key so the allowlist mapper has exactly one thing to not
   * reach into, rather than a scattering of fields someone must remember.
   */
  sisemine?: {
    /** `WorkType.nimi` values, for the desktop sanity check only. */
    labWorkTypes?: string[]
    markus?: string
  }
}

/** A brand-new service, ready for the settings editor to fill in. */
export function emptyPublicService(id: string, jarjekord: number): PublicService {
  return {
    id,
    nimi: '',
    avalik: false,          // never publish by accident
    jarjekord,
    hinnaAlates: 0,
    hinnaKuni: 0,
    kmSisaldub: true,
    samm: [],
    broneeritavSamm: 0,
    kinnitus: 'puudub',
  }
}

/**
 * A URL- and Dentas-safe slug.
 *
 * Estonian letters are folded rather than dropped: "Hügieen" must not become
 * "hgieen". Called only when CREATING a service — never on rename, see `id`.
 */
export function slugify(nimi: string): string {
  const map: Record<string, string> = {
    'ä': 'a', 'ö': 'o', 'ü': 'u', 'õ': 'o', 'š': 's', 'ž': 'z',
    'Ä': 'a', 'Ö': 'o', 'Ü': 'u', 'Õ': 'o', 'Š': 's', 'Ž': 'z',
  }
  return nimi
    .trim()
    .toLowerCase()
    .split('')
    .map(c => map[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
