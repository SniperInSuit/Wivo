/**
 * The phone's shorter session (spec, Phase 1b: "a shorter session on the
 * phone, and remote sign-out for a lost phone").
 *
 * A phone is easier to lose than a bench computer, so a sign-in on the phone
 * lasts one working day: 12 hours from signing in, then the password and the
 * second factor again. The desktop keeps Supabase's normal session.
 *
 * Remote sign-out is Supabase's: "Sign out on all other devices" (Seaded →
 * Profile on the desktop, or here) revokes every other session's refresh
 * token; the phone is out within the hour its current token has left — and
 * at the latest when this 12-hour limit hits.
 */
export const PHONE_SESSION_HOURS = 12
const KEY = 'wivo_phone_signed_in_at'

/** Has a sign-in made at `signedInAt` (ms) run out at `now`? No record = expired. */
export function phoneSessionExpired(signedInAt: number | null, now: number, hours = PHONE_SESSION_HOURS): boolean {
  if (signedInAt === null || !Number.isFinite(signedInAt)) return true
  return now - signedInAt >= hours * 3_600_000 || signedInAt > now + 60_000
}

export function markSignedIn(now = Date.now()): void {
  try { localStorage.setItem(KEY, String(now)) } catch { /* private mode: every load is a new sign-in */ }
}

export function signedInAt(): number | null {
  try {
    const v = localStorage.getItem(KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function clearSignedIn(): void {
  try { localStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}
