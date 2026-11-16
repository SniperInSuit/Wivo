/**
 * Why the profile could not be read — and which of those means "update Wivo".
 *
 * ── The failure this exists for ─────────────────────────────────────────────
 * `getProfile` ended in `if (error) return null`, so a missing row, a refusal
 * and a dead network all arrived as the same `null`. The screen then said
 * "Role: —", the name was blank and the menu lost every item that needs a
 * profile — with nothing anywhere saying what had happened. It took reading
 * four migrations to find out, and the answer was none of the obvious ones.
 *
 * ── The one that actually happened ──────────────────────────────────────────
 * sql/117 revoked table-wide SELECT on `profiles` and granted the columns by
 * name, so `select *` is refused. A build that still asks for `*` reads no
 * profile at all against that database. That is not a broken database and not
 * a broken sign-in: it is an app older than the schema it is talking to, and
 * the only useful thing to say is "update the app".
 *
 * So a permission refusal on a plain read is classified as `schema`, and the
 * caller raises the same "Update Wivo" that sql/104 raises when a save is
 * refused for being too old (docs/MIN-VERSION.md). One message, two routes to
 * it: the database refusing a save because it knows the version, and the
 * database refusing a read because the build asks for something it no longer
 * grants.
 *
 * ── What is deliberately NOT `schema` ───────────────────────────────────────
 * The second factor. Before it, sql/098 refuses nearly everything, and the
 * sign-in that follows loads the profile again — telling someone to update
 * Wivo at that moment would be a lie, and they would do it.
 */

/** Why the profile is not here. */
export type ProfileFailure =
  /** The row is not there. A sign-up that never got a profile, or the wrong project. */
  | 'missing'
  /** The database refused a column or a table this build asks for: app older than schema. */
  | 'schema'
  /** No second factor yet. Not an error — the next sign-in step loads it. */
  | 'mfa'
  /** Could not reach the database at all. */
  | 'offline'
  /** Anything else, reported with whatever the database said. */
  | 'unknown'

export interface ProfileError {
  code?: string
  message?: string
  hint?: string
  status?: number
}

/**
 * PostgREST codes that mean "this build asked for something the database does
 * not grant it".
 *
 *   42501  insufficient_privilege — the revoked table-wide SELECT of sql/117
 *   42703  undefined_column       — a column this build names and the schema lost
 *   42P01  undefined_table        — a table this build names and the schema lost
 *   PGRST204/PGRST202 — PostgREST's own "no such column / no such function"
 */
const SCHEMA_CODES = new Set(['42501', '42703', '42P01', 'PGRST204', 'PGRST202'])

/** No rows came back. PostgREST says this for `.single()` over an empty result. */
const MISSING_CODES = new Set(['PGRST116'])

export function classifyProfileError(e: ProfileError | null | undefined): ProfileFailure {
  if (!e) return 'unknown'
  // Before anything else: the second factor is a step, not a fault.
  if (e.hint === 'mfa_required') return 'mfa'

  const code = e.code ?? ''
  if (MISSING_CODES.has(code)) return 'missing'
  if (SCHEMA_CODES.has(code)) return 'schema'

  // supabase-js reports a dead network with no code and no status.
  if (!code && !e.status) return 'offline'

  // A 403 with no code is the same refusal seen from the HTTP side.
  if (e.status === 403) return 'schema'
  return 'unknown'
}

/**
 * Does this failure mean the app is behind the database?
 *
 * Kept separate from the classification so the caller can raise "Update Wivo"
 * without having to know which codes mean what.
 */
export const meansAppIsBehind = (f: ProfileFailure): boolean => f === 'schema'

/**
 * Is this failure worth putting on the screen?
 *
 * `mfa` is not: the sign-in is mid-flight and the profile arrives a moment
 * later. Showing an error there would make a normal sign-in look broken.
 */
export const worthShowing = (f: ProfileFailure): boolean => f !== 'mfa'
