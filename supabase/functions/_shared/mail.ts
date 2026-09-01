/**
 * Sending one message over SMTP. The only place this project talks to a mail
 * server.
 *
 * PORT 465, AND THAT IS NOT A PREFERENCE
 * Supabase edge functions block outbound 25 and 587. 465 — implicit TLS, the
 * whole connection encrypted from the first byte — is what is allowed, and it
 * happens to be what every Estonian host (Zone, Veebimajutus/elkdata) offers
 * alongside the 587 they usually recommend. Anyone "fixing" the port to 587
 * because a help page said so will get a connection that times out with no
 * error worth reading.
 *
 * SEND ONLY
 * Nothing here can read a mailbox. IMAP settings are never asked for, never
 * stored and never used — the clinic hands over its main address knowing the
 * only capability granted is putting a message in the outbox.
 *
 * The credentials come from `supabase secrets` at runtime and are never logged,
 * never returned and never written to a table.
 */
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

export interface MailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface MailSender {
  send(msg: MailMessage): Promise<void>
  close(): Promise<void>
}

/** What is missing from the environment, in plain words. Empty = ready. */
export function smtpProblems(): string[] {
  const out: string[] = []
  if (!Deno.env.get('SMTP_HOST')) out.push('SMTP_HOST')
  if (!Deno.env.get('SMTP_USER')) out.push('SMTP_USER')
  if (!Deno.env.get('SMTP_PASS')) out.push('SMTP_PASS')
  return out
}

/**
 * One connection, reused for the whole run.
 *
 * Opening a TLS session per message would be slower and — the part that
 * actually matters — looks far more like a burst to a shared host's rate
 * limiter than one authenticated session sending several messages does.
 */
export function openSmtp(fromAddress: string, fromName: string): MailSender {
  const port = Number(Deno.env.get('SMTP_PORT') ?? '465')
  const client = new SMTPClient({
    connection: {
      hostname: Deno.env.get('SMTP_HOST') ?? '',
      port,
      // Implicit TLS. `tls: true` is what makes 465 work; STARTTLS on 587 is
      // the thing this platform will not let us do.
      tls: true,
      auth: {
        username: Deno.env.get('SMTP_USER') ?? '',
        password: Deno.env.get('SMTP_PASS') ?? '',
      },
    },
  })

  const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress

  return {
    async send(msg: MailMessage): Promise<void> {
      await client.send({
        from,
        to: msg.to,
        subject: msg.subject,
        content: msg.text,
        html: msg.html,
      })
    },
    async close(): Promise<void> {
      // Never allowed to throw: a failed close after a successful send must not
      // turn a delivered message into a reported failure, because the retry
      // that follows would send it twice.
      try { await client.close() } catch { /* ignore */ }
    },
  }
}

/**
 * A server message with anything credential-shaped taken out.
 *
 * SMTP servers quote what you sent them, which on an auth failure can include
 * the login. This string is written to `invoices.send_error`, a column every
 * clinic member can read.
 */
export function safeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(/AUTH\s+\S+/gi, 'AUTH <peidetud>')
    .replace(/password[=:]\s*\S+/gi, 'password=<peidetud>')
    .slice(0, 500)
}
