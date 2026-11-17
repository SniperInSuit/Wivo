/**
 * The columns of `profiles` the app may read — the app's half of sql/117.
 *
 * ── Why this is not a string inside supabase.ts ─────────────────────────────
 * sql/117 revoked table-wide SELECT and granted the columns by name, so
 * `select *` is refused and the app has to name them. That makes this list a
 * COPY of something the database decides, and a copy that nothing compares
 * drifts: one column the app names and the database does not grant, or does
 * not have, and the whole read fails — not that column, the read. The screen
 * then shows a blank name and "Role: —", which is indistinguishable from an
 * account with few permissions.
 *
 * It lives here, free of `createClient` and `import.meta.env`, so that
 * sql/test/profilePay.test.ts can run exactly this select against the
 * replayed schema. The guard is that test, not this comment.
 *
 * A column added to `profiles` later is hidden until a migration grants it,
 * and may only be added here in the same change.
 */
export const PROFILE_COLUMNS =
  'id, full_name, username, role, org_role, clinic_id, removed_from, patient_id, language, notify_email, notify_push, ui_prefs, created_at, updated_at' as const

/** The same list, one per entry — for a test, or anything that needs them apart. */
export const PROFILE_COLUMN_LIST: readonly string[] = PROFILE_COLUMNS.split(',').map(c => c.trim())
