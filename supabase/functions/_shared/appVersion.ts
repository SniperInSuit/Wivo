/**
 * The app's version on every request (docs/MIN-VERSION.md, sql/104).
 *
 * The app sends `x-wivo-version` (and `x-wivo-client`, for logs) with every
 * call, Edge Functions included, so their CORS answer must allow both or the
 * browser refuses the call before it is made. A function that calls the
 * database AS THE USER passes the caller's version on, so a save made through
 * it is checked like one made directly. A guard against old builds, not a
 * security control: the header is whatever the caller says.
 *
 * No imports, so Deno and Vitest load it as it is.
 */

/** The headers a browser may send to a function the app calls. */
export const APP_ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type, x-wivo-version, x-wivo-client'

/** The caller's version, to send on with the function's own calls as that user. */
export function callerVersionHeaders(req: { headers: { get(name: string): string | null } }): Record<string, string> {
  const v = (req.headers.get('x-wivo-version') ?? '').trim()
  return v && v.length <= 40 ? { 'x-wivo-version': v } : {}
}
