import { describe, it, expect } from 'vitest'
import { materialUnitCost } from './priceBook'

/**
 * The Midas capsule as the lab actually uses it: 21 € a capsule, three small
 * teeth to a capsule, one molar filling one on its own.
 *
 * These numbers are not invented — they are what the owner read off the print
 * plate: two capsules covered five teeth, where Wivo had been charging five.
 */
const MIDAS = { yhikHind: 21, yhikMahutavus: 3, yhikSuurSlot: 3 }

describe('materialUnitCost — kapsel on jagamatu', () => {
  it('viis väikest hammast on kaks kapslit, mitte viis', () => {
    // The whole reason this function exists.
    expect(materialUnitCost(MIDAS, 5, 0)).toEqual({ kapsleid: 2, summa: 42 })
  })

  it('kaks väikest hammast on ikkagi terve kapsel', () => {
    // The error in the other direction: you opened it, you paid for it.
    expect(materialUnitCost(MIDAS, 2, 0)).toEqual({ kapsleid: 1, summa: 21 })
  })

  it('kolm väikest hammast mahub täpselt ühte', () => {
    expect(materialUnitCost(MIDAS, 3, 0)).toEqual({ kapsleid: 1, summa: 21 })
  })

  it('neljas hammas avab teise kapsli', () => {
    expect(materialUnitCost(MIDAS, 4, 0)).toEqual({ kapsleid: 2, summa: 42 })
  })

  it('üks molaar täidab kapsli üksi', () => {
    expect(materialUnitCost(MIDAS, 0, 1)).toEqual({ kapsleid: 1, summa: 21 })
  })

  it('molaar ja kaks väikest on kaks kapslit', () => {
    // 3 slots for the molar + 2 = 5 slots = ceil(5/3) = 2.
    expect(materialUnitCost(MIDAS, 2, 1)).toEqual({ kapsleid: 2, summa: 42 })
  })

  it('tühi töö ei ava ühtegi kapslit', () => {
    // The one case that rounds DOWN to zero.
    expect(materialUnitCost(MIDAS, 0, 0)).toEqual({ kapsleid: 0, summa: 0 })
  })
})

describe('materialUnitCost — millal ta keeldub', () => {
  it('ilma kapsli hinnata ei ütle midagi', () => {
    // null, not 0: "not priced by capsule" and "costs nothing" are different
    // answers, and only the caller knows to fall back to the per-tooth price.
    expect(materialUnitCost({}, 5, 0)).toBeNull()
    expect(materialUnitCost({ yhikMahutavus: 3 }, 5, 0)).toBeNull()
  })

  it('ilma mahutavuseta ei ütle midagi', () => {
    expect(materialUnitCost({ yhikHind: 21 }, 5, 0)).toBeNull()
  })

  it('vigane mahutavus ei jaga nulliga ega anna miinust', () => {
    for (const bad of [0, -3, NaN, Infinity]) {
      expect(materialUnitCost({ yhikHind: 21, yhikMahutavus: bad }, 5, 0), String(bad))
        .toBeNull()
    }
  })

  it('vigane hind lükatakse samamoodi tagasi', () => {
    for (const bad of [0, -21, NaN]) {
      expect(materialUnitCost({ yhikHind: bad, yhikMahutavus: 3 }, 5, 0), String(bad))
        .toBeNull()
    }
  })
})

describe('materialUnitCost — molaari slot', () => {
  it('vaikimisi täidab molaar terve kapsli', () => {
    // yhikSuurSlot absent → defaults to the whole capacity.
    expect(materialUnitCost({ yhikHind: 21, yhikMahutavus: 3 }, 0, 1))
      .toEqual({ kapsleid: 1, summa: 21 })
    expect(materialUnitCost({ yhikHind: 21, yhikMahutavus: 3 }, 0, 2))
      .toEqual({ kapsleid: 2, summa: 42 })
  })

  it('aga seda saab üle öelda, kui molaar võtab vähem', () => {
    // A lab whose molars take two slots, not three: two molars then share.
    const p = { yhikHind: 21, yhikMahutavus: 4, yhikSuurSlot: 2 }
    expect(materialUnitCost(p, 0, 2)).toEqual({ kapsleid: 1, summa: 21 })
    expect(materialUnitCost(p, 0, 3)).toEqual({ kapsleid: 2, summa: 42 })
  })

  it('eirab vigast slotti ja kasutab mahutavust', () => {
    expect(materialUnitCost({ yhikHind: 21, yhikMahutavus: 3, yhikSuurSlot: 0 }, 0, 1))
      .toEqual({ kapsleid: 1, summa: 21 })
  })
})
