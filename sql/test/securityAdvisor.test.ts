/**
 * The checks Supabase's Security Advisor runs, run here against the database
 * the migrations build (spec, Phase 0: "Security Advisor shows no errors").
 *
 * The advisor itself only runs on a hosted project. These are its lints that
 * can be decided from the catalogue alone, named as the advisor names them,
 * so a failure here reads the same as the advisor's report would. Everything
 * at ERROR level is covered; the advisor's other lints are about Auth and
 * Storage settings, which live in the dashboard (MORNING.md).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './harness'

let db: PGlite
beforeAll(async () => { db = await freshDb() }, 120_000)

async function names(sql: string): Promise<string[]> {
  return (await db.query<{ name: string }>(sql)).rows.map(r => r.name)
}

describe('Security Advisor lints', () => {
  it('rls_disabled_in_public (ERROR): every table in public has RLS on', async () => {
    expect(await names(`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`)).toEqual([])
  })

  it('policy_exists_rls_disabled (ERROR): no policy sits on a table with RLS off', async () => {
    expect(await names(`
      select distinct c.relname as name from pg_policy p join pg_class c on c.oid = p.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and not c.relrowsecurity`)).toEqual([])
  })

  it('security_definer_view (ERROR): every view runs with the caller\'s rights', async () => {
    expect(await names(`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('v', 'm')
         and not coalesce('security_invoker=true' = any(c.reloptions), false)
         and not coalesce('security_invoker=on' = any(c.reloptions), false)`)).toEqual([])
  })

  it('auth_users_exposed (ERROR): no public view reads auth.users', async () => {
    expect(await names(`
      select distinct v.relname as name from pg_depend d
        join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
        join pg_namespace vn on vn.oid = v.relnamespace
        join pg_class t on t.oid = d.refobjid join pg_namespace tn on tn.oid = t.relnamespace
       where vn.nspname = 'public' and tn.nspname = 'auth' and t.relname = 'users'`)).toEqual([])
  })

  it('function_search_path_mutable (WARN): every function pins its search_path', async () => {
    expect(await names(`
      select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).toEqual([])
  })

  it('rls_enabled_no_policy (INFO): no table is locked shut by having RLS and no policy', async () => {
    expect(await names(`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
         and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`)).toEqual([])
  })
})
