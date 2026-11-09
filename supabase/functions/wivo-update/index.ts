/**
 * wivo-update: each clinic's own updater (docs/ARCHITECTURE-INSTANCES.md 5b, 5g).
 *   { action: 'check' }               the project's scheduled job (its service key), or an approver
 *   { action: 'install', version }    an approver, with a code under 5 minutes old
 *
 * Everything that decides is in ../_shared/wivoUpdate.ts, tested against the
 * real migrations. This file only connects it: the project's own database
 * connection (SUPABASE_DB_URL, which Supabase gives every Edge Function), the
 * network, the pinned roots and the published addresses (shared/release, in
 * this function's own code), and the caller's token, which the database
 * checks (update_approval, sql/120).
 *
 * The gateway's JWT check is OFF (verify_jwt = false in supabase/config.toml;
 * deploy with --no-verify-jwt), as for account-security: the caller's token
 * is checked by PostgREST on the first call, made as that user.
 *
 * Env (the platform's): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_DB_URL, and
 * the service key as for send-notifications.
 */
import postgres from 'npm:postgres@3.4.5'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { handleUpdateRequest, limitedFetcher, type Db } from '../_shared/wivoUpdate.ts'
import { PINNED_ROOTS, UPDATE_SOURCES } from '../_shared/generated/release.ts'
import { isServiceRequest } from '../_shared/serviceAuth.ts'
import { APP_ALLOWED_HEADERS, callerVersionHeaders } from '../_shared/appVersion.ts'

const env = (name: string) => Deno.env.get(name)
const noSession = { persistSession: false, autoRefreshToken: false }

// A bearer token, not a cookie: any origin may ask, only an approver or the project's own job gets an answer.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': APP_ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** postgres.js behind the small Db that wivoUpdate.ts asks for. A migration runs by the simple protocol: several statements, no parameters. */
// deno-lint-ignore no-explicit-any
const asDb = (sql: any): Db => ({
  query: async (text, params = []) => ({ rows: [...await sql.unsafe(text, params)] }),
  exec: async text => { await sql.unsafe(text).simple() },
  transaction: fn => sql.begin((tx: unknown) => fn(asDb(tx))),
})

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { ok: false, error: 'bad_request' })

  const authorization = req.headers.get('Authorization')
  let body: unknown = null
  try { body = await req.json() } catch { /* answered as bad_request */ }

  // Lazy: nothing connects until a query needs it, so a bad request opens no connection.
  const sql = postgres(env('SUPABASE_DB_URL') ?? '', { max: 1, prepare: false, onnotice: () => {} })
  const asUser = createClient(env('SUPABASE_URL') ?? '', env('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization ?? '', ...callerVersionHeaders(req) } }, auth: noSession,
  })
  try {
    const answer = await handleUpdateRequest(authorization, body, {
      updater: { db: asDb(sql), fetch: limitedFetcher(fetch), pinned: PINNED_ROOTS, sources: UPDATE_SOURCES },
      isService: a => isServiceRequest(a, env),
      asUser: fn => asUser.rpc(fn),
    })
    return json(answer.status, answer.body)
  } catch (e) {
    // The code only: an error's text can quote data.
    const code = (e as { code?: unknown }).code
    console.error(`[wivo-update] failed: ${typeof code === 'string' ? code : 'error'}`)
    return json(500, { ok: false, error: 'failed' })
  } finally {
    await sql.end({ timeout: 5 })
  }
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
