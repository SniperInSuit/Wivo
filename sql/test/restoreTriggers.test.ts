/**
 * sql/108: the triggers a restore left out are put back — exactly the ones the
 * migrations define on our functions, nothing twice — and nothing changes on a
 * database that has them.
 */
import { describe, it, expect } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, emptyDb, applyMigrations, migrationFiles, createTenant, makeRow, rowsAs } from './harness'

/** Our triggers, as fully qualified definitions. */
async function triggers(d: PGlite): Promise<string[]> {
  await d.exec(`set search_path = ''`)
  const { rows } = await d.query<{ def: string }>(`
    select pg_get_triggerdef(t.oid) as def from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
     where not t.tgisinternal and pn.nspname = 'public' order by 1`)
  await d.exec(`set search_path = "$user", public, extensions`)
  return rows.map(r => r.def)
}

/** The test copy's state: our triggers gone. */
async function dropOurTriggers(d: PGlite, where = 'true'): Promise<void> {
  await d.exec(`do $$ declare r record; begin
    for r in select t.tgname, t.tgrelid::regclass as rel from pg_trigger t
               join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
              where not t.tgisinternal and pn.nspname = 'public' and (${where}) loop
      execute format('drop trigger %I on %s', r.tgname, r.rel);
    end loop; end $$;`)
}

const run108 = (d: PGlite) => applyMigrations(d, ['108_restore_triggers.sql'])

describe('108 puts back exactly the triggers the migrations define', () => {
  it('a database that lost them all gets back the same 27, on public tables and on auth.users', async () => {
    const d = await emptyDb()
    await applyMigrations(d, migrationFiles().filter(f => f < '108'))
    const before = await triggers(d)
    expect(before).toHaveLength(27)
    expect(before.some(t => t.includes('ON auth.users'))).toBe(true)
    await dropOurTriggers(d)
    expect(await triggers(d)).toEqual([])
    await run108(d)
    expect(await triggers(d)).toEqual(before)
  }, 120_000)

  it('the restored triggers work: a new account gets its profile, a job its code, a delete stays soft', async () => {
    const d = await freshDb()
    await dropOurTriggers(d)
    await run108(d)
    const A = await createTenant(d, 'Tallinn')
    expect((await d.query(`select 1 from public.profiles where id = $1`, [A.workerId])).rows).toHaveLength(1)
    const job = await makeRow(d, 'jobs', A)
    const { rows } = await d.query<{ job_code: string | null }>(`select job_code from public.jobs where id = $1`, [job.id])
    expect(rows[0].job_code).toBeTruthy()
    await rowsAs(d, { id: A.ownerId }, `delete from public.jobs where id = $1`, [job.id])
    const after = await d.query<{ deleted_at: Date | null }>(`select deleted_at from public.jobs where id = $1`, [job.id])
    expect(after.rows).toHaveLength(1)
    expect(after.rows[0].deleted_at).not.toBeNull()
  }, 120_000)
})

describe('on a complete database (production, a fresh one) it changes nothing', () => {
  it('nothing added, running it again neither', async () => {
    const d = await freshDb()
    const before = await triggers(d)
    await run108(d)
    await run108(d)
    expect(await triggers(d)).toEqual(before)
  }, 120_000)

  it('a trigger whose function is attached under another name is not added twice', async () => {
    const d = await freshDb()
    await d.exec(`alter trigger soft_delete_job on public.jobs rename to soft_delete_job_old_name`)
    await run108(d)
    const { rows } = await d.query<{ n: number }>(`select count(*)::int as n from pg_trigger
      where tgrelid = 'public.jobs'::regclass and tgfoid = 'public.soft_delete_job()'::regprocedure`)
    expect(rows[0].n).toBe(1)
  }, 120_000)

  it('no table has two of our triggers on one function (so that guard never hides one)', async () => {
    const d = await freshDb()
    const { rows } = await d.query(`select tgrelid, tgfoid from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      join pg_namespace pn on pn.oid = p.pronamespace where not t.tgisinternal and pn.nspname = 'public'
      group by 1, 2 having count(*) > 1`)
    expect(rows).toEqual([])
  }, 120_000)
})
