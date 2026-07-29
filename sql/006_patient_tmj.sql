-- ============================================================================
-- Workly — migration 006: patients.lougaliiges (Lõualiiges / TMJ)
-- Introduced in app version 1.1.4
-- Run this in the Supabase SQL editor. Safe to run on its own, any time.
-- ============================================================================
--
-- WHY THIS EXISTS AS ITS OWN FILE
--   The Ravikaart was split into separate "Hambumus" and "Lõualiiges" fields in
--   1.1.1, and this column was added to 003 — which had ALREADY been run. An
--   applied migration is history: editing it changes nothing in the database.
--   The result was that saving a patient sent `lougaliiges`, Postgres rejected
--   the unknown column (42703 / PGRST204), and the whole Ravikaart save failed
--   silently. Hence: one new file per change, always.
--
--   `lougad` (from 001) now means Hambumus / occlusion only. The joint gets its
--   own field because they are separate clinical observations.
--
-- GDPR: clinical information about an identified person = special category data
-- (Art. 9), same as the rest of the ravikaart. No RLS change needed — 002
-- already covers every column on public.patients.
--
-- QUIT THE WORKLY APP FIRST — an open instance holds a realtime subscription on
-- `patients`, and ALTER TABLE needs an exclusive lock on it.
-- ============================================================================

set lock_timeout = '10s';

alter table public.patients
  add column if not exists lougaliiges text;   -- Lõualiiges (TMJ) notes

-- ─── Verify: expect one row ─────────────────────────────────────────────────
-- select column_name from information_schema.columns
--   where table_name = 'patients' and column_name = 'lougaliiges';
