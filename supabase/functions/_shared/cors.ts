/**
 * Origin allowlist.
 *
 * `Access-Control-Allow-Origin: *` would be simpler and wrong: this function
 * writes into a real clinic calendar, and the browser's origin check is one of
 * the few things standing between that and any page on the internet.
 *
 * `Vary: Origin` is not optional. Without it a CDN caches one origin's ACAO
 * header and serves it to another, which silently breaks the allowlist.
 */
const ALLOWED = (Deno.env.get('PUBLIC_BOOKING_ORIGINS') ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Vary': 'Origin' }
  if (origin && ALLOWED.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'content-type, x-wivo-idempotency-key'
    headers['Access-Control-Max-Age'] = '86400'
  }
  return headers
}

/** Answer a preflight before anything else runs. */
export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}
