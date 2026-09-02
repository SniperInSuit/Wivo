/**
 * Sends the invoices that are due. Called by pg_cron once a day.
 *
 * NOT PUBLIC. Deployed WITHOUT `--no-verify-jwt`, unlike `public-booking`: this
 * one sends mail from the clinic's main address, so an unauthenticated caller
 * would be handed a mail cannon. The caller is pg_cron holding the service key.
 *
 * IT DECIDES NOTHING ITSELF
 * Every "may this go out" answer comes from `shared/billing/sendGuard.ts` — the
 * same function the settings screen explains itself with. This file finds
 * candidates, asks, and obeys. A rule invented here would be a rule the clinic
 * cannot see in Seaded and cannot switch off.
 *
 * `?dry=1` runs everything — policy, guard, rendering — and reports what it
 * WOULD send without opening a connection. That is the safe way to look at a
 * live queue, and it is why the guard runs before the SMTP session opens.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { invoiceDoc } from '@shared/billing/invoiceDoc.ts'
import { maySendInvoice, remainingToday, SAFE_MAIL_POLICY } from '@shared/billing/sendGuard.ts'
import type { MailPolicy } from '@shared/billing/sendGuard.ts'
import { invoiceHtml, invoiceText, invoiceSubject } from '../_shared/invoiceHtml.ts'
import { openSmtp, smtpProblems, safeError } from '../_shared/mail.ts'
import { invoicePdf, invoicePdfName } from '../_shared/invoicePdf.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
)

/** Today in Tallinn. The clinic's day, not UTC's — an invoice dated today must
 *  not sit unsent until 03:00 because the server thinks it is still yesterday. */
function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Tallinn' })
    .format(new Date())
}

interface Outcome {
  clinic: string
  invoice: string
  to?: string
  redirected?: boolean
  sent?: boolean
  skipped?: string
  error?: string
}

