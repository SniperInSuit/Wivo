/**
 * Resend's sending limit (sql/125). On the free plan: 100 e-mails a day and
 * 3000 a month, Supabase Auth's own e-mails included. Over it, Resend answers
 * 429 with `daily_quota_exceeded` or `monthly_quota_exceeded`. A plain
 * `rate_limit_exceeded` (too many per second) is not the limit: it passes in
 * a second and is only retried.
 *
 * No imports, so Deno and Vitest load it as it is.
 */
export type QuotaKind = 'daily' | 'monthly'

/** Which limit a Resend answer says was reached, or null. `body`: the response text. */
export function quotaLimit(status: number, body: string): QuotaKind | null {
  if (status !== 429) return null
  if (/daily_quota_exceeded/.test(body)) return 'daily'
  if (/monthly_quota_exceeded/.test(body)) return 'monthly'
  return null
}

/** The same, from an error string written as `${status} ${body}` (team-account's sendMail). */
export function quotaLimitInError(error: string | undefined): QuotaKind | null {
  const m = /^(\d{3})\s([\s\S]*)$/.exec(error ?? '')
  return m ? quotaLimit(Number(m[1]), m[2]) : null
}

export const QUOTA_WARNING: Record<QuotaKind, string> = {
  daily: "Resend's daily sending limit is reached: e-mails wait until it resets (the owner is told in the bell)",
  monthly: "Resend's monthly sending limit is reached: e-mails wait until it resets (the owner is told in the bell)",
}
