/**
 * The Edge Function `account-security` (sql/097): removing one's own
 * authenticator, and an owner resetting a member's two-factor sign-in.
 *
 * The caller check is our own and strict (the gateway's JWT check is off for
 * this function, as for send-notifications):
 *  1. The header must be `Bearer <a signed-in user's access token>`: a JWT
 *     whose payload says role = authenticated, with a user id, not expired.
 *     Keys of any kind (anon, service, sb_…) are refused before anything runs.
 *  2. The decision is the database's, made AS THAT USER: PostgREST checks the
 *     token's signature, and `authorize_mfa_removal` / `authorize_mfa_reset`
 *     check aal2, the proof, the owner, the organisation (sql/097).
 *  3. What the database returns must match the request and the token, or
 *     nothing happens.
 * Only then does the service key act: GoTrue's admin API removes the
 * factors, and `complete_mfa_change` writes the audit row and the
 * notification and, when needed, ends every session.
 *
 * No imports, so Deno and Vitest load it as it is.
 */

export interface RpcError { message: string; code?: string; hint?: string }
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>

export interface SecurityDeps {
  /** As the caller: their token, the anon key. */
  asUser: Rpc
  /** With the service key. */
  asService: Rpc
  /** GoTrue admin: remove one factor of one user. */
  deleteFactor: (userId: string, factorId: string) => Promise<{ error: { message: string } | null }>
  warn: (message: string) => void
  now?: () => number
}

export type ErrorCode =
  | 'sign_in' | 'bad_request' | 'mfa_required' | 'not_allowed' | 'proof_required' | 'wrong_password'
  | 'too_many_attempts' | 'nothing_to_reset' | 'failed' | 'not_recorded'

export interface Answer {
  status: number
  body: { ok: true; last: boolean; signedOut: boolean; removed: number } | { ok: false; error: ErrorCode; message?: string }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

function base64urlJson(part: string): Record<string, unknown> | null {
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const parsed: unknown = JSON.parse(atob(b64))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The user id in a signed-in user's access token, or null for anything else.
 * The signature is NOT checked here — PostgREST checks it on the first call;
 * this only refuses keys and junk before any call is made.
 */
export function userTokenSubject(authorization: string | null, nowMs = Date.now()): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization ?? '')
  if (!m) return null
  const payload = base64urlJson(m[1].split('.')[1])
  if (!payload || payload.role !== 'authenticated' || !isUuid(payload.sub)) return null
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null
  return payload.sub.toLowerCase()
}

export type SecurityRequest =
  | { action: 'remove'; factorId: string; password: string | null }
  | { action: 'reset'; userId: string; reason: string }

export function parseRequest(body: unknown): SecurityRequest | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.action === 'remove' && isUuid(b.factorId)) {
    if (b.password !== undefined && b.password !== null && (typeof b.password !== 'string' || b.password.length > 200)) return null
    return { action: 'remove', factorId: b.factorId.toLowerCase(), password: typeof b.password === 'string' && b.password ? b.password : null }
  }
  if (b.action === 'reset' && isUuid(b.userId) && typeof b.reason === 'string' && b.reason.length <= 500) {
    return { action: 'reset', userId: b.userId.toLowerCase(), reason: b.reason }
  }
  return null
}

const fail = (status: number, error: ErrorCode, message?: string): Answer =>
  ({ status, body: message ? { ok: false, error, message } : { ok: false, error } })

/** A refusal from the database, as the app should hear it. */
function refusal(e: RpcError): Answer {
  if (e.code?.startsWith('PGRST3') || /JWT/i.test(e.message)) return fail(401, 'sign_in')
  if (e.hint === 'mfa_required') return fail(403, 'mfa_required')
  if (e.hint === 'nothing_to_reset') return fail(409, 'nothing_to_reset', e.message)
  if (e.code === '22023') return fail(400, 'bad_request', e.message)
  return fail(403, 'not_allowed', e.message)
}

const SOFT: Record<string, Answer> = {
  proof_required: fail(403, 'proof_required'),
  wrong_password: fail(403, 'wrong_password'),
  too_many_attempts: fail(429, 'too_many_attempts'),
}

