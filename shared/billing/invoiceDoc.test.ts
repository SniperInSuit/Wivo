/**
 * The invoice is about to exist in two renderings — printed and emailed — and
 * they must say the same thing. These tests pin the DERIVED values, because
 * that is the half that can silently disagree; the markup differences are
 * visible the moment anyone looks.
 */
import { describe, it, expect } from 'vitest'
import { invoiceDoc, docDate, money, type DocInvoice, type DocClinic } from './invoiceDoc'

const clinic = (over: Partial<DocClinic> = {}): DocClinic => ({
  name: 'Fullgevity Dental OÜ',
  address: 'Pärnu mnt 1',
  postal_code: '10141',
  city: 'Tallinn',
  reg_code: '12345678',
  vat_number: 'EE101234567',
  phone: '+372 5555 5555',
  email: 'info@example.ee',
  bank_name: 'LHV Pank',
  bank_account: 'EE001234567890',
  ...over,
})

const invoice = (over: Partial<DocInvoice> = {}): DocInvoice => ({
  number: '2026-0007',
  status: 'saadetud',
  patsient: 'Mari Maasikas',
  issue_date: '2026-09-02',
  due_date: '2026-09-16',
  vat_rate: 22,
  net_total: 1000,
  vat_total: 220,
  gross_total: 1220,
  note: null,
  lines: [{ description: 'Kroon 11', qty: 1, unit_price: 400 }],
  payments: [],
  ...over,
})

describe('docDate', () => {
  it('turns an ISO date into the Estonian form', () => {
    expect(docDate('2026-09-02')).toBe('02.09.2026')
  })

  it('tolerates a full timestamp', () => {
    expect(docDate('2026-09-02T10:00:00Z')).toBe('02.09.2026')
  })

  it.each([null, undefined, '', '2026-09', 'eile', '2026-02-30'])(
    'refuses %p rather than guessing a date', (v) => {
      // A half-typed date guessed into a real one would put a due date on a
      // document nobody chose.
      expect(docDate(v as string | null)).toBe('—')
    })
})

describe('money', () => {
  it('always shows two decimals and the sign', () => {
    expect(money(1234.5)).toBe('1234.50 €')
    expect(money(0)).toBe('0.00 €')
  })

  it('reads a numeric string, because Postgres numerics arrive as strings', () => {
    expect(money('1220.00')).toBe('1220.00 €')
  })

  it('never produces NaN from junk', () => {
    expect(money(undefined)).toBe('0.00 €')
    expect(money('abc')).toBe('0.00 €')
  })
})

describe('invoiceDoc', () => {
  it('composes the seller block with blanks dropped', () => {
    const d = invoiceDoc(invoice(), clinic({ vat_number: null, phone: '  ' }))
    expect(d.seller.name).toBe('Fullgevity Dental OÜ')
    expect(d.seller.lines).toEqual([
      'Pärnu mnt 1', '10141 Tallinn', 'Reg nr 12345678', 'info@example.ee',
    ])
  })

  it('names what an Estonian invoice needs and this one lacks', () => {
    const d = invoiceDoc(invoice(), clinic({ reg_code: null, bank_account: '' }))
    expect(d.missing).toEqual(['registrikood', 'IBAN'])
  })

  it('reports everything missing when there is no clinic at all', () => {
    const d = invoiceDoc(invoice(), null)
    expect(d.missing).toEqual(['nimi', 'registrikood', 'IBAN', 'aadress'])
    expect(d.seller.name).toBe('—')
    expect(d.payment).toBeNull()
  })

  it('computes each line total from qty × unit price', () => {
    const d = invoiceDoc(invoice({
      lines: [
        { description: 'Kroon', qty: 3, unit_price: 370 },
        { description: 'Sild', qty: 1, unit_price: '250.5' },
      ],
    }), clinic())
    expect(d.lines[0].total).toBe(1110)
    expect(d.lines[0].totalText).toBe('1110.00 €')
    expect(d.lines[1].total).toBe(250.5)
  })

  it('shows the paid pair only once money has arrived', () => {
    const dry = invoiceDoc(invoice(), clinic())
    expect(dry.totals.showPaid).toBe(false)
    expect(dry.totals.due).toBe(1220)

    const wet = invoiceDoc(invoice({ payments: [{ amount: 500 }] }), clinic())
    expect(wet.totals.showPaid).toBe(true)
    expect(wet.totals.paid).toBe(500)
    expect(wet.totals.due).toBe(720)
  })

  it('never shows a negative outstanding on an overpayment', () => {
    const d = invoiceDoc(invoice({ payments: [{ amount: 1500 }] }), clinic())
    expect(d.totals.due).toBe(0)
  })

  it('owes nothing on a cancelled invoice, whatever was billed', () => {
    // The same rule `outstanding()` follows. Restated here because shared/
    // cannot import it — and pinned so the two cannot drift apart.
    const d = invoiceDoc(invoice({ status: 'tuhistatud' }), clinic())
    expect(d.cancelled).toBe(true)
    expect(d.totals.due).toBe(0)
  })

  it('carries the payment reference the bank transfer needs', () => {
    const d = invoiceDoc(invoice(), clinic())
    expect(d.payment).toEqual({
      bankName: 'LHV Pank',
      iban: 'EE001234567890',
      reference: 'arve 2026-0007',
    })
  })

  it('drops the payment block when the clinic has no bank details', () => {
    expect(invoiceDoc(invoice(), clinic({ bank_name: null, bank_account: null })).payment)
      .toBeNull()
  })

  it('labels the VAT rate as it was frozen on the document', () => {
    // Never re-read from settings: the rate on a sent invoice is history.
    const d = invoiceDoc(invoice({ vat_rate: '9' }), clinic())
    expect(d.totals.vatLabel).toBe('Käibemaks 9%')
  })

  it('treats a blank note as no note', () => {
    expect(invoiceDoc(invoice({ note: '   ' }), clinic()).note).toBeNull()
    expect(invoiceDoc(invoice({ note: 'Osamakse 3/5' }), clinic()).note).toBe('Osamakse 3/5')
  })

  it('says "—" for a missing due date rather than inventing one', () => {
    const d = invoiceDoc(invoice({ due_date: null }), clinic())
    expect(d.hasDueDate).toBe(false)
    expect(d.dueDate).toBe('—')
  })
})
