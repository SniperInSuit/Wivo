-- ============================================================================
-- Wivo — migration 107: put back foreign keys a restore left out
-- Run AFTER sql/106. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- On the test copy, Invoices said "Could not find a relationship between
-- 'invoices' and 'invoice_lines' in the schema cache" for the owner, and the
-- Finance cards the same. The cause was not sql/102 (which changes no
-- constraint) but the test copy itself: it was made by restoring a backup,
-- which left out triggers and Storage policies (docs/MIGRATIONS.md, RUN-3) —
-- and, it turns out, foreign keys. invoices and invoice_lines had none at all.
-- PostgREST finds `invoices?select=*,lines:invoice_lines(*),payments(*)` ONLY
-- through foreign keys, so without them the read fails whatever the rights.
--
-- This puts back every foreign key the migrations define (000–106, all 117,
-- listed below as a fresh database has them), where it is missing:
--   - one that exists, under any name, is left alone: on production and on a
--     database built from the migrations this changes nothing;
--   - a missing one is added NOT VALID (no full-table check holding a lock),
--     then validated; if old rows point at nothing, it stays NOT VALID — it
--     still guards every new row and still tells PostgREST the relationship —
--     and the notice names it, so the orphans can be looked at.
--   - a table or column this database does not have is skipped and named.
--
-- It reports how many it added. Running it again adds nothing.
-- No new table, no function. Tests: sql/test/restoreForeignKeys.test.ts.
-- ============================================================================

set lock_timeout = '10s';

do $$
declare
  r            record;
  v_attnum     int2;
  v_ref_attnum int2;
  v_name       text;
  v_added      int := 0;
  v_not_valid  text[] := '{}';
  v_skipped    text[] := '{}';
