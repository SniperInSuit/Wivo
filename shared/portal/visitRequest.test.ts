import { describe, it, expect } from 'vitest'
import {
  visitRequestProblems, looksLikeSpam, toVisitRequestRow, looksLikeEmail, looksLikePhone,
  SONUM_MAX,
} from './visitRequest'
import type { VisitRequestInput } from './visitRequest'

const good = (over: Partial<VisitRequestInput> = {}): VisitRequestInput => ({
  nimi: 'Mari Maasikas',
  telefon: '+372 5551 2345',
  idempotencyKey: 'form-abc-123',
  ...over,
})

describe('visitRequestProblems — what may be sent', () => {
  it('accepts a name, a phone and a key', () => {
    expect(visitRequestProblems(good())).toEqual([])
  })

  it('requires a phone rather than an email', () => {
    // A clinic rings back, and plenty of people have no email they read.
    expect(visitRequestProblems(good({ telefon: '' }))).toContain('Telefoninumber on puudu.')
    expect(visitRequestProblems(good({ email: undefined }))).toEqual([])
  })

  it('reports every problem at once, never just the first', () => {
    const p = visitRequestProblems({ nimi: '', telefon: '', idempotencyKey: '' })
    expect(p.length).toBe(3)
  })

  it('refuses a message longer than the cap', () => {
    expect(visitRequestProblems(good({ sonum: 'x'.repeat(SONUM_MAX + 1) })))
      .toContain(`Sõnum on liiga pikk (kuni ${SONUM_MAX} tähemärki).`)
    expect(visitRequestProblems(good({ sonum: 'x'.repeat(SONUM_MAX) }))).toEqual([])
  })

  it('demands the idempotency key — without it a double-click is two requests', () => {
    expect(visitRequestProblems(good({ idempotencyKey: '  ' })))
      .toContain('Vormi võti on puudu.')
  })
})

describe('looksLikeSpam — the honeypot', () => {
  it('passes a submission that left the hidden field alone', () => {
    expect(looksLikeSpam(good())).toBe(false)
    expect(looksLikeSpam(good({ veebileht: '' }))).toBe(false)
  })

  it('catches one that filled it', () => {
    expect(looksLikeSpam(good({ veebileht: 'http://spam.example' }))).toBe(true)
  })
})

describe('looksLikePhone — loose on purpose', () => {
  it('accepts how people actually type a number', () => {
    for (const n of ['+372 5551 2345', '55512345', '(+372) 555-1234', '5551.2345']) {
      expect(looksLikePhone(n), n).toBe(true)
    }
  })

  it('rejects text and absurd lengths', () => {
    for (const n of ['helista mulle', '123', '1'.repeat(16), '']) {
      expect(looksLikePhone(n), n).toBe(false)
    }
  })
})

describe('looksLikeEmail', () => {
  it('rejects a comma or semicolon — that is header smuggling, not an address', () => {
    expect(looksLikeEmail('a@b.ee,c@d.ee')).toBe(false)
    expect(looksLikeEmail('a@b.ee;c@d.ee')).toBe(false)
    expect(looksLikeEmail('a@b.ee')).toBe(true)
  })
})

describe('toVisitRequestRow — what is stored', () => {
  it('drops the honeypot rather than storing it', () => {
    const row = toVisitRequestRow(good({ veebileht: 'spam' }))
    expect(JSON.stringify(row)).not.toContain('spam')
    expect('veebileht' in row).toBe(false)
  })

  it('truncates instead of losing the request', () => {
    // The check constraint would answer 400 characters with a 500. The honest
    // answer is to keep 300 of them.
    const row = toVisitRequestRow(good({ sonum: 'x'.repeat(400) }))
    expect(row.sonum?.length).toBe(SONUM_MAX)
  })

  it('stores empty optional fields as null, not as empty strings', () => {
    const row = toVisitRequestRow(good({ email: '  ', sonum: '', serviceId: undefined }))
    expect(row.email).toBeNull()
    expect(row.sonum).toBeNull()
    expect(row.service_id).toBeNull()
  })

  it('trims what it keeps', () => {
    expect(toVisitRequestRow(good({ nimi: '  Mari  ' })).nimi).toBe('Mari')
  })
})
