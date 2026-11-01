-- ============================================================================
-- Wivo — migration 068: tenant isolation
-- Run AFTER sql/067. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- The Phase 0 RLS audit (docs/night-run/phase0-report.md §2) ran every policy
-- against two real tenants. Every table already has RLS, but five holes let one
-- organisation reach another's data. With a single clinic on the database none
-- of them could be used. With a second organisation on the same project
-- (the partnership plan) every one of them could. Each is a failing test in
-- sql/test/rlsTenantIsolation.test.ts before this file and passes after it.
--
-- 1. A USER COULD REWRITE THEIR OWN ROLE AND CLINIC. `profiles_update_own` lets
--    you update your own row, and nothing stopped that update from touching
--    `role` or `clinic_id`. A worker could make themselves owner (and with it
--    every permission), or set `clinic_id` to another clinic's id and read all
--    of that clinic's jobs and patients. A trigger now guards both columns;
--    see `guard_profile_change` for the four changes that are allowed.
--
-- 2. EVERY CLINIC WAS READABLE BY EVERY USER — name, address, registry code,
--    IBAN (`clinic_read`: auth.uid() is not null). Now only your own, plus one
--    you have just created (`created_by`, so the setup wizard's insert can
--    still read its own row back).
--
-- 3. ROWS WITH NO CLINIC BELONGED TO EVERYBODY. jobs, patients, patient_teeth,
--    visits and profiles all had `... or clinic_id is null`. That was the
--    bridge from the single-clinic days. It also meant:
--      - an orphan row was visible to every tenant;
--      - `jobs_update` had no WITH CHECK, so a user could set their own job's
--        clinic_id to null and publish it to everyone;
--      - a brand-new signup appeared in every owner's "removed workers" list,
--        and any owner could pull them into their clinic.
--    The null branch is gone. Orphans are adopted ONLY when the database holds
--    exactly one clinic, which is the existing installation: there is no doubt
--    whose they are. With two or more, nothing is guessed. The rows stay where
--    they are, invisible, and a NOTICE says how many there are.
--
-- 4. "REMOVED WORKERS" NEEDED A MEMORY. Removing a worker sets their clinic_id
--    to null, and the owner's list of people to put back was "everyone with no
--    clinic", i.e. every unlinked user on the project. `removed_from` records
--    which clinic removed them, so the list and the right to restore are that
--    clinic's alone.
--
-- 5. A NEW CLINIC'S FOUNDER WAS A 'worker' IN IT. Only the first user ever is
--    made owner (012). On a shared project every later founder stayed a worker.
--    Linking yourself into a clinic you created now makes you its owner.
--
-- Safe to re-run: columns are `if not exists`, policies are dropped first,
-- functions are `create or replace`, the adoption only touches null rows.
-- ============================================================================

-- ── Columns ─────────────────────────────────────────────────────────────────

alter table public.clinics
  add column if not exists created_by uuid default auth.uid()
    references auth.users(id) on delete set null;

alter table public.profiles
  add column if not exists removed_from uuid
    references public.clinics(id) on delete set null;

-- ── Adopt orphans, but only where there is no doubt whose they are ──────────

do $$
declare
  v_clinics int := (select count(*) from public.clinics);
  v_only    uuid;
  v_orphans int;
begin
  if v_clinics = 1 then
    v_only := (select id from public.clinics);
    update public.jobs     set clinic_id = v_only where clinic_id is null;
    update public.patients set clinic_id = v_only where clinic_id is null;
    update public.visits   set clinic_id = v_only where clinic_id is null;
    -- Workers removed before this migration: their clinic is the only one.
    update public.profiles set removed_from = v_only
     where clinic_id is null and removed_from is null and role in ('owner', 'worker');
  elsif v_clinics > 1 then
    v_orphans := (select count(*) from public.jobs where clinic_id is null)
               + (select count(*) from public.patients where clinic_id is null)
               + (select count(*) from public.visits where clinic_id is null);
    if v_orphans > 0 then
      raise notice '% rows in jobs/patients/visits have no clinic and are now visible to nobody. '
                   'Assign them by hand: update ... set clinic_id = ''<clinic>'' where clinic_id is null.', v_orphans;
    end if;
  end if;
end $$;

-- ── clinics ─────────────────────────────────────────────────────────────────

drop policy if exists "clinic_read" on public.clinics;
create policy "clinic_read" on public.clinics
  for select using (id = public.my_clinic_id() or created_by = auth.uid());

-- ── profiles ────────────────────────────────────────────────────────────────

drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select using (
    id = auth.uid()
    or clinic_id = public.my_clinic_id()
    or (clinic_id is null and removed_from = public.my_clinic_id())
  );

drop policy if exists "profiles_update_clinic_owner" on public.profiles;
create policy "profiles_update_clinic_owner" on public.profiles
  for update using (
    public.my_role() = 'owner' and (
      clinic_id = public.my_clinic_id()
      or (clinic_id is null and (
            removed_from = public.my_clinic_id()
            or created_at > now() - interval '1 hour'))
    )
  );

/**
 * Who may change `role` and `clinic_id`, and how.
 *
 * Runs only for requests that carry a user (auth.uid() is not null). The
 * signup trigger, Edge Functions with the service key and the SQL editor have
 * no user and are not limited here.
 *
 * Allowed, and nothing else:
 *   1. Founding: your own row, from no clinic, into a clinic YOU created.
 *      You become its owner.
 *   2. An owner removing someone else from their own clinic. `removed_from`
 *      remembers which clinic did it.
 *   3. An owner adding someone to their own clinic: a person they removed, or
 *      a user created within the last hour (the "new worker" form signs the
 *      account up and links it seconds later).
 *   4. An owner switching someone else in their clinic between owner and worker.
 */
