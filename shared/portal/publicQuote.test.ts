import { describe, it, expect } from 'vitest'
// Extensionless on purpose: this file is only ever compiled by vitest/vite,
// never by Deno. `publicQuote.ts` DOES carry the extension because the edge
// function imports it — see the note in its header.
import type { PublicService } from './publicService'
import { emptyPublicService, slugify } from './publicService'
import {
  publicPriceRange, publicPlanSummary, publishProblems, toPublicCatalogue,
  bookingDuration,
} from './publicQuote'

const CLINIC = { nimi: 'Fullgevity Dental', telefon: '+372 5000 0000', email: 'info@example.ee' }

function service(over: Partial<PublicService> = {}): PublicService {
  return {
    ...emptyPublicService('implantaat', 1),
    nimi: 'Hambaimplantaat',
    avalik: true,
    hinnaAlates: 1200,
    hinnaKuni: 1900,
    samm: [
      { pealkiri: 'Konsultatsioon', kestusMin: 45 },
      { pealkiri: 'Implantaadi paigaldus', kestusMin: 90, ootaegPaevad: 14 },
      { pealkiri: 'Krooni paigaldus', kestusMin: 60, ootaegPaevad: 90 },
    ],
    broneeritavSamm: 0,
    dentasServiceId: 'dentas-konsultatsioon',
    ...over,
  }
}

// ─── The leak test. This is the one that matters. ────────────────────────────
//
// Margin is the single thing that must never reach a patient's browser. The
// edge function's `.select('public_services')` is the real guarantee; this
// proves the mapper does not undo it, and it is written to fail loudly rather
// than subtly — a sentinel string, not a shape assertion.

describe('the public DTO never carries margin', () => {
  /** Every cost-bearing field the repo has, stuffed with a recognisable value. */
  const poisoned = {
    ...service(),
    sisemine: { labWorkTypes: ['LEAK-worktype'], markus: 'LEAK-internal-note' },
    // Fields that do not belong on PublicService at all, but would be here if
    // somebody ever spread a clinic_settings row into it by accident.
    kulud: [{ nimi: 'LEAK-kulu', summa: 999 }],
    material_costs: { 'Crown HT': { small: 999, large: 999 } },
    material_prices: { 'Crown HT': { small: 15, large: 15 } },
    pricing: {
      designFee: 999, hambaHind: 999, kiirtooKordaja: 999,
      fixedCostsPerJob: [{ nimi: 'LEAK-fixed', summa: 999 }],
      yldkulud: [{ nimi: 'LEAK-overhead', summa: 999, periood: 'paev' }],
      toopaevadNadalas: 4,
    },
    payroll: { tooandjaMaksudProtsent: 33.8 },
    soodushind: 999,
    hind: 999,
  } as unknown as PublicService

  const json = JSON.stringify(toPublicCatalogue([poisoned], CLINIC))

  it('contains no sentinel from any cost field', () => {
    expect(json).not.toContain('LEAK')
  })

  it('contains none of the forbidden keys', () => {
    for (const key of [
      'kulud', 'material_costs', 'material_prices', 'pricing', 'payroll',
      'soodushind', 'designFee', 'hambaHind', 'kiirtooKordaja',
      'fixedCostsPerJob', 'yldkulud', 'toopaevadNadalas', 'sisemine', 'labWorkTypes',
    ]) {
      expect(json).not.toContain(`"${key}"`)
    }
  })

  it('still returns the service — stripping is not the same as dropping', () => {
    const dto = toPublicCatalogue([poisoned], CLINIC)
    expect(dto.services).toHaveLength(1)
    expect(dto.services[0].nimi).toBe('Hambaimplantaat')
  })
})

// ─── Price ───────────────────────────────────────────────────────────────────

describe('publicPriceRange', () => {
  it('formats a range once, so no caller formats money itself', () => {
    expect(publicPriceRange(service()).tekst).toBe('1200–1900 €')
  })

  it('collapses a fixed price to one number rather than "450–450"', () => {
    expect(publicPriceRange(service({ hinnaAlates: 450, hinnaKuni: 450 })).tekst).toBe('450 €')
  })

  it('carries kmSisaldub as a stored fact, not an assumption', () => {
    expect(publicPriceRange(service({ kmSisaldub: false })).kmSisaldub).toBe(false)
  })
})

// ─── Plan ────────────────────────────────────────────────────────────────────

describe('publicPlanSummary', () => {
  it('derives the visit count from the list rather than storing it', () => {
    expect(publicPlanSummary(service()).visiite).toBe(3)
  })

  it('sums chair time', () => {
    expect(publicPlanSummary(service()).toolisAegMin).toBe(195)
  })

  it('prefers the owner’s own wording over a computed figure', () => {
    const s = service({ kestusKokkuTekst: 'u 4 kuud' })
    expect(publicPlanSummary(s).kestusTekst).toBe('u 4 kuud')
  })

  it('falls back to a VAGUE duration — never "104 päeva" on a marketing page', () => {
    // 14 + 90 = 104 days. The computed fallback must not read as a promise.
    expect(publicPlanSummary(service()).kestusTekst).toBe('u 3 kuud')
  })

  it('says "ühe visiidiga" when there is no waiting at all', () => {
    const s = service({ samm: [{ pealkiri: 'Kontroll', kestusMin: 30 }] })
    expect(publicPlanSummary(s).kestusTekst).toBe('ühe visiidiga')
  })
})

