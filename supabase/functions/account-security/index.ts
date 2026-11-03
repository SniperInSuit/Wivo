/**
 * Settings → Security, the part the browser must not do itself (sql/097):
 *   { action: 'remove', factorId, password? }  one's own authenticator
 *   { action: 'reset', userId, reason }        an owner, for a member
 *
 * The work and the caller check are in ../_shared/accountSecurity.ts
 * (tested). The gateway's JWT check is OFF (verify_jwt = false in
 * supabase/config.toml; deploy with --no-verify-jwt): the caller's token is
 * checked by PostgREST on the first call, made as that user, and the database
 * decides. Only then does the service key remove factors (GoTrue admin API)
 * and write the record.
 *
 * Env (the platform's): SUPABASE_URL, SUPABASE_ANON_KEY, and the service key
 * as for send-notifications (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEYS
 * / WIVO_SERVICE_SECRET_KEY).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { handleSecurityRequest } from '../_shared/accountSecurity.ts'
import { serviceClientKey } from '../_shared/serviceAuth.ts'

const env = (name: string) => Deno.env.get(name)
const URL_ = env('SUPABASE_URL') ?? ''
const noSession = { persistSession: false, autoRefreshToken: false }

const service = createClient(URL_, serviceClientKey(env), { auth: noSession })

// A bearer token, not a cookie: any origin may ask, only a signed-in user gets an answer.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { ok: false, error: 'bad_request' })

  const authorization = req.headers.get('Authorization')
  let body: unknown = null
  try { body = await req.json() } catch { /* answered as bad_request */ }

  const asUser = createClient(URL_, env('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization ?? '' } }, auth: noSession,
  })
  const answer = await handleSecurityRequest(authorization, body, {
    asUser: async (fn, args) => await asUser.rpc(fn, args),
    asService: async (fn, args) => await service.rpc(fn, args),
    deleteFactor: async (userId, factorId) => {
      const { error } = await service.auth.admin.mfa.deleteFactor({ id: factorId, userId })
      return { error: error ? { message: error.message } : null }
    },
    warn: message => console.warn(`[account-security] ${message}`),
  })
  return json(answer.status, answer.body)
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
