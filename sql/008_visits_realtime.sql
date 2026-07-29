-- ============================================================================
-- Workly — migration 008: realtime sync for visits
-- Introduced in app version 1.3.0
-- Run this ON ITS OWN, in a separate query, AFTER 007_visits.sql.
-- ============================================================================
--
-- Separate file for the same reason 004 is: ALTER PUBLICATION needs a lock the
-- Supabase realtime worker holds, while that worker wants a read lock on the
-- table the other statements are holding. In one transaction that deadlocks
-- (40P01). Alone, this takes one short lock and finishes.
--
-- OPTIONAL. Skip it and everything works; a visit added on one computer just
-- will not appear on the other until the app is reopened.
-- ============================================================================

set lock_timeout = '10s';

do $$
begin
  alter publication supabase_realtime add table public.visits;
exception
  when duplicate_object then null;   -- already added
  when undefined_object then null;   -- publication missing on this project
end $$;

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'visits';