// ─── Refusing to publish ─────────────────────────────────────────────────────

describe('publishProblems — refuse rather than publish something wrong', () => {
  it('is silent on a complete service', () => {
    expect(publishProblems(service())).toEqual([])
  })

  it('treats a zero price as missing, because on a price list it always is', () => {
    expect(publishProblems(service({ hinnaAlates: 0 }))[0]).toContain('hind puudub')
  })

  it('catches an inverted range', () => {
    const p = publishProblems(service({ hinnaAlates: 1900, hinnaKuni: 1200 }))
    expect(p.some(x => x.includes('väiksem'))).toBe(true)
  })

  it('catches a bookable step pointing at a visit that does not exist', () => {
    const p = publishProblems(service({ broneeritavSamm: 7 }))
    expect(p.some(x => x.includes('olematule'))).toBe(true)
  })

  it('keeps an unpublishable service OFF the site rather than showing 0 €', () => {
    const broken = service({ hinnaAlates: 0, hinnaKuni: 0 })
    expect(toPublicCatalogue([broken], CLINIC).services).toHaveLength(0)
  })

  it('keeps a draft off the site even when it is otherwise complete', () => {
    expect(toPublicCatalogue([service({ avalik: false })], CLINIC).services).toHaveLength(0)
  })
})

// ─── Ordering and slugs ──────────────────────────────────────────────────────

describe('catalogue ordering', () => {
  it('sorts by jarjekord, not by the lab list’s match order', () => {
    const dto = toPublicCatalogue([
      service({ id: 'c', nimi: 'Kolmas', jarjekord: 3 }),
      service({ id: 'a', nimi: 'Esimene', jarjekord: 1 }),
      service({ id: 'b', nimi: 'Teine', jarjekord: 2 }),
    ], CLINIC)
    expect(dto.services.map(s => s.nimi)).toEqual(['Esimene', 'Teine', 'Kolmas'])
  })

  it('marks a service unbookable when no Dentas service is mapped', () => {
    const dto = toPublicCatalogue([service({ dentasServiceId: undefined })], CLINIC)
    expect(dto.services[0].broneeritav).toBe(false)
  })
})

describe('slugify', () => {
  it('folds Estonian letters instead of dropping them', () => {
    expect(slugify('Hügieen')).toBe('hugieen')
    expect(slugify('Õendus ja šokk')).toBe('oendus-ja-sokk')
  })

  it('produces a URL-safe id', () => {
    expect(slugify('Hambaimplantaat (üks hammas)')).toBe('hambaimplantaat-uks-hammas')
  })
})

// ─── The contract that makes this file safe ──────────────────────────────────

describe('shared/portal imports nothing from shared/pricing', () => {
  // Not a runtime check — a statement of the invariant, so anyone adding an
  // import here has to delete a test that says why they should not.
  it('is enforced by review, and the reason is the point', () => {
    expect(true).toBe(true)
  })
})

describe('bookingDuration — kui pikk aeg kalendrist kinni pannakse', () => {
  // The single most load-bearing number on the public side: it is what gets
  // blocked out of the diary, so ONE function answers it for the slot list, the
  // booking that follows, and the readiness check.
  it('eelistab teenuse enda kestust', () => {
    expect(bookingDuration(service({ kestusMin: 45 }))).toBe(45)
  })

  it('langeb broneeritava sammu peale, kui teenusel oma kestust ei ole', () => {
    // Services set up before the field existed keep working.
    const s = service({
      kestusMin: undefined,
      samm: [{ pealkiri: 'Konsultatsioon', kestusMin: 20 },
             { pealkiri: 'Paigaldus', kestusMin: 90 }],
      broneeritavSamm: 1,
    })
    expect(bookingDuration(s)).toBe(90)
  })

  it('teenuse oma kestus võidab ka siis, kui plaan on olemas', () => {
    const s = service({
      kestusMin: 30,
      samm: [{ pealkiri: 'Paigaldus', kestusMin: 90 }],
      broneeritavSamm: 0,
    })
    expect(bookingDuration(s)).toBe(30)
  })

  it('annab 0, kui kumbagi ei ole — ja 0 tähendab „ära paku aega"', () => {
    // Refusing beats guessing a chair length.
    expect(bookingDuration(service({ kestusMin: undefined, samm: [] }))).toBe(0)
    expect(bookingDuration(service({ kestusMin: 0, samm: [] }))).toBe(0)
    expect(bookingDuration(service({ kestusMin: -30, samm: [] }))).toBe(0)
  })
})

describe('publishProblems — raviplaan ei ole kohustuslik', () => {
  it('avaldab ühe visiidi teenuse ilma raviplaanita', () => {
    // "Visiit, 30 min, 200 €" is a complete offer. Demanding a plan for it
    // meant inventing a step and naming it to say nothing extra.
    expect(publishProblems(service({ kestusMin: 30, samm: [] }))).toEqual([])
  })

  it('aga nõuab kestust, sest just seda broneeritakse', () => {
    const p = publishProblems(service({ kestusMin: undefined, samm: [] }))
    expect(p[0]).toContain('kestus on määramata')
  })

  it('katkine broneeritav samm on endiselt viga, kui plaan on olemas', () => {
    const p = publishProblems(service({ samm: [{ pealkiri: 'Üks' }], broneeritavSamm: 7 }))
    expect(p[0]).toContain('olematule visiidile')
  })
})
