/**
 * "Is this request from this project's service role?" — for functions that
 * run with the gateway's JWT check OFF (`verify_jwt = false`) and must do the
 * whole check themselves. send-notifications is one: the gateway answered
 * 401 UNAUTHORIZED_LEGACY_JWT to the cron's legacy service_role JWT before
 * our code ran (docs/night-run/RUN-4.md).
 *
 * Accepted, and nothing else:
 *  - the legacy service_role JWT, exactly as the platform gives it to the
 *    function (`SUPABASE_SERVICE_ROLE_KEY`), and only if its payload really
 *    says role = service_role (an anon key in that slot is never accepted);
 *  - a new secret key (`sb_secret_…`), from the platform's
 *    `SUPABASE_SECRET_KEYS` when it provides it, or from our own function
 *    secret `WIVO_SERVICE_SECRET_KEY` (names starting SUPABASE_ cannot be set
 *    by us). A publishable key (`sb_publishable_…`) never.
 *
 * The header must be exactly `Bearer <key>`. Keys are compared in constant
 * time. With no key configured, every request is refused.
 *
 * No imports, so Deno and Vitest load it as it is.
 */

export type Env = (name: string) => string | undefined

const SECRET_PREFIX = 'sb_secret_'

function base64urlJson(part: string): Record<string, unknown> | null {
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const parsed: unknown = JSON.parse(atob(b64))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A JWT (three parts) whose payload says role = service_role. The signature is the platform's to check. */
export function isServiceRoleJwt(key: string | undefined): key is string {
  if (!key) return false
  const parts = key.split('.')
  return parts.length === 3 && parts.every(p => p.length > 0) && base64urlJson(parts[1])?.role === 'service_role'
}

export function isSecretKey(key: string | undefined): key is string {
  return !!key && key.startsWith(SECRET_PREFIX) && key.length > SECRET_PREFIX.length + 8
}

/** `SUPABASE_SECRET_KEYS` may be a JSON object of name → key, a JSON array, or one key. */
function platformSecretKeys(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
    if (v && typeof v === 'object') return Object.values(v).filter((x): x is string => typeof x === 'string')
    if (typeof v === 'string') return [v]
  } catch { /* not JSON: a plain list */ }
  return raw.split(',').map(s => s.trim())
}

/** Every key that counts as this project's service role, as configured for the function. */
export function acceptedServiceKeys(env: Env): string[] {
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY')
  return [
    ...(isServiceRoleJwt(legacy) ? [legacy] : []),
    ...platformSecretKeys(env('SUPABASE_SECRET_KEYS')).filter(isSecretKey),
    ...[env('WIVO_SERVICE_SECRET_KEY')].filter(isSecretKey),
  ]
}

/** The key the function's own database client uses: a new secret key when there is one, else the legacy JWT. */
export function serviceClientKey(env: Env): string {
  const keys = acceptedServiceKeys(env)
  return keys.find(isSecretKey) ?? keys[0] ?? ''
}

/** Same length and same characters, without stopping at the first difference. */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export function isServiceRequest(authorization: string | null, env: Env): boolean {
  const m = /^Bearer ([^\s]+)$/.exec(authorization ?? '')
  if (!m) return false
  const token = m[1]
  let ok = false
  for (const key of acceptedServiceKeys(env)) ok = safeEqual(key, token) || ok  // check them all, whatever matches
  return ok
}
