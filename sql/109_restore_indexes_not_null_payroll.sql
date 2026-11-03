-- ============================================================================
-- Wivo — migration 109: put back indexes, NOT NULL and the payroll policies a
-- restore left out
-- Run AFTER sql/108. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- sql/checks/schema_check.sql on the test copy (2026-11-03), after 107 and
-- 108, still found what its restore had left out:
--   - 52 indexes. A missing plain index only makes reads slow; a missing
--     UNIQUE one (job codes, code prefixes, one live share per job and
--     partner, …) lets duplicates in.
--   - NOT NULL on jobs.created_at and jobs.updated_at.
--   - The payroll policies of sql/027: the test copy still has sql/022's
--     owner-only versions (*_write_owner, and select/insert that only the
--     owner passes), so a member given payroll.manage is refused.
--
-- This puts each one back where it is missing, as the migrations (000–108)
-- define it:
--   1. Indexes (all 64). One that exists under its name, or with
--      the same definition under another name, is left alone. A UNIQUE one
--      that existing rows break is skipped, and the duplicates are named
--      (the key and the row ids) — nothing is deleted.
--   2. NOT NULL (300 columns). A column that has empty values is skipped
--      and the count reported — nothing is filled in.
--   3. The 9 payroll policies of sql/027 (worker_rates, work_hours,
--      worker_payouts, worker_payout_lines). Each is made under a temporary
--      name and compared with the one this database has, on this database,
--      so a policy that is already right is left alone. Then the owner-only
--      *_write_owner policies that 027 dropped are dropped. If
--      public.can_manage_payroll() is missing, this part is skipped.
-- On production and on a database built from the migrations: no change.
-- It reports what it added and what it skipped. Running it again adds nothing.
-- ============================================================================

set lock_timeout = '10s';

-- 1. Indexes ------------------------------------------------------------------
do $$
declare
  r record;
  dupes text;
  same_shape constant text := '^CREATE (UNIQUE )?INDEX \S+ ON ';
  added text[] := '{}';
  skipped text[] := '{}';
