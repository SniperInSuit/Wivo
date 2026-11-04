-- ============================================================================
-- Wivo — migration 117: a colleague's pay and tax settings only for payroll
-- Run AFTER sql/116. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- profiles_read lets every member read every profile of their clinic, former
-- members included, and the desktop loaded whole rows (select *) for every
-- member: each colleague's pension percentage, tax-free income, employment
-- type, pay basis and rush multiplier. Payroll's rule is "your own pay; all
-- of it with Manage payroll" (worker_rates, work_hours, worker_payouts).
-- Now profiles follows it (docs/PERMISSIONS.md):
--
-- 1. Column grants, as sql/102 did for clinic_settings. A signed-in user
--    reads every column of profiles EXCEPT the pay and tax ones:
--      toosuhe                  employment type
--      tasu_arvestus            pay basis (gross / net)
--      kogumispension_protsent  pension percentage
--      maksuvaba_tulu           tax-free income
--      kiirtoo_kordaja          rush pay multiplier
--    That is what the app needs to show a colleague (name, username, role)
--    and one's own settings. `select *` is refused, so the app names its
--    columns. A column added later is hidden until it is granted.
-- 2. pay_settings(): the pay and tax fields of the people the caller may
--    see — themselves always; with Manage payroll, as the owner or as an
--    admin, everyone in the clinic and its former members. `stable`.
--
-- Writing is unchanged: the same policies decide who changes what (one's
-- own row; the owner, anyone in the clinic).
--
-- No new table. Tests: sql/test/profilePay.test.ts.
-- ============================================================================

set lock_timeout = '10s';

-- ── 1. Who reads which column ───────────────────────────────────────────────

revoke select on public.profiles from anon, authenticated;
grant select (id, full_name, username, role, org_role, clinic_id, removed_from, patient_id,
              language, notify_email, notify_push, ui_prefs, created_at, updated_at)
  on public.profiles to authenticated;

-- ── 2. The pay and tax fields, for whom they belong to and for payroll ──────

create or replace function public.pay_settings()
returns table (profile_id uuid, toosuhe text, tasu_arvestus text, kogumispension_protsent numeric,
               maksuvaba_tulu numeric, kiirtoo_kordaja numeric)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.toosuhe, p.tasu_arvestus, p.kogumispension_protsent, p.maksuvaba_tulu, p.kiirtoo_kordaja
    from public.profiles p
   where p.id = auth.uid()
      or (public.my_clinic_id() is not null
          and (public.can_manage_payroll() or public.is_org_admin())
          and (p.clinic_id = public.my_clinic_id()
               or (p.clinic_id is null and p.removed_from = public.my_clinic_id())))
$$;

revoke execute on function public.pay_settings() from public, anon;
grant execute on function public.pay_settings() to authenticated;

select public.lock_anon_functions();
