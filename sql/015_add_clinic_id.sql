-- Wivo — migration 015: add clinic_id to all data tables
--
-- Links every row to the clinic it belongs to. Existing rows get NULL
-- initially — the first-run wizard backfills them.
-- Run in the Supabase SQL editor (Wivo closed) AFTER 014_clinics.sql.

-- ── jobs ──────────────────────────────────────────────────────────────────────
alter table public.jobs
  add column if not exists clinic_id uuid references public.clinics(id);

create index if not exists idx_jobs_clinic on public.jobs(clinic_id);

-- ── patients ──────────────────────────────────────────────────────────────────
alter table public.patients
  add column if not exists clinic_id uuid references public.clinics(id);

create index if not exists idx_patients_clinic on public.patients(clinic_id);

-- ── visits ────────────────────────────────────────────────────────────────────
alter table public.visits
  add column if not exists clinic_id uuid references public.clinics(id);

create index if not exists idx_visits_clinic on public.visits(clinic_id);

-- patient_teeth inherits isolation through patients.clinic_id (FK cascade),
-- so it does not need its own clinic_id column.

-- ── profiles — already has clinic_id from 012, add FK now ─────────────────────
-- The column exists but has no FK constraint yet (clinics table didn't exist).
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'profiles_clinic_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_clinic_id_fkey
      foreign key (clinic_id) references public.clinics(id);
  end if;
end $$;