begin
  for r in
    select * from (values
    ('app_min_version', 'org_id', 'public', 'clinics', 'id', 'cascade', 'app_min_version_org_id_fkey'),
    ('audit_log', 'org_id', 'public', 'clinics', 'id', 'cascade', 'audit_log_org_id_fkey'),
    ('audit_log', 'user_id', 'auth', 'users', 'id', 'set null', 'audit_log_user_id_fkey'),
    ('bug_report', 'org_id', 'public', 'clinics', 'id', 'set null', 'bug_report_org_id_fkey'),
    ('bug_report', 'user_id', 'auth', 'users', 'id', 'set null', 'bug_report_user_id_fkey'),
    ('channel_members', 'channel_id', 'public', 'channels', 'id', 'cascade', 'channel_members_channel_id_fkey'),
    ('channel_members', 'profile_id', 'public', 'profiles', 'id', 'cascade', 'channel_members_profile_id_fkey'),
    ('channels', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'channels_clinic_id_fkey'),
    ('channels', 'created_by', 'public', 'profiles', 'id', 'set null', 'channels_created_by_fkey'),
    ('channels', 'job_id', 'public', 'jobs', 'id', 'cascade', 'channels_job_id_fkey'),
    ('clinic_settings', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'clinic_settings_clinic_id_fkey'),
    ('clinics', 'created_by', 'auth', 'users', 'id', 'set null', 'clinics_created_by_fkey'),
    ('customers', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'customers_clinic_id_fkey'),
    ('file_download_grant', 'org_id', 'public', 'clinics', 'id', 'cascade', 'file_download_grant_org_id_fkey'),
    ('file_download_grant', 'user_id', 'auth', 'users', 'id', 'cascade', 'file_download_grant_user_id_fkey'),
    ('inventory_count', 'by_user', 'auth', 'users', 'id', 'set null', 'inventory_count_by_user_fkey'),
    ('inventory_count', 'org_id', 'public', 'clinics', 'id', 'cascade', 'inventory_count_org_id_fkey'),
    ('inventory_count_line', 'count_id', 'public', 'inventory_count', 'id', 'cascade', 'inventory_count_line_count_id_fkey'),
    ('inventory_count_line', 'item_id', 'public', 'stock_item', 'id', 'cascade', 'inventory_count_line_item_id_fkey'),
    ('inventory_count_line', 'org_id', 'public', 'clinics', 'id', 'cascade', 'inventory_count_line_org_id_fkey'),
    ('inventory_schedule', 'org_id', 'public', 'clinics', 'id', 'cascade', 'inventory_schedule_org_id_fkey'),
    ('inventory_schedule', 'updated_by', 'auth', 'users', 'id', 'set null', 'inventory_schedule_updated_by_fkey'),
    ('invoice_counters', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'invoice_counters_clinic_id_fkey'),
    ('invoice_lines', 'invoice_id', 'public', 'invoices', 'id', 'cascade', 'invoice_lines_invoice_id_fkey'),
    ('invoice_lines', 'job_id', 'public', 'jobs', 'id', 'set null', 'invoice_lines_job_id_fkey'),
    ('invoices', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'invoices_clinic_id_fkey'),
    ('invoices', 'created_by', 'public', 'profiles', 'id', 'set null', 'invoices_created_by_fkey'),
    ('invoices', 'customer_id', 'public', 'customers', 'id', 'set null', 'invoices_customer_id_fkey'),
    ('invoices', 'patient_id', 'public', 'patients', 'id', 'set null', 'invoices_patient_id_fkey'),
    ('invoices', 'payment_plan_id', 'public', 'payment_plans', 'id', 'set null', 'invoices_payment_plan_id_fkey'),
    ('job_code_counter', 'org_id', 'public', 'clinics', 'id', 'cascade', 'job_code_counter_org_id_fkey'),
    ('job_file', 'deleted_by', 'auth', 'users', 'id', 'set null', 'job_file_deleted_by_fkey'),
    ('job_file', 'job_id', 'public', 'jobs', 'id', 'cascade', 'job_file_job_id_fkey'),
    ('job_file', 'org_id', 'public', 'clinics', 'id', 'cascade', 'job_file_org_id_fkey'),
    ('job_file', 'supersedes', 'public', 'job_file', 'id', 'set null', 'job_file_supersedes_fkey'),
    ('job_file', 'uploaded_by', 'auth', 'users', 'id', 'set null', 'job_file_uploaded_by_fkey'),
    ('job_file', 'uploaded_by_org', 'public', 'clinics', 'id', 'set null', 'job_file_uploaded_by_org_fkey'),
    ('job_share', 'consent_by', 'auth', 'users', 'id', 'set null', 'job_share_consent_by_fkey'),
    ('job_share', 'created_by', 'auth', 'users', 'id', 'set null', 'job_share_created_by_fkey'),
    ('job_share', 'job_id', 'public', 'jobs', 'id', 'cascade', 'job_share_job_id_fkey'),
    ('job_share', 'owner_org', 'public', 'clinics', 'id', 'cascade', 'job_share_owner_org_fkey'),
    ('job_share', 'partner_org', 'public', 'clinics', 'id', 'cascade', 'job_share_partner_org_fkey'),
    ('job_share', 'partnership_id', 'public', 'partnership', 'id', 'cascade', 'job_share_partnership_id_fkey'),
    ('jobs', 'assigned_to', 'public', 'profiles', 'id', 'set null', 'jobs_assigned_to_fkey'),
    ('jobs', 'clinic_id', 'public', 'clinics', 'id', 'no action', 'jobs_clinic_id_fkey'),
    ('jobs', 'customer_id', 'public', 'customers', 'id', 'set null', 'jobs_customer_id_fkey'),
    ('jobs', 'deleted_by', 'auth', 'users', 'id', 'set null', 'jobs_deleted_by_fkey'),
    ('jobs', 'designed_by', 'public', 'profiles', 'id', 'set null', 'jobs_designed_by_fkey'),
    ('jobs', 'patient_id', 'public', 'patients', 'id', 'set null', 'jobs_patient_id_fkey'),
    ('message_jobs', 'job_id', 'public', 'jobs', 'id', 'cascade', 'message_jobs_job_id_fkey'),
    ('message_jobs', 'message_id', 'public', 'messages', 'id', 'cascade', 'message_jobs_message_id_fkey'),
    ('messages', 'author_id', 'public', 'profiles', 'id', 'set null', 'messages_author_id_fkey'),
    ('messages', 'author_org', 'public', 'clinics', 'id', 'set null', 'messages_author_org_fkey'),
    ('messages', 'channel_id', 'public', 'channels', 'id', 'cascade', 'messages_channel_id_fkey'),
    ('messages', 'file_id', 'public', 'job_file', 'id', 'set null', 'messages_file_id_fkey'),
    ('messages', 'resolved_by', 'auth', 'users', 'id', 'set null', 'messages_resolved_by_fkey'),
    ('mfa_attempt', 'org_id', 'public', 'clinics', 'id', 'cascade', 'mfa_attempt_org_id_fkey'),
    ('mfa_attempt', 'user_id', 'auth', 'users', 'id', 'cascade', 'mfa_attempt_user_id_fkey'),
    ('notification', 'job_id', 'public', 'jobs', 'id', 'cascade', 'notification_job_id_fkey'),
    ('notification', 'org_id', 'public', 'clinics', 'id', 'cascade', 'notification_org_id_fkey'),
    ('notification', 'user_id', 'auth', 'users', 'id', 'cascade', 'notification_user_id_fkey'),
    ('partnership', 'accepted_by', 'auth', 'users', 'id', 'set null', 'partnership_accepted_by_fkey'),
    ('partnership', 'confirmed_by', 'auth', 'users', 'id', 'set null', 'partnership_confirmed_by_fkey'),
    ('partnership', 'ended_by', 'auth', 'users', 'id', 'set null', 'partnership_ended_by_fkey'),
    ('partnership', 'org_a', 'public', 'clinics', 'id', 'cascade', 'partnership_org_a_fkey'),
    ('partnership', 'org_b', 'public', 'clinics', 'id', 'cascade', 'partnership_org_b_fkey'),
    ('partnership', 'suspended_by', 'auth', 'users', 'id', 'set null', 'partnership_suspended_by_fkey'),
    ('partnership', 'suspended_by_org', 'public', 'clinics', 'id', 'set null', 'partnership_suspended_by_org_fkey'),
    ('partnership_invite', 'created_by', 'auth', 'users', 'id', 'set null', 'partnership_invite_created_by_fkey'),
    ('partnership_invite', 'org_id', 'public', 'clinics', 'id', 'cascade', 'partnership_invite_org_id_fkey'),
    ('partnership_invite', 'used_by_org', 'public', 'clinics', 'id', 'set null', 'partnership_invite_used_by_org_fkey'),
    ('partnership_invite_attempt', 'org_id', 'public', 'clinics', 'id', 'cascade', 'partnership_invite_attempt_org_id_fkey'),
    ('patient_teeth', 'patient_id', 'public', 'patients', 'id', 'cascade', 'patient_teeth_patient_id_fkey'),
    ('patients', 'clinic_id', 'public', 'clinics', 'id', 'no action', 'patients_clinic_id_fkey'),
    ('payment_plans', 'clinic_id', 'public', 'clinics', 'id', 'no action', 'payment_plans_clinic_id_fkey'),
    ('payment_plans', 'patient_id', 'public', 'patients', 'id', 'set null', 'payment_plans_patient_id_fkey'),
    ('payments', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'payments_clinic_id_fkey'),
    ('payments', 'invoice_id', 'public', 'invoices', 'id', 'cascade', 'payments_invoice_id_fkey'),
    ('payments', 'job_id', 'public', 'jobs', 'id', 'set null', 'payments_job_id_fkey'),
    ('payments', 'recorded_by', 'public', 'profiles', 'id', 'set null', 'payments_recorded_by_fkey'),
    ('profiles', 'clinic_id', 'public', 'clinics', 'id', 'no action', 'profiles_clinic_id_fkey'),
    ('profiles', 'id', 'auth', 'users', 'id', 'cascade', 'profiles_id_fkey'),
    ('profiles', 'removed_from', 'public', 'clinics', 'id', 'set null', 'profiles_removed_from_fkey'),
    ('push_subscription', 'org_id', 'public', 'clinics', 'id', 'cascade', 'push_subscription_org_id_fkey'),
    ('push_subscription', 'user_id', 'auth', 'users', 'id', 'cascade', 'push_subscription_user_id_fkey'),
    ('stage_transition', 'org_id', 'public', 'clinics', 'id', 'cascade', 'stage_transition_org_id_fkey'),
    ('stock_item', 'created_by', 'auth', 'users', 'id', 'set null', 'stock_item_created_by_fkey'),
    ('stock_item', 'org_id', 'public', 'clinics', 'id', 'cascade', 'stock_item_org_id_fkey'),
    ('stock_item', 'owner_org', 'public', 'clinics', 'id', 'restrict', 'stock_item_owner_org_fkey'),
    ('stock_movement', 'by_user', 'auth', 'users', 'id', 'set null', 'stock_movement_by_user_fkey'),
    ('stock_movement', 'count_id', 'public', 'inventory_count', 'id', 'set null', 'stock_movement_count_id_fkey'),
    ('stock_movement', 'item_id', 'public', 'stock_item', 'id', 'cascade', 'stock_movement_item_id_fkey'),
    ('stock_movement', 'job_id', 'public', 'jobs', 'id', 'set null', 'stock_movement_job_id_fkey'),
    ('stock_movement', 'org_id', 'public', 'clinics', 'id', 'cascade', 'stock_movement_org_id_fkey'),
    ('stock_threshold', 'org_id', 'public', 'clinics', 'id', 'cascade', 'stock_threshold_org_id_fkey'),
    ('stock_threshold', 'updated_by', 'auth', 'users', 'id', 'set null', 'stock_threshold_updated_by_fkey'),
    ('visit_requests', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'visit_requests_clinic_id_fkey'),
    ('visit_requests', 'kasitles', 'public', 'profiles', 'id', 'set null', 'visit_requests_kasitles_fkey'),
    ('visit_requests', 'visit_id', 'public', 'visits', 'id', 'set null', 'visit_requests_visit_id_fkey'),
    ('visits', 'clinic_id', 'public', 'clinics', 'id', 'no action', 'visits_clinic_id_fkey'),
    ('visits', 'patient_id', 'public', 'patients', 'id', 'set null', 'visits_patient_id_fkey'),
    ('work_hours', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'work_hours_clinic_id_fkey'),
    ('work_hours', 'profile_id', 'public', 'profiles', 'id', 'cascade', 'work_hours_profile_id_fkey'),
    ('work_hours', 'recorded_by', 'public', 'profiles', 'id', 'set null', 'work_hours_recorded_by_fkey'),
    ('worker_invite', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'worker_invite_clinic_id_fkey'),
    ('worker_invite', 'created_by', 'auth', 'users', 'id', 'set null', 'worker_invite_created_by_fkey'),
    ('worker_invite', 'used_by', 'auth', 'users', 'id', 'set null', 'worker_invite_used_by_fkey'),
    ('worker_payout_lines', 'job_id', 'public', 'jobs', 'id', 'set null', 'worker_payout_lines_job_id_fkey'),
    ('worker_payout_lines', 'payout_id', 'public', 'worker_payouts', 'id', 'cascade', 'worker_payout_lines_payout_id_fkey'),
    ('worker_payout_lines', 'work_hours_id', 'public', 'work_hours', 'id', 'set null', 'worker_payout_lines_work_hours_id_fkey'),
    ('worker_payouts', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'worker_payouts_clinic_id_fkey'),
    ('worker_payouts', 'created_by', 'public', 'profiles', 'id', 'set null', 'worker_payouts_created_by_fkey'),
    ('worker_payouts', 'profile_id', 'public', 'profiles', 'id', 'cascade', 'worker_payouts_profile_id_fkey'),
    ('worker_permissions', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'worker_permissions_clinic_id_fkey'),
    ('worker_permissions', 'profile_id', 'public', 'profiles', 'id', 'cascade', 'worker_permissions_profile_id_fkey'),
    ('worker_rates', 'clinic_id', 'public', 'clinics', 'id', 'cascade', 'worker_rates_clinic_id_fkey'),
    ('worker_rates', 'profile_id', 'public', 'profiles', 'id', 'cascade', 'worker_rates_profile_id_fkey')
    ) as e(tbl, col, ref_schema, ref_tbl, ref_col, on_delete, conname)
  loop
    if to_regclass(format('public.%I', r.tbl)) is null or to_regclass(format('%I.%I', r.ref_schema, r.ref_tbl)) is null then
      v_skipped := v_skipped || format('%s.%s', r.tbl, r.col);
      continue;
    end if;
    select attnum into v_attnum from pg_attribute
     where attrelid = format('public.%I', r.tbl)::regclass and attname = r.col and not attisdropped;
    select attnum into v_ref_attnum from pg_attribute
     where attrelid = format('%I.%I', r.ref_schema, r.ref_tbl)::regclass and attname = r.ref_col and not attisdropped;
    if v_attnum is null or v_ref_attnum is null then
      v_skipped := v_skipped || format('%s.%s', r.tbl, r.col);
      continue;
    end if;

    -- Already there, under any name.
    if exists (select 1 from pg_constraint c
                where c.contype = 'f'
                  and c.conrelid = format('public.%I', r.tbl)::regclass
                  and c.confrelid = format('%I.%I', r.ref_schema, r.ref_tbl)::regclass
                  and c.conkey = array[v_attnum] and c.confkey = array[v_ref_attnum]) then
      continue;
    end if;

    v_name := r.conname;
    if exists (select 1 from pg_constraint where conrelid = format('public.%I', r.tbl)::regclass and conname = v_name) then
      v_name := left(r.conname, 50) || '_restored';
    end if;
    execute format('alter table public.%I add constraint %I foreign key (%I) references %I.%I (%I) on delete %s not valid',
                   r.tbl, v_name, r.col, r.ref_schema, r.ref_tbl, r.ref_col, r.on_delete);
    v_added := v_added + 1;
    begin
      execute format('alter table public.%I validate constraint %I', r.tbl, v_name);
    exception when foreign_key_violation then
      v_not_valid := v_not_valid || format('%s.%s -> %s.%s', r.tbl, r.col, r.ref_tbl, r.ref_col);
    end;
  end loop;

  raise notice '107: added % foreign key(s)', v_added;
  if cardinality(v_not_valid) > 0 then
    raise notice '107: rows that point at nothing; these stay NOT VALID until they are looked at: %', v_not_valid;
  end if;
  if cardinality(v_skipped) > 0 then
    raise notice '107: not on this database, skipped: %', v_skipped;
  end if;
end $$;