Deno.serve(async (req: Request): Promise<Response> => {
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const day = today()
  const results: Outcome[] = []
  // Why each clinic did or did not produce anything. An empty `results` is
  // ambiguous between "switched off" and "nothing was due", and the first thing
  // anyone does with this endpoint is run it and wonder which one they got.
  const clinics: { clinic: string; status: string; due?: number }[] = []

  const missing = smtpProblems()
  if (missing.length > 0 && !dry) {
    return json(500, { ok: false, error: `SMTP seadistamata: ${missing.join(', ')}` })
  }

  // Only clinics that have switched sending on. Read as a whole because the
  // policy shape IS what the guard takes — no field-by-field rebuild that could
  // drop a permission and have it read as false by accident.
  const { data: rows, error } = await db
    .from('clinic_settings')
    .select('clinic_id, email')
  if (error) return json(500, { ok: false, error: error.message })

  for (const row of rows ?? []) {
    // Heartbeat, before any policy check: "the sender ran" is a different fact
    // from "the sender sent something", and it is the one that tells a clinic
    // the automation is alive. A cron that returns 401 leaves this stale, and
    // Seaded → E-post says how long ago — which is what turns a silent failure
    // into a visible one. `cron.job_run_details` cannot do this: net.http_post
    // is async, so cron reports success whatever the function answered.
    if (!dry) {
      await db.from('clinic_settings')
        .update({ email: { ...(row.email ?? {}), viimane_kaivitus: new Date().toISOString() } })
        .eq('clinic_id', row.clinic_id)
    }

    const policy: MailPolicy = { ...SAFE_MAIL_POLICY, ...(row.email ?? {}) }
    if (!policy.saatmineLubatud) {
      clinics.push({ clinic: row.clinic_id, status: 'automaatne saatmine on väljas' })
      continue
    }
    if (!policy.lubaArved) {
      clinics.push({ clinic: row.clinic_id, status: 'arvete saatmine ei ole lubatud' })
      continue
    }

    // The cap counts what THIS system sent today, from the invoices themselves.
    // A counter the sender kept for itself would reset on every cold start,
    // which on an edge runtime is often.
    // A ROLLING 24 hours, not a calendar day. `day` is the date in Tallinn and
    // `sent_at` is an instant, so `${day}T00:00:00Z` would start the window
    // three hours late in summer — messages sent between Tallinn midnight and
    // UTC midnight would not count against the cap. Once this runs hourly that
    // stops being theoretical. A rolling window is also the honest reading of
    // "N kirja päevas" for a limit whose job is to stop a burst.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: sentToday } = await db
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', row.clinic_id)
      .gte('sent_at', since)

    let used = sentToday ?? 0
    if (remainingToday(policy, used) <= 0) {
      clinics.push({ clinic: row.clinic_id, status: `päevalimiit täis (${used}/${policy.paevaLimiit})` })
      continue
    }

    // Unsent, already issued, newest last so a long queue is worked in the
    // order the invoices were meant to go out.
    const { data: due } = await db
      .from('invoices')
      .select('*, lines:invoice_lines(*), payments(*)')
      .eq('clinic_id', row.clinic_id)
      .is('sent_at', null)
      .lte('issue_date', day)
      .order('issue_date', { ascending: true })
      .limit(Math.max(0, remainingToday(policy, used)))

    if (!due || due.length === 0) {
      // "None due" and "none at all" are different answers, and the first thing
      // anyone does after making their first invoice is run this and wonder
      // which one they got. A plan writes its instalments dated ahead, so
      // "there are five, none of them today" is the normal case — not an error,
      // but not "nothing exists" either.
      const { count: waiting } = await db
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', row.clinic_id)
        .is('sent_at', null)
        .gt('issue_date', day)
      clinics.push({
        clinic: row.clinic_id,
        status: (waiting ?? 0) > 0
          ? `täna ei ole midagi saata — ${waiting} arve ootab hilisemat väljastuskuupäeva`
          : 'saatmata arveid ei ole',
        due: 0,
      })
      continue
    }
    clinics.push({ clinic: row.clinic_id, status: 'töötlen', due: due.length })

    const { data: clinic } = await db
      .from('clinics').select('*').eq('id', row.clinic_id).maybeSingle()

    let smtp: ReturnType<typeof openSmtp> | null = null

    for (const inv of due) {
      // Ask BEFORE looking up an address or opening a connection: a refusal
      // must cost nothing, and the cap must not be spent on lookups.
      const recipient = await recipientFor(inv)
      const verdict = maySendInvoice(inv, policy, recipient, used, day)

      if (!verdict.send) {
        results.push({ clinic: row.clinic_id, invoice: inv.number, skipped: verdict.reason })
        continue
      }

      if (dry) {
        results.push({
          clinic: row.clinic_id, invoice: inv.number,
          to: verdict.to, redirected: verdict.redirected, sent: false,
          skipped: 'proovikäivitus — ei saadetud',
        })
        used++
        continue
      }

      const doc = invoiceDoc(inv, clinic)
      try {
        if (!smtp) smtp = openSmtp(policy.saatjaAadress, (row.email?.saatjaNimi as string) ?? '')
        // The clinic's own wording, from the same settings row. Blank fields
        // fall back to the shipped letter rather than to nothing.
        const tpl = (row.email ?? {}) as { pealkiri?: string; sissejuhatus?: string; lopp?: string }
        // The body is what they read; the attachment is what they save, print
        // or forward to their accountant. Both off the same InvoiceDoc, so the
        // file cannot say something the email does not.
        const pdf = await invoicePdf(doc)
        await smtp.send({
          to: verdict.to,
          subject: invoiceSubject(doc, tpl),
          html: invoiceHtml(doc, tpl),
          text: invoiceText(doc, tpl),
          attachments: [{
            filename: invoicePdfName(doc),
            content: pdf,
            contentType: 'application/pdf',
          }],
        })
        // Stamped IMMEDIATELY after the server accepts. A crash between the two
        // is the one case that could double-send, so the window is one await.
        await db.from('invoices')
          .update({ sent_at: new Date().toISOString(), send_error: null })
          .eq('id', inv.id)
        used++
        results.push({
          clinic: row.clinic_id, invoice: inv.number,
          to: verdict.to, redirected: verdict.redirected, sent: true,
        })
      } catch (err) {
        // One bad address must not stop the run — the rest of the queue is
        // fine, and a whole day's invoices held up by one full mailbox is a
        // worse failure than the one that caused it.
        const msg = safeError(err)
        await db.from('invoices').update({ send_error: msg }).eq('id', inv.id)
        results.push({ clinic: row.clinic_id, invoice: inv.number, error: msg })
      }
    }

    if (smtp) await smtp.close()
  }

  return json(200, {
    ok: true,
    dry,
    day,
    sent: results.filter(r => r.sent).length,
    skipped: results.filter(r => r.skipped).length,
    failed: results.filter(r => r.error).length,
    clinics,
    results,
  })
})

/**
 * Who this invoice goes to. The patient or the ordering practice, according to
 * what the document itself says it is addressed to — never guessed from
 * whichever id happens to be filled in.
 */
async function recipientFor(inv: Record<string, unknown>): Promise<string | null> {
  if (inv.bill_to_kind === 'customer' && inv.customer_id) {
    const { data } = await db
      .from('customers').select('email').eq('id', inv.customer_id).maybeSingle()
    return (data?.email as string | null) ?? null
  }
  if (inv.patient_id) {
    const { data } = await db
      .from('patients').select('email').eq('id', inv.patient_id).maybeSingle()
    return (data?.email as string | null) ?? null
  }
  return null
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
