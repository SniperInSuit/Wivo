-- ============================================================================
-- Wivo — read-only schema check: trigger only
-- GENERATED from a database built from sql/000 … the newest migration
-- (sql/test/schemaCheck.test.ts); do not edit by hand. Regenerate with:
--   WRITE_SCHEMA_CHECK=1 npx vitest run --mode unit sql/test/schemaCheck.test.ts
-- ============================================================================
--
-- Paste into the SQL Editor of a project that has every migration applied
-- (the test copy). It is one SELECT: it reads the
-- catalog and changes nothing.
--
-- One row per difference:
--   missing   the migrations define it; this database does not have it
--   differs   both have it, but not the same (whitespace and case ignored).
--             Postgres 17 and 18 can print the same thing slightly differently;
--             read the two definitions before acting on a "differs".
--   extra     this database has it; the migrations do not define it
-- No rows: this database matches the migrations in all of it.
--
-- Covered: trigger.
-- Expected rows: 27.
-- ============================================================================

with expected(kind, key, def) as (values
    ('trigger', 'auth.users.on_auth_email_changed', 'CREATE TRIGGER on_auth_email_changed AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION on_auth_email_changed()'),
    ('trigger', 'auth.users.on_auth_user_created', 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()'),
    ('trigger', 'public.audit_log.audit_log_append_only', 'CREATE TRIGGER audit_log_append_only BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only()'),
    ('trigger', 'public.channel_members.guard_channel_member_change', 'CREATE TRIGGER guard_channel_member_change BEFORE UPDATE ON public.channel_members FOR EACH ROW EXECUTE FUNCTION guard_channel_member_change()'),
    ('trigger', 'public.clinic_settings.clinic_settings_touch', 'CREATE TRIGGER clinic_settings_touch BEFORE UPDATE ON public.clinic_settings FOR EACH ROW EXECUTE FUNCTION touch_clinic_settings()'),
    ('trigger', 'public.clinics.guard_code_prefix', 'CREATE TRIGGER guard_code_prefix BEFORE UPDATE OF code_prefix ON public.clinics FOR EACH ROW EXECUTE FUNCTION guard_code_prefix()'),
    ('trigger', 'public.clinics.set_code_prefix', 'CREATE TRIGGER set_code_prefix BEFORE INSERT ON public.clinics FOR EACH ROW EXECUTE FUNCTION set_code_prefix()'),
    ('trigger', 'public.invoice_lines.invoice_lines_recalc', 'CREATE TRIGGER invoice_lines_recalc AFTER INSERT OR DELETE OR UPDATE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_touch()'),
    ('trigger', 'public.invoices.invoices_recalc_on_rate', 'CREATE TRIGGER invoices_recalc_on_rate AFTER UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION invoices_rate_touch()'),
    ('trigger', 'public.job_file.file_added_notify', 'CREATE TRIGGER file_added_notify AFTER UPDATE OF completed_at ON public.job_file FOR EACH ROW EXECUTE FUNCTION on_file_added_notify()'),
    ('trigger', 'public.job_file.refuse_file_on_deleted_job', 'CREATE TRIGGER refuse_file_on_deleted_job BEFORE INSERT ON public.job_file FOR EACH ROW EXECUTE FUNCTION refuse_file_on_deleted_job()'),
    ('trigger', 'public.job_share.job_share_notify', 'CREATE TRIGGER job_share_notify AFTER INSERT OR UPDATE OF revoked_at ON public.job_share FOR EACH ROW EXECUTE FUNCTION on_job_share_notify()'),
    ('trigger', 'public.job_share.refuse_share_of_deleted_job', 'CREATE TRIGGER refuse_share_of_deleted_job BEFORE INSERT OR UPDATE ON public.job_share FOR EACH ROW EXECUTE FUNCTION refuse_share_of_deleted_job()'),
    ('trigger', 'public.jobs.guard_partner_visible_job_text', 'CREATE TRIGGER guard_partner_visible_job_text BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION guard_partner_visible_job_text()'),
    ('trigger', 'public.jobs.guard_stage_change', 'CREATE TRIGGER guard_stage_change BEFORE UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION guard_stage_change()'),
    ('trigger', 'public.jobs.job_stage_notify', 'CREATE TRIGGER job_stage_notify AFTER UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION on_job_stage_notify()'),
    ('trigger', 'public.jobs.job_team_notify', 'CREATE TRIGGER job_team_notify AFTER INSERT OR UPDATE OF status, revisions, assigned_to, designed_by, work_items ON public.jobs FOR EACH ROW EXECUTE FUNCTION on_job_team_notify()'),
    ('trigger', 'public.jobs.jobs_updated_at', 'CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at()'),
    ('trigger', 'public.jobs.set_job_code', 'CREATE TRIGGER set_job_code BEFORE INSERT OR UPDATE OF job_code, clinic_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION set_job_code()'),
    ('trigger', 'public.jobs.soft_delete_job', 'CREATE TRIGGER soft_delete_job BEFORE DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION soft_delete_job()'),
    ('trigger', 'public.messages.guard_partner_visible_message', 'CREATE TRIGGER guard_partner_visible_message BEFORE INSERT OR UPDATE OF body ON public.messages FOR EACH ROW EXECUTE FUNCTION guard_partner_visible_message()'),
    ('trigger', 'public.messages.question_notify', 'CREATE TRIGGER question_notify AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION on_question_notify()'),
    ('trigger', 'public.messages.stamp_message_org', 'CREATE TRIGGER stamp_message_org BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION stamp_message_org()'),
    ('trigger', 'public.profiles.guard_profile_change', 'CREATE TRIGGER guard_profile_change BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_change()'),
    ('trigger', 'public.stock_item.guard_partner_visible_stock_text', 'CREATE TRIGGER guard_partner_visible_stock_text BEFORE INSERT OR UPDATE ON public.stock_item FOR EACH ROW EXECUTE FUNCTION guard_partner_visible_stock_text()'),
    ('trigger', 'public.stock_movement.stock_movement_append_only', 'CREATE TRIGGER stock_movement_append_only BEFORE DELETE OR UPDATE ON public.stock_movement FOR EACH ROW EXECUTE FUNCTION stock_movement_append_only()'),
    ('trigger', 'public.worker_permissions.replace_stale_grant', 'CREATE TRIGGER replace_stale_grant BEFORE INSERT ON public.worker_permissions FOR EACH ROW EXECUTE FUNCTION replace_stale_grant()')
),
actual as (select * from (
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
         || ', body md5 ' || md5(coalesce(p.prosrc, ''))
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
) catalog where kind in ('trigger')),
norm as (
  select coalesce(e.kind, a.kind) as kind, coalesce(e.key, a.key) as key,
         e.def as expected, a.def as actual
    from expected e full join actual a on a.kind = e.kind and a.key = e.key
)
select kind, key,
       case when actual is null then 'missing' when expected is null then 'extra' else 'differs' end as status,
       expected, actual
  from norm
 where actual is null or expected is null
    or regexp_replace(lower(actual), '\s+', ' ', 'g') <> regexp_replace(lower(expected), '\s+', ' ', 'g')
 order by 3, 1, 2;
