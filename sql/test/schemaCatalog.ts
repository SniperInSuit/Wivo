/**
 * What a database HAS, as one list of (kind, key, def) rows: triggers on our
 * functions, indexes, constraints, NOT NULL columns, column defaults, identity
 * columns, sequence ownership, views, row security, policies, our functions
 * (settings and a fingerprint of the body: prosrc is the text as written, the
 * same on every Postgres; a body pasted with Windows line endings is the same
 * body, so CR LF counts as LF) and what anon, authenticated, service_role and
 * PUBLIC may do with each table, column and function.
 *
 * The same query builds two things (schemaCheck.test.ts keeps them current):
 *  - the expected list, run on a database built from the migrations (PGlite);
 *  - sql/checks/schema_check.sql, the read-only check Kevin runs on a real
 *    project, which runs this query there and compares.
 * So the check cannot disagree with how the list was made.
 *
 * Postgres 17 and 18 both: NOT NULL is read from the column (attnotnull), not
 * from pg_constraint, where only 18 lists it.
 */
export const CATALOG_SQL = `
select 'trigger'::text as kind, n.nspname || '.' || c.relname || '.' || t.tgname as key, pg_get_triggerdef(t.oid) as def
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
 where not t.tgisinternal and pn.nspname = 'public'
union all
select 'index', 'public.' || ic.relname, pg_get_indexdef(i.indexrelid)
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  join pg_class tc on tc.oid = i.indrelid join pg_namespace n on n.oid = tc.relnamespace
 where n.nspname = 'public'
   and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.contype in ('p', 'u', 'x'))
union all
select 'constraint', 'public.' || tc.relname || '.' || k.conname, pg_get_constraintdef(k.oid)
  from pg_constraint k
  join pg_class tc on tc.oid = k.conrelid join pg_namespace n on n.oid = tc.relnamespace
 where n.nspname = 'public' and k.contype in ('p', 'u', 'c', 'f', 'x')
union all
select 'not null', 'public.' || tc.relname || '.' || a.attname, 'not null'
  from pg_attribute a
  join pg_class tc on tc.oid = a.attrelid join pg_namespace n on n.oid = tc.relnamespace
 where n.nspname = 'public' and tc.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped and a.attnotnull
union all
select 'default', 'public.' || tc.relname || '.' || a.attname, pg_get_expr(d.adbin, d.adrelid)
  from pg_attrdef d
  join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
  join pg_class tc on tc.oid = d.adrelid join pg_namespace n on n.oid = tc.relnamespace
 where n.nspname = 'public'
union all
select 'identity', 'public.' || tc.relname || '.' || a.attname, case a.attidentity when 'a' then 'always' else 'by default' end
  from pg_attribute a
  join pg_class tc on tc.oid = a.attrelid join pg_namespace n on n.oid = tc.relnamespace
 where n.nspname = 'public' and a.attidentity <> '' and not a.attisdropped
union all
select 'sequence owner', 'public.' || s.relname, tc.relname || '.' || a.attname
  from pg_class s
  join pg_namespace n on n.oid = s.relnamespace
  join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
  join pg_class tc on tc.oid = d.refobjid
  join pg_attribute a on a.attrelid = tc.oid and a.attnum = d.refobjsubid
 where s.relkind = 'S' and n.nspname = 'public'
union all
select 'view', 'public.' || c.relname, coalesce(array_to_string(c.reloptions, ','), '') || ' ' || pg_get_viewdef(c.oid)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('v', 'm') and n.nspname = 'public'
union all
select 'row security', 'public.' || c.relname,
       case when c.relforcerowsecurity then 'on, forced' when c.relrowsecurity then 'on' else 'off' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
union all
select 'policy', p.schemaname || '.' || p.tablename || '.' || p.policyname,
       p.permissive || ' ' || p.cmd || ' to ' || array_to_string(p.roles, ',')
         || ' using (' || coalesce(p.qual, '') || ') check (' || coalesce(p.with_check, '') || ')'
  from pg_policies p
 where p.schemaname in ('public', 'storage')
union all
select 'function', 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       case when p.prosecdef then 'security definer' else 'security invoker' end
         || ', ' || case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end
         || coalesce(', ' || array_to_string(p.proconfig, ', '), '')
         || ', body md5 ' || md5(replace(coalesce(p.prosrc, ''), chr(13) || chr(10), chr(10)))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind in ('f', 'p')
   and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
union all
select 'grant', g.target || ' to ' || g.grantee, string_agg(g.privilege, ',' order by g.privilege)
  from (
    select 'public.' || c.relname as target, coalesce(r.rolname, 'PUBLIC') as grantee, x.privilege_type as privilege
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
      left join pg_roles r on r.oid = x.grantee
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
    union all
    select 'public.' || c.relname || '.' || a.attname, coalesce(r.rolname, 'PUBLIC'), x.privilege_type
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(a.attacl) x
      left join pg_roles r on r.oid = x.grantee
     where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped and a.attacl is not null
    union all
    select 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', coalesce(r.rolname, 'PUBLIC'), x.privilege_type
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      left join pg_roles r on r.oid = x.grantee
     where n.nspname = 'public' and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  ) g
 where g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
 group by g.target, g.grantee
`

