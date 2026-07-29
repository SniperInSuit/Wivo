-- ============================================================================
-- Workly — migration 004: realtime sync for patient_teeth
-- Introduced in app version 1.1.0
-- Run this ON ITS OWN, in a separate Supabase SQL editor query, AFTER 003.
-- ============================================================================
--
-- WHY THIS IS ITS OWN FILE
--   Running this in the same transaction as 003's ALTER TABLE produced:
--     ERROR: 40P01: deadlock detected
--   ALTER PUBLICATION needs a lock on the publication that Supabase's realtime
--   worker already holds, while that worker wants a read lock on `patients`,
--   which 003's transaction was holding. Circular wait → Postgres kills one.
--   Alone, this statement takes one short lock and finishes.
--
-- WHAT IT DOES
--   Adds patient_teeth to the supabase_realtime publication so a tooth marked
--   on one computer appears on the other without a refresh — same as `jobs`
--   and `patients` already do.
--
-- THIS STEP IS OPTIONAL. Skip it and everything still works; tooth changes
-- made on another machine just will not appear until the app is reopened.
--
-- IF IT DEADLOCKS AGAIN: quit the Workly app on every computer first (each open
-- instance holds a realtime subscription), then re-run. You can also do the
-- same thing from the dashboard: Database → Replication → supabase_realtime →
-- enable `patient_teeth`.
-- ============================================================================

set lock_timeout = '10s';

do $$
begin
  alter publication supabase_realtime add table public.patient_teeth;
exception
  when duplicate_object then null;   -- already added, nothing to do
  when undefined_object then null;   -- publication missing on this project
end $$;

-- ─── Verify: expect one row naming patient_teeth ────────────────────────────
-- select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'patient_teeth';
