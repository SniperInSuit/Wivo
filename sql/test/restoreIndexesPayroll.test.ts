/**
 * sql/109: what the test copy's restore still lacked after 107 and 108 —
 * indexes, NOT NULL on jobs.created_at / updated_at, and the payroll policies
 * of sql/027 — is put back where missing, and nothing changes on a database
 * that has it. A unique index that existing rows break, and a column with
 * empty values, are skipped and named, never "fixed" by changing data.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, emptyDb, applyMigrations, migrationFiles, createTenant, makeRow, rowsAs, errorAs, SQL_DIR } from './harness'
import { CATALOG_SQL } from './schemaCatalog'

const PAYROLL = ['worker_rates', 'work_hours', 'worker_payouts', 'worker_payout_lines']

/** Everything the schema check compares. */
async function schema(d: PGlite): Promise<string[]> {
  const { rows } = await d.query<{ kind: string; key: string; def: string }>(`${CATALOG_SQL} order by 1, 2`)
  return rows.map(r => `${r.kind} ${r.key} ${r.def}`)
}

/** Run 109, keeping what it reports. */
async function run109(d: PGlite): Promise<string[]> {
  const notices: string[] = []
  const sql = readFileSync(join(SQL_DIR, '109_restore_indexes_not_null_payroll.sql'), 'utf8')
  await d.exec(sql, { onNotice: n => notices.push(n.message ?? '') })
  return notices
}

/** The test copy as schema_check.sql found it on 2026-11-03, after 108. */
async function asTheTestCopyWas(d: PGlite): Promise<void> {
  await d.exec(`do $$ declare r record; begin
    for r in select ic.relname from pg_index i join pg_class ic on ic.oid = i.indexrelid
               join pg_class tc on tc.oid = i.indrelid join pg_namespace n on n.oid = tc.relnamespace
              where n.nspname = 'public'
                and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid) loop
      execute format('drop index public.%I', r.relname);
    end loop; end $$;
    alter table public.jobs alter column created_at drop not null;
    alter table public.jobs alter column updated_at drop not null;`)
  // sql/022's owner-only payroll policies, as they were before sql/027.
  const v022 = readFileSync(join(SQL_DIR, '022_worker_pay.sql'), 'utf8')
  const old = v022.match(/create policy "[a-z_]+" on public\.(worker_rates|work_hours|worker_payouts|worker_payout_lines)\b[\s\S]*?;/g) ?? []
  expect(old.length).toBeGreaterThanOrEqual(8)
  for (const t of PAYROLL) {
    await d.exec(`do $$ declare r record; begin
      for r in select polname from pg_policy where polrelid = 'public.${t}'::regclass and polname <> 'mfa_required' loop
        execute format('drop policy %I on public.${t}', r.polname);
      end loop; end $$;`)
  }
  await d.exec(old.join('\n'))
}

describe('109 puts back what the restore left out', () => {
  it('after it the test copy\'s state matches the migrations everywhere the schema check looks', async () => {
    const d = await emptyDb()
    await applyMigrations(d, migrationFiles().filter(f => f < '109'))
    const before = await schema(d)
    await asTheTestCopyWas(d)
    expect(await schema(d)).not.toEqual(before)
    const notices = await run109(d)
    expect(await schema(d)).toEqual(before)
    expect(notices).toEqual(expect.arrayContaining([
      expect.stringMatching(/^109: added 64 index\(es\): /),
      '109: set NOT NULL on 2 column(s): jobs.created_at, jobs.updated_at',
      expect.stringMatching(/^109: payroll policies: 4 added, 4 replaced, 4 old owner-only dropped: /),
    ]))
  }, 120_000)

  it('the payroll policies work again: payroll.manage, not only the owner', async () => {
    const d = await freshDb()
    await asTheTestCopyWas(d)
    await run109(d)
    const A = await createTenant(d, 'Tallinn')
    await d.query(`insert into public.worker_permissions (profile_id, clinic_id, permission, granted)
                   values ($1, $2, 'payroll.manage', true)`, [A.workerId, A.clinicId])
    const rate = await makeRow(d, 'worker_rates', A)
    await d.query(`update public.worker_rates set profile_id = $1 where id = $2`, [A.ownerId, rate.id])
    // 022's owner-only policy hid another person's rate from everyone but the owner.
    expect(await rowsAs(d, { id: A.workerId }, `select 1 from public.worker_rates where id = $1`, [rate.id])).toHaveLength(1)
    expect(await errorAs(d, { id: A.workerId }, `update public.worker_rates set clinic_id = clinic_id where id = $1`, [rate.id])).toBeNull()
    await d.query(`delete from public.worker_permissions where profile_id = $1`, [A.workerId])
    expect(await rowsAs(d, { id: A.workerId }, `select 1 from public.worker_rates where id = $1`, [rate.id])).toEqual([])
  }, 120_000)
})

