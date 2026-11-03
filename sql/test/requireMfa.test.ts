/**
 * sql/098: the database requires the second factor, not only the app's screens.
 *
 * - Every table in `public` and storage.objects carries the restrictive
 *   "mfa_required" policy (the catalog check fails for a new table without it).
 * - A session signed in with the password alone (aal1) gets nothing: no row of
 *   any table, no write, no file — except reading its own profile row.
 * - A session that has been ended (an owner's reset, "sign out everywhere")
 *   gets nothing at once, though its token still says aal2.
 * - The API-wide check (db_pre_request) refuses every request without the
 *   second factor except reading one's own profile; that is what covers the
 *   SECURITY DEFINER functions, which RLS does not reach.
 * - 098 works on production's base too: 000–091, without 092–097.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  freshDb, emptyDb, applyMigrations, migrationFiles, createTenant, makeRow, primaryKey, publicTables,
  rowsAs, errorAs, as, type Tenant, type Actor,
} from './harness'

let db: PGlite
let A: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
}, 120_000)

const password = (id: string): Actor => ({ id, mfa: false })

async function newSession(userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.sessions (user_id, aal) values ($1, 'aal2') returning id`, [userId])
  return rows[0].id
}
const inSession = (id: string, session: string): Actor => ({ id, mfa: true, claims: { session_id: session } })

/** `where pk1 = $1 and pk2 = $2` for one row. */
function wherePk(pk: string[], row: Record<string, unknown>): [string, unknown[]] {
  return [pk.map((c, i) => `"${c}" = $${i + 1}`).join(' and '), pk.map(c => row[c])]
}

async function missingPolicies(d: PGlite): Promise<string[]> {
  const { rows } = await d.query<{ name: string }>(`
    select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not exists (select 1 from pg_policy p
                        where p.polrelid = c.oid and not p.polpermissive
                          and p.polname like 'mfa_required%'
                          and pg_get_expr(p.polqual, p.polrelid) like '%has_mfa()%')
    union all
    select 'storage.objects' where not exists (
      select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
         and not p.polpermissive and p.polname = 'mfa_required')
    order by 1`)
  return rows.map(r => r.name)
}

describe('the policy is on every table', () => {
  it('every table in public and storage.objects has the restrictive mfa_required', async () => {
    expect(await missingPolicies(db)).toEqual([])
  })
})

describe('a password-only session (aal1) gets nothing', () => {
  it('cannot read, change or delete a row of any table — its own organisation\'s', async () => {
    const failures: string[] = []
    for (const table of await publicTables(db)) {
      const row = await makeRow(db, table, A)
      const pk = await primaryKey(db, table)
      const [where, params] = wherePk(pk, row)
      for (const [who, id] of [['owner', A.ownerId], ['worker', A.workerId]] as const) {
        const actor = password(id)
        if (table === 'profiles' && row.id === id) continue  // their own row: below
        const seen = await rowsAs(db, actor, `select 1 from public.${table} where ${where}`, params).catch(() => [])
        if (seen.length > 0) failures.push(`${table}: ${who} can READ it`)
        const updated = await rowsAs(db, actor, `update public.${table} set "${pk[0]}" = "${pk[0]}" where ${where} returning 1`, params).catch(() => [])
        if (updated.length > 0) failures.push(`${table}: ${who} can UPDATE it`)
        const deleted = await rowsAs(db, actor, `delete from public.${table} where ${where} returning 1`, params).catch(() => [])
        if (deleted.length > 0) failures.push(`${table}: ${who} can DELETE it`)
      }
    }
    expect(failures).toEqual([])
  }, 120_000)

  it('the same owner with the second factor does see the clinic\'s data', async () => {
    const job = await makeRow(db, 'jobs', A)
    const patient = await makeRow(db, 'patients', A)
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.jobs where id = $1`, [job.id])).toHaveLength(1)
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.patients where id = $1`, [patient.id])).toHaveLength(1)
    expect(await rowsAs(db, password(A.ownerId), `select 1 from public.jobs where id = $1`, [job.id])).toHaveLength(0)
  })

  it('cannot add a job or a patient', async () => {
    expect(await errorAs(db, password(A.ownerId),
      `insert into public.jobs (clinic_id, patsient, kuupaev) values ($1, 'X', current_date)`, [A.clinicId]))
      .toMatch(/row-level security/)
    expect(await errorAs(db, password(A.ownerId),
      `insert into public.patients (clinic_id, nimi) values ($1, 'X')`, [A.clinicId]))
      .toMatch(/row-level security/)
    // The same insert with the second factor goes through: it is the factor, not the statement.
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.jobs (clinic_id, patsient, kuupaev) values ($1, 'X', current_date)`, [A.clinicId])).toBeNull()
  })

  it('reads only its own profile row, and cannot change it', async () => {
    const mine = await rowsAs<{ id: string }>(db, password(A.workerId), `select id from public.profiles`)
    expect(mine.map(r => r.id)).toEqual([A.workerId])
    expect(await rowsAs(db, password(A.workerId),
      `update public.profiles set full_name = 'Changed' where id = $1 returning 1`, [A.workerId]).catch(() => [])).toHaveLength(0)
  })

  it('cannot see or add a file', async () => {
    const path = `${A.clinicId}/job/x.stl`
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('job-files', $1, $2)`, [path, A.ownerId])
    expect(await rowsAs(db, password(A.ownerId), `select 1 from storage.objects where name = $1`, [path])).toHaveLength(0)
    expect(await errorAs(db, password(A.ownerId),
      `insert into storage.objects (bucket_id, name, owner) values ('job-files', $1, $2)`, [`${A.clinicId}/job/y.stl`, A.ownerId]))
      .toMatch(/row-level security/)
  })
})

