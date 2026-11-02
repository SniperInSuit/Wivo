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

/**
 * Who a query runs as. A user id means a signed-in `authenticated` user;
 * `mfa: true` means they signed in with a second factor (`aal2`).
 */
export type Actor = { id: string; mfa?: boolean } | 'anon'

/**
 * Runs `fn` as that actor, exactly as PostgREST would: the database role
 * switches to `authenticated` / `anon` and `request.jwt.claims` carries the
 * user id, which is what `auth.uid()` reads. Always switches back, even when
 * `fn` throws — a test that forgot to would run the rest of the file as a
 * restricted user and pass or fail for the wrong reason.
 */
export async function as<T>(db: PGlite, actor: Actor, fn: () => Promise<T>): Promise<T> {
  const role = actor === 'anon' ? 'anon' : 'authenticated'
  const claims = actor === 'anon'
    ? { role: 'anon' }
    : { sub: actor.id, role: 'authenticated', aal: actor.mfa ? 'aal2' : 'aal1' }
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
  // `org_role` exists from sql/070 on; the harness also builds databases
  // that stop earlier, so it is set only where the column is there.
  const { rows: hasOrgRole } = await db.query(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'org_role'`)
  const orgRole = (r: string): string => (hasOrgRole.length ? `, org_role = '${r}'` : '')
  await db.query(`update public.profiles set clinic_id = $1, role = 'owner'${orgRole('owner')} where id = $2`, [clinicId, ownerId])
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker'${orgRole('technician')} where id = $2`, [clinicId, workerId])
  return { clinicId, ownerId, workerId }
}

// ── Generic rows, for leak tests over every table ───────────────────────────

interface Col { name: string; type: string; nullable: boolean; hasDefault: boolean }
interface Fk { column: string; refTable: string; refSchema: string; refColumn: string }

async function columnsOf(db: PGlite, table: string): Promise<Col[]> {
  const { rows } = await db.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null; is_generated: string; is_identity: string }>(
    `select column_name, data_type, is_nullable, column_default, is_generated, is_identity
       from information_schema.columns where table_schema = 'public' and table_name = $1
      order by ordinal_position`, [table])
  return rows
    .filter(r => r.is_generated === 'NEVER')
    .map(r => ({
      name: r.column_name, type: r.data_type, nullable: r.is_nullable === 'YES',
      hasDefault: r.column_default !== null || r.is_identity === 'YES',
    }))
}

async function fksOf(db: PGlite, table: string): Promise<Fk[]> {
  const { rows } = await db.query<{ column: string; ref_table: string; ref_schema: string; ref_column: string }>(
    `select a.attname as column, cf.relname as ref_table, nf.nspname as ref_schema, af.attname as ref_column
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
       join pg_class cf on cf.oid = c.confrelid join pg_namespace nf on nf.oid = cf.relnamespace
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
      where c.contype = 'f' and n.nspname = 'public' and t.relname = $1`, [table])
  return rows.map(r => ({ column: r.column, refTable: r.ref_table, refSchema: r.ref_schema, refColumn: r.ref_column }))
}

/** The first value a CHECK constraint on this column allows, when it lists them. */
async function allowedValue(db: PGlite, table: string, column: string): Promise<string | null> {
  const { rows } = await db.query<{ def: string }>(
    `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
      where c.contype = 'c' and n.nspname = 'public' and t.relname = $1`, [table])
  for (const { def } of rows) {
    if (!new RegExp(`\\b${column}\\b`).test(def)) continue
    // A phone push endpoint (sql/091): a real push service, unique per row.
    if (def.includes(`is_push_endpoint(${column})`)) return `https://fcm.googleapis.com/fcm/send/t${++seq}`
    // A fixed-length hex pattern (`~ '^[0-9a-f]{64}$'`, a SHA-256): that many hex digits.
    const hex = def.match(/\[0-9a-f\]\{(\d+)\}/)
    if (hex) return 'a'.repeat(Number(hex[1]))
    if (def.includes(' ~ ')) continue  // another pattern: not a list of values
    const m = def.match(/'([^']*)'::/)
    if (m) return m[1]
    // Ranges render as `(col >= 11) AND (col <= 18)`: the lower bound is allowed.
    const lo = def.match(new RegExp(`\\b${column} >= \\(?(-?\\d+)`))
    if (lo) return lo[1]
  }
  return null
}

