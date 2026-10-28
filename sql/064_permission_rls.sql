-- Wivo — migration 064: the permission checkboxes become real
--
-- ── What was wrong ───────────────────────────────────────────────────────────
-- `worker_permissions` (sql/017) has been read in ONE place: the browser.
-- `usePermissions` asks it which menu items to draw. Migration 016 meanwhile
-- gives every member of a clinic full select/insert/update/delete on `jobs`,
-- `patients`, `patient_teeth` and `visits`, asking only that the row belong to
-- their clinic.
--
-- So an employee whose "Patsiente vaadata" box is UNTICKED cannot find the
-- patients page in the app — and can read every patient record in the clinic,
-- including the health data, with one REST call and the anon key that ships
-- inside the app. The checkbox was decoration.
--
-- This migration moves the question to the server, where it cannot be skipped.
--
-- ── Run it in the Supabase SQL editor, Wivo closed ───────────────────────────
-- Then, as a SEPARATE statement:  notify pgrst, 'reload schema';
--
-- ── Before you run it, read this ─────────────────────────────────────────────
-- Nobody loses access they can currently SEE: the app already hides everything
-- this blocks, because it already asks the same table and already defaults an
-- un-granted permission to false. What changes is that the API stops disagreeing
-- with the screen.
--
-- The owner is unaffected, always, by construction.
--
-- There is one deliberate exception, and it is the whole reason this migration
-- is not a one-liner: see `jobs_select` below.

-- ── Helpers ──────────────────────────────────────────────────────────────────

