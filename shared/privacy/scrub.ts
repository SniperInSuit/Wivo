/**
 * What must not leave the machine in an error report (spec: "Sentry: errors
 * are caught automatically, patient data is filtered out before sending";
 * the bug report's "latest errors" use the same filter).
 *
 * Dependency-free: the renderer, the Electron main process and tests all use
 * it. Two layers:
 *  - text: e-mail addresses, Estonian and Latvian personal codes, phone-like
 *    numbers. A bare name cannot be recognised, so free text is also capped.
 *  - events: everything Sentry would send beyond the error itself is dropped
 *    (user, request bodies, `extra`, console breadcrumbs, typed input), and
 *    URLs lose their query strings — a Supabase REST URL carries its filters
 *    there, `?patsient=ilike.*Maasikas*` included.
 */

export function scrubPersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b[1-6]\d{2}[01]\d[0-3]\d{5}\b/g, '[personal-code]')     // EE isikukood (11 digits)
    .replace(/\b[0-3]\d[01]\d\d{2}-?[0-2]\d{4}\b/g, '[personal-code]')  // LV personas kods
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]')                          // phone numbers and the like
}

const stripQuery = (url: unknown): unknown =>
  typeof url === 'string' ? url.replace(/[?#].*$/, '') : url

/** Breadcrumb categories that can carry what a person typed or logged. */
const DROP_BREADCRUMBS = new Set(['console', 'ui.input'])

type AnyEvent = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export function scrubBreadcrumb<B extends AnyEvent | null>(b: B): B | null {
  if (!b) return b
  if (DROP_BREADCRUMBS.has(b.category)) return null
  const out: AnyEvent = { ...b }
  if (typeof out.message === 'string') out.message = scrubPersonalData(out.message).slice(0, 300)
  if (out.data) {
    out.data = { ...out.data }
    if ('url' in out.data) out.data.url = stripQuery(out.data.url)
    if ('to' in out.data) out.data.to = stripQuery(out.data.to)
    if ('from' in out.data) out.data.from = stripQuery(out.data.from)
    delete out.data.body
  }
  return out as B
}

/** A Sentry event as it may leave: the error, where it happened, which version. */
export function scrubSentryEvent<E extends AnyEvent | null>(event: E): E | null {
  if (!event) return event
  const e: AnyEvent = { ...event }
  delete e.user
  delete e.extra
  delete e.server_name
  if (e.request) e.request = { url: stripQuery(e.request.url), method: e.request.method }
  if (typeof e.message === 'string') e.message = scrubPersonalData(e.message).slice(0, 500)
  if (e.logentry?.message) e.logentry = { message: scrubPersonalData(String(e.logentry.message)).slice(0, 500) }
  if (e.exception?.values) {
    e.exception = {
      ...e.exception,
      values: e.exception.values.map((v: AnyEvent) => ({
        ...v,
        value: typeof v.value === 'string' ? scrubPersonalData(v.value).slice(0, 500) : v.value,
        stacktrace: v.stacktrace && {
          ...v.stacktrace,
          // Local variables can hold a whole patient record.
          frames: (v.stacktrace.frames ?? []).map((f: AnyEvent) => { const { vars: _vars, ...rest } = f; return rest }),
        },
      })),
    }
  }
  if (Array.isArray(e.breadcrumbs)) e.breadcrumbs = e.breadcrumbs.map(scrubBreadcrumb).filter(Boolean)
  return e as E
}