begin
  for r in select * from (values
    ('app_min_version', 'app_min_version_one_global', true,
     'CREATE UNIQUE INDEX app_min_version_one_global ON public.app_min_version USING btree ((true)) WHERE (org_id IS NULL)',
     'select string_agg(format(''(%s) in %s rows, ids %s'', k, n, ids), ''; '') from (select coalesce(((true))::text, ''null'') as k, count(*) as n, array_agg(id order by id)::text as ids from public.app_min_version where org_id IS NULL group by (true) having count(*) > 1) d'),
    ('app_min_version', 'app_min_version_one_per_org', true,
     'CREATE UNIQUE INDEX app_min_version_one_per_org ON public.app_min_version USING btree (org_id) WHERE (org_id IS NOT NULL)',
     'select string_agg(format(''(%s) in %s rows, ids %s'', k, n, ids), ''; '') from (select coalesce((org_id)::text, ''null'') as k, count(*) as n, array_agg(id order by id)::text as ids from public.app_min_version where org_id IS NOT NULL group by org_id having count(*) > 1) d'),
    ('audit_log', 'audit_log_org_action_at_idx', false,
     'CREATE INDEX audit_log_org_action_at_idx ON public.audit_log USING btree (org_id, action, at DESC, id DESC)',
     null),
    ('audit_log', 'audit_log_org_at_idx', false,
     'CREATE INDEX audit_log_org_at_idx ON public.audit_log USING btree (org_id, at DESC)',
     null),
    ('audit_log', 'audit_log_org_object_at_idx', false,
     'CREATE INDEX audit_log_org_object_at_idx ON public.audit_log USING btree (org_id, object, at DESC, id DESC)',
     null),
    ('audit_log', 'audit_log_org_user_at_idx', false,
     'CREATE INDEX audit_log_org_user_at_idx ON public.audit_log USING btree (org_id, user_id, at DESC, id DESC)',
     null),
    ('channel_members', 'channel_members_profile_idx', false,
     'CREATE INDEX channel_members_profile_idx ON public.channel_members USING btree (profile_id)',
     null),
    ('channels', 'channels_clinic_idx', false,
     'CREATE INDEX channels_clinic_idx ON public.channels USING btree (clinic_id, created_at DESC)',
     null),
    ('clinics', 'clinics_code_prefix_key', true,
     'CREATE UNIQUE INDEX clinics_code_prefix_key ON public.clinics USING btree (code_prefix)',
     'select string_agg(format(''(%s) in %s rows, ids %s'', k, n, ids), ''; '') from (select coalesce((code_prefix)::text, ''null'') as k, count(*) as n, array_agg(id order by id)::text as ids from public.clinics group by code_prefix having count(*) > 1) d'),
    ('clinics', 'clinics_public_slug_idx', true,
     'CREATE UNIQUE INDEX clinics_public_slug_idx ON public.clinics USING btree (public_slug) WHERE (public_slug IS NOT NULL)',
     'select string_agg(format(''(%s) in %s rows, ids %s'', k, n, ids), ''; '') from (select coalesce((public_slug)::text, ''null'') as k, count(*) as n, array_agg(id order by id)::text as ids from public.clinics where public_slug IS NOT NULL group by public_slug having count(*) > 1) d'),
    ('customers', 'customers_clinic_idx', false,
     'CREATE INDEX customers_clinic_idx ON public.customers USING btree (clinic_id, lower(name))',
     null),
    ('file_download_grant', 'file_download_grant_lookup', false,
     'CREATE INDEX file_download_grant_lookup ON public.file_download_grant USING btree (user_id, storage_path, expires_at)',
     null),
    ('jobs', 'idx_jobs_clinic', false,
     'CREATE INDEX idx_jobs_clinic ON public.jobs USING btree (clinic_id)',
     null),
    ('patients', 'idx_patients_clinic', false,
     'CREATE INDEX idx_patients_clinic ON public.patients USING btree (clinic_id)',
     null),
    ('visits', 'idx_visits_clinic', false,
     'CREATE INDEX idx_visits_clinic ON public.visits USING btree (clinic_id)',
     null),
    ('inventory_count', 'inventory_count_org_idx', false,
     'CREATE INDEX inventory_count_org_idx ON public.inventory_count USING btree (org_id, finished_at DESC)',
     null),
    ('invoice_lines', 'invoice_lines_invoice_idx', false,
     'CREATE INDEX invoice_lines_invoice_idx ON public.invoice_lines USING btree (invoice_id, sort_order)',
     null),
    ('invoice_lines', 'invoice_lines_job_idx', false,
     'CREATE INDEX invoice_lines_job_idx ON public.invoice_lines USING btree (job_id)',
     null),
    ('invoices', 'invoices_clinic_idx', false,
     'CREATE INDEX invoices_clinic_idx ON public.invoices USING btree (clinic_id, issue_date DESC)',
     null),
    ('invoices', 'invoices_customer_idx', false,
     'CREATE INDEX invoices_customer_idx ON public.invoices USING btree (customer_id, issue_date DESC)',
     null),
    ('invoices', 'invoices_patient_idx', false,
     'CREATE INDEX invoices_patient_idx ON public.invoices USING btree (patient_id)',
     null),
    ('invoices', 'invoices_payment_plan_idx', false,
     'CREATE INDEX invoices_payment_plan_idx ON public.invoices USING btree (payment_plan_id, instalment_no) WHERE (payment_plan_id IS NOT NULL)',
     null),
    ('invoices', 'invoices_status_idx', false,
     'CREATE INDEX invoices_status_idx ON public.invoices USING btree (status)',
     null),
    ('invoices', 'invoices_unsent_idx', false,
     'CREATE INDEX invoices_unsent_idx ON public.invoices USING btree (issue_date) WHERE (sent_at IS NULL)',
     null),
    ('job_file', 'job_file_job_idx', false,
     'CREATE INDEX job_file_job_idx ON public.job_file USING btree (job_id) WHERE (deleted_at IS NULL)',
     null),
    ('job_share', 'job_share_live_key', true,
     'CREATE UNIQUE INDEX job_share_live_key ON public.job_share USING btree (job_id, partner_org) WHERE (revoked_at IS NULL)',
     'select string_agg(format(''(%s) in %s rows, ids %s'', k, n, ids), ''; '') from (select coalesce((job_id)::text, ''null'') || '', '' || coalesce((partner_org)::text, ''null'') as k, count(*) as n, array_agg(id order by id)::text as ids from public.job_share where revoked_at IS NULL group by job_id, partner_org having count(*) > 1) d'),
    ('job_share', 'job_share_partner_idx', false,
     'CREATE INDEX job_share_partner_idx ON public.job_share USING btree (partner_org) WHERE (revoked_at IS NULL)',
     null),
    ('jobs', 'jobs_assigned_to_idx', false,
     'CREATE INDEX jobs_assigned_to_idx ON public.jobs USING btree (assigned_to)',
     null),
    ('jobs', 'jobs_customer_idx', false,
     'CREATE INDEX jobs_customer_idx ON public.jobs USING btree (customer_id, valmis_kuupaev)',
     null),
    ('jobs', 'jobs_designed_by_idx', false,
     'CREATE INDEX jobs_designed_by_idx ON public.jobs USING btree (designed_by)',
     null),
    ('jobs', 'jobs_job_code_key', true,
     'CREATE UNIQUE INDEX jobs_job_code_key ON public.jobs USING btree (job_code)',
     'select string_agg(format(''(%s) in %s rows, ids %s'', k, n, ids), ''; '') from (select coalesce((job_code)::text, ''null'') as k, count(*) as n, array_agg(id order by id)::text as ids from public.jobs group by job_code having count(*) > 1) d'),
    ('jobs', 'jobs_kuupaev_idx', false,
     'CREATE INDEX jobs_kuupaev_idx ON public.jobs USING btree (kuupaev DESC)',
     null),
    ('jobs', 'jobs_patient_id_idx', false,
     'CREATE INDEX jobs_patient_id_idx ON public.jobs USING btree (patient_id)',
     null),
    ('jobs', 'jobs_status_idx', false,
     'CREATE INDEX jobs_status_idx ON public.jobs USING btree (status)',
     null),
    ('jobs', 'jobs_valmis_kuupaev_idx', false,
     'CREATE INDEX jobs_valmis_kuupaev_idx ON public.jobs USING btree (valmis_kuupaev)',
     null),
    ('message_jobs', 'message_jobs_job_idx', false,
     'CREATE INDEX message_jobs_job_idx ON public.message_jobs USING btree (job_id)',
     null),
    ('messages', 'messages_channel_idx', false,
     'CREATE INDEX messages_channel_idx ON public.messages USING btree (channel_id, created_at DESC)',
     null),
    ('mfa_attempt', 'mfa_attempt_user_at_idx', false,
     'CREATE INDEX mfa_attempt_user_at_idx ON public.mfa_attempt USING btree (user_id, at DESC)',
     null),
    ('notification', 'notification_email_pending_idx', false,
     'CREATE INDEX notification_email_pending_idx ON public.notification USING btree (created_at) WHERE (emailed_at IS NULL)',
     null),
    ('notification', 'notification_user_unread_idx', false,
     'CREATE INDEX notification_user_unread_idx ON public.notification USING btree (user_id, created_at DESC) WHERE (read_at IS NULL)',
     null),
    ('partnership', 'partnership_pair_live_key', true,
     'CREATE UNIQUE INDEX partnership_pair_live_key ON public.partnership USING btree (LEAST(org_a, org_b), GREATEST(org_a, org_b)) WHERE (status <> ''ended''::text)',
     'select string_agg(format(''(%s) in %s rows, ids %s'', k, n, ids), ''; '') from (select coalesce((LEAST(org_a, org_b))::text, ''null'') || '', '' || coalesce((GREATEST(org_a, org_b))::text, ''null'') as k, count(*) as n, array_agg(id order by id)::text as ids from public.partnership where status <> ''ended''::text group by LEAST(org_a, org_b), GREATEST(org_a, org_b) having count(*) > 1) d'),
    ('patients', 'patients_marketing_ok_idx', false,
     'CREATE INDEX patients_marketing_ok_idx ON public.patients USING btree (clinic_id) WHERE (turundusnousolek = ''jah''::text)',
     null),
    ('patients', 'patients_nimi_idx', false,
     'CREATE INDEX patients_nimi_idx ON public.patients USING btree (lower(nimi))',
     null),
    ('payment_plans', 'payment_plans_clinic_idx', false,
     'CREATE INDEX payment_plans_clinic_idx ON public.payment_plans USING btree (clinic_id, created_at DESC)',
     null),
    ('payment_plans', 'payment_plans_patient_idx', false,
     'CREATE INDEX payment_plans_patient_idx ON public.payment_plans USING btree (patient_id)',
     null),
    ('payments', 'payments_clinic_idx', false,
     'CREATE INDEX payments_clinic_idx ON public.payments USING btree (clinic_id, paid_at DESC)',
     null),
    ('payments', 'payments_invoice_idx', false,
     'CREATE INDEX payments_invoice_idx ON public.payments USING btree (invoice_id)',
     null),
    ('profiles', 'profiles_clinic_username_key', true,
     'CREATE UNIQUE INDEX profiles_clinic_username_key ON public.profiles USING btree (clinic_id, lower(username)) WHERE (username IS NOT NULL)',
     'select string_agg(format(''(%s) in %s rows, ids %s'', k, n, ids), ''; '') from (select coalesce((clinic_id)::text, ''null'') || '', '' || coalesce((lower(username))::text, ''null'') as k, count(*) as n, array_agg(id order by id)::text as ids from public.profiles where username IS NOT NULL group by clinic_id, lower(username) having count(*) > 1) d'),
    ('push_subscription', 'push_subscription_user_idx', false,
     'CREATE INDEX push_subscription_user_idx ON public.push_subscription USING btree (user_id)',
     null),
    ('stock_item', 'stock_item_org_idx', false,
     'CREATE INDEX stock_item_org_idx ON public.stock_item USING btree (org_id, product_key)',
     null),
    ('stock_item', 'stock_item_owner_idx', false,
     'CREATE INDEX stock_item_owner_idx ON public.stock_item USING btree (owner_org) WHERE (owner_org IS NOT NULL)',
     null),
    ('stock_movement', 'stock_movement_item_idx', false,
     'CREATE INDEX stock_movement_item_idx ON public.stock_movement USING btree (item_id)',
     null),
    ('stock_movement', 'stock_movement_job_idx', false,
     'CREATE INDEX stock_movement_job_idx ON public.stock_movement USING btree (job_id) WHERE (job_id IS NOT NULL)',
     null),
    ('visit_requests', 'visit_requests_inbox_idx', false,
     'CREATE INDEX visit_requests_inbox_idx ON public.visit_requests USING btree (clinic_id, staatus, created_at DESC)',
     null),
    ('visit_requests', 'visit_requests_montonio_uuid_idx', true,
     'CREATE UNIQUE INDEX visit_requests_montonio_uuid_idx ON public.visit_requests USING btree (montonio_uuid) WHERE (montonio_uuid IS NOT NULL)',
     'select string_agg(format(''(%s) in %s rows, ids %s'', k, n, ids), ''; '') from (select coalesce((montonio_uuid)::text, ''null'') as k, count(*) as n, array_agg(id order by id)::text as ids from public.visit_requests where montonio_uuid IS NOT NULL group by montonio_uuid having count(*) > 1) d'),
    ('visits', 'visits_algus_idx', false,
     'CREATE INDEX visits_algus_idx ON public.visits USING btree (algus)',
     null),
    ('visits', 'visits_patient_id_idx', false,
     'CREATE INDEX visits_patient_id_idx ON public.visits USING btree (patient_id)',
     null),
    ('work_hours', 'work_hours_profile_idx', false,
     'CREATE INDEX work_hours_profile_idx ON public.work_hours USING btree (profile_id, work_date DESC)',
     null),
    ('worker_payout_lines', 'worker_payout_lines_job_idx', false,
     'CREATE INDEX worker_payout_lines_job_idx ON public.worker_payout_lines USING btree (job_id)',
     null),
    ('worker_payout_lines', 'worker_payout_lines_key_idx', false,
     'CREATE INDEX worker_payout_lines_key_idx ON public.worker_payout_lines USING btree (payout_id, line_key)',
     null),
    ('worker_payout_lines', 'worker_payout_lines_payout_idx', false,
     'CREATE INDEX worker_payout_lines_payout_idx ON public.worker_payout_lines USING btree (payout_id)',
     null),
    ('worker_payouts', 'worker_payouts_profile_idx', false,
     'CREATE INDEX worker_payouts_profile_idx ON public.worker_payouts USING btree (profile_id, period_end DESC)',
     null),
    ('worker_rates', 'worker_rates_clinic_idx', false,
     'CREATE INDEX worker_rates_clinic_idx ON public.worker_rates USING btree (clinic_id)',
     null),
    ('worker_rates', 'worker_rates_profile_idx', false,
     'CREATE INDEX worker_rates_profile_idx ON public.worker_rates USING btree (profile_id)',
     null)
  ) v(tbl, name, is_unique, def, dupes_sql) loop
    if to_regclass('public.' || quote_ident(r.tbl)) is null then
      skipped := skipped || format('%s (no table %s)', r.name, r.tbl);
      continue;
    end if;
    if to_regclass('public.' || quote_ident(r.name)) is not null then
      continue;   -- there under its name
    end if;
    if exists (select 1 from pg_index i
                where i.indrelid = ('public.' || quote_ident(r.tbl))::regclass
                  and regexp_replace(pg_get_indexdef(i.indexrelid), same_shape, '')
                    = regexp_replace(r.def, same_shape, '')) then
      continue;   -- there under another name
    end if;
    begin
      execute r.def;
      added := added || r.name;
    exception
      when unique_violation then
        execute r.dupes_sql into dupes;
        skipped := skipped || format('%s: duplicates %s', r.name, coalesce(dupes, '?'));
      when undefined_column or undefined_function then
        skipped := skipped || format('%s (%s)', r.name, sqlerrm);
    end;
  end loop;
  raise notice '109: added % index(es)%', cardinality(added),
    case when cardinality(added) > 0 then ': ' || array_to_string(added, ', ') else '' end;
  if cardinality(skipped) > 0 then
    raise notice '109: skipped % index(es): %', cardinality(skipped), array_to_string(skipped, ' | ');
  end if;
