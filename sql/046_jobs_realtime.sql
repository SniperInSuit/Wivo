-- ============================================================================
-- Wivo — migration 046: realtime sync for jobs
-- Run this ON ITS OWN, in a separate query.
-- ============================================================================
--
-- WHY THIS IS ONLY APPEARING NOW
--   Every other synced table was added to the publication by a migration:
--   patients (001), patient_teeth (004), visits (008), clinic_settings (019),
--   invoices/invoice_lines/payments (020), worker_rates/work_hours/
--   worker_payouts (022), customers (036).
--
--   `jobs` has none — because `jobs` predates the sql/ folder entirely. It was
--   created by hand from the snippet in README.md, before there were numbered
--   migrations, and nothing ever published it. `sql/005_job_notes.sql:14` says
--   "jobs table is already in supabase_realtime", but that is a belief written
--   in a comment, not a statement that ever ran.
--
--   Symptom: dragging a job to another stage on one computer does not move it
--   on anyone else's until they reopen the app. The client is subscribed and
--   correct (`useJobs.ts` opens a `postgres_changes` channel per mount); there
--   is simply nothing being published for it to receive.
--
-- SAFE EITHER WAY
--   Guarded, exactly like 004/008/036. If `jobs` is already in the publication
--   this does nothing and reports no error, so it can be run without checking
--   first.
--
-- SEPARATE FILE, SEPARATE QUERY
--   ALTER PUBLICATION needs a lock the Supabase realtime worker holds while
--   that worker wants a read lock on the table. Bundled with other statements
--   in one transaction it deadlocks (40P01). Alone it takes one short lock.
-- ============================================================================

set lock_timeout = '10s';

do $$
begin
  alter publication supabase_realtime add table public.jobs;
exception
  when duplicate_object then null;   -- already added, nothing to do
  when undefined_object then null;   -- publication missing on this project
end $$;

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- Run this BEFORE and AFTER. Before: probably zero rows. After: one row.
--
-- select tablename from pg_publication_tables
--  where pubname = 'supabase_realtime' and tablename = 'jobs';
--
-- The full picture, if you want to see which tables sync at all:
--
-- select tablename from pg_publication_tables
--  where pubname = 'supabase_realtime' order by tablename;