describe('on a complete database (production, a fresh one) it changes nothing', () => {
  it('nothing added, running it again neither', async () => {
    const d = await freshDb()
    const before = await schema(d)
    const notices = await run109(d)
    await run109(d)
    expect(await schema(d)).toEqual(before)
    expect(notices).toEqual([
      '109: added 0 index(es)',
      '109: set NOT NULL on 0 column(s)',
      '109: payroll policies: 0 added, 0 replaced, 0 old owner-only dropped',
    ])
  }, 120_000)

  it('an index there under another name is not built twice', async () => {
    const d = await freshDb()
    await d.exec(`alter index public.jobs_status_idx rename to jobs_status_old_name`)
    expect(await run109(d)).toContain('109: added 0 index(es)')
  }, 120_000)
})

describe('it changes no data: what rows break is skipped and named', () => {
  it('a unique index with duplicate rows is skipped, naming the key and the rows; the rest is built', async () => {
    const d = await freshDb()
    const A = await createTenant(d, 'Tallinn')
    const one = await makeRow(d, 'jobs', A)
    const two = await makeRow(d, 'jobs', A)
    await d.exec(`drop index public.jobs_job_code_key; drop index public.jobs_status_idx;`)
    // The job code is the database's own (sql/082); a restore can still bring duplicates.
    await d.exec(`alter table public.jobs disable trigger set_job_code`)
    await d.query(`update public.jobs set job_code = 'DUP-1' where id in ($1, $2)`, [one.id, two.id])
    await d.exec(`alter table public.jobs enable trigger set_job_code`)
    const notices = await run109(d)
    expect(notices).toContain('109: added 1 index(es): jobs_status_idx')
    const ids = [one.id, two.id].sort()
    expect(notices).toContain(`109: skipped 1 index(es): jobs_job_code_key: duplicates (DUP-1) in 2 rows, ids {${ids.join(',')}}`)
    expect((await d.query(`select 1 from public.jobs where job_code = 'DUP-1'`)).rows).toHaveLength(2)
  }, 120_000)

  it('a column with empty values keeps them and stays nullable; the other column is set', async () => {
    const d = await freshDb()
    const A = await createTenant(d, 'Tallinn')
    const job = await makeRow(d, 'jobs', A)
    await d.exec(`alter table public.jobs alter column created_at drop not null;
                  alter table public.jobs alter column updated_at drop not null;`)
    await d.query(`update public.jobs set created_at = null where id = $1`, [job.id])
    const notices = await run109(d)
    expect(notices).toContain('109: set NOT NULL on 1 column(s): jobs.updated_at')
    expect(notices).toContain('109: NOT NULL skipped: jobs.created_at (1 row(s) without a value)')
  }, 120_000)
})

describe('the payroll part', () => {
  it('without can_manage_payroll() it is skipped, and the rest still runs', async () => {
    const d = await freshDb()
    await d.exec(`drop index public.jobs_status_idx; drop function public.can_manage_payroll() cascade;`)
    const notices = await run109(d)
    expect(notices).toContain('109: added 1 index(es): jobs_status_idx')
    expect(notices).toContain('109: payroll policies skipped: public.can_manage_payroll() is missing')
  }, 120_000)

  it('a policy on a payroll table the migrations do not define is named, not dropped', async () => {
    const d = await freshDb()
    await d.exec(`create policy someone_elses on public.work_hours for select using (false)`)
    const notices = await run109(d)
    expect(notices).toContain('109: payroll tables also have policies the migrations do not define (left as they are): work_hours.someone_elses')
    expect((await d.query(`select 1 from pg_policy where polname = 'someone_elses'`)).rows).toHaveLength(1)
  }, 120_000)
})
