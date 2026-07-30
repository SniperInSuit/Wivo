-- Wivo — migration 016: clinic-based RLS policies
--
-- Replaces the simple "authenticated_all" policies from 013 with proper
-- clinic isolation. Each user can only see/edit data belonging to their clinic.
-- Run in the Supabase SQL editor (Wivo closed) AFTER 015_add_clinic_id.sql.

-- Helper: returns the clinic_id for the currently logged-in user.
-- Used in every RLS policy so the subquery is not repeated everywhere.
create or replace function public.my_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select clinic_id from public.profiles where id = auth.uid()
$$;

-- ── jobs ──────────────────────────────────────────────────────────────────────
drop policy if exists "authenticated_all" on public.jobs;

create policy "jobs_select" on public.jobs
  for select using (clinic_id = my_clinic_id() or clinic_id is null);

create policy "jobs_insert" on public.jobs
  for insert with check (clinic_id = my_clinic_id());

create policy "jobs_update" on public.jobs
  for update using (clinic_id = my_clinic_id() or clinic_id is null);

create policy "jobs_delete" on public.jobs
  for delete using (clinic_id = my_clinic_id() or clinic_id is null);

-- ── patients ──────────────────────────────────────────────────────────────────
drop policy if exists "authenticated_all" on public.patients;

create policy "patients_select" on public.patients
  for select using (clinic_id = my_clinic_id() or clinic_id is null);

create policy "patients_insert" on public.patients
  for insert with check (clinic_id = my_clinic_id());

create policy "patients_update" on public.patients
  for update using (clinic_id = my_clinic_id() or clinic_id is null);

create policy "patients_delete" on public.patients
  for delete using (clinic_id = my_clinic_id() or clinic_id is null);

-- ── patient_teeth ─────────────────────────────────────────────────────────────
-- Isolated via the patients FK — only accessible if the parent patient is visible.
drop policy if exists "authenticated_all" on public.patient_teeth;

create policy "patient_teeth_select" on public.patient_teeth
  for select using (
    patient_id in (select id from public.patients where clinic_id = my_clinic_id() or clinic_id is null)
  );

create policy "patient_teeth_insert" on public.patient_teeth
  for insert with check (
    patient_id in (select id from public.patients where clinic_id = my_clinic_id() or clinic_id is null)
  );

create policy "patient_teeth_update" on public.patient_teeth
  for update using (
    patient_id in (select id from public.patients where clinic_id = my_clinic_id() or clinic_id is null)
  );

create policy "patient_teeth_delete" on public.patient_teeth
  for delete using (
    patient_id in (select id from public.patients where clinic_id = my_clinic_id() or clinic_id is null)
  );

-- ── visits ────────────────────────────────────────────────────────────────────
drop policy if exists "authenticated_all" on public.visits;

create policy "visits_select" on public.visits
  for select using (clinic_id = my_clinic_id() or clinic_id is null);

create policy "visits_insert" on public.visits
  for insert with check (clinic_id = my_clinic_id());

create policy "visits_update" on public.visits
  for update using (clinic_id = my_clinic_id() or clinic_id is null);

create policy "visits_delete" on public.visits
  for delete using (clinic_id = my_clinic_id() or clinic_id is null);

-- Note: "or clinic_id is null" allows access to pre-migration data that hasn't
-- been backfilled yet. Once the first-run wizard assigns clinic_id to all rows,
-- these NULLs disappear and the isolation is complete.
