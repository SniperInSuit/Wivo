import { describe, it, expect } from 'vitest'
import {
  calculatePublic, publicTierFor, calculableServices, money, HOIATUS,
} from './publicCalculator'
import type { PublicService } from './publicService'

/**
 * U+00A0, the non-breaking space `money()` uses — written as an ESCAPE, never
 * as the character. An invisible NBSP sitting in source is what made these
 * expectations disagree with the code while looking identical on screen.
 */
const NB = String.fromCharCode(0x00a0)

const svc = (over: Partial<PublicService> = {}): PublicService => ({
  id: 'kroon', nimi: 'Kroon', avalik: true, jarjekord: 0,
  hinnaAlates: 250, hinnaKuni: 400, kmSisaldub: true,
  samm: [], broneeritavSamm: 0, kinnitus: 'puudub',
  kalkulaator: { hambaHind: 250 },
  ...over,
} as PublicService)

const calc = (services: PublicService[], sel: Parameters<typeof calculatePublic>[1]) =>
  calculatePublic(services, sel)

describe('calculatePublic — mida patsient valis', () => {
  it('korrutab hambad hinnaga', () => {
    const r = calc([svc()], [{ serviceId: 'kroon', hambad: ['11', '12', '13'] }])
    expect(r.kokku).toBe(750)
    //   = non-breaking space. Deliberate: a price must not wrap.
    expect(r.kokkuTekst).toBe(`750.00${NB}€`)
    expect(r.read[0].tekst).toBe(`3 × 250.00${NB}€ = 750.00${NB}€`)
  })

  it('loeb sama hamba üks kord', () => {
    // A tooth picked twice is one tooth. The map can fire twice on one tap.
    const r = calc([svc()], [{ serviceId: 'kroon', hambad: ['11', '11', '12'] }])
    expect(r.read[0].hambaid).toBe(2)
  })

  it('ei ole kunagi siduv ja ütleb seda', () => {
    const r = calc([svc()], [{ serviceId: 'kroon', hambad: ['11'] }])
    expect(r.siduv).toBe(false)
    expect(r.hoiatus).toBe(HOIATUS)
  })

  it('tühi valik annab nulli, mitte viga', () => {
    const r = calc([svc()], [{ serviceId: 'kroon', hambad: [] }])
    expect(r.kokku).toBe(0)
    expect(r.probleemid).toEqual([])
    expect(r.read).toEqual([])
  })

  it('liidab mitu teenust kokku', () => {
    const r = calc(
      [svc(), svc({ id: 'laminaat', nimi: 'Laminaat', kalkulaator: { hambaHind: 400 } })],
      [
        { serviceId: 'kroon', hambad: ['11', '12'] },
        { serviceId: 'laminaat', hambad: ['21'] },
      ],
    )
    expect(r.kokku).toBe(900)
    expect(r.read).toHaveLength(2)
  })
})

describe('kogusehinnad', () => {
  const tiered = svc({
    kalkulaator: {
      hambaHind: 250,
      astmed: [{ alates: 6, hind: 200 }, { alates: 3, hind: 225 }],
    },
  })

  it('kõrgeim sobiv aste võidab, kirjutamise järjekorrast sõltumata', () => {
    // Written 6 before 3 on purpose: order must not decide.
    expect(publicTierFor(tiered.kalkulaator!.astmed, 4)?.hind).toBe(225)
    expect(publicTierFor(tiered.kalkulaator!.astmed, 8)?.hind).toBe(200)
  })

  it('alla astme jääb põhihind', () => {
    const r = calc([tiered], [{ serviceId: 'kroon', hambad: ['11', '12'] }])
    expect(r.read[0].hambaHind).toBe(250)
    expect(r.read[0].astmeAlates).toBeUndefined()
  })

  it('astme peal langeb hind ja rida ütleb, millest alates', () => {
    const r = calc([tiered], [{ serviceId: 'kroon', hambad: ['11', '12', '13', '14', '15', '16'] }])
    expect(r.read[0].hambaHind).toBe(200)
    expect(r.read[0].astmeAlates).toBe(6)
    expect(r.kokku).toBe(1200)
  })

  it('null hammast ei vali astet', () => {
    expect(publicTierFor(tiered.kalkulaator!.astmed, 0)).toBeNull()
  })
})

