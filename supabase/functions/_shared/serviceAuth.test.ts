/**
 * The service-key check send-notifications relies on once the gateway's JWT
 * check is off (serviceAuth.ts). It must let in exactly this project's
 * service key — legacy JWT or sb_secret — and nothing else.
 */
import { describe, it, expect } from 'vitest'
import { isServiceRequest, acceptedServiceKeys, serviceClientKey, isServiceRoleJwt, isSecretKey, type Env } from './serviceAuth'

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (payload: object) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJlLWZvci10ZXN0cw`

const SERVICE_JWT = jwt({ iss: 'supabase', ref: 'jhqyvancrzykxhzwnost', role: 'service_role', exp: 2000000000 })
const ANON_JWT = jwt({ iss: 'supabase', ref: 'jhqyvancrzykxhzwnost', role: 'anon', exp: 2000000000 })
const OTHER_SERVICE_JWT = jwt({ iss: 'supabase', ref: 'wrtucsfmpbwekugzzzxw', role: 'service_role', exp: 2000000000 })
const SECRET = 'sb_secret_test_0123456789abcdef'
const PUBLISHABLE = 'sb_publishable_test_0123456789abcdef'

const envOf = (vars: Record<string, string>): Env => name => vars[name]
const bearer = (k: string) => `Bearer ${k}`

describe('isServiceRequest: this project\'s service key, nothing else', () => {
  const env = envOf({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_JWT, SUPABASE_ANON_KEY: ANON_JWT })

  it('accepts the legacy service_role JWT the function was given', () => {
    expect(isServiceRequest(bearer(SERVICE_JWT), env)).toBe(true)
  })

  it('refuses the anon key, another project\'s service key, a publishable key, garbage', () => {
    for (const k of [ANON_JWT, OTHER_SERVICE_JWT, PUBLISHABLE, SECRET, 'x', SERVICE_JWT.slice(0, -1), `${SERVICE_JWT}x`]) {
      expect(isServiceRequest(bearer(k), env)).toBe(false)
    }
  })

  it('refuses a missing or malformed header', () => {
    for (const h of [null, '', SERVICE_JWT, `bearer${SERVICE_JWT}`, `Basic ${SERVICE_JWT}`, `Bearer ${SERVICE_JWT} extra`, `Bearer  ${SERVICE_JWT}`, 'Bearer ']) {
      expect(isServiceRequest(h, env)).toBe(false)
    }
  })

  it('accepts a new secret key from the platform (object, array or plain) or from WIVO_SERVICE_SECRET_KEY', () => {
    for (const vars of [
      { SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }) },
      { SUPABASE_SECRET_KEYS: JSON.stringify([SECRET]) },
      { SUPABASE_SECRET_KEYS: SECRET },
      { WIVO_SERVICE_SECRET_KEY: SECRET },
    ]) {
      const e = envOf({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_JWT, ...vars })
      expect(isServiceRequest(bearer(SECRET), e)).toBe(true)
      expect(isServiceRequest(bearer(SERVICE_JWT), e)).toBe(true)
      expect(isServiceRequest(bearer(PUBLISHABLE), e)).toBe(false)
    }
  })

  it('a publishable key or a too-short value configured as "secret" is never accepted', () => {
    const e = envOf({ SUPABASE_SECRET_KEYS: JSON.stringify({ a: PUBLISHABLE, b: 'sb_secret_' }), WIVO_SERVICE_SECRET_KEY: PUBLISHABLE })
    expect(acceptedServiceKeys(e)).toEqual([])
    expect(isServiceRequest(bearer(PUBLISHABLE), e)).toBe(false)
  })

  it('an anon key in the service-role slot is not accepted (misconfiguration fails closed)', () => {
    const e = envOf({ SUPABASE_SERVICE_ROLE_KEY: ANON_JWT })
    expect(acceptedServiceKeys(e)).toEqual([])
    expect(isServiceRequest(bearer(ANON_JWT), e)).toBe(false)
  })

  it('with no key configured, everything is refused', () => {
    expect(isServiceRequest(bearer(SERVICE_JWT), envOf({}))).toBe(false)
    expect(isServiceRequest('Bearer ', envOf({}))).toBe(false)
  })
})

describe('the key the function\'s own database client uses', () => {
  it('a new secret key when there is one, else the legacy JWT, else nothing', () => {
    expect(serviceClientKey(envOf({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_JWT, WIVO_SERVICE_SECRET_KEY: SECRET }))).toBe(SECRET)
    expect(serviceClientKey(envOf({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_JWT }))).toBe(SERVICE_JWT)
    expect(serviceClientKey(envOf({}))).toBe('')
  })
})

it('key shapes', () => {
  expect(isServiceRoleJwt(SERVICE_JWT)).toBe(true)
  expect(isServiceRoleJwt(ANON_JWT)).toBe(false)
  expect(isServiceRoleJwt('a.b')).toBe(false)
  expect(isServiceRoleJwt('a.!!!.c')).toBe(false)
  expect(isSecretKey(SECRET)).toBe(true)
  expect(isSecretKey(PUBLISHABLE)).toBe(false)
})