export async function handleSecurityRequest(authorization: string | null, body: unknown, deps: SecurityDeps): Promise<Answer> {
  const caller = userTokenSubject(authorization, (deps.now ?? Date.now)())
  if (!caller) return fail(401, 'sign_in')
  const req = parseRequest(body)
  if (!req) return fail(400, 'bad_request')
  return req.action === 'remove' ? remove(caller, req, deps) : reset(caller, req, deps)
}

async function remove(caller: string, req: Extract<SecurityRequest, { action: 'remove' }>, deps: SecurityDeps): Promise<Answer> {
  const { data, error } = await deps.asUser('authorize_mfa_removal', { p_factor: req.factorId, p_password: req.password })
  if (error) return refusal(error)
  const r = (data ?? {}) as Record<string, unknown>
  if (r.ok === false && typeof r.error === 'string' && SOFT[r.error]) return SOFT[r.error]
  // The database's answer must be about this caller and this factor, or nothing happens.
  if (r.ok !== true || r.user_id !== caller || r.factor_id !== req.factorId || !isUuid(r.org_id) || typeof r.last !== 'boolean') {
    deps.warn(`remove: unexpected answer from authorize_mfa_removal: ${JSON.stringify(r).slice(0, 200)}`)
    return fail(403, 'not_allowed')
  }

  const del = await deps.deleteFactor(caller, req.factorId)
  if (del.error) return fail(502, 'failed', del.error.message)

  const done = await deps.asService('complete_mfa_change', {
    p_kind: 'mfa_removed', p_org: r.org_id, p_actor: caller, p_target: caller,
    p_detail: { factor_id: req.factorId, name: r.name ?? '', how: r.how, last: r.last },
    p_sign_out: r.last,
  })
  if (done.error) {
    deps.warn(`remove: factor ${req.factorId} of ${caller} removed, NOT recorded: ${done.error.message}`)
    return fail(500, 'not_recorded', done.error.message)
  }
  return { status: 200, body: { ok: true, last: r.last, signedOut: r.last, removed: 1 } }
}

async function reset(caller: string, req: Extract<SecurityRequest, { action: 'reset' }>, deps: SecurityDeps): Promise<Answer> {
  const { data, error } = await deps.asUser('authorize_mfa_reset', { p_user: req.userId, p_reason: req.reason })
  if (error) return refusal(error)
  const r = (data ?? {}) as Record<string, unknown>
  const factors = Array.isArray(r.factor_ids) ? r.factor_ids : []
  if (r.ok !== true || r.actor_id !== caller || r.user_id !== req.userId || r.user_id === caller || !isUuid(r.org_id)
      || factors.length === 0 || !factors.every(isUuid)) {
    deps.warn(`reset: unexpected answer from authorize_mfa_reset: ${JSON.stringify(r).slice(0, 200)}`)
    return fail(403, 'not_allowed')
  }

  const removed: string[] = []
  let failure: string | null = null
  for (const f of factors as string[]) {
    const del = await deps.deleteFactor(req.userId, f)
    if (del.error) { failure = del.error.message; break }
    removed.push(f)
  }
  if (removed.length === 0) return fail(502, 'failed', failure ?? undefined)

  // Whatever was removed is recorded, and the member signed out, even when a
  // later factor could not be removed.
  const done = await deps.asService('complete_mfa_change', {
    p_kind: 'mfa_reset', p_org: r.org_id, p_actor: caller, p_target: req.userId,
    p_detail: { reason: r.reason ?? req.reason.trim(), factor_ids: removed, factors: removed.length },
    p_sign_out: true,
  })
  if (done.error) {
    deps.warn(`reset: ${removed.length} factor(s) of ${req.userId} removed, NOT recorded: ${done.error.message}`)
    return fail(500, 'not_recorded', done.error.message)
  }
  if (failure) return fail(502, 'failed', failure)
  return { status: 200, body: { ok: true, last: true, signedOut: true, removed: removed.length } }
}
