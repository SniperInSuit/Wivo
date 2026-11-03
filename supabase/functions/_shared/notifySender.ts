/**
 * What `send-notifications` does each minute, with everything it talks to
 * passed in, so it can be tested without Deno, a database or the network.
 * The function (send-notifications/index.ts) checks the caller and wires
 * these to Supabase, fetch and the VAPID push.
 *
 * Three independent parts, in this order: notification e-mails, bug-report
 * e-mails, phone pushes. Push NEVER depends on e-mail: without
 * RESEND_API_KEY / NOTIFY_FROM (e-mail not set up yet, as on production and
 * the test copy in Run 3) the e-mails are skipped with a warning and the
 * pushes still go. Until this file, a missing e-mail secret returned 500
 * before any push was sent — phones never rang.
 *
 * EMAIL_ALLOW_ONLY (the test copy only, mailAllow.ts): a notice for any
 * other address is marked done without being sent.
 *
 * Imports carry their `.ts`: Deno needs the extension and Vitest accepts it.
 */
import { mayMail } from './mailAllow.ts'
import { pushText, pushLang } from './pushText.ts'

export type PushResult = 'ok' | 'gone' | 'failed'

export interface SenderDeps {
  env: (name: string) => string | undefined
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
  signingKey: (publicKey: string, privateKey: string) => Promise<CryptoKey>
  /** One phone. `message`: the text and that browser's keys (vapid.ts encrypts it); null: an empty push. */
  push: (endpoint: string, signing: CryptoKey, publicKey: string, subject: string,
         message: { keys: { p256dh: string; auth: string }; text: string } | null) => Promise<PushResult>
  warn: (message: string) => void
}

export interface SenderResult {
  ok: boolean
  dry: boolean
  email: { status: 'sent' | 'skipped' | 'error'; sent: number; failed: { id: string; error: string }[]; error?: string }
  bugs: { sent: number; error?: string }
  pushes: { sent: number; gone: number; error?: string }
}

type Lang = 'en' | 'et' | 'ru'
type Kind = 'job_shared' | 'stage_handover' | 'question' | 'files_added' | 'stage_reached' | 'assigned' | 'mfa_removed' | 'mfa_reset'

const SUBJECT: Record<Lang, Record<Kind, string>> = {
  en: { job_shared: 'Job {code} was shared with you', stage_handover: 'Job {code} was handed over to you', question: 'New question on job {code}', files_added: 'New files on job {code}', stage_reached: 'Job {code} moved to a new stage', assigned: 'You were put on job {code}', mfa_removed: 'An authenticator was removed from your Wivo account', mfa_reset: 'Your Wivo two-factor sign-in was reset' },
  et: { job_shared: 'Töö {code} jagati teiega', stage_handover: 'Töö {code} anti teile üle', question: 'Uus küsimus tööl {code}', files_added: 'Tööle {code} lisati faile', stage_reached: 'Töö {code} liikus uude etappi', assigned: 'Sind määrati tööle {code}', mfa_removed: 'Sinu Wivo kontolt eemaldati autentimisrakendus', mfa_reset: 'Sinu Wivo kaheastmeline sisselogimine lähtestati' },
  ru: { job_shared: 'Работа {code} передана вам', stage_handover: 'Этап работы {code} передан вам', question: 'Новый вопрос по работе {code}', files_added: 'Новые файлы в работе {code}', stage_reached: 'Работа {code} перешла на новый этап', assigned: 'Вас назначили на работу {code}', mfa_removed: 'Из вашей учётной записи Wivo удалён аутентификатор', mfa_reset: 'Двухфакторный вход в Wivo для вас сброшен' },
}
const OPEN: Record<Lang, string> = { en: 'Open in Wivo', et: 'Ava Wivos', ru: 'Открыть в Wivo' }

interface Pending { id: string; email: string; job_id: string | null; job_code: string | null; kind: Kind; language: string }

export const EMAIL_NOT_SET = 'RESEND_API_KEY or NOTIFY_FROM is not set: e-mail skipped, pushes still sent'

export async function runSender(deps: SenderDeps, dry: boolean): Promise<SenderResult> {
  const key = deps.env('RESEND_API_KEY')
  const from = deps.env('NOTIFY_FROM')
  const emailReady = dry || (!!key && !!from)
  if (!emailReady) deps.warn(EMAIL_NOT_SET)

  const email = emailReady ? await sendEmails(deps, dry, key, from) : { status: 'skipped' as const, sent: 0, failed: [] }
  const bugs = emailReady ? await sendBugReports(deps, dry, key, from) : { sent: 0, error: 'e-mail not set up' }
  const pushes = await sendPushes(deps, dry)
  if (pushes.error) deps.warn(`push: ${pushes.error}`)
  return { ok: email.status !== 'error' && !pushes.error, dry, email, bugs, pushes }
}

