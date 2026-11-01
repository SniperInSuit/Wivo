/**
 * E-mails for notifications (spec, Phase 1: "e-mail via Resend, only the code
 * and a link"). Called every minute by pg_cron (sql/077) with the service key.
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
 * Env: RESEND_API_KEY, NOTIFY_FROM (e.g. "Wivo <noreply@wivo.ee>"),
 *      APP_LINK (e.g. "https://app.wivo.ee/job/{id}"), BUG_REPORT_TO.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
)

type Lang = 'en' | 'et' | 'ru'
type Kind = 'job_shared' | 'stage_handover' | 'question'

const SUBJECT: Record<Lang, Record<Kind, string>> = {
  en: { job_shared: 'Job {code} was shared with you', stage_handover: 'Job {code} was handed over to you', question: 'New question on job {code}' },
  et: { job_shared: 'Töö {code} jagati teiega', stage_handover: 'Töö {code} anti teile üle', question: 'Uus küsimus tööl {code}' },
  ru: { job_shared: 'Работа {code} передана вам', stage_handover: 'Этап работы {code} передан вам', question: 'Новый вопрос по работе {code}' },
}
const OPEN: Record<Lang, string> = { en: 'Open in Wivo', et: 'Ava Wivos', ru: 'Открыть в Wivo' }

interface Pending { id: string; email: string; job_id: string | null; job_code: string | null; kind: Kind; language: string }

Deno.serve(async (req: Request): Promise<Response> => {
  // Only the cron job (or Kevin with the service key) may run the sender. The
  // platform's JWT check accepts the public anon key too, which would let
  // anyone trigger sends — and two runs at once would send duplicates.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!serviceKey || req.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return json(401, { ok: false, error: 'service key required' })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const key = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('NOTIFY_FROM')
  const link = Deno.env.get('APP_LINK') ?? ''
  if (!dry && (!key || !from)) return json(500, { ok: false, error: 'RESEND_API_KEY and NOTIFY_FROM must be set' })

  const { data, error } = await db.rpc('pending_notification_emails', { p_limit: 200 })
  if (error) return json(500, { ok: false, error: error.message })

  const sent: string[] = []
  const failed: { id: string; error: string }[] = []
  for (const n of (data ?? []) as Pending[]) {
    const lang: Lang = (['en', 'et', 'ru'] as const).includes(n.language as Lang) ? n.language as Lang : 'en'
    const code = n.job_code ?? '—'
    const subject = SUBJECT[lang][n.kind].replace('{code}', code)
    const url = n.job_id ? link.replace('{id}', n.job_id) : link
    const text = url ? `${subject}\n\n${OPEN[lang]}: ${url}\n` : `${subject}\n`
    if (dry) { sent.push(n.id); continue }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: n.email, subject, text }),
    })
    if (res.ok) sent.push(n.id)
    else failed.push({ id: n.id, error: `${res.status} ${(await res.text()).slice(0, 200)}` })
  }

  if (!dry && sent.length > 0) {
    const { error: markErr } = await db.rpc('mark_notifications_emailed', { p_ids: sent })
    if (markErr) return json(500, { ok: false, error: markErr.message, sent: sent.length })
  }

  const bugs = await sendBugReports(dry, key, from)
  return json(200, { ok: true, dry, sent: sent.length, failed, bugs })
})

interface BugReport {
  id: string; org_name: string | null; app_version: string | null; screen: string | null
  message: string; recent_errors: { at?: string; message?: string; stack?: string }[]
  has_screenshot: boolean; created_at: string
}

async function sendBugReports(dry: boolean, key: string | undefined, from: string | undefined): Promise<{ sent: number; error?: string }> {
  const to = Deno.env.get('BUG_REPORT_TO')
  if (!to) return { sent: 0, error: 'BUG_REPORT_TO not set' }
  const { data, error } = await db.rpc('pending_bug_reports', { p_limit: 50 })
  if (error) return { sent: 0, error: error.message }
  const done: string[] = []
  for (const b of (data ?? []) as BugReport[]) {
    const subject = `Wivo bug: ${b.org_name ?? '—'} · ${b.screen ?? '—'} · v${b.app_version ?? '?'}`
    const errors = (b.recent_errors ?? []).map(e => `- ${e.at ?? ''} ${e.message ?? ''}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}`).join('\n')
    const text = [
      `Organisation: ${b.org_name ?? '—'}`, `Screen: ${b.screen ?? '—'}`, `Version: ${b.app_version ?? '—'}`,
      `Reported: ${b.created_at}`, `Report id: ${b.id}`,
      `Screenshot: ${b.has_screenshot ? 'yes, in the bug-reports bucket' : 'none'}`,
      '', b.message, '', 'Recent errors:', errors || '(none)',
    ].join('\n')
    if (dry) { done.push(b.id); continue }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
    })
    if (res.ok) done.push(b.id)
  }
  if (!dry && done.length > 0) await db.rpc('mark_bug_reports_emailed', { p_ids: done })
  return { sent: done.length }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
