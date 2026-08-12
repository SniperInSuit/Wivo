/**
 * Reading dates that came out of the database.
 *
 * `jobs.valmis_aeg` and the revision timestamps are TEXT, written by the app
 * rather than by Postgres, so a malformed value is not a theoretical concern —
 * the Kell field used to write `2026-08-12T1` the moment someone typed the
 * first digit of a time, and that string sat in the row afterwards.
 *
 * date-fns v3 throws `RangeError: Invalid time value` when asked to format an
 * Invalid Date. One such row was therefore enough to take down every view that
 * rendered it — the board, the table, the calendar — behind the error boundary,
 * with no clue as to which job was at fault.
 *
 * A date we cannot read is a missing date. Render it as one and keep the view
 * alive; the row is still visible and can be opened and corrected.
 */
import { format, parseISO, isValid } from 'date-fns'

/** Parse a stored date string, or null if it is absent or unreadable. */
export function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const iso = parseISO(value)
  if (isValid(iso)) return iso
  // parseISO is STRICTER than the Date constructor — notably it wants the 'T'
  // separator, while Postgres can hand back '2026-08-12 17:00:00+00'. Several
  // call sites used `new Date(...)` before this helper existed, so tightening
  // them to parseISO alone would have blanked dates that used to render fine.
  // Only genuinely unparseable values reach null.
  const loose = new Date(value)
  return isValid(loose) ? loose : null
}

/** Format a stored date string, falling back to `fallback` when unreadable. */
export function fmtDate(
  value: string | null | undefined,
  pattern: string,
  fallback = '—',
): string {
  const d = toDate(value)
  return d ? format(d, pattern) : fallback
}

/**
 * Is this a complete `HH:mm`? Guards what gets WRITTEN, so the reader above
 * stays a safety net rather than the thing holding the feature together.
 */
export const isValidTime = (t: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)

/**
 * A `YYYY-MM-DDTHH:mm` the app is willing to store, or null.
 *
 * Deliberately strict: the column is text and accepts anything, which is how
 * the bad rows got there. Anything that would not parse back is dropped rather
 * than stored and rendered as '—' forever.
 */
export function normalizeDateTime(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const [datePart, timePart] = trimmed.split('T')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart ?? '')) return null
  // A date with no usable time is still a date — 12:00 is the same default the
  // deadline field applies when a date is picked and no time is given.
  const time = isValidTime((timePart ?? '').slice(0, 5)) ? timePart.slice(0, 5) : '12:00'
  const composed = `${datePart}T${time}`
  return isValid(parseISO(composed)) ? composed : null
}
