import { describe, expect, it } from 'vitest'
import {
  b64urlDecode, b64urlEncode, encodePayload, licenceAllowsWrites, licenceStatus,
  parseToken, utf8Decode, utf8Encode, type LicencePayload,
} from './token'

const payload: LicencePayload = {
  v: 1, name: 'Hambalabor OÜ', plan: 'labor', seats: 5,
  iat: '2026-01-01', exp: '2026-12-31',
}

describe('base64url and utf8 round-trip', () => {
  it('survives every byte value', () => {
    const bytes = new Uint8Array(256).map((_, i) => i)
    expect([...b64urlDecode(b64urlEncode(bytes))]).toEqual([...bytes])
  })

  it('survives lengths either side of the 3-byte block', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37) & 0xff)
      expect([...b64urlDecode(b64urlEncode(bytes))]).toEqual([...bytes])
    }
  })

  it('survives Estonian letters and emoji — the payload carries a lab name', () => {
    const s = 'Hambalabor OÜ — Tõnu & Šveits 🦷'
    expect(utf8Decode(utf8Encode(s))).toBe(s)
  })

  it('emits no characters that need URL escaping', () => {
    const bytes = new Uint8Array(300).map((_, i) => (i * 7) & 0xff)
    expect(b64urlEncode(bytes)).toMatch(/^[A-Za-z0-9\-_]*$/)
  })
})

describe('parseToken rejects rather than throws', () => {
  const good = `WIVO1.${encodePayload(payload)}.AAAA`

  it('parses a well-formed token', () => {
    expect(parseToken(good)?.payload.name).toBe('Hambalabor OÜ')
  })

  it.each([
    ['empty', ''],
    ['no dots', 'WIVO1'],
    ['wrong prefix', `WIVO2.${encodePayload(payload)}.AAAA`],
    ['too few parts', `WIVO1.${encodePayload(payload)}`],
    ['payload not json', 'WIVO1.bm90anNvbg.AAAA'],
    ['wrong version', `WIVO1.${b64urlEncode(utf8Encode(JSON.stringify({ ...payload, v: 2 })))}.AAAA`],
  ])('returns null for %s', (_label, token) => {
    expect(parseToken(token)).toBeNull()
  })
})

describe('licenceStatus', () => {
  const on = (d: string) => licenceStatus(payload, new Date(`${d}T12:00:00Z`))

  it('is active well before expiry', () => {
    expect(on('2026-06-01').state).toBe('active')
  })

  it('is still active ON the expiry date — exp is inclusive', () => {
    const s = on('2026-12-31')
    expect(s.state).toBe('active')
    expect(s.daysLeft).toBe(0)
  })

  it('enters grace the day after expiry', () => {
    const s = on('2027-01-01')
    expect(s.state).toBe('grace')
    expect(s.graceLeft).toBe(13)
  })

  it('is still in grace on the last grace day', () => {
    expect(on('2027-01-14').state).toBe('grace')
  })

  it('expires the day after grace runs out', () => {
    expect(on('2027-01-15').state).toBe('expired')
  })

  it('reports missing when there is no key', () => {
    expect(licenceStatus(null, new Date()).state).toBe('missing')
  })

  it('does not flip at a timezone boundary — exp is a date, not an instant', () => {
    // 23:00 UTC on the expiry date is midday the next day in some zones. The
    // key must not stop working because of where the laptop thinks it is.
    expect(licenceStatus(payload, new Date('2026-12-31T23:00:00Z')).state).toBe('active')
    expect(licenceStatus(payload, new Date('2026-12-31T00:30:00Z')).state).toBe('active')
  })
})

describe('licenceAllowsWrites', () => {
  it('allows writing during grace — a lab must be able to invoice work it did', () => {
    expect(licenceAllowsWrites(licenceStatus(payload, new Date('2027-01-05')))).toBe(true)
  })

  it.each(['missing', 'expired'] as const)('blocks writing when %s', state => {
    const s = state === 'missing'
      ? licenceStatus(null, new Date())
      : licenceStatus(payload, new Date('2027-02-01'))
    expect(s.state).toBe(state)
    expect(licenceAllowsWrites(s)).toBe(false)
  })
})
