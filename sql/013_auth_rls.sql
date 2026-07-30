-- Wivo — migration 013: replace open anon policies with authenticated policies
--
-- This migration locks down all tables so only logged-in users can read/write.
-- Run in the Supabase SQL editor (Wivo closed) AFTER running 012_profiles.sql.
--
-- WARNING: After running this, the app REQUIRES login. The old anon key can
-- no longer read or write data.

-- ── jobs ──────────────────────────────────────────────────────────────────────
drop policy if exists "Allow all for anon" on public.jobs;
create policy "authenticated_all" on public.jobs
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── patients ──────────────────────────────────────────────────────────────────
drop policy if exists "Allow all for anon" on public.patients;
create policy "authenticated_all" on public.patients
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── patient_teeth ─────────────────────────────────────────────────────────────
drop policy if exists "Allow all for anon" on public.patient_teeth;
create policy "authenticated_all" on public.patient_teeth
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── visits ────────────────────────────────────────────────────────────────────
drop policy if exists "Allow all for anon" on public.visits;
create policy "authenticated_all" on public.visits
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- Note: These policies will be replaced again in Phase 2 (migration 016) with
-- clinic_id-based isolation. For now, any authenticated user can access all data.
