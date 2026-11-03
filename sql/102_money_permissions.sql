-- ============================================================================
-- Wivo — migration 102: money needs its permission in the database, not only
-- in the menu; deleting a job is its own permission; a new technician's defaults
-- Run AFTER sql/101. Then, as a SEPARATE query:
--   notify pgrst, 'reload schema';
-- ============================================================================
--
-- Before this, `payments.read` and `payments.write` only hid menu items: every
-- member of a clinic could read and change every invoice, invoice line, payment
-- and payment plan through the API, and number invoices. A technician saw the
-- clinic's money.
--
-- Owners and admins keep full access everywhere below: `has_perm_or_admin()`
-- is `has_perm()` (an owner has every permission) or an organisation admin.
--
-- 1. MONEY. invoices, invoice_lines, payments, payment_plans: reading needs
--    payments.read, writing needs payments.write. invoice_counters and
--    next_invoice_number() (numbering an invoice) need payments.write.
--    recalc_invoice_totals() is run only by the invoice-line trigger; nobody
--    calls it directly any more (it checked nothing).
-- 2. CUSTOMERS. Writing needs jobs.write. Reading stays with every member: a
--    job shows its customer's name.
-- 3. CLINIC SETTINGS. Every member reads what the screens they use need (work
--    types, materials and their prices, machines, stages, the price list,
--    calendar, tax rates for their own payslip, features). The rest only
--    through clinic_settings_private():
--      email, public_services, broneering, vestlus   owners and admins
--      material_costs                                owners, admins, payroll
--                                                    managers (job cost lines)
--    Column privileges do it: `authenticated` may select only the shared
--    columns, so `select *` is refused and the app names its columns. Writing
--    is unchanged (the owner updates, any member may seed a missing row).
--    The Edge Functions use the service role and are not affected.
-- 4. DELETING A JOB needs jobs.delete (was jobs.write), and so do the list of
--    deleted jobs and restoring one. Off by default: owners and admins only,
--    unless granted.
-- 5. A NEW TECHNICIAN (an account made with the owner's invite, sql/086/100)
--    gets stock.read, stock.write and jobs.write. Existing members keep what
--    they have.
--
-- BEFORE RELEASE (docs/PERMISSIONS.md): grant payments.read (and .write) to
-- whoever handles invoices, or they lose them the moment this runs.
-- OLD APP BUILDS read clinic_settings with `select *`, which this refuses:
-- they keep their last local settings until they update. Apply with the release.
--
-- No new table. Tests: sql/test/moneyPermissions.test.ts.
-- ============================================================================

/** has_perm(), or an admin of the organisation (owners and admins keep full access). */
create or replace function public.has_perm_or_admin(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm(perm) or public.is_org_admin()
$$;
grant execute on function public.has_perm_or_admin(text) to authenticated;

-- ── 1. Money ────────────────────────────────────────────────────────────────

drop policy if exists "invoices_select" on public.invoices;
drop policy if exists "invoices_insert" on public.invoices;
drop policy if exists "invoices_update" on public.invoices;
drop policy if exists "invoices_delete" on public.invoices;
create policy "invoices_select" on public.invoices for select
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.read'));
create policy "invoices_insert" on public.invoices for insert
  with check (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'));
create policy "invoices_update" on public.invoices for update
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'))
  with check (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'));
create policy "invoices_delete" on public.invoices for delete
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'));

-- A line belongs to an invoice of this clinic; the invoice's own policy applies
-- inside the subquery as well.
drop policy if exists "invoice_lines_all" on public.invoice_lines;
drop policy if exists "invoice_lines_select" on public.invoice_lines;
drop policy if exists "invoice_lines_write" on public.invoice_lines;
create policy "invoice_lines_select" on public.invoice_lines for select
  using (public.has_perm_or_admin('payments.read')
         and exists (select 1 from public.invoices i where i.id = invoice_id and i.clinic_id = public.my_clinic_id()));
create policy "invoice_lines_write" on public.invoice_lines for all
  using (public.has_perm_or_admin('payments.write')
         and exists (select 1 from public.invoices i where i.id = invoice_id and i.clinic_id = public.my_clinic_id()))
  with check (public.has_perm_or_admin('payments.write')
         and exists (select 1 from public.invoices i where i.id = invoice_id and i.clinic_id = public.my_clinic_id()));

drop policy if exists "payments_all" on public.payments;
drop policy if exists "payments_select" on public.payments;
drop policy if exists "payments_write" on public.payments;
create policy "payments_select" on public.payments for select
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.read'));
create policy "payments_write" on public.payments for all
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'))
  with check (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'));

drop policy if exists payment_plans_select on public.payment_plans;
drop policy if exists payment_plans_insert on public.payment_plans;
drop policy if exists payment_plans_update on public.payment_plans;
drop policy if exists payment_plans_delete on public.payment_plans;
create policy payment_plans_select on public.payment_plans for select
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.read'));
create policy payment_plans_insert on public.payment_plans for insert
  with check (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'));
create policy payment_plans_update on public.payment_plans for update
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'))
  with check (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'));
create policy payment_plans_delete on public.payment_plans for delete
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'));

drop policy if exists "invoice_counters_all" on public.invoice_counters;
create policy "invoice_counters_all" on public.invoice_counters for all
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'))
  with check (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('payments.write'));

/** 020's numbering, for someone who may write invoices. */
create or replace function public.next_invoice_number(p_clinic uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from current_date);
  v_no   int;
begin
  if p_clinic is null or p_clinic <> my_clinic_id() or not public.has_perm_or_admin('payments.write') then
    raise exception 'not allowed to number invoices for this clinic' using errcode = '42501';
  end if;
  insert into public.invoice_counters (clinic_id, year, last_no)
  values (p_clinic, v_year, 1)
  on conflict (clinic_id, year)
  do update set last_no = public.invoice_counters.last_no + 1
  returning last_no into v_no;
  return v_year || '-' || lpad(v_no::text, 4, '0');
end;
$$;

-- Run by the invoice_lines trigger (as its owner) only.
revoke execute on function public.recalc_invoice_totals(uuid) from public, anon, authenticated;

-- ── 2. Customers ────────────────────────────────────────────────────────────

drop policy if exists "customers_insert" on public.customers;
drop policy if exists "customers_update" on public.customers;
drop policy if exists "customers_delete" on public.customers;
create policy "customers_insert" on public.customers for insert
  with check (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('jobs.write'));
create policy "customers_update" on public.customers for update
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('jobs.write'))
  with check (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('jobs.write'));
create policy "customers_delete" on public.customers for delete
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('jobs.write'));

-- ── 3. Clinic settings ──────────────────────────────────────────────────────

revoke select on public.clinic_settings from anon, authenticated;
grant select (clinic_id, work_types, visit_types, materials, material_prices, machines,
              pipeline_stages, pricing, calendar, payroll, features, created_at, updated_at)
  on public.clinic_settings to authenticated;

/**
 * The settings only some may read, for the caller's own clinic: email,
 * public_services, broneering, vestlus to owners and admins; material_costs
 * also to payroll managers. A key the caller may not read is left out.
 */
create or replace function public.clinic_settings_private()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select '{}'::jsonb
         || case when public.is_org_admin()
                 then jsonb_build_object('email', s.email, 'public_services', s.public_services,
                                         'broneering', s.broneering, 'vestlus', s.vestlus)
                 else '{}'::jsonb end
         || case when public.is_org_admin() or public.can_manage_payroll()
                 then jsonb_build_object('material_costs', s.material_costs)
                 else '{}'::jsonb end
    from public.clinic_settings s
   where s.clinic_id = public.my_clinic_id() and public.has_mfa()
$$;
grant execute on function public.clinic_settings_private() to authenticated;

-- ── 4. Deleting a job: its own permission ───────────────────────────────────

drop policy if exists "jobs_delete" on public.jobs;
create policy "jobs_delete" on public.jobs for delete
  using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('jobs.delete'));

/** 091's list of deleted jobs, for whoever may delete them. */
create or replace function public.deleted_jobs()
returns table (id uuid, job_code text, patient text, work_type text, deleted_at timestamptz, deleted_by_name text)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, j.job_code, j.patsient, j.too, j.deleted_at, p.full_name
    from public.jobs j left join public.profiles p on p.id = j.deleted_by
   where j.clinic_id = public.my_org_id() and j.deleted_at is not null and public.has_perm_or_admin('jobs.delete')
     and (public.has_perm('jobs.read') or public.is_org_admin() or public.job_is_mine(j.assigned_to, j.designed_by, j.work_items))
   order by j.deleted_at desc
$$;

/** 091's restore, for whoever may delete. */
create or replace function public.restore_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.my_org_id();
begin
  if not public.has_perm_or_admin('jobs.delete')
     or not exists (select 1 from public.jobs j
                     where j.id = p_job and j.clinic_id = v_org and j.deleted_at is not null
                       and (public.has_perm('jobs.read') or public.is_org_admin()
                            or public.job_is_mine(j.assigned_to, j.designed_by, j.work_items))) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  update public.jobs set deleted_at = null, deleted_by = null where id = p_job;
  perform public.audit(v_org, 'restore', 'job:' || p_job, '{}'::jsonb);
end;
$$;

-- ── 5. A new technician's defaults ──────────────────────────────────────────

/** What a new technician starts with (shared/permissions.ts TECHNICIAN_PRESET is the same list). */
create or replace function public.technician_permissions()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['jobs.write', 'stock.read', 'stock.write']
$$;
grant execute on function public.technician_permissions() to authenticated;

/**
 * 100's signup trigger, plus the technician's defaults for an account made
 * with the owner's invite. Everything else is unchanged.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  user_role  text;
  v_token    text := new.raw_user_meta_data ->> 'invite_token';
  v_invite   public.worker_invite;
  v_username text := nullif(lower(btrim(new.raw_user_meta_data ->> 'username')), '');
  v_language text := nullif(new.raw_user_meta_data ->> 'language', '');
  v_code     text;
  v_standin  boolean := lower(split_part(coalesce(new.email, ''), '@', 2)) = 'nomail.wivodent.com';
begin
  if (select count(*) from public.profiles) = 0 then
    user_role := 'owner';
  else
    user_role := 'worker';
  end if;
  if v_language not in ('en', 'et', 'ru') then v_language := null; end if;

  if v_token is not null then
    update public.worker_invite
       set used_at = now(), used_by = new.id
     where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       and used_at is null and expires_at > now()
    returning * into v_invite;
  end if;

  if v_standin then
    select lower(code_prefix) into v_code from public.clinics where id = v_invite.clinic_id;
    if v_invite.id is null or v_code is null or v_username is null
       or lower(new.email) <> v_username || '.' || v_code || '@nomail.wivodent.com' then
      raise exception 'A login without e-mail is made by the clinic''s owner in Wivo'
        using errcode = '42501', hint = 'standin_needs_invite';
    end if;
  end if;

  if v_invite.id is not null then
    insert into public.profiles (id, full_name, role, clinic_id, org_role, username, language)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', ''),
      'worker',
      v_invite.clinic_id,
      'technician',
      case when v_username is not null
                and not exists (select 1 from public.profiles
                                 where clinic_id = v_invite.clinic_id and lower(username) = v_username)
           then v_username end,
      v_language
    );
    insert into public.worker_permissions (profile_id, clinic_id, permission, granted)
    select new.id, v_invite.clinic_id, p, true from unnest(public.technician_permissions()) p
    on conflict (profile_id, permission) do nothing;
  else
    insert into public.profiles (id, full_name, role, language)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), user_role, v_language);
  end if;
  return new;
end;
$$;

select public.lock_anon_functions();
