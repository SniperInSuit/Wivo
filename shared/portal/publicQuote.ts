/**
 * What a patient is told a service costs, and how long it takes.
 *
 * WHY NOT `quoteJob()`
 *   `quoteJob` answers "what does THIS JOB cost the clinic" and returns ONE
 *   number, from a `PriceBook` full of lab rates. This answers "what does THIS
 *   SERVICE cost a patient" and returns a RANGE. Routing the second through the
 *   first would mean faking every input — no teeth, no material, no rush flag —
 *   and, the real objection, putting a `PriceBook` in scope on the public path.
 *
 *   Keeping them apart means the public code CANNOT import margin. That is a
 *   stronger property than any amount of care, and it is why this file lives in
 *   `shared/portal/` and imports nothing from `shared/pricing/`.
 *
 * ONE IMPLEMENTATION, THREE CALLERS
 *   the edge function, the desktop preview in Seaded, and the tests. What the
 *   owner sees while editing is rendered by the same functions the website uses,
 *   so the two cannot drift.
 *
 * THE HONESTY RULE, INHERITED FROM `quoteJob`
 *   A service whose price cannot be stated is NOT PUBLISHED. It is never shown
 *   as "0 €". `publishProblems()` is this file's `Quote.unpriced`.
 *
 * THE `.ts` EXTENSION BELOW IS LOAD-BEARING — DO NOT "TIDY" IT AWAY
 *   Deno requires an extension on relative imports, and this file is imported by
 *   the Supabase edge function. The rest of `shared/` can stay extensionless
 *   because nothing outside the bundler imports it; `shared/portal/` cannot.
 *   Vite and `moduleResolution: "bundler"` accept the extension happily, so
 *   both worlds are satisfied by writing it.
 */
import type { PublicService } from './publicService.ts'

const round2 = (n: number) => Math.round(n * 100) / 100

/** '1200–1900 €' or '450 €'. Formatted here so no caller invents its own. */
function formatRange(alates: number, kuni: number): string {
  const eur = (n: number) => `${round2(n).toFixed(2).replace(/\.00$/, '')} €`
  return alates === kuni ? eur(kuni) : `${eur(alates).replace(' €', '')}–${eur(kuni)}`
}

export interface PublicPrice {
  alates: number
  kuni: number
  kmSisaldub: boolean
  /** Pre-formatted, so the Framer component never does money formatting. */
  tekst: string
  markus?: string
}

export function publicPriceRange(s: PublicService): PublicPrice {
  const alates = round2(s.hinnaAlates)
  const kuni = round2(s.hinnaKuni)
  return {
    alates,
    kuni,
    kmSisaldub: s.kmSisaldub,
    tekst: formatRange(alates, kuni),
    ...(s.hinnaMarkus?.trim() ? { markus: s.hinnaMarkus.trim() } : {}),
  }
}

export interface PublicPlanSummary {
  /** Derived from the list, never stored — two facts drift, one does not. */
  visiite: number
  /** Total chair time across every visit, minutes. 0 when unstated. */
  toolisAegMin: number
  /**
   * What the site shows for elapsed time. The owner's own words when given;
   * otherwise a deliberately vague computed fallback, never "127 päeva".
   */
  kestusTekst: string
  sammud: { pealkiri: string; kirjeldus?: string; kestusMin?: number; ootaegTekst?: string }[]
}

/** "u 2 nädalat" / "u 4 kuud" — vague on purpose. A plan is not a promise. */
function vagueDuration(days: number): string {
  if (days <= 0) return 'ühe visiidiga'
  if (days < 14) return `u ${days} päeva`
  if (days < 60) return `u ${Math.round(days / 7)} nädalat`
  return `u ${Math.round(days / 30)} kuud`
}

export function publicPlanSummary(s: PublicService): PublicPlanSummary {
  const sammud = s.samm ?? []
  const paevi = sammud.reduce((n, x) => n + (x.ootaegPaevad ?? 0), 0)
  return {
    visiite: sammud.length,
    toolisAegMin: sammud.reduce((n, x) => n + (x.kestusMin ?? 0), 0),
    kestusTekst: s.kestusKokkuTekst?.trim() || vagueDuration(paevi),
    sammud: sammud.map(x => ({
      pealkiri: x.pealkiri,
      ...(x.kirjeldus?.trim() ? { kirjeldus: x.kirjeldus.trim() } : {}),
      ...(x.kestusMin ? { kestusMin: x.kestusMin } : {}),
      ...(x.ootaegPaevad ? { ootaegTekst: `${vagueDuration(x.ootaegPaevad)} pärast eelmist` } : {}),
    })),
  }
}