end $$;

-- 2. NOT NULL -----------------------------------------------------------------
do $$
declare
  r record;
  col text;
  is_set boolean;
  empty_rows bigint;
  added text[] := '{}';
  skipped text[] := '{}';
begin
  for r in select * from (values
    ('app_min_version', array['id', 'min_version', 'required', 'updated_at']),
    ('audit_log', array['id', 'org_id', 'action', 'object', 'detail', 'at']),
    ('bug_report', array['id', 'message', 'recent_errors', 'status', 'created_at']),
    ('channel_members', array['channel_id', 'profile_id', 'role', 'joined_at']),
    ('channels', array['id', 'clinic_id', 'kind', 'created_at']),
    ('clinic_settings', array['clinic_id', 'work_types', 'materials', 'material_prices', 'machines', 'pipeline_stages', 'pricing', 'calendar', 'created_at', 'updated_at', 'material_costs', 'payroll', 'features', 'visit_types', 'public_services', 'email', 'broneering', 'vestlus']),
    ('clinics', array['id', 'name', 'created_at', 'updated_at', 'country', 'default_language', 'home_instance']),
    ('customers', array['id', 'clinic_id', 'name', 'cc_emails', 'billing_mode', 'payment_terms_days', 'price_overrides', 'created_at', 'updated_at']),
    ('file_download_grant', array['id', 'org_id', 'user_id', 'storage_path', 'expires_at']),
    ('inventory_count', array['id', 'org_id', 'started_at', 'finished_at']),
    ('inventory_count_line', array['id', 'org_id', 'count_id', 'item_id', 'expected', 'counted']),
    ('inventory_schedule', array['org_id', 'interval_months', 'next_due', 'updated_at']),
    ('invoice_counters', array['clinic_id', 'year', 'last_no']),
    ('invoice_lines', array['id', 'invoice_id', 'description', 'qty', 'unit_price', 'sort_order', 'created_at']),
    ('invoices', array['id', 'clinic_id', 'number', 'patsient', 'status', 'issue_date', 'vat_rate', 'net_total', 'vat_total', 'gross_total', 'created_at', 'updated_at', 'bill_to_kind']),
    ('job_code_counter', array['org_id', 'year', 'last']),
    ('job_file', array['id', 'job_id', 'org_id', 'type', 'version', 'is_active', 'sha256', 'size', 'file_name', 'storage_path', 'uploaded_at']),
    ('job_share', array['id', 'job_id', 'owner_org', 'partner_org', 'partnership_id', 'case_type', 'visibility', 'role', 'assigned_stages', 'created_at']),
    ('jobs', array['id', 'status', 'kuupaev', 'patsient', 'makstud', 'created_at', 'updated_at', 'kiirtoo', 'revisions', 'markused', 'work_items', 'extras', 'delivery_status', 'mudel', 'extra_costs', 'kulu_yle']),
    ('message_jobs', array['message_id', 'job_id']),
    ('messages', array['id', 'channel_id', 'body', 'created_at', 'is_question']),
    ('mfa_attempt', array['id', 'org_id', 'user_id', 'at']),
    ('notification', array['id', 'org_id', 'user_id', 'kind', 'detail', 'created_at']),
    ('partnership', array['id', 'org_a', 'org_b', 'share_stock', 'default_visibility', 'roles', 'status', 'created_at']),
    ('partnership_invite', array['id', 'org_id', 'code_hash', 'expires_at', 'attempts', 'created_at']),
    ('partnership_invite_attempt', array['id', 'org_id', 'ok', 'at']),
    ('patient_teeth', array['patient_id', 'fdi', 'staatus', 'updated_at']),
    ('patients', array['id', 'nimi', 'created_at', 'updated_at', 'markused', 'turundusnousolek']),
    ('payment_plans', array['id', 'clinic_id', 'patsient', 'kogusumma', 'osamakseid', 'esimene_arve', 'maksetahtaeg_paevi', 'staatus', 'created_at', 'updated_at']),
    ('payments', array['id', 'clinic_id', 'amount', 'method', 'paid_at', 'created_at']),
    ('profiles', array['id', 'full_name', 'role', 'created_at', 'updated_at', 'toosuhe', 'tasu_arvestus', 'ui_prefs', 'notify_email', 'notify_push']),
    ('push_subscription', array['id', 'org_id', 'user_id', 'endpoint', 'p256dh', 'auth', 'created_at']),
    ('stage_transition', array['id', 'org_id', 'from_stage', 'to_stage', 'actor']),
    ('stock_item', array['id', 'org_id', 'category', 'lot', 'expiry_date', 'created_at']),
    ('stock_movement', array['id', 'org_id', 'item_id', 'kind', 'delta', 'expired_override', 'at']),
    ('stock_threshold', array['org_id', 'product_key', 'min_qty', 'updated_at']),
    ('visit_requests', array['id', 'clinic_id', 'idempotency_key', 'nimi', 'telefon', 'staatus', 'created_at', 'updated_at', 'makse_staatus']),
    ('visits', array['id', 'patsient', 'algus', 'kestus_min', 'staatus', 'created_at', 'updated_at']),
    ('work_hours', array['id', 'clinic_id', 'profile_id', 'work_date', 'hours', 'created_at']),
    ('worker_invite', array['id', 'clinic_id', 'token_hash', 'created_at', 'expires_at']),
    ('worker_payout_lines', array['id', 'payout_id', 'kind', 'description', 'qty', 'rate', 'amount', 'created_at']),
    ('worker_payouts', array['id', 'clinic_id', 'profile_id', 'period_start', 'period_end', 'total', 'status', 'created_at']),
    ('worker_permissions', array['id', 'profile_id', 'clinic_id', 'permission', 'granted']),
    ('worker_rates', array['id', 'clinic_id', 'profile_id', 'kind', 'amount', 'priority', 'pay_revisions', 'created_at', 'updated_at', 'applies_to', 'auto_hours', 'work_days', 'additive'])
  ) v(tbl, cols) loop
    if to_regclass('public.' || quote_ident(r.tbl)) is null then
      skipped := skipped || format('%s (no table)', r.tbl);
      continue;
    end if;
    foreach col in array r.cols loop
      select a.attnotnull into is_set from pg_attribute a
       where a.attrelid = ('public.' || quote_ident(r.tbl))::regclass and a.attname = col and not a.attisdropped;
      if not found then
        skipped := skipped || format('%s.%s (no column)', r.tbl, col);
        continue;
      end if;
      continue when is_set;
      execute format('select count(*) from public.%I where %I is null', r.tbl, col) into empty_rows;
      if empty_rows > 0 then
        skipped := skipped || format('%s.%s (%s row(s) without a value)', r.tbl, col, empty_rows);
        continue;
      end if;
      execute format('alter table public.%I alter column %I set not null', r.tbl, col);
      added := added || format('%s.%s', r.tbl, col);
    end loop;
  end loop;
  raise notice '109: set NOT NULL on % column(s)%', cardinality(added),
    case when cardinality(added) > 0 then ': ' || array_to_string(added, ', ') else '' end;
  if cardinality(skipped) > 0 then
    raise notice '109: NOT NULL skipped: %', array_to_string(skipped, ' | ');
  end if;
