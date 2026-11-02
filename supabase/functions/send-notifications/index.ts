/**
 * E-mails for notifications (spec, Phase 1: "e-mail via Resend, only the code
 * and a link"). Called every minute by pg_cron (sql/077) with the service key.
 *
 * The work is in ../_shared/notifySender.ts (tested). E-mail, bug-report
 * e-mail and phone push are independent: without the e-mail secrets the
 * e-mails are skipped with a warning and the pushes still go.
 *
 * Reads `pending_notification_emails()` (sql/075), sends one short message per
 * notification and marks exactly what was sent. A failed send stays pending
 * and is tried again next minute, for a day.
 *
 * The message carries the job CODE and a link — never a patient name, never a
 * tooth, never a price. The rows it is built from do not contain them either.
 * Texts are here, not in shared/i18n: Deno cannot load that module's
 * extensionless imports, and an e-mail is content in the RECIPIENT's language
 * (their profile language, else their organisation's default).
 *
 * Bug reports (sql/079) ride the same minute: each new one is e-mailed to
 * BUG_REPORT_TO. A report has no patient fields; the recent errors were
 * scrubbed on the user's machine; a screenshot is never attached to the
 * e-mail — it stays in the private bucket, behind the service key.
 *
 * Phone push (Phase 1b, sql/090) rides the same minute too: one EMPTY push per
 * phone that has unread notifications waiting (`pending_pushes()`). The push
 * carries nothing; the phone says "New in Wivo" and the app shows the rest
 * after sign-in. E-mail stays the fallback for everyone without push.
 *
 * Env: RESEND_API_KEY, NOTIFY_FROM (e.g. "Wivo <noreply@wivo.ee>"),
 *      APP_LINK (e.g. "https://app.wivo.ee/job/{id}"), BUG_REPORT_TO,
 *      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. "mailto:ops@wivo.ee";
 *      scripts/vapid-keys.mjs makes the pair).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { vapidSigningKey, pushToPhone } from '../_shared/vapid.ts'
import { runSender } from '../_shared/notifySender.ts'
import { isServiceRequest, serviceClientKey } from '../_shared/serviceAuth.ts'

const env = (name: string) => Deno.env.get(name)

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  serviceClientKey(env),
  { auth: { persistSession: false, autoRefreshToken: false } },
)

Deno.serve(async (req: Request): Promise<Response> => {
  // Only the cron job (or Kevin with the service key) may run the sender.
  // The gateway's JWT check is OFF for this function (verify_jwt = false in
  // supabase/config.toml): it refused the legacy service_role JWT, and it
  // would accept the public anon key anyway. This is the whole check — this
  // project's service key, legacy or sb_secret, nothing else (serviceAuth.ts).
  if (!isServiceRequest(req.headers.get('Authorization'), env)) {
    return json(401, { ok: false, error: 'service key required' })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  // Always 200 once the caller is checked: each part reports its own result,
  // and a part that cannot run (no e-mail secrets) never stops the others.
  const result = await runSender({
    env,
    rpc: async (fn, args) => await db.rpc(fn, args),
    fetch: (url, init) => fetch(url, init),
    signingKey: vapidSigningKey,
    push: pushToPhone,
    warn: message => console.warn(`[send-notifications] ${message}`),
  }, dry)
  return json(200, result)
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