-- SECURITY DEFINER on purpose: this is consulted from inside the policies of
-- other tables, and it reads `profiles` and `worker_permissions`, which have
-- policies of their own. Without it, every check would re-enter RLS and either
-- recurse or quietly answer "no".
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- The same rule `usePermissions.can()` applies in the browser, in one place:
--   owner   → everything
--   patient → their own visits and nothing else
--   worker  → only what is explicitly granted; absent means NO
--
-- The licence check is NOT mirrored here. An expired licence makes the app
-- read-only, which is a commercial decision; locking a lab out of its own
-- production data at the database level is not the same thing and must not
-- happen by accident. See docs/v2.md, "fails open" — that is deliberate.
create or replace function public.has_perm(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when public.my_role() = 'owner' then true
    when public.my_role() = 'patient' then perm = 'visits.read'
    else exists (
      select 1 from public.worker_permissions
      where profile_id = auth.uid()
        and permission = perm
        and granted
    )
  end
$$;

-- Is this job this person's own work? Technician or designer, including the
-- per-item designer buried in the `work_items` JSON — a case split between two
-- designers names only one of them in `designed_by`, and the other is just as
-- much the author of their half.
create or replace function public.job_is_mine(
  assigned uuid, designer uuid, items jsonb
)
returns boolean
language sql
stable
as $$
  select auth.uid() is not null and (
    assigned = auth.uid()
    or designer = auth.uid()
    or exists (
      select 1
      from jsonb_array_elements(coalesce(items, '[]'::jsonb)) wi
      where wi->>'designed_by' = auth.uid()::text
    )
  )
$$;

-- ── jobs ─────────────────────────────────────────────────────────────────────
drop policy if exists "jobs_select" on public.jobs;
drop policy if exists "jobs_insert" on public.jobs;
drop policy if exists "jobs_update" on public.jobs;
drop policy if exists "jobs_delete" on public.jobs;

-- The exception promised above. A technician can be given "Töötasusid
-- hallata" (their own payslip) without "Töid vaadata", and that combination is
-- normal — a bench worker who should not browse the whole board. Their pay is
-- computed in the browser FROM THE JOBS, so a flat `jobs.read` requirement
-- would hand them an empty payslip and a wage of 0.00 €, with nothing on screen
-- explaining why.
--
-- So: the board needs `jobs.read`; your own work you can always see. That is
-- narrower than today, never wider, and it is the row-level version of a rule
-- the app already assumes.
create policy "jobs_select" on public.jobs
  for select using (
    (clinic_id = my_clinic_id() or clinic_id is null)
    and (
      has_perm('jobs.read')
      or job_is_mine(assigned_to, designed_by, work_items)
    )
  );

create policy "jobs_insert" on public.jobs
  for insert with check (
    clinic_id = my_clinic_id() and has_perm('jobs.write')
  );

-- No "own work" escape on writing. Seeing your own job is harmless; editing one
-- without the right to edit jobs is the thing the checkbox exists to stop.
create policy "jobs_update" on public.jobs
  for update using (
    (clinic_id = my_clinic_id() or clinic_id is null) and has_perm('jobs.write')
  );

create policy "jobs_delete" on public.jobs
  for delete using (
    (clinic_id = my_clinic_id() or clinic_id is null) and has_perm('jobs.write')
  );

-- ── patients ─────────────────────────────────────────────────────────────────
-- No exception here, by design. A patient record is health data under GDPR
-- Art. 9: there is no equivalent of "my own patient" that makes reading one
-- safe, and the softest possible rule for this table is the right one.
drop policy if exists "patients_select" on public.patients;
drop policy if exists "patients_insert" on public.patients;
drop policy if exists "patients_update" on public.patients;
drop policy if exists "patients_delete" on public.patients;

create policy "patients_select" on public.patients
  for select using (
    (clinic_id = my_clinic_id() or clinic_id is null) and has_perm('patients.read')
  );

create policy "patients_insert" on public.patients
  for insert with check (
    clinic_id = my_clinic_id() and has_perm('patients.write')
  );

create policy "patients_update" on public.patients
  for update using (
    (clinic_id = my_clinic_id() or clinic_id is null) and has_perm('patients.write')
  );

create policy "patients_delete" on public.patients
  for delete using (
    (clinic_id = my_clinic_id() or clinic_id is null) and has_perm('patients.write')
  );

-- ── patient_teeth ────────────────────────────────────────────────────────────
-- The dental chart. It carries no `clinic_id` of its own and reaches the clinic
-- through its patient, which is why these read the parent row rather than a
-- column. Same permission as the patient: this IS the patient's health data.
drop policy if exists "patient_teeth_select" on public.patient_teeth;
drop policy if exists "patient_teeth_insert" on public.patient_teeth;
drop policy if exists "patient_teeth_update" on public.patient_teeth;
drop policy if exists "patient_teeth_delete" on public.patient_teeth;

create policy "patient_teeth_select" on public.patient_teeth
  for select using (
    has_perm('patients.read') and exists (
      select 1 from public.patients p
      where p.id = patient_teeth.patient_id
        and (p.clinic_id = my_clinic_id() or p.clinic_id is null)
    )
  );

create policy "patient_teeth_insert" on public.patient_teeth
  for insert with check (
    has_perm('patients.write') and exists (
      select 1 from public.patients p
      where p.id = patient_teeth.patient_id and p.clinic_id = my_clinic_id()
    )
  );

create policy "patient_teeth_update" on public.patient_teeth
  for update using (
    has_perm('patients.write') and exists (
      select 1 from public.patients p
      where p.id = patient_teeth.patient_id
        and (p.clinic_id = my_clinic_id() or p.clinic_id is null)
    )
  );

create policy "patient_teeth_delete" on public.patient_teeth
  for delete using (
    has_perm('patients.write') and exists (
      select 1 from public.patients p
      where p.id = patient_teeth.patient_id
        and (p.clinic_id = my_clinic_id() or p.clinic_id is null)
    )
  );

-- ── visits ───────────────────────────────────────────────────────────────────
-- `clinic_id is null` is kept on select for the same reason it was there
-- before: sql/015 added the column and left older rows null, and the slot
-- calculation counts those as taken. Hiding them would start offering times
-- that are already booked.
drop policy if exists "visits_select" on public.visits;
drop policy if exists "visits_insert" on public.visits;
drop policy if exists "visits_update" on public.visits;
drop policy if exists "visits_delete" on public.visits;

create policy "visits_select" on public.visits
  for select using (
    (clinic_id = my_clinic_id() or clinic_id is null) and has_perm('visits.read')
  );

create policy "visits_insert" on public.visits
  for insert with check (
    clinic_id = my_clinic_id() and has_perm('visits.write')
  );

create policy "visits_update" on public.visits
  for update using (
    (clinic_id = my_clinic_id() or clinic_id is null) and has_perm('visits.write')
  );

create policy "visits_delete" on public.visits
  for delete using (
    (clinic_id = my_clinic_id() or clinic_id is null) and has_perm('visits.write')
  );

-- ── Undo ─────────────────────────────────────────────────────────────────────
-- If something locks up that should not have, re-running sql/016_clinic_rls.sql
-- restores exactly the previous behaviour: clinic isolation, no permission
-- check. It drops and recreates these same policy names, so it is safe to run
-- on top of this. The helper functions can stay; nothing else calls them.
