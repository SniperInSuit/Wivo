/**
 * A short-lived download link (spec: "download goes through an RPC that makes
 * a short-lived link and an audit row").
 *
 * Signing in the app let the CLIENT choose how long a link lives. Here the
 * function first calls `request_file_download` AS THE USER — so their rights
 * are checked and the audit row is written exactly as before — and only then
 * signs a 60-second link with the service key. The user never chooses the
 * lifetime.
 *
 * Deploy: `supabase functions deploy file-link`. Once every app build uses it,
 * drop the grant-based read policy on storage (MORNING.md) so this is the only
 * way to a file.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { sessionHasMfa } from '../_shared/requireMfa.ts'
import { APP_ALLOWED_HEADERS, callerVersionHeaders } from '../_shared/appVersion.ts'

const URL_ = Deno.env.get('SUPABASE_URL') ?? ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const LIFETIME_SECONDS = 60

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': APP_ALLOWED_HEADERS,
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'sign in first' })

  let fileId: string | undefined
  try { fileId = (await req.json())?.fileId } catch { /* empty body */ }
  if (!fileId) return json(400, { error: 'fileId required' })

  // As the user: rights, audit row, grant — all in the database.
  const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: auth, ...callerVersionHeaders(req) } }, auth: { persistSession: false } })
  // The link is signed with the service key, which no policy stops: so the
  // second factor is checked here too, by the database (sql/098), before
  // anything else. A password-only or ended session gets no file.
  if (!(await sessionHasMfa(fn => asUser.rpc(fn)))) return json(403, { error: 'mfa_required' })
  const { data: path, error } = await asUser.rpc('request_file_download', { p_file: fileId })
  if (error || typeof path !== 'string') return json(403, { error: error?.message ?? 'not allowed' })

  const { data: name } = await asUser.rpc('job_file_name', { p_file: fileId })
  const service = createClient(URL_, SERVICE, { auth: { persistSession: false } })
  const { data, error: signError } = await service.storage.from('job-files')
    .createSignedUrl(path, LIFETIME_SECONDS, typeof name === 'string' ? { download: name } : undefined)
  if (signError || !data) return json(500, { error: signError?.message ?? 'could not sign' })
  return json(200, { url: data.signedUrl, expiresIn: LIFETIME_SECONDS })
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
