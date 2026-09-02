import { describe, it, expect } from 'vitest'
import { acceptPayment, refusalStatus, PAID } from './montonioClaims'
import type { MontonioClaims } from './montonioClaims'

const EXPECTED = { accessKey: 'ak_live_1', uuid: 'ord-1', summa: 20, valuuta: 'EUR' }

const token = (over: Partial<MontonioClaims> = {}): MontonioClaims => ({
  accessKey: 'ak_live_1',
  uuid: 'ord-1',
  paymentStatus: PAID,
  grandTotal: 20,
  currency: 'EUR',
  ...over,
})

describe('acceptPayment — millal raha lugeda laekunuks', () => {
  it('võtab vastu õige tokeni', () => {
    expect(acceptPayment(token(), EXPECTED)).toEqual({ ok: true, uuid: 'ord-1' })
  })

  it('keeldub teise Montonio konto tokenist', () => {
    // A token signed by Montonio for a DIFFERENT merchant is a real thing.
    const v = acceptPayment(token({ accessKey: 'ak_live_KEEGI_TEINE' }), EXPECTED)
    expect(v).toMatchObject({ ok: false, reason: 'vale-konto' })
  })

  it('keeldub teise tellimuse tokenist — see on kordusrünne', () => {
    // Without this, a token from any of our own other orders settles this one.
    const v = acceptPayment(token({ uuid: 'ord-99' }), EXPECTED)
    expect(v).toMatchObject({ ok: false, reason: 'vale-tellimus' })
  })

  it('ei loe maksmata tellimust makstuks', () => {
    for (const s of ['PENDING', 'ABANDONED', 'VOIDED', 'paid', '']) {
      expect(acceptPayment(token({ paymentStatus: s }), EXPECTED).ok, s).toBe(false)
    }
  })

  it('keeldub liiga väiksest summast', () => {
    // Quietly accepting a short payment is accepting a short payment.
    const v = acceptPayment(token({ grandTotal: 1 }), EXPECTED)
    expect(v).toMatchObject({ ok: false, reason: 'vale-summa' })
  })

  it('lubab sendi ümardusvahe, mitte rohkem', () => {
    expect(acceptPayment(token({ grandTotal: 20.004 }), EXPECTED).ok).toBe(true)
    expect(acceptPayment(token({ grandTotal: 20.02 }), EXPECTED).ok).toBe(false)
  })

  it('võtab summa vastu ka tekstina — JWT-s võib ta nii tulla', () => {
    expect(acceptPayment(token({ grandTotal: '20.00' }), EXPECTED).ok).toBe(true)
    expect(acceptPayment(token({ grandTotal: 'kakskümmend' }), EXPECTED))
      .toMatchObject({ ok: false, reason: 'puudulik' })
  })

  it('keeldub vale valuutast', () => {
    expect(acceptPayment(token({ currency: 'PLN' }), EXPECTED))
      .toMatchObject({ ok: false, reason: 'vale-valuuta' })
    // Case is Montonio's business, not a reason to refuse money.
    expect(acceptPayment(token({ currency: 'eur' }), EXPECTED).ok).toBe(true)
  })

  it('keeldub poolikust tokenist, mitte ei oleta', () => {
    expect(acceptPayment({}, EXPECTED)).toMatchObject({ ok: false, reason: 'puudulik' })
    expect(acceptPayment(token({ uuid: undefined }), EXPECTED))
      .toMatchObject({ ok: false, reason: 'puudulik' })
    expect(acceptPayment(null as unknown as MontonioClaims, EXPECTED))
      .toMatchObject({ ok: false, reason: 'puudulik' })
  })

  it('kontrollib konto ENNE tellimust', () => {
    // Order matters for the message the clinic reads: a foreign token is a
    // different problem from our own replayed one.
    const v = acceptPayment(token({ accessKey: 'muu', uuid: 'ka-muu' }), EXPECTED)
    expect(v).toMatchObject({ reason: 'vale-konto' })
  })
})

describe('refusalStatus — mida rea peale kirjutada', () => {
  it('meelt muutnud inimene ei ole tõrge', () => {
    expect(refusalStatus('maksmata', 'ABANDONED')).toBe('tuhistatud')
    expect(refusalStatus('maksmata', 'VOIDED')).toBe('tuhistatud')
  })

  it('pooleli makse jääb ootele', () => {
    expect(refusalStatus('maksmata', 'PENDING')).toBe('ootel')
    expect(refusalStatus('maksmata', 'CREATED')).toBe('ootel')
  })

  it('vale konto või tellimus EI ole lihtsalt maksmata', () => {
    // These must not blend into the ordinary "didn't pay" pile — somebody
    // should look at them.
    expect(refusalStatus('vale-konto')).toBe('ebaonnestus')
    expect(refusalStatus('vale-tellimus')).toBe('ebaonnestus')
    expect(refusalStatus('vale-summa')).toBe('ebaonnestus')
  })

  it('tundmatu staatus loetakse tõrkeks, mitte ootamiseks', () => {
    expect(refusalStatus('maksmata', 'MIDAGI_UUT')).toBe('ebaonnestus')
    expect(refusalStatus('maksmata', undefined)).toBe('ebaonnestus')
  })
})
