/**
 * The API addresses this machine's licence allows — synchronously, because
 * lib/supabase.ts asks while it is building the client, before any request
 * exists to cancel.
 *
 * Empty means no restriction, and that is the answer in every case where the
 * question cannot be put: the phone app, a renderer opened in a plain browser
 * tab, a preload older than the bridge, or a build with no licence keys at
 * all. A licence must never be the reason a clinic cannot reach its own
 * database by accident — only on purpose, when the address genuinely is not
 * the one it was issued for.
 */
export function licensedApiOrigins(): string[] {
  try {
    const w = (window as unknown as { wivo?: { licensedApi?: () => string[] } }).wivo
    const list = w?.licensedApi?.()
    return Array.isArray(list) ? list.filter(a => typeof a === 'string' && a.trim() !== '') : []
  } catch {
    return []
  }
}