/**
 * How long to book for. One answer, asked in one place.
 *
 * The service's own duration wins; the bookable plan step is the fallback for
 * treatments that were set up before the field existed, and for genuine
 * multi-visit plans where the length lives with the visit. 0 means the website
 * cannot offer a time at all — and refusing beats guessing a chair length.
 */
export function bookingDuration(s: Pick<PublicService, 'kestusMin' | 'samm' | 'broneeritavSamm'>): number {
  const own = Number(s.kestusMin)
  if (Number.isFinite(own) && own > 0) return Math.round(own)
  const step = Number(s.samm?.[s.broneeritavSamm]?.kestusMin)
  return Number.isFinite(step) && step > 0 ? Math.round(step) : 0
}

/**
 * Why this service cannot go on the website yet. Empty = publishable.
 *
 * The same discipline as `Quote.unpriced`: refuse to publish rather than publish
 * something wrong. A price of 0 is treated as "not set", because on a dental
 * price list it always is.
 */
export function publishProblems(s: PublicService): string[] {
  const out: string[] = []
  if (!s.id?.trim()) out.push('Teenusel puudub tunnus.')
  if (!s.nimi?.trim()) out.push('Teenusel puudub nimi.')
  if (!(s.hinnaAlates > 0)) out.push(`${s.nimi || 'Teenus'}: hind puudub.`)
  if (s.hinnaKuni < s.hinnaAlates) {
    out.push(`${s.nimi || 'Teenus'}: ülemine hind on alumisest väiksem.`)
  }
  // A treatment plan is NOT required. Most services are one visit — "Visiit,
  // 30 min, 200 €" is a complete offer, and demanding a plan for it meant
  // inventing a step, naming it and marking it bookable to say nothing extra.
  // What IS required is a duration, because that is what gets booked.
  if (bookingDuration(s) <= 0) {
    out.push(`${s.nimi || 'Teenus'}: visiidi kestus on määramata.`)
  }
  if ((s.samm ?? []).length > 0
    && (s.broneeritavSamm < 0 || s.broneeritavSamm >= s.samm.length)) {
    out.push(`${s.nimi || 'Teenus'}: broneeritav samm osutab olematule visiidile.`)
  }
  return out
}

// ─── The public DTO ──────────────────────────────────────────────────────────

export interface PublicServiceDTO {
  id: string
  nimi: string
  luhikirjeldus?: string
  kategooria?: string
  hex?: string
  hind: PublicPrice
  plaan: PublicPlanSummary
  broneeritav: boolean
  kinnitus: 'puudub' | 'kood' | 'smart-id'
}

export interface PublicCatalogueDTO {
  clinic: { nimi: string; telefon?: string; email?: string }
  services: PublicServiceDTO[]
}

/**
 * The allowlist mapper — the second of three guards against leaking margin.
 *
 * Built field by field ON PURPOSE. A deny-list ("delete the cost fields") fails
 * open the moment someone adds a field; this fails closed. A new property on
 * `PublicService` is private until a human writes a line here.
 *
 * The FIRST guard is stronger and lives in the edge function: it selects only
 * `public_services` from `clinic_settings`, so `work_types`, `material_costs`
 * and `pricing` are never even fetched. The THIRD is `publicQuote.test.ts`.
 *
 * Unpublishable services are dropped silently rather than half-rendered — see
 * `publishProblems`. The desktop editor is where a human is told why.
 */
export function toPublicCatalogue(
  services: PublicService[],
  clinic: { nimi: string; telefon?: string | null; email?: string | null },
): PublicCatalogueDTO {
  const published = (services ?? [])
    .filter(s => s.avalik && publishProblems(s).length === 0)
    .sort((a, b) => a.jarjekord - b.jarjekord)

  return {
    clinic: {
      nimi: clinic.nimi,
      ...(clinic.telefon ? { telefon: clinic.telefon } : {}),
      ...(clinic.email ? { email: clinic.email } : {}),
    },
    services: published.map(s => ({
      id: s.id,
      nimi: s.nimi,
      ...(s.luhikirjeldus?.trim() ? { luhikirjeldus: s.luhikirjeldus.trim() } : {}),
      ...(s.kategooria?.trim() ? { kategooria: s.kategooria.trim() } : {}),
      ...(s.hex ? { hex: s.hex } : {}),
      hind: publicPriceRange(s),
      plaan: publicPlanSummary(s),
      broneeritav: !!s.dentasServiceId,
      kinnitus: s.kinnitus,
    })),
  }
}
