/**
 * Every field the app writes to `jobs` is created by some migration.
 *
 * ── The bug this is for ─────────────────────────────────────────────────────
 * A job insert is a raw spread of the object (`useJobs.ts`), so ONE column the
 * database does not have rejects the whole row. Nothing in the app checks, and
 * nothing in the build does either: the type says `Job` and PostgREST says 400.
 *
 * It has already happened twice — `mudel_id` and `extra_costs` — and both times
 * it was found in production, on a live database that had drifted. Those two
 * were survivable because one database existed and someone could add a column
 * to it by hand. A fresh database for a new customer hits every missing column
 * at once, and `docs/onboarding-audit.md` found five of them sitting there,
 * created in no file at all.
 *
 * ── Why the type file is the source ─────────────────────────────────────────
 * `types/job.ts` is what the app actually sends. A list maintained here would
 * be a third copy of the schema, which is the same trap the five missing
 * columns fell into — the README held a copy, it went stale, and nobody could
 * tell by looking.
 *
 * A TEXT comparison, not a database check: the migrations are run by hand in
 * the Supabase editor and there is no test database to point at. So this cannot
 * prove the live database is right. It proves that a fresh one would be, which
 * is the thing that was broken.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SQL_DIR = __dirname
const JOB_TYPES = join(__dirname, '..', 'src', 'renderer', 'src', 'types', 'job.ts')

/** Field names of the `Job` interface, in declaration order. */
function jobFields(): string[] {
  const src = readFileSync(JOB_TYPES, 'utf8')
  const start = src.indexOf('export interface Job {')
  if (start < 0) throw new Error('no Job interface — did it move?')
  const body = src.slice(start, src.indexOf('\n}', start))
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map(m => m[1])
}

/** Every `jobs` column any migration creates, however it creates it. */
function createdColumns(): Set<string> {
  const out = new Set<string>()
  for (const file of readdirSync(SQL_DIR).filter(f => f.endsWith('.sql'))) {
    const sql = readFileSync(join(SQL_DIR, file), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

    // `alter table … jobs … add column if not exists <name>`, including the
    // comma-separated form where one statement adds several.
    for (const stmt of sql.split(';')) {
      if (!/alter\s+table\s+(?:public\.)?jobs\b/i.test(stmt)) continue
      for (const m of stmt.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)) {
        out.add(m[1])
      }
    }

    // The create-table body.
    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?jobs\s*\(([\s\S]*?)\n\)/i
      .exec(sql)
    if (create) {
      for (const line of create[1].split('\n')) {
        const m = /^\s*(\w+)\s+\S/.exec(line)
        // Skip table-level constraints, which start with a keyword.
        if (m && !/^(primary|foreign|unique|check|constraint)$/i.test(m[1])) out.add(m[1])
      }
    }
  }
  return out
}

describe('jobs columns', () => {
  const fields = jobFields()
  const created = createdColumns()

  it('finds the interface at all', () => {
    // A guard on the parser rather than on the schema: if this file silently
    // read zero fields, every assertion below would pass for the wrong reason.
    expect(fields.length).toBeGreaterThan(30)
    expect(fields).toContain('patsient')
  })

  it('creates the table itself, not just alterations to it', () => {
    expect(created.has('id'), 'no migration creates public.jobs').toBe(true)
  })

  it('creates every column the app writes', () => {
    const missing = fields.filter(f => !created.has(f))
    expect(missing, 'columns in types/job.ts that no migration creates').toEqual([])
  })

  it('creates the five that existed in no file before sql/000', () => {
    // Named explicitly so that deleting 000 fails with the reason rather than
    // with a list of forty columns.
    for (const col of ['masina', 'print_id', 'kiirtoo', 'disain_hind', 'revisions']) {
      expect(created.has(col), col).toBe(true)
    }
  })
})
