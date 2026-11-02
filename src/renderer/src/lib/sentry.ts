/**
 * Sentry for the window — the renderer half of src/main/sentry.ts. Off unless
 * VITE_SENTRY_DSN is set at build time; loaded only then, so a build without
 * it carries none of Sentry's code. Same scrubbing as the main process.
 */
import { scrubBreadcrumb, scrubSentryEvent } from '@shared/privacy/scrub'
import { IS_TEST_COPY } from './testCopy'

export function initSentryRenderer(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn || IS_TEST_COPY) return  // test mode: errors from the test copy are not production's
  void import('@sentry/electron/renderer').then(Sentry => {
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      beforeSend: event => scrubSentryEvent(event),
      beforeBreadcrumb: crumb => scrubBreadcrumb(crumb),
    })
  }).catch(() => { /* not in Electron (dev in a browser): nothing to report to */ })
}
