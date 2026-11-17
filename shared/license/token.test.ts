import { describe, expect, it } from 'vitest'
import {
  LICENCE_SIGNING_DOMAIN, MODULE_KEYS, b64urlDecode, b64urlEncode, encodePayload,
  licenceAllowsApi, licenceAllowsWrites, licenceApiOrigins, licenceModules,
  licenceStatus, moduleSetProblem, normaliseOrigin, parseToken, signingInput,
  utf8Decode, utf8Encode, type LicencePayload,
} from './token'

const payload: LicencePayload = {
  v: 1, name: 'Hambalabor OÜ', plan: 'labor', seats: 5,
  iat: '2026-01-01', exp: '2026-12-31',
}

const ORG = '8f14e45f-ceea-467a-9b71-1c4a9c0e8b2d'

const v2 = (over: Partial<LicencePayload> = {}): LicencePayload => ({
  ...payload, v: 2, org: ORG, api: ['https://abc.supabase.co'], modules: ['jobs', 'payroll'],
  ...over,
})

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
    ['version from the future', `WIVO1.${b64urlEncode(utf8Encode(JSON.stringify({ ...payload, v: 3 })))}.AAAA`],
    // v2 exists to carry org and modules. One without them is malformed, and
    // reading it as "all modules" would turn a broken file into a full licence.
    ['v2 with no org', `WIVO1.${b64urlEncode(utf8Encode(JSON.stringify({ ...payload, v: 2, modules: ['jobs'] })))}.AAAA`],
    ['v2 with no modules', `WIVO1.${b64urlEncode(utf8Encode(JSON.stringify({ ...payload, v: 2, org: ORG })))}.AAAA`],
    ['api that is not a list', `WIVO1.${b64urlEncode(utf8Encode(JSON.stringify({ ...payload, api: 'https://a.example' })))}.AAAA`],
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

describe('v2: the modules a licence allows', () => {
  it('reads back what was issued', () => {
    expect([...licenceModules(v2())].sort()).toEqual(['jobs', 'payroll'])
  })

  it('a v1 key means EVERYTHING — nobody\'s licence narrows because we added a field', () => {
    expect([...licenceModules(payload)].sort()).toEqual([...MODULE_KEYS].sort())
  })

  it('no key at all also means everything: an unlicensed build is not a crippled one', () => {
    expect([...licenceModules(null)].sort()).toEqual([...MODULE_KEYS].sort())
  })

  it('an empty list means nothing, and is not confused with an absent one', () => {
    expect([...licenceModules(v2({ modules: [] }))]).toEqual([])
  })

  it('ignores a module this build has not heard of instead of refusing the key', () => {
    // A key signed by a newer tool must not lock a clinic out of the modules
    // this build does know.
    expect([...licenceModules(v2({ modules: ['jobs', 'teleport'] }))]).toEqual(['jobs'])
  })

  it('a v2 token survives the round trip through parseToken', () => {
    const parsed = parseToken(`WIVO1.${encodePayload(v2())}.AAAA`)
    expect(parsed?.payload.org).toBe(ORG)
    expect([...licenceModules(parsed!.payload)]).toEqual(['jobs', 'payroll'])
  })
})

describe('moduleSetProblem — what the issuing tool refuses', () => {
  it('passes a plain set', () => {
    expect(moduleSetProblem(['jobs', 'payroll'])).toBeNull()
  })

  it('passes the whole list', () => {
    expect(moduleSetProblem([...MODULE_KEYS])).toBeNull()
  })

  it('refuses ratings without jobs — a rating is given on a job', () => {
    expect(moduleSetProblem(['ratings', 'payroll'])).toMatch(/ratings needs jobs/)
  })

  it('accepts ratings with jobs', () => {
    expect(moduleSetProblem(['jobs', 'ratings'])).toBeNull()
  })

  it('refuses a name that does not exist, so a typo is not a quiet downgrade', () => {
    expect(moduleSetProblem(['jobs', 'payrol'])).toMatch(/unknown module: payrol/)
  })
})