create or replace function public.guard_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_clin uuid;
  v_role text;
begin
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Your own profile row is made by the signup trigger. One made by hand
    -- starts with no clinic and no rank, whatever it asked for.
    new.clinic_id := null;
    new.role := 'worker';
    new.removed_from := null;
    return new;
  end if;

  if new.role is not distinct from old.role
     and new.clinic_id is not distinct from old.clinic_id
     and new.removed_from is not distinct from old.removed_from then
    return new;
  end if;

  select clinic_id, role into v_clin, v_role from public.profiles where id = v_uid;

  -- 1. Founding a clinic.
  if new.id = v_uid and old.clinic_id is null and new.clinic_id is not null
     and exists (select 1 from public.clinics c where c.id = new.clinic_id and c.created_by = v_uid) then
    new.role := 'owner';
    new.removed_from := null;
    return new;
  end if;

  if v_role = 'owner' and v_clin is not null and new.id <> v_uid
     and new.role is not distinct from old.role then
    -- 2. Removing.
    if old.clinic_id = v_clin and new.clinic_id is null then
      new.removed_from := v_clin;
      return new;
    end if;
    -- 3. Adding.
    if old.clinic_id is null and new.clinic_id = v_clin
       and (old.removed_from = v_clin
            or (old.removed_from is null and old.created_at > now() - interval '1 hour')) then
      new.removed_from := null;
      return new;
    end if;
  end if;

  -- 4. Rank within the clinic.
  if v_role = 'owner' and new.id <> v_uid
     and old.clinic_id = v_clin and new.clinic_id is not distinct from old.clinic_id
     and old.role in ('owner', 'worker') and new.role in ('owner', 'worker')
     and new.removed_from is not distinct from old.removed_from then
    return new;
  end if;

  raise exception 'Not allowed to change role or clinic of this profile'
    using errcode = '42501';
end;
$$;

drop trigger if exists guard_profile_change on public.profiles;
create trigger guard_profile_change
  before insert or update on public.profiles
  for each row execute function public.guard_profile_change();

-- ── jobs, patients, patient_teeth, visits: the same as 064, minus `or clinic_id is null` ──
-- UPDATE now has an explicit WITH CHECK, so a row cannot be moved OUT of the
-- clinic either.

drop policy if exists "jobs_select" on public.jobs;
drop policy if exists "jobs_update" on public.jobs;
drop policy if exists "jobs_delete" on public.jobs;
create policy "jobs_select" on public.jobs
  for select using (
    clinic_id = public.my_clinic_id()
    and (public.has_perm('jobs.read') or public.job_is_mine(assigned_to, designed_by, work_items))
  );
create policy "jobs_update" on public.jobs
  for update using (clinic_id = public.my_clinic_id() and public.has_perm('jobs.write'))
  with check (clinic_id = public.my_clinic_id() and public.has_perm('jobs.write'));
create policy "jobs_delete" on public.jobs
  for delete using (clinic_id = public.my_clinic_id() and public.has_perm('jobs.write'));

drop policy if exists "patients_select" on public.patients;
drop policy if exists "patients_update" on public.patients;
drop policy if exists "patients_delete" on public.patients;
create policy "patients_select" on public.patients
  for select using (clinic_id = public.my_clinic_id() and public.has_perm('patients.read'));
create policy "patients_update" on public.patients
  for update using (clinic_id = public.my_clinic_id() and public.has_perm('patients.write'))
  with check (clinic_id = public.my_clinic_id() and public.has_perm('patients.write'));
create policy "patients_delete" on public.patients
  for delete using (clinic_id = public.my_clinic_id() and public.has_perm('patients.write'));

drop policy if exists "patient_teeth_select" on public.patient_teeth;
drop policy if exists "patient_teeth_update" on public.patient_teeth;
drop policy if exists "patient_teeth_delete" on public.patient_teeth;
create policy "patient_teeth_select" on public.patient_teeth
  for select using (
    public.has_perm('patients.read') and exists (
      select 1 from public.patients p
       where p.id = patient_teeth.patient_id and p.clinic_id = public.my_clinic_id())
  );
create policy "patient_teeth_update" on public.patient_teeth
  for update using (
    public.has_perm('patients.write') and exists (
      select 1 from public.patients p
       where p.id = patient_teeth.patient_id and p.clinic_id = public.my_clinic_id())
  );
create policy "patient_teeth_delete" on public.patient_teeth
  for delete using (
    public.has_perm('patients.write') and exists (
      select 1 from public.patients p
       where p.id = patient_teeth.patient_id and p.clinic_id = public.my_clinic_id())
  );

drop policy if exists "visits_select" on public.visits;
drop policy if exists "visits_update" on public.visits;
drop policy if exists "visits_delete" on public.visits;
create policy "visits_select" on public.visits
  for select using (clinic_id = public.my_clinic_id() and public.has_perm('visits.read'));
create policy "visits_update" on public.visits
  for update using (clinic_id = public.my_clinic_id() and public.has_perm('visits.write'))
  with check (clinic_id = public.my_clinic_id() and public.has_perm('visits.write'));
create policy "visits_delete" on public.visits
  for delete using (clinic_id = public.my_clinic_id() and public.has_perm('visits.write'));

-- ── Advisor: function_search_path_mutable ───────────────────────────────────
-- The last three functions without a fixed search_path. None is SECURITY
-- DEFINER, so this is Supabase's WARN level, not an exploit — but pinning it
-- costs nothing and leaves the advisor with nothing to say.
alter function public.set_updated_at() set search_path = public;
alter function public.touch_clinic_settings() set search_path = public;
alter function public.job_is_mine(uuid, uuid, jsonb) set search_path = public;
