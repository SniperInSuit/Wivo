/**
 * sql/checks/schema_check.sql — the read-only check that a database matches
 * the migrations — is current, reads only, finds nothing on a database built
 * from the migrations, and finds each kind of drift.
 *
 * production_check.sql is the same check for what production should have
 * (000–091 and 098: docs/MIGRATIONS.md), orphan_users.sql lists rows that
 * point at a deleted sign-in account, scheduled_jobs.sql says which project
 * the scheduled jobs call, with whose key, and sign_in_account.sql what one
 * address's sign-in account is (its own tests: deleteAccount.test.ts).
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
const JOBS_FILE = join(__dirname, '..', 'checks', 'scheduled_jobs.sql')
const ACCOUNT_FILE = join(__dirname, '..', 'checks', 'sign_in_account.sql')
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
      for (const file of [TRIGGER_FILE, PRODUCTION_FILE, ORPHANS_FILE, JOBS_FILE, ACCOUNT_FILE]) {
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

  it('a function pasted with Windows line endings is the same function', async () => {
    // Production and the test copy have five functions so (2026-11-04).
    const d = await freshDb()
    const { rows: [{ def }] } = await d.query<{ def: string }>(
      `select pg_get_functiondef('public.set_updated_at()'::regprocedure) as def`)
    await d.exec(def.replace(/\n/g, '\r\n'))
    const { rows: [{ crlf }] } = await d.query<{ crlf: boolean }>(
      `select position(chr(13) in prosrc) > 0 as crlf from pg_proc where oid = 'public.set_updated_at()'::regprocedure`)
    expect(crlf).toBe(true)
    expect(await differences(d)).toEqual([])
    // A real change to the body still shows.
    await d.exec(def.replace('now()', 'clock_timestamp()'))
    expect((await differences(d)).map(r => `${r.status} ${r.kind} ${r.key}`))
      .toEqual(['differs function public.set_updated_at()'])
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

  it('scheduled_jobs.sql says which project each job calls and whose key the Vault holds, never the key', async () => {
    // The two project ids are the ones test mode uses (CLAUDE.md: change them together).
    const testCopy = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'lib', 'testCopy.ts'), 'utf8')
    const ref = (name: string): string => testCopy.match(new RegExp(`export const ${name} = '([a-z0-9]+)'`))![1]
    const sql = readFileSync(JOBS_FILE, 'utf8')
    expect(sql).toContain(`('${ref('PRODUCTION_REF')}', 'PRODUCTION')`)
    expect(sql).toContain(`('${ref('TEST_REF')}', 'the test copy')`)

    const d = await freshDb()
    const run = async (): Promise<string[]> =>
      (await d.query<{ what: string; finding: string }>(sql)).rows.map(r => `${r.what}: ${r.finding}`)
    // As built: sql/052 writes production's address into its job; the harness's key is no JWT.
    expect(await run()).toEqual(expect.arrayContaining([
      'job wivo-send-invoices: 7 * * * *: calls PRODUCTION, with a key whose project cannot be read from it',
      'job wivo-chat-prune: 17 3 * * *: calls nothing outside this database',
      'Vault wivo_service_role_key: a key whose project cannot be read from it',
    ]))

    // A test copy restored with production's Vault, and the notification job pointed at itself.
    const part = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url')
    const key = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ iss: 'supabase', ref: ref('PRODUCTION_REF'), role: 'service_role' })}.not-a-signature`
    await d.query(`update vault.secrets set secret = $1 where name = 'wivo_service_role_key'`, [key])
    await d.query(`select vault.create_secret($1, 'wivo_functions_url')`, [`https://${ref('TEST_REF')}.functions.supabase.co`])
    await d.exec(readFileSync(join(__dirname, '..', '077_notification_email_cron.sql'), 'utf8'))
    await d.exec(`
      insert into cron.job_run_details (jobid, status, start_time)
        select jobid, 'succeeded', '2026-11-04 10:07:00+00' from cron.job where jobname = 'wivo-send-invoices';
      insert into net._http_response (id, status_code, created)
        values (1, 200, '2026-11-04 10:07:01+00'), (2, 200, '2026-11-04 11:07:01+00'), (3, 401, '2026-11-04 11:08:00+00');`)
    const found = await run()
    expect(found).toEqual(expect.arrayContaining([
      'job wivo-send-invoices: 7 * * * *: calls PRODUCTION, with a service_role key of PRODUCTION',
      'job wivo-send-notifications: * * * * *: calls the Vault\'s address (the test copy), with a service_role key of PRODUCTION',
      `Vault wivo_functions_url: https://${ref('TEST_REF')}.functions.supabase.co (the test copy)`,
      'Vault wivo_service_role_key: a service_role key of PRODUCTION',
    ]))
    expect(found.find(f => f.startsWith('last run of wivo-send-invoices: succeeded at 2026-11-04'))).toBeTruthy()
    expect(found.find(f => f.startsWith('answers to this database\'s calls: 200 x2, 401 x1, between 2026-11-04'))).toBeTruthy()
    expect(found.join('\n')).not.toContain(key.split('.')[1])
  }, 120_000)
})
