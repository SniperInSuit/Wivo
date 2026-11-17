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
 * ── Which way round the mismatch is ─────────────────────────────────────────
 * The two directions are not the same message, and the first version of this
 * file had them as one. `42501` is a column the database HAS and does not
 * grant this build: the app is behind, and "update Wivo" fixes it. `42703`
 * and its kind are a column the build NAMES and the database does not have:
 * the database is behind, and updating the app makes it worse. That one
 * happened the same evening — a build from `testing` against production,
 * which has no `notify_push` yet (sql/095) — and it said "Update Wivo".
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
  /** The database has the column and does not grant it to this build: app older than schema. */
  | 'schema'
  /** The build names a column, table or function this database does not have: schema older than app. */
  | 'database'
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
 * "The database has it and will not give it to this build" — the app is
 * behind. `42501` insufficient_privilege: the revoked table-wide SELECT of
 * sql/117 against a build that still asks for `select *`.
 */
const APP_BEHIND_CODES = new Set(['42501'])

/**
 * "This build names something the database does not have" — the database is
 * behind. Updating the app would only widen the gap.
 *
 *   42703  undefined_column   — a column this build names, e.g. notify_push (sql/095)
 *   42P01  undefined_table    — a table this build names
 *   PGRST204/PGRST202 — PostgREST's own "no such column / no such function"
 */
const DATABASE_BEHIND_CODES = new Set(['42703', '42P01', 'PGRST204', 'PGRST202'])

/** No rows came back. PostgREST says this for `.single()` over an empty result. */
const MISSING_CODES = new Set(['PGRST116'])

export function classifyProfileError(e: ProfileError | null | undefined): ProfileFailure {
  if (!e) return 'unknown'
  // Before anything else: the second factor is a step, not a fault.
  if (e.hint === 'mfa_required') return 'mfa'

  const code = e.code ?? ''
  if (MISSING_CODES.has(code)) return 'missing'
  if (APP_BEHIND_CODES.has(code)) return 'schema'
  if (DATABASE_BEHIND_CODES.has(code)) return 'database'

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
 * without having to know which codes mean what — and so that `database`, the
 * other direction, cannot reach it by accident.
 */
export const meansAppIsBehind = (f: ProfileFailure): boolean => f === 'schema'

/**
 * Is this failure worth putting on the screen?
 *
 * `mfa` is not: the sign-in is mid-flight and the profile arrives a moment
 * later. Showing an error there would make a normal sign-in look broken.
 */
export const worthShowing = (f: ProfileFailure): boolean => f !== 'mfa'
