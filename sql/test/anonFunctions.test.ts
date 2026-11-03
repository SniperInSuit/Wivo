/**
 * sql/101: with only the public key, no function in `public` runs, but the one
 * PostgREST itself needs before every request. A signed-in user and the
 * service role run exactly what they could before.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, emptyDb, applyMigrations, migrationFiles, createTenant, rowsAs, errorAs, as, type Tenant } from './harness'

let db: PGlite
let A: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
}, 120_000)

/** Non-trigger functions in `public` a role can run. */
async function runnable(d: PGlite, role: string): Promise<string[]> {
  const { rows } = await d.query<{ f: string }>(`
    select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype
       and has_function_privilege($1, p.oid, 'execute')
     order by 1`, [role])
  return rows.map(r => r.f)
}

describe('the anonymous key', () => {
  it('can run require_mfa_for_api() and nothing else in public', async () => {
    expect(await runnable(db, 'anon')).toEqual(['require_mfa_for_api()'])
  })

  it('the ones that worked for anyone are refused: chat_prune, purge_visit_requests, recalc_invoice_totals', async () => {
    for (const sql of [`select public.chat_prune()`, `select public.purge_visit_requests()`,
                       `select public.recalc_invoice_totals(gen_random_uuid())`, `select public.has_mfa()`,
                       `select public.preview_partnership_invite('x')`, `select public.my_clinic_id()`]) {
      expect(await errorAs(db, 'anon', sql)).toMatch(/permission denied for function/)
    }
  })

  it('the API check before each request still runs for an anonymous request', async () => {
    await expect(as(db, 'anon', async () => {
      await db.query(`select set_config('request.method', 'GET', false), set_config('request.path', '/jobs', false)`)
      await db.query(`select public.require_mfa_for_api()`)
    })).resolves.toBeUndefined()
  })

  it('reading a table still gets nothing', async () => {
    await db.query(`insert into public.jobs (clinic_id, patsient, kuupaev) values ($1, 'X', current_date)`, [A.clinicId])
    const seen = await rowsAs(db, 'anon', `select 1 from public.jobs`).catch(() => [])
    expect(seen).toEqual([])
  })
})

describe('a signed-in user and the service role', () => {
  it('can run exactly what they could before 101', async () => {
    const before = await emptyDb()
    await applyMigrations(before, migrationFiles().filter(f => f < '101'))
    const added = ['anon_allowed_functions()']  // new in 101, for them to read
    for (const role of ['authenticated', 'service_role']) {
      expect((await runnable(db, role)).filter(f => !added.includes(f))).toEqual(await runnable(before, role))
      expect(await runnable(db, role)).not.toContain('lock_anon_functions()')
    }
  }, 120_000)

  it('ordinary work still runs: a job gets its code (trigger) and the owner reads it (policy functions)', async () => {
    const [{ id }] = await rowsAs<{ id: string }>(db, { id: A.ownerId },
      `insert into public.jobs (clinic_id, patsient, kuupaev) values ($1, 'Y', current_date) returning id`, [A.clinicId])
    const [job] = await rowsAs<{ job_code: string | null }>(db, { id: A.ownerId }, `select job_code from public.jobs where id = $1`, [id])
    expect(job.job_code).toMatch(/-\d{2}-/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.my_clinic_id()`)).toBeNull()
  })

  it('nobody but the database owner can run the lock itself', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.lock_anon_functions()`)).toMatch(/permission denied/)
  })
})

describe('later functions', () => {
  it('a new one is open to anon until lock_anon_functions() runs; then only the signed-in keep it', async () => {
    await db.exec(`create function public.later_fn() returns int language sql as 'select 1'`)
    expect(await runnable(db, 'anon')).toContain('later_fn()')
    await db.exec(`select public.lock_anon_functions()`)
    expect(await runnable(db, 'anon')).toEqual(['require_mfa_for_api()'])
    expect(await runnable(db, 'authenticated')).toContain('later_fn()')
    await db.exec(`drop function public.later_fn()`)
  })
})

describe('101 on production\'s base (000–091, without 092–100)', () => {
  it('applies, and anon runs nothing (no require_mfa_for_api there yet)', async () => {
    const d = await emptyDb()
    const files = migrationFiles().filter(f => f <= '091' || f.startsWith('101_'))
    await applyMigrations(d, files)
    expect(await runnable(d, 'anon')).toEqual([])
  }, 120_000)
})
