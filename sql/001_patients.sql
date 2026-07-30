-- ============================================================================
-- Wivo — migration 001: patients table + jobs.patient_id
-- Introduced in app version 1.0.46
-- Run this in the Supabase SQL editor BEFORE using the "Patsiendid" view.
-- ============================================================================
--
-- GDPR NOTE: the `ravikaart`, `allergiad` and `eelistused` columns hold health
-- data = special category personal data (GDPR Art. 9). Before this table holds
-- real patient records in production you should:
--   1. enable RLS and require an authenticated user (see the commented block
--      at the bottom of this file),
--   2. keep a data processing register,
--   3. sign a DPA with any clinic whose data is stored here.
-- NOTE (added in 1.0.47): this file does not set any RLS policy, and on this
-- project RLS ends up enabled on the new table — which denies everything.
-- >>> You must also run 002_patients_rls.sql. <<<
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.patients (
  id           uuid primary key default gen_random_uuid(),
  -- Identity
  nimi         text not null,              -- Nimi — full name (required)
  synniaeg     date,                       -- Sünniaeg — date of birth
  -- Contact
  telefon      text,                       -- Telefon
  email        text,                       -- E-post
  -- Referrer
  arst         text,                       -- Saatev arst
  kliinik      text,                       -- Kliinik
  -- Ravikaart (health data — GDPR Art. 9)
  ravikaart    text,                       -- Ravikaart — treatment notes
  allergiad    text,                       -- Allergiad
  eelistused   text,                       -- Materjali eelistused
  lougad       text,                       -- Lõualuu / hambumuse märkused
  -- Free-form
  markmed      text,                       -- Üldised märkmed (non-clinical)
  -- Metadata
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Fast name lookup for the picker / search
create index if not exists patients_nimi_idx on public.patients (lower(nimi));

-- Link jobs to a patient record. `jobs.patsient` (free-text name) is kept as a
-- denormalised display value so existing views and imported rows keep working
-- even when a job has not been linked to a patient record yet.
alter table public.jobs
  add column if not exists patient_id uuid references public.patients(id) on delete set null;

create index if not exists jobs_patient_id_idx on public.jobs (patient_id);

-- Live sync across machines (same as the jobs table)
do $$
begin
  alter publication supabase_realtime add table public.patients;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- When user login is added (Path B / before real production data), enable this:
-- ----------------------------------------------------------------------------
-- alter table public.patients enable row level security;
-- create policy "authenticated read"   on public.patients for select using (auth.role() = 'authenticated');
-- create policy "authenticated write"  on public.patients for all    using (auth.role() = 'authenticated');
