/**
 * A real Postgres, built from `sql/` alone, for tests.
 *
 * Until now every SQL test in this repo was a TEXT replay ("there is no test
 * database to point at"). PGlite is Postgres compiled to WASM: it runs inside
 * vitest, needs no server and leaves nothing running. With it the migrations
 * are actually executed, in order, on an empty database — and RLS is checked
 * by querying as a real `authenticated` user, which no text replay can do.
 *
 * What it stands in for, and what it cannot: docs/night-run/DECISIONS.md, D3.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

export const SQL_DIR = join(__dirname, '..')

/** Every migration, in the order they are run: by file name. */
export function migrationFiles(): string[] {
  return readdirSync(SQL_DIR).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()
}

/**
 * The two edits a person makes before pasting a migration into the editor,
 * made here so the replay needs nobody.
 *
 * - `create extension pg_cron / pg_net`: PGlite has neither. The shim provides
 *   the functions the migrations call, so only the CREATE line is skipped.
 * - `<SERVICE_ROLE_KEY>`: sql/052 and sql/056 refuse to run until a real key
 *   is pasted in (on purpose — see their headers). A fake one that passes their
 *   `^eyJ` check is enough here; nothing is ever called with it.
 */
export function prepareMigration(sql: string): string {
  return sql
    .replace(/create extension if not exists (pg_cron|pg_net)\b[^;]*;/gi, '-- [harness] $&')
    .replaceAll('<SERVICE_ROLE_KEY>', 'eyJ.harness-test-key.not-real')
}

const SHIM = readFileSync(join(__dirname, 'supabaseShim.sql'), 'utf8')

async function newDb(loadDataDir?: Blob): Promise<PGlite> {
  return PGlite.create({ extensions: { pgcrypto }, ...(loadDataDir ? { loadDataDir } : {}) })
}

/** An empty Supabase-shaped database: the shim, no migrations. */
export async function emptyDb(): Promise<PGlite> {
  const db = await newDb()
  await db.exec(SHIM)
  return db
}

/** Apply migrations in order. Throws naming the file that failed. */
export async function applyMigrations(db: PGlite, files = migrationFiles()): Promise<void> {
  for (const f of files) {
    try {
      await db.exec(prepareMigration(readFileSync(join(SQL_DIR, f), 'utf8')))
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`)
    }
    // A migration may leave the role or search_path changed; the next one
    // must start where the SQL editor would.
    await db.exec(`reset role; set search_path = "$user", public, extensions;`)
  }
}

/**
 * A fully migrated database.
 *
 * Replaying ~70 migrations takes a few seconds, and every test file wants a
 * fresh copy, so the finished data directory is cached on disk — keyed by the
 * content of the shim and every migration, so changing any of them rebuilds it.
 */
export async function freshDb(): Promise<PGlite> {
  const files = migrationFiles()
  const hash = createHash('sha256').update(SHIM)
  for (const f of files) hash.update(f).update(readFileSync(join(SQL_DIR, f)))
  const dir = join(tmpdir(), 'wivo-pglite-cache')
  const cache = join(dir, `${hash.digest('hex').slice(0, 16)}.tar.gz`)

  if (existsSync(cache)) {
    const db = await newDb(new Blob([readFileSync(cache)]))
    await db.exec(`set search_path = "$user", public, extensions;`)
    return db
  }
  const db = await emptyDb()
  await applyMigrations(db, files)
  const dump = await db.dumpDataDir('gzip')
  mkdirSync(dir, { recursive: true })
  writeFileSync(cache, Buffer.from(await dump.arrayBuffer()))
  return db
}

// ── Acting as someone ───────────────────────────────────────────────────────

/** Who a query runs as. A user id means a signed-in `authenticated` user. */
export type Actor = { id: string } | 'anon'

/**
 * Runs `fn` as that actor, exactly as PostgREST would: the database role
 * switches to `authenticated` / `anon` and `request.jwt.claims` carries the
 * user id, which is what `auth.uid()` reads. Always switches back, even when
 * `fn` throws — a test that forgot to would run the rest of the file as a
 * restricted user and pass or fail for the wrong reason.
 */
export async function as<T>(db: PGlite, actor: Actor, fn: () => Promise<T>): Promise<T> {
  const role = actor === 'anon' ? 'anon' : 'authenticated'
  const claims = actor === 'anon' ? { role: 'anon' } : { sub: actor.id, role: 'authenticated' }
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)])
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}

/** Rows visible to `actor` for a query. */
export async function rowsAs<T = Record<string, unknown>>(
  db: PGlite, actor: Actor, sql: string, params: unknown[] = [],
): Promise<T[]> {
  return as(db, actor, async () => (await db.query<T>(sql, params)).rows)
}

/**
 * The error a statement raises as `actor`, or null if it succeeded. For
 * asserting that a write is REFUSED: a test that only checks "no rows came
 * back" would pass on a write that silently did nothing and on one that was
 * blocked, which are different outcomes.
 */
export async function errorAs(
  db: PGlite, actor: Actor, sql: string, params: unknown[] = [],
): Promise<string | null> {
  try {
    await as(db, actor, () => db.query(sql, params))
    return null
  } catch (e) {
    return (e as Error).message
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

let seq = 0

/** A signed-up user. The profile row is made by the real 012 trigger. */
export async function createUser(db: PGlite, fullName = `User ${++seq}`): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
    [`u${Date.now()}-${++seq}@test.invalid`, fullName],
  )
  return rows[0].id
}

export interface Tenant {
  clinicId: string
  ownerId: string
  workerId: string
}

/** A clinic with an owner and a worker — one tenant, as the app sets it up. */
export async function createTenant(db: PGlite, name: string): Promise<Tenant> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.clinics (name) values ($1) returning id`, [name],
  )
  const clinicId = rows[0].id
  const ownerId = await createUser(db, `${name} owner`)
  const workerId = await createUser(db, `${name} worker`)
  await db.query(`update public.profiles set clinic_id = $1, role = 'owner'  where id = $2`, [clinicId, ownerId])
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [clinicId, workerId])
  return { clinicId, ownerId, workerId }
}
