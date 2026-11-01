/**
 * Spec, Phase 0: "a fresh database builds from the migrations, from zero,
 * without manual steps".
 *
 * Every migration is executed, in order, on an empty Supabase-shaped database.
 * The two manual edits a person makes in the SQL editor (see
 * `prepareMigration`) are made by the harness; everything else runs as written.
 */
import { describe, it, expect } from 'vitest'
import { emptyDb, applyMigrations, migrationFiles } from './harness'

describe('fresh database from sql/', () => {
  it('applies every migration in order, each exactly once', async () => {
    const db = await emptyDb()
    await applyMigrations(db)
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public'`,
    )
    expect(rows[0].n).toBeGreaterThan(20)
  }, 120_000)

  it('numbers are unique — two files with the same prefix run in an order nobody chose', () => {
    const prefixes = migrationFiles().map(f => f.slice(0, 3))
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })
})