describe('an ended session gets nothing at once, though its token says aal2', () => {
  it('a session deleted from auth.sessions sees no job', async () => {
    const job = await makeRow(db, 'jobs', A)
    const s = await newSession(A.workerId)
    await db.query(`update public.jobs set assigned_to = $1 where id = $2`, [A.workerId, job.id])
    expect(await rowsAs(db, inSession(A.workerId, s), `select 1 from public.jobs where id = $1`, [job.id])).toHaveLength(1)
    await db.query(`delete from auth.sessions where id = $1`, [s])
    expect(await rowsAs(db, inSession(A.workerId, s), `select 1 from public.jobs where id = $1`, [job.id])).toHaveLength(0)
  })

  it('after an owner\'s reset (complete_mfa_change, signed out) the member\'s open session reads nothing', async () => {
    const job = await makeRow(db, 'jobs', A)
    await db.query(`update public.jobs set assigned_to = $1 where id = $2`, [A.workerId, job.id])
    const s = await newSession(A.workerId)
    await db.query(`select public.complete_mfa_change('mfa_reset', $1, $2, $3, '{"reason":"Lost phone"}', true)`,
      [A.clinicId, A.ownerId, A.workerId])
    expect(await rowsAs(db, inSession(A.workerId, s), `select 1 from public.jobs where id = $1`, [job.id])).toHaveLength(0)
    expect(await rowsAs(db, inSession(A.workerId, s), `select 1 from public.notification`)).toHaveLength(0)
  })

  it('someone else\'s session, no session, or a malformed one: nothing, and no error', async () => {
    await makeRow(db, 'jobs', A)
    const ownerSession = await newSession(A.ownerId)
    for (const claims of [{ session_id: ownerSession }, { session_id: null }, { session_id: 'not-a-uuid' }]) {
      const actor: Actor = { id: A.workerId, mfa: true, claims }
      expect(await rowsAs(db, actor, `select 1 from public.jobs`)).toHaveLength(0)
      expect((await rowsAs<{ ok: boolean }>(db, actor, `select public.has_mfa() as ok`))[0].ok).toBe(false)
    }
  })
})

describe('every API request (db_pre_request)', () => {
  /** require_mfa_for_api() as PostgREST calls it: role, claims and request settings in place. */
  async function request(actor: Actor, method: string, path: string): Promise<string | null> {
    try {
      await as(db, actor, async () => {
        await db.query(`select set_config('request.method', $1, false), set_config('request.path', $2, false)`, [method, path])
        await db.query(`select public.require_mfa_for_api()`)
      })
      return null
    } catch (e) {
      return (e as Error).message
    }
  }

  it('is what PostgREST runs before each request', async () => {
    const { rows } = await db.query<{ cfg: string[] }>(`select rolconfig as cfg from pg_roles where rolname = 'authenticator'`)
    expect(rows[0].cfg).toContain('pgrst.db_pre_request=public.require_mfa_for_api')
  })

  it('refuses a password-only session everything but reading its own profile — functions included', async () => {
    expect(await request(password(A.ownerId), 'GET', '/profiles')).toBeNull()
    for (const [m, p] of [['GET', '/jobs'], ['GET', '/clinics'], ['PATCH', '/profiles'], ['POST', '/rpc/patient_export'],
                          ['POST', '/rpc/job_files'], ['POST', '/rpc/request_file_download'], ['POST', '/rpc/audit_entries']]) {
      expect(await request(password(A.ownerId), m, p)).toMatch(/second factor first/)
    }
  })

  it('lets the second factor through, and leaves anonymous requests to RLS', async () => {
    expect(await request({ id: A.ownerId }, 'POST', '/rpc/patient_export')).toBeNull()
    expect(await request('anon', 'POST', '/rpc/anything')).toBeNull()
  })

  it('refuses an ended session', async () => {
    const s = await newSession(A.ownerId)
    await db.query(`delete from auth.sessions where id = $1`, [s])
    expect(await request(inSession(A.ownerId, s), 'GET', '/jobs')).toMatch(/second factor first/)
  })
})

describe('098 on production\'s base (000–091, without 092–097)', () => {
  it('applies, and puts the policy on every table', async () => {
    const d = await emptyDb()
    const files = migrationFiles().filter(f => f <= '091' || f.startsWith('098_'))
    expect(files.at(-1)).toMatch(/^098_/)
    await applyMigrations(d, files)
    expect(await missingPolicies(d)).toEqual([])
    // And a new table (092–097 arriving later) is covered by running it again.
    await d.exec(`create table public.later (id int primary key); alter table public.later enable row level security;`)
    expect(await missingPolicies(d)).toEqual(['later'])
    await d.exec(`select public.ensure_mfa_policies()`)
    expect(await missingPolicies(d)).toEqual([])
  }, 120_000)
})
