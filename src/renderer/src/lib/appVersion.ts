/**
 * The app's version on every request, and what happens when the database says
 * it is too old to save (docs/MIN-VERSION.md, sql/104).
 *
 * Every Supabase call carries `x-wivo-version` (this build's version, fixed at
 * build time) and `x-wivo-client`. Below the minimum, the database refuses a
 * save with HTTP 426 and "Update Wivo"; reads go on. A guard against old builds
 * losing data, not a security control: the header is whatever the app says.
 */

/** This build's version: package.json when it was built. */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''

/** Desktop (the Electron bridge is there) or the phone app in a browser. For logs only. */
export function appClient(): 'desktop' | 'phone' {
  return typeof window !== 'undefined' && window.wivo ? 'desktop' : 'phone'
}

export function appHeaders(): Record<string, string> {
  return { 'x-wivo-version': APP_VERSION, 'x-wivo-client': appClient() }
}

/** '2.0.10' → [2, 0, 10]; three parts always; null if it is not a version. As sql/104 version_parts. */
export function versionParts(v: string | null | undefined): [number, number, number] | null {
  const m = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v ?? '')
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null
}

/** Is `version` below `minimum`? A missing or unreadable version is; no minimum, never. As sql/104 version_below. */
export function versionBelow(version: string | null | undefined, minimum: string | null | undefined): boolean {
  const min = versionParts(minimum)
  if (!min) return false
  const v = versionParts(version)
  if (!v) return true
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] < min[i]
  return false
}

// ── "Update Wivo" ───────────────────────────────────────────────────────────

const listeners = new Set<() => void>()
let refused = false

/** A save was refused for the version. Once is enough to know. */
export function reportUpdateRequired(): void {
  refused = true
  listeners.forEach(l => l())
}

/** Has a save been refused for the version in this session? */
export const updateWasRequired = (): boolean => refused

/** Told when a save is refused for the version. Returns the unsubscribe. */
export function onUpdateRequired(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** fetch, noticing the database's "too old to save" (HTTP 426) on the way back. */
export function versionWatchingFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const res = await inner(input, init)
    if (res.status === 426) reportUpdateRequired()
    return res
  }
}

/** The database's answer for a refused save (sql/104). */
export function isUpdateRequired(e: unknown): boolean {
  const err = e as { code?: string; hint?: string; status?: number } | null
  return err?.hint === 'update_required' || err?.code === 'PT426' || err?.status === 426
}
