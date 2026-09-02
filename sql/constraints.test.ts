/**
 * Replays every migration in order and asks: at the end, how many CHECK
 * constraints guard the same column's allowed values?
 *
 * The answer must be one. Here is what happened when it was two:
 *
 *   sql/024  add worker_rates_applies_valid  (too, disain)
 *   sql/026  add worker_rates_applies_valid  (+ muudatus)
 *   sql/039  add worker_rates_scope_valid    (+ lisa)    ← a NEW name, and the
 *                                                         drop above it named
 *                                                         the new one too, so
 *                                                         the old one survived
 *   sql/040  add worker_rates_scope_valid    (- lisa)
 *   sql/048  add worker_rates_scope_valid    (+ mudel)
 *
 * From 039 the table carried two constraints on `applies_to`, and a row must
 * satisfy BOTH. Nothing broke while they happened to allow the same values.
 * Then 048 widened one to allow 'mudel' and the other still did not, so
 * "Mille eest: Mudel" could never be saved — and the error named
 * `worker_rates_applies_valid`, a constraint no recent migration mentions.
 *
 * `drop constraint IF EXISTS` is what kept it quiet. It is the right tool for a
 * re-runnable migration, and it also means a mistyped name drops nothing and
 * says nothing. The typo and the safety net cancel out, so the name has to be
 * checked somewhere else. Here.
 *
 * A TEXT replay, not a database check: migrations are run by hand in the
 * Supabase editor and there is no test database to point at.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = __dirname
const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()

/** A migration's live SQL. Comments are stripped BEFORE anything is matched. */
function liveSql(file: string): string {
  return readFileSync(join(DIR, file), 'utf8')
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n')
}

interface AddedConstraint { table: string; name: string; body: string }

/**
 * Statements, split on `;`.
 *
 * Per STATEMENT and not with one regex over the whole file, because the obvious
 * regex is wrong in a way that hides the very bug this test is about:
 *
 *   alter table public.profiles add column kiirtoo_kordaja numeric(5,2);
 *   alter table public.worker_rates add constraint worker_rates_scope_valid ...
 *
 * A pattern of `alter table (\w+) [\s\S]*? add constraint` happily binds the
 * FIRST table name to the SECOND statement's constraint, filing it under
 * `profiles`. The clash on `worker_rates` then disappears from the report.
 * A statement is the unit the database applies, so it is the unit to parse.
 */
function statementsOf(file: string): string[] {
  return liveSql(file).split(';')
}

const ADD_RE =
  /alter\s+table\s+(?:public\.)?(\w+)\s+add\s+constraint\s+(\w+)\s+check\s*\(([\s\S]*)\)/i
const DROP_RE =
  /alter\s+table\s+(?:public\.)?(\w+)\s+drop\s+constraint\s+if\s+exists\s+(\w+)/i

/**
 * The column whose ALLOWED VALUES a check body restricts — `col in ('a','b')`.
 *
 * Membership only, deliberately. Two constraints on one column are legitimate
 * when they do different jobs: `invoices` has both `bill_to_kind in (...)` and a
 * cross-column rule that a customer invoice must name a customer. Those cannot
 * contradict each other. Two membership LISTS can, and silently.
 */
function membershipColumn(body: string): string | null {
  const m = /(\w+)\s+in\s*\(/i.exec(body)
  return m ? m[1] : null
}

/**
 * Every migration applied in order. Returns the constraints still on each table
 * at the end — which is the state the real database is in.
 */
function replay(upTo: string[] = files): Map<string, AddedConstraint[]> {
  /** table -> name -> constraint */
  const live = new Map<string, Map<string, AddedConstraint>>()
  for (const file of upTo) {
    for (const stmt of statementsOf(file)) {
      const dropped = DROP_RE.exec(stmt)
      if (dropped) { live.get(dropped[1])?.delete(dropped[2]); continue }
      const added = ADD_RE.exec(stmt)
      if (!added) continue
      const [, table, name, body] = added
      const forTable = live.get(table) ?? new Map<string, AddedConstraint>()
      forTable.set(name, { table, name, body })
      live.set(table, forTable)
    }
  }
  const out = new Map<string, AddedConstraint[]>()
  for (const [table, byName] of live) out.set(table, [...byName.values()])
  return out
}

/** Every constraint name any migration creates, for the stale-drop check. */
function everAdded(): Set<string> {
  const names = new Set<string>()
  for (const file of files) {
    for (const stmt of statementsOf(file)) {
      const m = ADD_RE.exec(stmt)
      if (m) names.add(m[2])
    }
  }
  return names
}

describe('sql/ — üks veerg, üks liikmelisuse piirang', () => {
  const final = replay()

  it('finds constraints to replay at all', () => {
    // A scanner that matches nothing would pass every assertion below it.
    const total = [...final.values()].reduce((n, cs) => n + cs.length, 0)
    expect(total).toBeGreaterThan(5)
  })

  it('leaves exactly one membership constraint per column', () => {
    const clashes: string[] = []
    for (const [table, constraints] of final) {
      const byColumn = new Map<string, string[]>()
      for (const c of constraints) {
        const col = membershipColumn(c.body)
        if (!col) continue
        byColumn.set(col, [...(byColumn.get(col) ?? []), c.name])
      }
      for (const [col, names] of byColumn) {
        if (names.length > 1) {
          clashes.push(`${table}.${col}: ${names.join(' + ')}`)
        }
      }
    }
    expect(clashes, 'rida peab rahuldama mõlemad — laienda üht ja teine keelab').toEqual([])
  })

  it('drops a constraint name some migration actually creates', () => {
    // A drop naming a constraint nothing ever added is a typo or dead code, and
    // `if exists` makes those two indistinguishable at run time.
    const known = everAdded()
    const stale: string[] = []
    for (const file of files) {
      for (const stmt of statementsOf(file)) {
        const m = DROP_RE.exec(stmt)
        // Foreign keys and constraints declared inline by `create table` never
        // appear in an `add constraint`; only the hand-redefined checks do, and
        // this repo names all of those `*_valid`.
        if (m && m[2].endsWith('_valid') && !known.has(m[2])) stale.push(`${file}: ${m[2]}`)
      }
    }
    expect(stale, 'drop nimetab piirangut, mida ükski migratsioon ei loo').toEqual([])
  })
})
