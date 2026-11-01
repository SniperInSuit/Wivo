/**
 * The last few errors this window saw, for a bug report (spec, Phase 1: the
 * report carries "the latest errors") and for Sentry's filter.
 *
 * An error message can quote data — a failed insert may echo a name, an
 * e-mail, a personal code. `scrubPersonalData` removes what can be recognised
 * as personal before anything leaves the machine: e-mail addresses, phone
 * numbers, Estonian/Latvian personal codes, and anything that looks like a
 * UUID-free long number. It cannot recognise a bare name, so messages are
 * also capped in length; the stack, which is code locations, is kept.
 */

export interface LoggedError {
  at: string
  message: string
  stack?: string
}

const MAX = 20
const buffer: LoggedError[] = []

export function scrubPersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b[1-6]\d{2}[01]\d[0-3]\d{5}\b/g, '[personal-code]')          // EE isikukood (11 digits)
    .replace(/\b[0-3]\d[01]\d\d{2}-?[0-2]\d{4}\b/g, '[personal-code]')       // LV personas kods
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]')                               // phone numbers and the like
}

function push(message: string, stack?: string): void {
  buffer.push({
    at: new Date().toISOString(),
    message: scrubPersonalData(message).slice(0, 500),
    stack: stack ? scrubPersonalData(stack).slice(0, 2000) : undefined,
  })
  if (buffer.length > MAX) buffer.shift()
}

export function recentErrors(): LoggedError[] {
  return [...buffer]
}

let installed = false

/** Called once at start-up. Listens; never changes how errors behave. */
export function installErrorLog(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', e => push(e.message || String(e.error), e.error?.stack))
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason as { message?: string; stack?: string } | undefined
    push(r?.message ?? String(e.reason), r?.stack)
  })
  const original = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    push(args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : '')).join(' ').trim() || 'console.error',
      args.find((a): a is Error => a instanceof Error)?.stack)
    original(...args)
  }
}
