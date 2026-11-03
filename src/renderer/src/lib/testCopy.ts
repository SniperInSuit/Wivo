/**
 * Test mode: `npm run dev:test` runs the desktop app against the TEST COPY of
 * the database, with the URL and anon key from `.env.test` (Vite mode
 * `test`). Kevin pastes those two values in himself; that file never holds a
 * service_role key or an access token, and git ignores it.
 *
 * Fail closed. Vite loads `.env` first and `.env.test` over it, so a value
 * missing from `.env.test` would silently be production's. In test mode a
 * missing URL or key, or the production project's URL, is replaced by an
 * address where nothing listens: every request fails, nothing reaches
 * production, and the TEST COPY banner turns red and says why.
 *
 * Only the test copy. The URL must be exactly the test copy's (TEST_REF); any
 * other address, not only production's, is refused the same way. Every
 * request the Supabase client makes — database, sign-in, storage, Edge
 * Functions — goes through guardTestFetch, which refuses anything that is not
 * the test copy before it is sent; installTestModeNetworkGuard does the same
 * for any other fetch, upload (XHR) or realtime socket to a Supabase host.
 *
 * Its own session. Test mode keeps its sign-in under its own storage key
 * (TEST_STORAGE_KEY), and the desktop's main process gives it its own
 * userData folder (main/index.ts), so a session, a setting or a cached value
 * from `npm run dev` on the same machine is never seen here.
 *
 * `npm test` runs Vitest in mode `unit` (package.json), so it reads `.env`
 * only and none of this is on there. (Vitest's own default mode is also
 * called `test`; started bare, it would read .env.test and land here —
 * harmlessly: nowhere to connect to, and no test needs a connection.)
 */

/** The production project (docs/night-run/RUN-3.md). Test mode refuses it. */
export const PRODUCTION_REF = 'wrtucsfmpbwekugzzzxw'

/** The test copy (CLAUDE.md). The ONLY project test mode talks to. If it ever changes, change it here. */
export const TEST_REF = 'jhqyvancrzykxhzwnost'
export const TEST_ORIGIN = `https://${TEST_REF}.supabase.co`

/** Test mode's own sign-in, apart from the normal app's (supabase.ts). */
export const TEST_STORAGE_KEY = 'wivo-test-copy-auth'

const NOWHERE = 'http://127.0.0.1:9'

export type TestCopyProblem = 'missing' | 'production' | 'not-test-copy' | null

function originOf(url: string): string | null {
  try { return new URL(url).origin } catch { return null }
}

export interface SupabaseTarget {
  url: string
  key: string
  problem: TestCopyProblem
}

/** What the client connects to, given the mode and the env values. Pure. */
export function supabaseTarget(mode: string, url: string | undefined, key: string | undefined): SupabaseTarget {
  if (mode !== 'test') return { url: url ?? '', key: key ?? '', problem: null }
  if (!url?.trim() || !key?.trim()) return { url: NOWHERE, key: 'test-copy-not-configured', problem: 'missing' }
  if (url.includes(PRODUCTION_REF)) return { url: NOWHERE, key: 'test-copy-not-configured', problem: 'production' }
  if (originOf(url.trim()) !== TEST_ORIGIN) return { url: NOWHERE, key: 'test-copy-not-configured', problem: 'not-test-copy' }
  return { url: TEST_ORIGIN, key, problem: null }
}

/** May test mode send this request? Only to the test copy. */
export const allowedInTestMode = (url: string): boolean => originOf(url) === TEST_ORIGIN

export class TestCopyRefused extends Error {
  constructor(url: string) { super(`Test mode: refused a request outside the test copy (${originOf(url) ?? 'unreadable address'})`) }
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

/** The Supabase client's fetch in test mode: the test copy, or nothing at all. */
export function guardTestFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = urlOf(input)
    if (!allowedInTestMode(url)) throw new TestCopyRefused(url)
    return inner(input, init)
  }
}

/** A Supabase host (any project, any service), as opposed to the app's own files or other services. */
export function isSupabaseHost(url: string, base = 'http://localhost'): boolean {
  try { return /(^|\.)supabase\.(co|in|net)$/i.test(new URL(url, base).hostname) } catch { return false }
}

/**
 * Test mode, for everything outside the Supabase client: a fetch, an upload
 * (XHR) or a realtime socket to any Supabase host other than the test copy is
 * refused before it leaves. Other addresses (the app's own files, the updater)
 * are not this guard's business.
 */
export function installTestModeNetworkGuard(w: {
  fetch: typeof fetch
  XMLHttpRequest?: { prototype: { open: (...args: never[]) => unknown } }
  WebSocket?: unknown
}): void {
  const refused = (url: string) => isSupabaseHost(url) && !allowedInTestMode(url)
  const innerFetch = w.fetch.bind(w)
  w.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    if (refused(url)) throw new TestCopyRefused(url)
    return innerFetch(input, init)
  }) as typeof fetch
  const xhr = w.XMLHttpRequest?.prototype as { open: (method: string, url: string | URL, ...rest: unknown[]) => unknown } | undefined
  if (xhr) {
    const open = xhr.open
    xhr.open = function (this: unknown, method: string, url: string | URL, ...rest: unknown[]) {
      if (refused(String(url))) throw new TestCopyRefused(String(url))
      return open.call(this, method, url, ...rest)
    }
  }
  if (typeof w.WebSocket === 'function') {
    const Inner = w.WebSocket as new (url: string | URL, protocols?: string | string[]) => object
    const Guarded = function (url: string | URL, protocols?: string | string[]) {
      const http = String(url).replace(/^ws/i, 'http')
      if (refused(http)) throw new TestCopyRefused(http)
      return new Inner(url, protocols)
    } as unknown as typeof WebSocket
    Object.assign(Guarded, Inner)
    ;(Guarded as unknown as { prototype: unknown }).prototype = (Inner as unknown as { prototype: unknown }).prototype
    w.WebSocket = Guarded
  }
}

export const IS_TEST_COPY: boolean = import.meta.env.MODE === 'test'