export interface CatalogRow { kind: string; key: string; def: string }

const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`

/**
 * sql/checks/schema_check.sql: the expected rows, and the comparison. One
 * SELECT; it reads the catalog and changes nothing. With `kinds`, only those
 * (sql/checks/trigger_check.sql: the triggers alone).
 */
export interface CheckOptions {
  /** Only these kinds (trigger_check.sql: ['trigger']). */
  kinds?: string[]
  /** Which migrations the expected rows come from, and where to run it. */
  built?: string
  runOn?: string
  /**
   * What a migration removed on purpose: reported as "must be absent", with
   * the reason, when a database still has it (sql/115: audit_log_user_id_fkey).
   */
  absent?: { kind: string; key: string; why: string }[]
}

export function renderCheck(all: CatalogRow[], { kinds, built = 'sql/000 … the newest migration', runOn = 'a project that has every migration applied\n-- (the test copy)', absent: allAbsent = [] }: CheckOptions = {}): string {
  const expected = kinds ? all.filter(r => kinds.includes(r.kind)) : all
  const absent = kinds ? allAbsent.filter(a => kinds.includes(a.kind)) : allAbsent
  const absentNote = absent.length
    ? `--   must be absent   a migration removed it on purpose; this database still has it:\n${
        absent.map(a => `--                    ${a.kind} ${a.key}: ${a.why}`).join('\n')}\n`
    : ''
  const absentCase = absent.length
    ? ` when expected is null and kind || ' ' || key in (${absent.map(a => quote(`${a.kind} ${a.key}`)).join(', ')}) then 'must be absent'`
    : ''
  const only = kinds ? ` where kind in (${kinds.map(quote).join(', ')})` : ''
  const title = kinds ? `${kinds.join(', ')} only` : 'does this database match the migrations?'
  const values = expected.map(r => `    (${quote(r.kind)}, ${quote(r.key)}, ${quote(r.def)})`).join(',\n')
  return `-- ============================================================================
-- Wivo — read-only schema check: ${title}
-- GENERATED from a database built from ${built}
-- (sql/test/schemaCheck.test.ts); do not edit by hand. Regenerate with:
--   WRITE_SCHEMA_CHECK=1 npx vitest run --mode unit sql/test/schemaCheck.test.ts
-- ============================================================================
--
-- Paste into the SQL Editor of ${runOn}. It is one SELECT: it reads the
-- catalog and changes nothing.
--
-- One row per difference:
--   missing   the migrations define it; this database does not have it
--   differs   both have it, but not the same (whitespace and case ignored).
--             Postgres 17 and 18 can print the same thing slightly differently;
--             read the two definitions before acting on a "differs".
--   extra     this database has it; the migrations do not define it
${absentNote}-- No rows: this database matches the migrations in all of it.
--
-- Covered: ${kinds ? kinds.join(', ') : `triggers on our functions (public and auth.users), indexes,
-- primary-key, unique, check, foreign-key and exclusion constraints, NOT NULL
-- columns, column defaults, identity columns, sequence ownership, views (with
-- their options), row security, policies (public and storage), our functions
-- (security, volatility, settings, a fingerprint of the body) and the grants
-- to anon, authenticated, service_role and PUBLIC on tables, columns and
-- functions`}.
-- Expected rows: ${expected.length}.
-- ============================================================================

with expected(kind, key, def) as (values
${values}
),
actual as (select * from (${CATALOG_SQL}) catalog${only}),
norm as (
  select coalesce(e.kind, a.kind) as kind, coalesce(e.key, a.key) as key,
         e.def as expected, a.def as actual
    from expected e full join actual a on a.kind = e.kind and a.key = e.key
)
select kind, key,
       case when actual is null then 'missing'${absentCase} when expected is null then 'extra' else 'differs' end as status,
       expected, actual
  from norm
 where actual is null or expected is null
    or regexp_replace(lower(actual), '\\s+', ' ', 'g') <> regexp_replace(lower(expected), '\\s+', ' ', 'g')
 order by 3, 1, 2;
`
}