async function sendEmails(deps: SenderDeps, dry: boolean, key: string | undefined, from: string | undefined): Promise<SenderResult['email']> {
  const link = deps.env('APP_LINK') ?? ''
  const { data, error } = await deps.rpc('pending_notification_emails', { p_limit: 200 })
  if (error) return { status: 'error', sent: 0, failed: [], error: error.message }

  const sent: string[] = []
  const failed: { id: string; error: string }[] = []
  for (const n of (data ?? []) as Pending[]) {
    const lang: Lang = (['en', 'et', 'ru'] as const).includes(n.language as Lang) ? n.language as Lang : 'en'
    const code = n.job_code ?? '—'
    // A kind this build does not know yet is still worth an e-mail: never let it
    // stop the loop (and with it every other e-mail).
    const subject = (SUBJECT[lang][n.kind] ?? SUBJECT[lang].files_added).replace('{code}', code)
    const url = n.job_id ? link.replace('{id}', n.job_id) : appPage(link, n.kind.startsWith('mfa_') ? '/settings' : '/')
    const text = url ? `${subject}\n\n${OPEN[lang]}: ${url}\n` : `${subject}\n`
    if (dry || !mayMail(n.email, deps.env('EMAIL_ALLOW_ONLY'))) { sent.push(n.id); continue }
    const res = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: n.email, subject, text }),
    })
    if (res.ok) sent.push(n.id)
    else failed.push({ id: n.id, error: `${res.status} ${(await res.text()).slice(0, 200)}` })
  }

  if (!dry && sent.length > 0) {
    const { error: markErr } = await deps.rpc('mark_notifications_emailed', { p_ids: sent })
    if (markErr) return { status: 'error', sent: sent.length, failed, error: markErr.message }
  }
  return { status: 'sent', sent: sent.length, failed }
}

/** No job to open (a security notice): the app's own page on the same site. */
function appPage(link: string, path: string): string {
  try { return new URL(link.replace('{id}', 'x')).origin + path } catch { return '' }
}

interface BugReport {
  id: string; org_name: string | null; app_version: string | null; screen: string | null
  message: string; recent_errors: { at?: string; message?: string; stack?: string }[]
  has_screenshot: boolean; created_at: string
}

async function sendBugReports(deps: SenderDeps, dry: boolean, key: string | undefined, from: string | undefined): Promise<SenderResult['bugs']> {
  const to = deps.env('BUG_REPORT_TO')
  if (!to) return { sent: 0, error: 'BUG_REPORT_TO not set' }
  const { data, error } = await deps.rpc('pending_bug_reports', { p_limit: 50 })
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
    const res = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
    })
    if (res.ok) done.push(b.id)
  }
  if (!dry && done.length > 0) await deps.rpc('mark_bug_reports_emailed', { p_ids: done })
  return { sent: done.length }
}

interface PendingPush {
  notification_id: string; subscription_id: string; endpoint: string
  p256dh?: string | null; auth?: string | null
  /** sql/103; absent before it. */
  kind?: string | null; language?: string | null; unread?: number | null
}

/**
 * One push per phone, however many notifications wait for it — its title
 * says what happened or how many wait, and the app shows them all. A notification is done once a phone took the push or turned
 * out to be gone; one whose phones all failed is tried again next minute, for
 * an hour (pending_pushes). Twenty phones at a time, ten seconds each at most.
 */
export const PUSH_BATCH = 500
async function sendPushes(deps: SenderDeps, dry: boolean): Promise<SenderResult['pushes']> {
  const pub = deps.env('VAPID_PUBLIC_KEY')
  const priv = deps.env('VAPID_PRIVATE_KEY')
  const subject = deps.env('VAPID_SUBJECT')
  if (!pub || !priv || !subject) return { sent: 0, gone: 0, error: 'VAPID keys not set' }
  const { data, error } = await deps.rpc('pending_pushes', { p_limit: PUSH_BATCH })
  if (error) return { sent: 0, gone: 0, error: error.message }
  const rows = (data ?? []) as PendingPush[]
  if (rows.length === 0) return { sent: 0, gone: 0 }

  const phones = new Map<string, { endpoint: string; notifications: string[]; kinds: string[]; row: PendingPush }>()
  for (const r of rows) {
    const p = phones.get(r.subscription_id) ?? { endpoint: r.endpoint, notifications: [], kinds: [], row: r }
    p.notifications.push(r.notification_id)
    if (r.kind) p.kinds.push(r.kind)
    phones.set(r.subscription_id, p)
  }
  // The words, per phone: what happened, or how many wait (pushText.ts). No
  // job code, patient or name, ever. Encrypted for that browser by `push`.
  const messageFor = (p: { kinds: string[]; row: PendingPush }) => {
    if (!p.row.p256dh || !p.row.auth) return null
    const words = pushText(p.kinds, p.row.unread ?? 0, pushLang(p.row.language))
    return { keys: { p256dh: p.row.p256dh, auth: p.row.auth }, text: JSON.stringify(words) }
  }
  const signing = await deps.signingKey(pub, priv)
  const ok: string[] = []
  const gone: string[] = []
  const done = new Set<string>()
  const list = [...phones]
  for (let i = 0; i < list.length; i += 20) {
    const slice = list.slice(i, i + 20)
    const results: PushResult[] = await Promise.all(slice.map(([, p]) =>
      dry ? Promise.resolve<PushResult>('ok') : deps.push(p.endpoint, signing, pub, subject, messageFor(p))))
    slice.forEach(([id, p], k) => {
      if (results[k] === 'ok') ok.push(id)
      if (results[k] === 'gone') gone.push(id)
      if (results[k] !== 'failed') p.notifications.forEach(n => done.add(n))
    })
  }
  // A full batch may have cut the last notification's phones short (rows come
  // ordered by notification, sql/091): leave it for the next run.
  if (rows.length === PUSH_BATCH) done.delete(rows[rows.length - 1].notification_id)
  if (!dry) {
    const { error: markErr } = await deps.rpc('mark_pushed', {
      p_notifications: [...done], p_ok_subscriptions: ok, p_gone_subscriptions: gone,
    })
    if (markErr) return { sent: ok.length, gone: gone.length, error: markErr.message }
  }
  return { sent: ok.length, gone: gone.length }
}
