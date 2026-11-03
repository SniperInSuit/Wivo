/**
 * The Supabase client's options (lib/supabase), apart so the test can build
 * the real client with them: every call carries the app's version
 * (docs/MIN-VERSION.md) and, in test mode, may only go to the test copy and
 * keeps its sign-in under its own key (lib/testCopy).
 */
import { appHeaders, versionWatchingFetch } from './appVersion'
import { guardTestFetch, TEST_STORAGE_KEY } from './testCopy'

export function supabaseOptions(test: boolean, inner: typeof fetch = (...args) => fetch(...args)) {
  return {
    global: { headers: appHeaders(), fetch: versionWatchingFetch(test ? guardTestFetch(inner) : inner) },
    ...(test ? { auth: { storageKey: TEST_STORAGE_KEY } } : {}),
  }
}