function sample(type: string): unknown {
  if (/int|numeric|double|real/.test(type)) return 1
  if (type === 'boolean') return false
  if (type === 'uuid') return crypto.randomUUID()
  if (/timestamp/.test(type)) return new Date().toISOString()
  if (type === 'date') return new Date().toISOString().slice(0, 10)
  if (/json/.test(type)) return '{}'
  if (type === 'ARRAY') return '{}'
  return `t${++seq}`
}

/**
 * One row in `table` that belongs to `tenant`, made as the superuser.
 *
 * Fills only what must be filled — NOT NULL columns without a default, plus
 * `clinic_id` / `org_id` always — and follows foreign keys by making the parent
 * row for the same tenant first. Values come from the column's CHECK constraint
 * when it lists allowed values. Returns the primary key of the new row.
 */
export async function makeRow(
  db: PGlite, table: string, tenant: Tenant, depth = 0,
): Promise<Record<string, unknown>> {
  if (depth > 4) throw new Error(`makeRow: foreign keys too deep at ${table}`)
  if (table === 'clinics') return { id: tenant.clinicId }
  if (table === 'profiles') return { id: tenant.ownerId }
  const cols = await columnsOf(db, table)
  const fks = await fksOf(db, table)
  const values: Record<string, unknown> = {}
  // The FIRST organisation column is the tenant's; a second one (org_b,
  // partner_org) is some other organisation, as it would be in real life.
  let orgCols = 0
  const orgFor = async (): Promise<string> => (orgCols++ === 0 ? tenant.clinicId : otherClinic(db))
  for (const c of cols) {
    const fk = fks.find(f => f.column === c.name)
    const tenantCol = c.name === 'clinic_id' || c.name === 'org_id'
    if (!tenantCol && (c.nullable || c.hasDefault)) continue
    if (tenantCol) { values[c.name] = await orgFor(); continue }
    if (fk) {
      if (fk.refSchema === 'auth' || fk.refTable === 'profiles') values[c.name] = tenant.ownerId
      else if (fk.refTable === 'clinics') values[c.name] = await orgFor()
      else values[c.name] = (await makeRow(db, fk.refTable, tenant, depth + 1))[fk.refColumn]
      continue
    }
    values[c.name] = (await allowedValue(db, table, c.name)) ?? sample(c.type)
  }
  const names = Object.keys(values)
  const sql = names.length
    ? `insert into public.${table} (${names.map(n => `"${n}"`).join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')}) returning *`
    : `insert into public.${table} default values returning *`
  const { rows } = await db.query<Record<string, unknown>>(sql, Object.values(values))
  return rows[0]
}

/**
 * An organisation nobody in the test belongs to. A new one each time: some
 * tables allow one row per pair of organisations (a partnership), and a row
 * made for a foreign key must not collide with the next row asked for.
 */
async function otherClinic(db: PGlite): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`insert into public.clinics (name) values ('Elsewhere') returning id`)
  return rows[0].id
}

/** Primary-key columns of a table, for addressing one row. */
export async function primaryKey(db: PGlite, table: string): Promise<string[]> {
  const { rows } = await db.query<{ attname: string }>(
    `select a.attname from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = ('public.' || $1)::regclass and i.indisprimary`, [table])
  return rows.map(r => r.attname)
}

/** Every ordinary table in `public`. */
export async function publicTables(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`)
  return rows.map(r => r.relname)
}

/** Grant permissions to a member, in their own clinic — as the owner would. */
export async function grant(db: PGlite, t: Tenant, profileId: string, perms: string[]): Promise<void> {
  for (const p of perms) {
    await db.query(
      `insert into public.worker_permissions (profile_id, clinic_id, permission) values ($1, $2, $3)
       on conflict (profile_id, permission) do update set granted = true, clinic_id = excluded.clinic_id`,
      [profileId, t.clinicId, p])
  }
}
