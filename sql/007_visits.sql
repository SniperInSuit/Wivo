-- ============================================================================
-- Workly — migration 007: visits (Visiidid)
-- Introduced in app version 1.3.0
-- Run this in the Supabase SQL editor, then 008_visits_realtime.sql SEPARATELY.
-- ============================================================================
--
-- QUIT THE WORKLY APP FIRST — an open instance holds realtime subscriptions, and
-- creating a table that references `patients` needs a lock on it.
--
-- WHY THIS TABLE EXISTS
--   Until now the calendar could only show job DEADLINES. A visit — someone
--   arriving at a given time, for a given duration, referred by a given dentist —
--   was nowhere in the data, so "Visiidid" could not be filtered, counted, or
--   added. Deriving it from deadlines was a stopgap on the dashboard; a real
--   "+ Lisa visiit" button needs a real row to write.
--
-- RELATIONSHIP TO JOBS
--   A visit is NOT a job and does not own jobs. They are linked through the
--   patient: a visit's jobs are that patient's jobs. Keeping them independent
--   means a cancelled visit never destroys production records.
--
-- GDPR: a visit is an appointment for an identified person, which together with
-- the ravikaart is health-adjacent personal data. Same caveats as 002 — the open
-- anon policy below is acceptable only while this is a single-user local tool.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.visits (
  id          uuid        primary key default gen_random_uuid(),
  -- Same denormalisation as jobs: the FK is the truth, the name keeps the row
  -- readable when the patient record has not been created or linked yet.
  patient_id  uuid        references public.patients(id) on delete set null,
  patsient    text        not null,
  arst        text,                                   -- Suunav arst
  algus       timestamptz not null,                   -- Algusaeg
  kestus_min  smallint    not null default 30,        -- Kestus minutites
  markus      text,                                   -- Märkus
  staatus     text        not null default 'planeeritud',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint visits_staatus_valid check (
    staatus in ('planeeritud', 'toimunud', 'tuhistatud')
  ),
  constraint visits_kestus_valid check (kestus_min between 5 and 600)
);

-- The calendar always queries by day, so the start time leads the index
create index if not exists visits_algus_idx      on public.visits (algus);
create index if not exists visits_patient_id_idx on public.visits (patient_id);

-- ─── RLS — REQUIRED. Without a policy every write fails with 42501 and every ──
-- ─── select silently returns zero rows (this is what broke 1.0.46). ──────────
alter table public.visits enable row level security;

drop policy if exists "Allow all for anon" on public.visits;
create policy "Allow all for anon" on public.visits
  for all using (true) with check (true);

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select relname, relrowsecurity from pg_class where relname = 'visits';
-- select policyname, cmd from pg_policies where tablename = 'visits';

-- ─── NEXT: run 008_visits_realtime.sql as its own separate query ────────────

-- ----------------------------------------------------------------------------
-- Replace the open policy with this once user login exists (Path B):
-- ----------------------------------------------------------------------------
-- drop policy if exists "Allow all for anon" on public.visits;
-- create policy "authenticated read"  on public.visits for select using (auth.role() = 'authenticated');
-- create policy "authenticated write" on public.visits for all    using (auth.role() = 'authenticated');
