-- ============================================================================
-- Wivo — migration 108: put back triggers a restore left out
-- Run AFTER sql/107. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- The test copy was made by restoring a backup, and the restore missed 12
-- triggers (docs/MIGRATIONS.md, RUN-3); whether they were ever put back is not
-- recorded. A missing trigger fails silently: a job without its code, a
-- delete that really deletes (soft_delete_job), a notification never written,
-- a new account with no profile (handle_new_user).
--
-- This puts back every trigger the migrations define on our own functions
-- (000–107, all 27: on public tables and on auth.users), where it is missing:
--   - one that exists under its name is left alone;
--   - one whose function is already attached to that table under ANOTHER
--     name is left alone too, so nothing ever fires twice;
--   - a table or function this database does not have: skipped and named.
-- On production and on a database built from the migrations: no change.
-- It reports how many it added. Running it again adds nothing.
--
-- To see what else differs from the migrations (indexes, constraints,
-- defaults, views, policies …): sql/checks/schema_check.sql, read-only.
-- No new table, no function. Tests: sql/test/restoreTriggers.test.ts.
-- ============================================================================

set lock_timeout = '10s';

do $$
declare
  r        record;
  v_rel    regclass;
  v_added  int := 0;
  v_names  text[] := '{}';
  v_skip   text[] := '{}';
