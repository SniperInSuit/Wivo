-- ============================================================================
-- Wivo — migration 002: row level security policy for patients
-- Introduced in app version 1.0.47
-- Run this in the Supabase SQL editor after 001_patients.sql.
-- ============================================================================
--
-- WHY: on this Supabase project RLS ends up enabled on new tables, and a table
-- with RLS enabled but NO policy denies everything — selects silently return
-- zero rows and inserts fail with 42501 "new row violates row-level security
-- policy". That is what made the Patsiendid page look empty with dead buttons.
--
-- This grants the same open access the `jobs` table already uses ("Allow all
-- for anon"), because the desktop app talks to Supabase with the anon key and
-- has no user login yet.
--
-- GDPR: this policy means anyone holding the anon key can read every ravikaart
-- (Art. 9 health data). Acceptable only while this is a single-user local tool
-- with the key kept private. Before multi-user or commercial use, replace it
-- with the authenticated-only policies at the bottom of this file.
-- ============================================================================

alter table public.patients enable row level security;

drop policy if exists "Allow all for anon" on public.patients;
create policy "Allow all for anon" on public.patients
  for all using (true) with check (true);

-- Verify: should return one row with rowsecurity = true
-- select relname, relrowsecurity from pg_class where relname = 'patients';
-- select policyname, cmd from pg_policies where tablename = 'patients';

-- ----------------------------------------------------------------------------
-- Replace the open policy with this once user login exists (Path B):
-- ----------------------------------------------------------------------------
-- drop policy if exists "Allow all for anon" on public.patients;
-- create policy "authenticated read"  on public.patients for select using (auth.role() = 'authenticated');
-- create policy "authenticated write" on public.patients for all    using (auth.role() = 'authenticated');
