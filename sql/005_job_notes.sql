-- ============================================================================
-- Workly — migration 005: notes on a job
-- Introduced in app version 1.1.3
-- Run this in the Supabase SQL editor. It can be run on its own at any time.
-- ============================================================================
--
-- Adds a "Märkused" box to the job record, under Tootmise andmed. Same shape as
-- patients.markused (migration 003): { id, ts, autor, tekst }.
--
-- No RLS change is needed — the `jobs` table already has RLS enabled with an
-- "Allow all for anon" policy that covers every column (see README).
--
-- No publication change either, so this cannot deadlock the way 003 did: the
-- jobs table is already in supabase_realtime, and adding a column does not
-- touch the publication.
--
-- QUIT THE WORKLY APP FIRST anyway — an open instance holds a realtime
-- subscription on `jobs`, and ALTER TABLE needs an exclusive lock on it.
-- ============================================================================

set lock_timeout = '10s';

alter table public.jobs
  add column if not exists markused jsonb not null default '[]'::jsonb;
-- Element shape: { id: uuid, ts: iso8601, autor: text, tekst: text }

-- ─── Verify: expect one row ─────────────────────────────────────────────────
-- select column_name, data_type from information_schema.columns
--   where table_name = 'jobs' and column_name = 'markused';