end $$;

-- 3. The payroll policies (sql/027) -------------------------------------------
do $$
declare
  r record;
  rel regclass;
  want text;
  have text;
  old_name text;
  tmp constant text := 'wivo_109_expected';
  added text[] := '{}';
  replaced text[] := '{}';
  dropped text[] := '{}';
  unknown text[];
begin
  if to_regprocedure('public.can_manage_payroll()') is null then
    raise notice '109: payroll policies skipped: public.can_manage_payroll() is missing';
    return;
  end if;
  for r in select * from (values
    ('work_hours', 'work_hours_insert',
     'create policy __NAME__ on public.work_hours as permissive for insert to public with check (((clinic_id = public.my_clinic_id()) AND ((profile_id = auth.uid()) OR public.can_manage_payroll())))'),
    ('work_hours', 'work_hours_manage',
     'create policy __NAME__ on public.work_hours as permissive for all to public using (((clinic_id = public.my_clinic_id()) AND public.can_manage_payroll())) with check (((clinic_id = public.my_clinic_id()) AND public.can_manage_payroll()))'),
    ('work_hours', 'work_hours_select',
     'create policy __NAME__ on public.work_hours as permissive for select to public using (((clinic_id = public.my_clinic_id()) AND ((profile_id = auth.uid()) OR public.can_manage_payroll())))'),
    ('worker_payout_lines', 'worker_payout_lines_manage',
     'create policy __NAME__ on public.worker_payout_lines as permissive for all to public using ((public.can_manage_payroll() AND (payout_id IN ( SELECT worker_payouts.id
   FROM public.worker_payouts
  WHERE (worker_payouts.clinic_id = public.my_clinic_id()))))) with check ((public.can_manage_payroll() AND (payout_id IN ( SELECT worker_payouts.id
   FROM public.worker_payouts
  WHERE (worker_payouts.clinic_id = public.my_clinic_id())))))'),
    ('worker_payout_lines', 'worker_payout_lines_select',
     'create policy __NAME__ on public.worker_payout_lines as permissive for select to public using ((payout_id IN ( SELECT worker_payouts.id
   FROM public.worker_payouts)))'),
    ('worker_payouts', 'worker_payouts_manage',
     'create policy __NAME__ on public.worker_payouts as permissive for all to public using (((clinic_id = public.my_clinic_id()) AND public.can_manage_payroll())) with check (((clinic_id = public.my_clinic_id()) AND public.can_manage_payroll()))'),
    ('worker_payouts', 'worker_payouts_select',
     'create policy __NAME__ on public.worker_payouts as permissive for select to public using (((clinic_id = public.my_clinic_id()) AND ((profile_id = auth.uid()) OR public.can_manage_payroll())))'),
    ('worker_rates', 'worker_rates_manage',
     'create policy __NAME__ on public.worker_rates as permissive for all to public using (((clinic_id = public.my_clinic_id()) AND public.can_manage_payroll())) with check (((clinic_id = public.my_clinic_id()) AND public.can_manage_payroll()))'),
    ('worker_rates', 'worker_rates_select',
     'create policy __NAME__ on public.worker_rates as permissive for select to public using (((clinic_id = public.my_clinic_id()) AND ((profile_id = auth.uid()) OR public.can_manage_payroll())))')
  ) v(tbl, name, stmt) loop
    rel := to_regclass('public.' || quote_ident(r.tbl));
    if rel is null then
      raise notice '109: payroll policy % skipped (no table %)', r.name, r.tbl;
      continue;
    end if;
    -- The policy as the migrations define it, printed by THIS database, next
    -- to the one it has: the same Postgres prints both, so equal means equal.
    execute replace(r.stmt, '__NAME__', quote_ident(tmp));
    select p.polcmd::text || ' ' || p.polpermissive::text || ' ' || p.polroles::text
             || ' using ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
             || ' check ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
      into want from pg_policy p where p.polrelid = rel and p.polname = tmp;
    select p.polcmd::text || ' ' || p.polpermissive::text || ' ' || p.polroles::text
             || ' using ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
             || ' check ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
      into have from pg_policy p where p.polrelid = rel and p.polname = r.name;
    if have is not distinct from want then
      execute format('drop policy %I on %s', tmp, rel);
      continue;
    end if;
    if have is null then
      added := added || format('%s.%s', r.tbl, r.name);
    else
      execute format('drop policy %I on %s', r.name, rel);
      replaced := replaced || format('%s.%s', r.tbl, r.name);
    end if;
    execute format('alter policy %I on %s rename to %I', tmp, rel, r.name);
  end loop;

  -- sql/027 dropped the owner-only policies its *_manage ones replace.
  foreach old_name in array array['worker_rates_write_owner', 'work_hours_write_owner',
                                  'worker_payouts_write_owner', 'worker_payout_lines_write_owner'] loop
    select p.polrelid into rel from pg_policy p
     where p.polname = old_name and p.polrelid = to_regclass('public.' || regexp_replace(old_name, '_write_owner$', ''));
    if found then
      execute format('drop policy %I on %s', old_name, rel);
      dropped := dropped || old_name;
    end if;
  end loop;

  raise notice '109: payroll policies: % added, % replaced, % old owner-only dropped%',
    cardinality(added), cardinality(replaced), cardinality(dropped),
    case when cardinality(added) + cardinality(replaced) + cardinality(dropped) > 0
         then ': ' || array_to_string(added || replaced || dropped, ', ') else '' end;

  -- Anything else on these tables the migrations do not define: named, not touched.
  select array_agg(c.relname || '.' || p.polname order by c.relname, p.polname) into unknown
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('worker_rates', 'work_hours', 'worker_payouts', 'worker_payout_lines')
     and p.polname <> 'mfa_required'
     and p.polname not in ('work_hours_insert', 'work_hours_manage', 'work_hours_select', 'worker_payout_lines_manage', 'worker_payout_lines_select', 'worker_payouts_manage', 'worker_payouts_select', 'worker_rates_manage', 'worker_rates_select');
  if unknown is not null then
    raise notice '109: payroll tables also have policies the migrations do not define (left as they are): %',
      array_to_string(unknown, ', ');
  end if;
end $$;