describe('normaliseOrigin', () => {
  it.each([
    ['https://abc.supabase.co', 'https://abc.supabase.co'],
    ['https://abc.supabase.co/', 'https://abc.supabase.co'],
    ['https://abc.supabase.co/rest/v1/jobs?x=1', 'https://abc.supabase.co'],
    ['HTTPS://ABC.Supabase.CO', 'https://abc.supabase.co'],
    ['https://abc.supabase.co:443', 'https://abc.supabase.co'],
    ['http://127.0.0.1:54321', 'http://127.0.0.1:54321'],
    ['http://localhost:80', 'http://localhost'],
    ['https://wivo.dentiks.lv', 'https://wivo.dentiks.lv'],
    ['http://[::1]:8000', 'http://[::1]:8000'],
  ])('reduces %s to %s', (input, expected) => {
    expect(normaliseOrigin(input)).toBe(expected)
  })

  it.each(['', '   ', 'abc.supabase.co', '/rest/v1', 'https://', 'https://host:port'])(
    'returns null for %s, rather than guessing', input => {
      expect(normaliseOrigin(input)).toBeNull()
    })
})

describe('the allowed API address', () => {
  it('allows the address it was issued for, however it is written', () => {
    expect(licenceAllowsApi(v2(), 'https://ABC.supabase.co/rest/v1/jobs')).toBe(true)
  })

  it('refuses another project — a copied key does not work elsewhere', () => {
    expect(licenceAllowsApi(v2(), 'https://other.supabase.co')).toBe(false)
  })

  it('allows either address while a clinic is moving to its own server', () => {
    const moving = v2({ api: ['https://abc.supabase.co', 'https://wivo.dentiks.lv'] })
    expect(licenceAllowsApi(moving, 'https://abc.supabase.co')).toBe(true)
    expect(licenceAllowsApi(moving, 'https://wivo.dentiks.lv')).toBe(true)
    expect(licenceAllowsApi(moving, 'https://wivo.dentiks.lv.evil.example')).toBe(false)
  })

  it('refuses an unreadable address rather than passing it through', () => {
    expect(licenceAllowsApi(v2(), 'not an address')).toBe(false)
  })

  it.each([
    ['no licence at all (an unlicensed build)', null],
    ['a v1 key, issued before the field existed', payload],
  ])('allows anything with %s', (_label, p) => {
    expect(licenceAllowsApi(p, 'https://anything.example')).toBe(true)
  })

  it('an empty list is no restriction, not a lockout', () => {
    expect(licenceAllowsApi(v2({ api: [] }), 'https://anything.example')).toBe(true)
    expect(licenceApiOrigins(v2({ api: [] }))).toEqual([])
  })

  it('drops an entry that is not an address, and de-duplicates', () => {
    expect(licenceApiOrigins(v2({ api: ['https://a.example', 'nonsense', 'https://A.example/'] })))
      .toEqual(['https://a.example'])
  })
})

describe('domain separation: a licence signature is not an update signature', () => {
  const b64 = encodePayload(v2())

  it('v2 signs the licence prefix', () => {
    expect(utf8Decode(signingInput(b64, 2))).toBe(`${LICENCE_SIGNING_DOMAIN}\nWIVO1.${b64}`)
  })

  it('v1 signs what it always signed — an issued key must not stop working', () => {
    expect(utf8Decode(signingInput(b64, 1))).toBe(`WIVO1.${b64}`)
  })

  it('the two are different bytes, so one signature cannot serve both roles', () => {
    expect([...signingInput(b64, 2)]).not.toEqual([...signingInput(b64, 1)])
  })

  it('defaults to v1, the shape that existed before the argument did', () => {
    expect([...signingInput(b64)]).toEqual([...signingInput(b64, 1)])
  })
})
