-- ============================================================================
-- Wivo — migration 027: payroll can be delegated
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   Payroll was owner-only in the policies, which means an owner who employs a
--   manager or bookkeeper has to do every payout personally. That is not a
--   security position, it is a missing permission.
--
--   `payroll.manage` joins the existing worker_permissions keys. The owner
--   always has it implicitly, as with everything else.
--
-- WHAT IT DOES NOT CHANGE
--   Reading is still self-or-manager: an ordinary worker sees their own rate,
--   hours and payouts and nobody else's. What someone earns is between them and
--   whoever runs payroll.
-- ============================================================================

set lock_timeout = '10s';

create or replace function public.can_manage_payroll()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.profiles
             where id = auth.uid() and role = 'owner')
    or exists (select 1 from public.worker_permissions
                where profile_id = auth.uid()
                  and permission = 'payroll.manage'
                  and granted);
$$;

-- ── worker_rates ─────────────────────────────────────────────────────────────
drop policy if exists "worker_rates_select"     on public.worker_rates;
drop policy if exists "worker_rates_write_owner" on public.worker_rates;

create policy "worker_rates_select" on public.worker_rates
  for select using (
    clinic_id = my_clinic_id()
    and (profile_id = auth.uid() or can_manage_payroll())
  );

create policy "worker_rates_manage" on public.worker_rates
  for all using (clinic_id = my_clinic_id() and can_manage_payroll())
      with check (clinic_id = my_clinic_id() and can_manage_payroll());

-- ── work_hours ───────────────────────────────────────────────────────────────
drop policy if exists "work_hours_select"      on public.work_hours;
drop policy if exists "work_hours_insert"      on public.work_hours;
drop policy if exists "work_hours_write_owner" on public.work_hours;

create policy "work_hours_select" on public.work_hours
  for select using (
    clinic_id = my_clinic_id()
    and (profile_id = auth.uid() or can_manage_payroll())
  );

-- A worker may log their own hours; a payroll manager may log anyone's.
create policy "work_hours_insert" on public.work_hours
  for insert with check (
    clinic_id = my_clinic_id()
    and (profile_id = auth.uid() or can_manage_payroll())
  );

create policy "work_hours_manage" on public.work_hours
  for all using (clinic_id = my_clinic_id() and can_manage_payroll())
      with check (clinic_id = my_clinic_id() and can_manage_payroll());

-- ── worker_payouts ───────────────────────────────────────────────────────────
drop policy if exists "worker_payouts_select"      on public.worker_payouts;
drop policy if exists "worker_payouts_write_owner" on public.worker_payouts;

create policy "worker_payouts_select" on public.worker_payouts
  for select using (
    clinic_id = my_clinic_id()
    and (profile_id = auth.uid() or can_manage_payroll())
  );

create policy "worker_payouts_manage" on public.worker_payouts
  for all using (clinic_id = my_clinic_id() and can_manage_payroll())
      with check (clinic_id = my_clinic_id() and can_manage_payroll());

-- ── worker_payout_lines ──────────────────────────────────────────────────────
drop policy if exists "worker_payout_lines_write_owner" on public.worker_payout_lines;

create policy "worker_payout_lines_manage" on public.worker_payout_lines
  for all using (
    can_manage_payroll()
    and payout_id in (select id from public.worker_payouts where clinic_id = my_clinic_id())
  ) with check (
    can_manage_payroll()
    and payout_id in (select id from public.worker_payouts where clinic_id = my_clinic_id())
  );