begin
  for r in
    select * from (values
    ('auth', 'users', 'on_auth_email_changed', 'public.on_auth_email_changed()',
     'CREATE TRIGGER on_auth_email_changed AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.on_auth_email_changed()'),
    ('auth', 'users', 'on_auth_user_created', 'public.handle_new_user()',
     'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()'),
    ('public', 'audit_log', 'audit_log_append_only', 'public.audit_log_append_only()',
     'CREATE TRIGGER audit_log_append_only BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.audit_log_append_only()'),
    ('public', 'channel_members', 'guard_channel_member_change', 'public.guard_channel_member_change()',
     'CREATE TRIGGER guard_channel_member_change BEFORE UPDATE ON public.channel_members FOR EACH ROW EXECUTE FUNCTION public.guard_channel_member_change()'),
    ('public', 'clinic_settings', 'clinic_settings_touch', 'public.touch_clinic_settings()',
     'CREATE TRIGGER clinic_settings_touch BEFORE UPDATE ON public.clinic_settings FOR EACH ROW EXECUTE FUNCTION public.touch_clinic_settings()'),
    ('public', 'clinics', 'guard_code_prefix', 'public.guard_code_prefix()',
     'CREATE TRIGGER guard_code_prefix BEFORE UPDATE OF code_prefix ON public.clinics FOR EACH ROW EXECUTE FUNCTION public.guard_code_prefix()'),
    ('public', 'clinics', 'set_code_prefix', 'public.set_code_prefix()',
     'CREATE TRIGGER set_code_prefix BEFORE INSERT ON public.clinics FOR EACH ROW EXECUTE FUNCTION public.set_code_prefix()'),
    ('public', 'invoice_lines', 'invoice_lines_recalc', 'public.invoice_lines_touch()',
     'CREATE TRIGGER invoice_lines_recalc AFTER INSERT OR DELETE OR UPDATE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION public.invoice_lines_touch()'),
    ('public', 'invoices', 'invoices_recalc_on_rate', 'public.invoices_rate_touch()',
     'CREATE TRIGGER invoices_recalc_on_rate AFTER UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.invoices_rate_touch()'),
    ('public', 'job_file', 'file_added_notify', 'public.on_file_added_notify()',
     'CREATE TRIGGER file_added_notify AFTER UPDATE OF completed_at ON public.job_file FOR EACH ROW EXECUTE FUNCTION public.on_file_added_notify()'),
    ('public', 'job_file', 'refuse_file_on_deleted_job', 'public.refuse_file_on_deleted_job()',
     'CREATE TRIGGER refuse_file_on_deleted_job BEFORE INSERT ON public.job_file FOR EACH ROW EXECUTE FUNCTION public.refuse_file_on_deleted_job()'),
    ('public', 'job_share', 'job_share_notify', 'public.on_job_share_notify()',
     'CREATE TRIGGER job_share_notify AFTER INSERT OR UPDATE OF revoked_at ON public.job_share FOR EACH ROW EXECUTE FUNCTION public.on_job_share_notify()'),
    ('public', 'job_share', 'refuse_share_of_deleted_job', 'public.refuse_share_of_deleted_job()',
     'CREATE TRIGGER refuse_share_of_deleted_job BEFORE INSERT OR UPDATE ON public.job_share FOR EACH ROW EXECUTE FUNCTION public.refuse_share_of_deleted_job()'),
    ('public', 'jobs', 'guard_partner_visible_job_text', 'public.guard_partner_visible_job_text()',
     'CREATE TRIGGER guard_partner_visible_job_text BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.guard_partner_visible_job_text()'),
    ('public', 'jobs', 'guard_stage_change', 'public.guard_stage_change()',
     'CREATE TRIGGER guard_stage_change BEFORE UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.guard_stage_change()'),
    ('public', 'jobs', 'job_stage_notify', 'public.on_job_stage_notify()',
     'CREATE TRIGGER job_stage_notify AFTER UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.on_job_stage_notify()'),
    ('public', 'jobs', 'job_team_notify', 'public.on_job_team_notify()',
     'CREATE TRIGGER job_team_notify AFTER INSERT OR UPDATE OF status, revisions, assigned_to, designed_by, work_items ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.on_job_team_notify()'),
    ('public', 'jobs', 'jobs_updated_at', 'public.set_updated_at()',
     'CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()'),
    ('public', 'jobs', 'set_job_code', 'public.set_job_code()',
     'CREATE TRIGGER set_job_code BEFORE INSERT OR UPDATE OF job_code, clinic_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_job_code()'),
    ('public', 'jobs', 'soft_delete_job', 'public.soft_delete_job()',
     'CREATE TRIGGER soft_delete_job BEFORE DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.soft_delete_job()'),
    ('public', 'messages', 'guard_partner_visible_message', 'public.guard_partner_visible_message()',
     'CREATE TRIGGER guard_partner_visible_message BEFORE INSERT OR UPDATE OF body ON public.messages FOR EACH ROW EXECUTE FUNCTION public.guard_partner_visible_message()'),
    ('public', 'messages', 'question_notify', 'public.on_question_notify()',
     'CREATE TRIGGER question_notify AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.on_question_notify()'),
    ('public', 'messages', 'stamp_message_org', 'public.stamp_message_org()',
     'CREATE TRIGGER stamp_message_org BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.stamp_message_org()'),
    ('public', 'profiles', 'guard_profile_change', 'public.guard_profile_change()',
     'CREATE TRIGGER guard_profile_change BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_change()'),
    ('public', 'stock_item', 'guard_partner_visible_stock_text', 'public.guard_partner_visible_stock_text()',
     'CREATE TRIGGER guard_partner_visible_stock_text BEFORE INSERT OR UPDATE ON public.stock_item FOR EACH ROW EXECUTE FUNCTION public.guard_partner_visible_stock_text()'),
    ('public', 'stock_movement', 'stock_movement_append_only', 'public.stock_movement_append_only()',
     'CREATE TRIGGER stock_movement_append_only BEFORE DELETE OR UPDATE ON public.stock_movement FOR EACH ROW EXECUTE FUNCTION public.stock_movement_append_only()'),
    ('public', 'worker_permissions', 'replace_stale_grant', 'public.replace_stale_grant()',
     'CREATE TRIGGER replace_stale_grant BEFORE INSERT ON public.worker_permissions FOR EACH ROW EXECUTE FUNCTION public.replace_stale_grant()')
    ) as e(sch, tbl, tgname, fn, def)
  loop
    v_rel := to_regclass(format('%I.%I', r.sch, r.tbl));
    if v_rel is null or to_regprocedure(r.fn) is null then
      v_skip := v_skip || format('%s.%s.%s', r.sch, r.tbl, r.tgname);
      continue;
    end if;
    if exists (select 1 from pg_trigger t
                where t.tgrelid = v_rel and not t.tgisinternal
                  and (t.tgname = r.tgname or t.tgfoid = to_regprocedure(r.fn))) then
      continue;
    end if;
    execute r.def;
    v_added := v_added + 1;
    v_names := v_names || format('%s.%s.%s', r.sch, r.tbl, r.tgname);
  end loop;

  raise notice '108: added % trigger(s)%', v_added,
    case when v_added > 0 then ': ' || array_to_string(v_names, ', ') else '' end;
  if cardinality(v_skip) > 0 then
    raise notice '108: table or function not on this database, skipped: %', v_skip;
  end if;
end $$;
