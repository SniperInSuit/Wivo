import { describe, it, expect } from 'vitest'
import { clinicCountry, hasEstonianTax, invoicesAvailable } from './country'

describe("the clinic's country", () => {
  it('Estonian until the clinic says otherwise, as every clinic was before', () => {
    expect(clinicCountry(null)).toBe('EE')
    expect(clinicCountry({})).toBe('EE')
    expect(clinicCountry({ country: '' })).toBe('EE')
    expect(clinicCountry({ country: 'lv' })).toBe('LV')
  })

  it('Estonian tax and invoices only in Estonia; Latvia, or any other country, gets neither', () => {
    expect(hasEstonianTax('EE')).toBe(true)
    expect(invoicesAvailable('EE')).toBe(true)
    for (const c of ['LV', 'LT', 'FI']) {
      expect(hasEstonianTax(c)).toBe(false)
      expect(invoicesAvailable(c)).toBe(false)
    }
  })
})
