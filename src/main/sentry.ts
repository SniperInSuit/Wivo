/**
 * Sentry for the main process (spec, Phase 1: "Sentry in Electron: errors are
 * caught automatically, patient data is filtered out before sending").
 *
 * Off unless a DSN is configured at build time (MAIN_VITE_SENTRY_DSN), so a
 * build without one sends nothing anywhere. Every event and breadcrumb passes
 * shared/privacy/scrub first; no PII by default, no screenshots, ever.
 */
import { scrubBreadcrumb, scrubSentryEvent } from '../../shared/privacy/scrub'

export async function initSentryMain(release: string): Promise<void> {
  const dsn = import.meta.env.MAIN_VITE_SENTRY_DSN as string | undefined
  if (!dsn) return
  const Sentry = await import('@sentry/electron/main')
  Sentry.init({
    dsn,
    release,
    sendDefaultPii: false,
    attachScreenshot: false,
    beforeSend: event => scrubSentryEvent(event),
    beforeBreadcrumb: crumb => scrubBreadcrumb(crumb),
  })
}