describe('lisad', () => {
  const withAddOns = svc({
    kalkulaator: {
      hambaHind: 250,
      lisad: [
        { id: 'toon', nimi: 'Toonivalik', hind: 30 },
        { id: 'garantii', nimi: 'Pikendatud garantii', hind: 20, hambaKohta: true },
      ],
    },
  })

  it('lisab ühekordse lisa üks kord', () => {
    const r = calc([withAddOns], [{ serviceId: 'kroon', hambad: ['11', '12'], lisad: ['toon'] }])
    expect(r.read[0].lisad).toEqual([{ nimi: 'Toonivalik', summa: 30 }])
    expect(r.kokku).toBe(530)
  })

  it('korrutab hamba kohta käiva lisa hammaste arvuga', () => {
    const r = calc([withAddOns], [{ serviceId: 'kroon', hambad: ['11', '12'], lisad: ['garantii'] }])
    expect(r.read[0].lisad).toEqual([{ nimi: 'Pikendatud garantii', summa: 40 }])
    expect(r.kokku).toBe(540)
  })

  it('eirab tundmatut lisa, mitte ei kuku', () => {
    // The widget is public code; anything can arrive in this array.
    const r = calc([withAddOns], [{ serviceId: 'kroon', hambad: ['11'], lisad: ['vabatekst'] }])
    expect(r.read[0].lisad).toEqual([])
    expect(r.kokku).toBe(250)
  })

  it('loeb sama lisa üks kord', () => {
    const r = calc([withAddOns], [{ serviceId: 'kroon', hambad: ['11'], lisad: ['toon', 'toon'] }])
    expect(r.kokku).toBe(280)
  })
})

describe('millal kalkulaator keeldub', () => {
  it('ütleb otse, kui teenusel ei ole hamba hinda', () => {
    const r = calc([svc({ kalkulaator: undefined })], [{ serviceId: 'kroon', hambad: ['11'] }])
    expect(r.kokku).toBe(0)
    expect(r.probleemid[0]).toContain('ei saa veebis arvutada')
  })

  it('keeldub numbrist, kui hambaid on üle piiri', () => {
    // A calculator that confidently prices 28 crowns is worse than one that
    // admits its limit.
    const capped = svc({ kalkulaator: { hambaHind: 250, maxHambaid: 6 } })
    const r = calc([capped], [{ serviceId: 'kroon', hambad: '11,12,13,14,15,16,17'.split(',') }])
    expect(r.read).toEqual([])
    expect(r.probleemid[0]).toContain('rohkem, kui veebis arvutada saab')
  })

  it('ei arvuta avaldamata teenust', () => {
    const r = calc([svc({ avalik: false })], [{ serviceId: 'kroon', hambad: ['11'] }])
    expect(r.probleemid[0]).toBe('Valitud teenust ei ole.')
  })

  it('ei arvuta olematut teenust', () => {
    const r = calc([svc()], [{ serviceId: 'ei-ole', hambad: ['11'] }])
    expect(r.probleemid[0]).toBe('Valitud teenust ei ole.')
  })

  it('ütleb välja, kui käibemaksu käsitlus on ridade vahel erinev', () => {
    const r = calc(
      [svc(), svc({ id: 'muu', nimi: 'Muu', kmSisaldub: false, kalkulaator: { hambaHind: 100 } })],
      [{ serviceId: 'kroon', hambad: ['11'] }, { serviceId: 'muu', hambad: ['21'] }],
    )
    expect(r.probleemid.some(p => p.includes('käibemaksu'))).toBe(true)
  })
})

describe('calculableServices', () => {
  it('jätab alles ainult need, mida saab arvutada', () => {
    const list = [
      svc(),
      svc({ id: 'hygieen', kalkulaator: undefined }),
      svc({ id: 'null', kalkulaator: { hambaHind: 0 } }),
      svc({ id: 'peidus', avalik: false }),
    ]
    expect(calculableServices(list).map(s => s.id)).toEqual(['kroon'])
  })
})

describe('money — üks vormindaja', () => {
  it('paneb murdumatu tühiku nii tuhandelisse kui märgi ette', () => {
    // Both spaces are U+00A0. A price that wraps mid-number on a narrow phone
    // reads as two numbers, and a lone € on the next line reads as nothing.
    expect(money(1234.5)).toBe(`1${NB}234.50${NB}€`)
    expect(money(999)).toBe(`999.00${NB}€`)
    expect(money(0)).toBe(`0.00${NB}€`)
    expect(money(1234.5)).not.toContain('1 234')   // a plain space would be wrong
  })

  it('ei kuku vigase arvu peal', () => {
    expect(money(NaN)).toBe(`0.00${NB}€`)
  })
})
