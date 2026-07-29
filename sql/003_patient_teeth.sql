-- ============================================================================
-- Workly — migration 003: manual per-tooth status + patient card extensions
-- Introduced in app version 1.1.0
-- Run this in the Supabase SQL editor AFTER 001_patients.sql and
-- 002_patients_rls.sql, and BEFORE 004_patient_teeth_realtime.sql.
-- ============================================================================
--
-- !!  QUIT THE WORKLY APP BEFORE RUNNING THIS.
--     A running instance holds realtime subscriptions on `patients` and `jobs`.
--     The ALTER TABLE below needs an AccessExclusiveLock on `patients`, so an
--     open app makes this wait. Combined with a publication change in the SAME
--     transaction it deadlocks outright (40P01) — which is exactly why the
--     realtime step was moved out of this file into 004.
--
-- WHAT THIS ADDS
--   1. patients.varvi_eelistus  — VITA shade preferences (health data, Art. 9)
--   1b. patients.lougaliiges   — TMJ notes, split out from the occlusion field
--   2. patients.markused        — timestamped notes with an author (JSONB array,
--                                 same shape idiom as jobs.revisions)
--   3. patient_teeth            — the user's MANUAL tooth statuses
--
-- WHY A SEPARATE TABLE AND NOT A COLUMN ON patients:
--   Marking teeth is click-heavy. A jsonb column on `patients` would bump
--   patients.updated_at on every click, which (a) makes "Viimati muudetud"
--   meaningless and (b) fires the profile's realtime refresh mid-interaction.
--   A child table keeps the patient row untouched.
--
-- WHAT IS *NOT* STORED HERE:
--   'toodeldud' is never written. It is derived at read time from the patient's
--   job history (jobs.hambad + revisions[].hambad + legacy rev_hambad). A row in
--   this table is an explicit override and always wins over the derived value.
--
-- GDPR: a tooth status is clinical information about an identified person =
-- special category data (Art. 9), exactly like ravikaart. Same caveats as 002.
-- ============================================================================

-- Fail fast instead of hanging if something still holds a lock. Seeing
-- "canceling statement due to lock timeout" here means the app is still open.
set lock_timeout = '10s';

-- ─── 1 + 2. New columns on patients ─────────────────────────────────────────
-- No new RLS policy is needed for these: 002 already enabled RLS on
-- public.patients with an "Allow all for anon" policy that covers all columns.
alter table public.patients
  add column if not exists varvi_eelistus text;                 -- Värvi eelistused

alter table public.patients
  add column if not exists lougaliiges text;                     -- Lõualiiges (TMJ)
-- `lougad` (from 001) now means Hambumus/occlusion only; the joint gets its own
-- field because they are separate clinical observations.

alter table public.patients
  add column if not exists markused jsonb not null default '[]'::jsonb;
-- Element shape: { id: uuid, ts: iso8601, autor: text, tekst: text }

-- ─── 3. Manual tooth statuses ───────────────────────────────────────────────
create table if not exists public.patient_teeth (
  patient_id  uuid        not null references public.patients(id) on delete cascade,
  fdi         smallint    not null,   -- FDI number: 11-18, 21-28, 31-38, 41-48
  staatus     text        not null,   -- 'ravi' | 'puudub' | 'terve'
  markus      text,                   -- optional per-tooth note
  updated_at  timestamptz not null default now(),
  primary key (patient_id, fdi),

  -- Reject garbage tooth tokens at the DB level. The app has NO FDI validation
  -- today (OdontogramPicker.tsx:81-83 just does set membership), so imported
  -- junk like "1 21" can already reach jobs.hambad. It must not reach this table.
  constraint patient_teeth_fdi_valid check (
    fdi between 11 and 18 or fdi between 21 and 28 or
    fdi between 31 and 38 or fdi between 41 and 48
  ),
  constraint patient_teeth_staatus_valid check (
    staatus in ('ravi', 'puudub', 'terve')
  )
);
-- The primary key already indexes patient_id as its leading column, so a
-- separate patient_id index would be redundant. Do not add one.

-- ─── RLS — REQUIRED. Without this every write fails with 42501 and every ─────
-- ─── select silently returns zero rows (this is what 002 had to fix). ───────
alter table public.patient_teeth enable row level security;

drop policy if exists "Allow all for anon" on public.patient_teeth;
create policy "Allow all for anon" on public.patient_teeth
  for all using (true) with check (true);

-- ─── Live sync is NOT set up here — see 004_patient_teeth_realtime.sql ──────
-- ALTER PUBLICATION in this same transaction is what caused the 40P01 deadlock:
-- this transaction holds `patients` while the realtime worker holds the
-- publication and wants `patients`. Neither can proceed. Run 004 separately.

-- ─── Verify: expect rowsecurity = true and one policy row ───────────────────
-- select relname, relrowsecurity from pg_class where relname = 'patient_teeth';
-- select policyname, cmd from pg_policies where tablename = 'patient_teeth';
-- select column_name from information_schema.columns
--   where table_name = 'patients' and column_name in ('varvi_eelistus','lougaliiges','markused');

-- ─── NEXT: run 004_patient_teeth_realtime.sql, as its own separate query ────

-- ----------------------------------------------------------------------------
-- Replace the open policy with this once user login exists (Path B):
-- ----------------------------------------------------------------------------
-- drop policy if exists "Allow all for anon" on public.patient_teeth;
-- create policy "authenticated read"  on public.patient_teeth for select using (auth.role() = 'authenticated');
-- create policy "authenticated write" on public.patient_teeth for all    using (auth.role() = 'authenticated');
