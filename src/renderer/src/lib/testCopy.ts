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
 * `npm test` runs Vitest in mode `unit` (package.json), so it reads `.env`
 * only and none of this is on there. (Vitest's own default mode is also
 * called `test`; started bare, it would read .env.test and land here —
 * harmlessly: nowhere to connect to, and no test needs a connection.)
 */

/** The production project (docs/night-run/RUN-3.md). Test mode refuses it. */
export const PRODUCTION_REF = 'wrtucsfmpbwekugzzzxw'

const NOWHERE = 'http://127.0.0.1:9'

export type TestCopyProblem = 'missing' | 'production' | null

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
  return { url, key, problem: null }
}

export const IS_TEST_COPY: boolean = import.meta.env.MODE === 'test'
