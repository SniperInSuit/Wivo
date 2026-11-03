/**
 * sql/checks/schema_check.sql — the read-only check that a database matches
 * the migrations — is current, reads only, finds nothing on a database built
 * from the migrations, and finds each kind of drift.
 *
 * production_check.sql is the same check for what production should have
 * (000–091 and 098: docs/MIGRATIONS.md), and orphan_users.sql lists rows that
 * point at a deleted sign-in account.
 *
 * WRITE_SCHEMA_CHECK=1 regenerates them after a migration changes the schema.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, emptyDb, applyMigrations, migrationFiles } from './harness'
import { CATALOG_SQL, renderCheck, type CatalogRow } from './schemaCatalog'

const FILE = join(__dirname, '..', 'checks', 'schema_check.sql')
const TRIGGER_FILE = join(__dirname, '..', 'checks', 'trigger_check.sql')
const PRODUCTION_FILE = join(__dirname, '..', 'checks', 'production_check.sql')
const ORPHANS_FILE = join(__dirname, '..', 'checks', 'orphan_users.sql')
/** What production has had applied: everything up to 091, then 098 (MFA). */
const PRODUCTION_MIGRATIONS = migrationFiles().filter(f => f < '092' || f.startsWith('098_'))
let fresh: PGlite
let production: PGlite
let check: string
let triggerCheck: string
let productionCheck: string

beforeAll(async () => {
  fresh = await freshDb()
  const { rows } = await fresh.query<CatalogRow>(`${CATALOG_SQL} order by 1, 2`)
  check = renderCheck(rows)
  triggerCheck = renderCheck(rows, { kinds: ['trigger'] })
  production = await emptyDb()
  await applyMigrations(production, PRODUCTION_MIGRATIONS)
  const prod = await production.query<CatalogRow>(`${CATALOG_SQL} order by 1, 2`)
  productionCheck = renderCheck(prod.rows, {
    built: 'sql/000–091 and 098, what production should\n-- have before 2.1',
    runOn: 'PRODUCTION, read-only, to see whether it has drifted from\n-- the migrations it has had (000–091, 098). Anything from 092–097 or 099+\n-- that production already has shows as "extra"',
  })
  if (process.env.WRITE_SCHEMA_CHECK === '1') {
    writeFileSync(FILE, check)
    writeFileSync(TRIGGER_FILE, triggerCheck)
    writeFileSync(PRODUCTION_FILE, productionCheck)
  }
}, 120_000)

interface Diff { kind: string; key: string; status: string }
const differences = async (d: PGlite, file = FILE): Promise<Diff[]> => (await d.query<Diff>(readFileSync(file, 'utf8'))).rows

describe('the schema check', () => {
  it('is current: what a database built from every migration has (else: WRITE_SCHEMA_CHECK=1)', () => {
    expect(readFileSync(FILE, 'utf8')).toBe(check)
    expect(readFileSync(TRIGGER_FILE, 'utf8')).toBe(triggerCheck)
    expect(readFileSync(PRODUCTION_FILE, 'utf8')).toBe(productionCheck)
  })

  it('covers every kind it says it does', () => {
    for (const kind of ['trigger', 'index', 'constraint', 'not null', 'default', 'identity', 'sequence owner', 'view', 'row security', 'policy', 'function', 'grant']) {
      expect(check, kind).toContain(`('${kind}', '`)
    }
  })

  it('only reads: it runs in a read-only transaction', async () => {
    await fresh.exec('begin transaction read only')
    try {
      await expect(fresh.query(readFileSync(FILE, 'utf8'))).resolves.toBeTruthy()
      for (const file of [TRIGGER_FILE, PRODUCTION_FILE, ORPHANS_FILE]) {
        await expect(fresh.query(readFileSync(file, 'utf8')), file).resolves.toBeTruthy()
      }
    } finally {
      await fresh.exec('rollback')
    }
  })

  it('finds nothing on a database built from the migrations', async () => {
    expect(await differences(fresh)).toEqual([])
    expect(await differences(fresh, TRIGGER_FILE)).toEqual([])
  })

  it('the production check finds nothing on what production should be, and names what it lacks', async () => {
    expect(await differences(production, PRODUCTION_FILE)).toEqual([])
    // Production has had neither 092–097 nor 099+: their objects are not expected there.
    expect(productionCheck).not.toContain(`'public.app_min_version'`)
    // The payroll policies of 027 are.
    expect(productionCheck).toContain(`('policy', 'public.work_hours.work_hours_manage'`)
    // A database with every migration has things production should not have yet.
    const extra = (await differences(fresh, PRODUCTION_FILE)).filter(r => r.status === 'extra')
    expect(extra.map(r => r.key)).toContain('public.app_min_version')
  }, 120_000)

  it('finds each kind of drift a restore can leave', async () => {
    const d = await freshDb()
    await d.exec(`
      drop trigger soft_delete_job on public.jobs;
      drop index public.audit_log_org_at_idx;
      alter table public.invoices drop constraint invoices_number_per_clinic;
      alter table public.jobs alter column delivery_status set default 'valmis';
      alter table public.jobs alter column created_at drop default;
      alter table public.customers alter column name drop not null;
      drop policy "mfa_required" on storage.objects;
      alter table public.notification disable row level security;
      alter view public.stock_levels reset (security_invoker);
      create index extra_idx on public.jobs (patsient);
      alter function public.can_manage_payroll() security invoker;
      revoke delete on public.jobs from authenticated;
    `)
    const found = (await differences(d)).map(r => `${r.status} ${r.kind} ${r.key}`)
    expect(found).toEqual(expect.arrayContaining([
      'missing trigger public.jobs.soft_delete_job',
      'missing index public.audit_log_org_at_idx',
      'missing constraint public.invoices.invoices_number_per_clinic',
      'differs default public.jobs.delivery_status',
      'missing default public.jobs.created_at',
      'missing not null public.customers.name',
      'missing policy storage.objects.mfa_required',
      'differs row security public.notification',
      'differs view public.stock_levels',
      'extra index public.extra_idx',
      'differs function public.can_manage_payroll()',
      'differs grant public.jobs to authenticated',
    ]))
    // The trigger check: the trigger alone.
    expect((await differences(d, TRIGGER_FILE)).map(r => `${r.status} ${r.kind} ${r.key}`))
      .toEqual(['missing trigger public.jobs.soft_delete_job'])
  }, 120_000)

  it('orphan_users.sql names the rows that point at a deleted account, and nothing else', async () => {
    const d = await freshDb()
    const { createTenant } = await import('./harness')
    const A = await createTenant(d, 'Tallinn')
    expect((await d.query(readFileSync(ORPHANS_FILE, 'utf8'))).rows).toEqual([])
    // An account deleted while the keys were missing (the test copy's state).
    await d.exec(`alter table public.profiles drop constraint profiles_id_fkey;
                  alter table public.clinics drop constraint clinics_created_by_fkey;`)
    await d.query(`update public.clinics set created_by = $1 where id = $2`, [A.workerId, A.clinicId])
    await d.query(`delete from auth.users where id = $1`, [A.workerId])
    const rows = (await d.query<{ points_from: string; missing_account: string }>(readFileSync(ORPHANS_FILE, 'utf8'))).rows
    expect(rows.map(r => `${r.points_from} ${r.missing_account}`)).toEqual([
      `clinics.created_by ${A.workerId}`,
      `profiles.id ${A.workerId}`,
    ])
  }, 120_000)
})
