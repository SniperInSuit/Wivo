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
 * Env: RESEND_API_KEY, NOTIFY_FROM (e.g. "Wivo <noreply@wivo.ee>"),
 *      APP_LINK (e.g. "https://app.wivo.ee/job/{id}").
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
  return json(200, { ok: true, dry, sent: sent.length, failed })
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
