/**
 * A token bucket keyed by a HASHED ip.
 *
 * In-memory, so it resets on a cold start. That is fine for the read routes:
 * the job here is to stop a script hammering the catalogue, not to be a durable
 * quota. The booking write will need a durable counter as well — see the plan.
 *
 * The IP is peppered and hashed and never stored raw. There is no reason for
 * this function to hold a visitor's address, so it does not.
 */
const buckets = new Map<string, { tokens: number; refilled: number }>()

export async function ipKey(req: Request): Promise<string> {
  const raw = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('cf-connecting-ip')
    ?? 'unknown'
  const pepper = Deno.env.get('IP_HASH_PEPPER') ?? ''
  const bytes = new TextEncoder().encode(`${pepper}:${raw}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

/** true = allowed. `perMinute` tokens, refilled continuously. */
export function take(key: string, perMinute: number): boolean {
  const now = Date.now()
  const b = buckets.get(key) ?? { tokens: perMinute, refilled: now }
  const refill = ((now - b.refilled) / 60_000) * perMinute
  const tokens = Math.min(perMinute, b.tokens + refill)
  if (tokens < 1) {
    buckets.set(key, { tokens, refilled: now })
    return false
  }
  buckets.set(key, { tokens: tokens - 1, refilled: now })
  // Cheap bound: a long-lived instance must not accumulate a map of every IP
  // that ever called. Dropping the oldest entries costs those callers a full
  // bucket, which is the harmless direction to be wrong in.
  if (buckets.size > 5000) {
    for (const k of [...buckets.keys()].slice(0, 1000)) buckets.delete(k)
  }
  return true
}
