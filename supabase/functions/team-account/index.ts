/**
 * Team → "Add member" and Settings → "Add an e-mail address" (docs/ACCOUNTS.md):
 *   { action: 'invite', email, fullName, language }
 *   { action: 'create_login', username, fullName, password, language }
 *   { action: 'resend', userId, language }
 *   { action: 'add_email', email, language }
 *
 * The work and the caller check are in ../_shared/teamAccount.ts (tested).
 * The gateway's JWT check is OFF (verify_jwt = false in supabase/config.toml;
 * deploy with --no-verify-jwt), as for account-security: the caller's token
 * is checked by PostgREST on the first call, made as that user, and the
 * database decides. Only then does the service key create the account.
 *
 * Env: the platform's SUPABASE_URL, SUPABASE_ANON_KEY and the service key (as
 * for send-notifications); ours: RESEND_API_KEY, NOTIFY_FROM, APP_LINK,
 * optional STANDIN_DOMAIN, and EMAIL_ALLOW_ONLY on the test copy only.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { handleTeamRequest } from '../_shared/teamAccount.ts'
import { serviceClientKey } from '../_shared/serviceAuth.ts'
import { sessionHasMfa } from '../_shared/requireMfa.ts'
import { APP_ALLOWED_HEADERS, callerVersionHeaders } from '../_shared/appVersion.ts'

const env = (name: string) => Deno.env.get(name)
const URL_ = env('SUPABASE_URL') ?? ''
const noSession = { persistSession: false, autoRefreshToken: false }

const service = createClient(URL_, serviceClientKey(env), { auth: noSession })

// A bearer token, not a cookie: any origin may ask, only a signed-in user gets an answer.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': APP_ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { ok: false, error: 'bad_request' })

  const authorization = req.headers.get('Authorization')
  let body: unknown = null
  try { body = await req.json() } catch { /* answered as bad_request */ }

  const asUser = createClient(URL_, env('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization ?? '', ...callerVersionHeaders(req) } }, auth: noSession,
  })
  const answer = await handleTeamRequest(authorization, body, {
    asUser: async (fn, args) => await asUser.rpc(fn, args),
    hasMfa: () => sessionHasMfa(fn => asUser.rpc(fn)),
    callerClinic: async (caller) => {
      const { data: me } = await asUser.from('profiles').select('clinic_id').eq('id', caller).maybeSingle()
      if (!me?.clinic_id) return null
      const { data: c } = await asUser.from('clinics').select('name, code_prefix').eq('id', me.clinic_id).maybeSingle()
      return c ? { name: c.name as string, code: (c.code_prefix as string | null) ?? null } : null
    },
    generateLink: async (p) => {
      const { data, error } = p.type === 'invite'
        ? await service.auth.admin.generateLink({ type: 'invite', email: p.email, options: p.data ? { data: p.data } : undefined })
        : await service.auth.admin.generateLink({ type: 'email_change_new', email: p.email, newEmail: p.newEmail })
      return {
        hashedToken: data?.properties?.hashed_token ?? null,
        userId: data?.user?.id ?? null,
        error: error ? `${error.code ?? ''} ${error.message}`.trim() : null,
      }
    },
    createUser: async (p) => {
      const { data, error } = await service.auth.admin.createUser({
        email: p.email, password: p.password, email_confirm: p.emailConfirm, user_metadata: p.data,
      })
      return { userId: data?.user?.id ?? null, error: error ? `${error.code ?? ''} ${error.message}`.trim() : null }
    },
    userEmail: async (userId) => {
      const { data } = await service.auth.admin.getUserById(userId)
      return data?.user?.email ?? null
    },
    sendMail: async (m) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env('NOTIFY_FROM'), to: m.to, subject: m.subject, text: m.text }),
      })
      return res.ok ? { ok: true } : { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` }
    },
    env,
    warn: message => console.warn(`[team-account] ${message}`),
  })
  return json(answer.status, answer.body)
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
