-- ============================================================================
-- Wivo — migration 043: ad-hoc costs on jobs (`extra_costs`)
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY THIS IS LATE
--   `extra_costs` has existed in the TypeScript `Job` type and in the Edit
--   page's cost box for some time — free-text cost rows like a root canal or
--   outsourced work, which the omahind / Rahandus figures already sum. The
--   column was never migrated. Nothing broke because every WRITE path happened
--   to omit the key: the wizard did not send it, and opening a saved job left
--   `form.extra_costs` undefined so the update spread dropped it. Every READ
--   site guards with `?? []`, so the gap stayed invisible.
--
--   1.31.6 closed those two write gaps — the wizard now sends `extra_costs: []`
--   and the Edit page loads and saves the real list — and the missing column
--   immediately rejected the whole insert, because both writes are raw spreads.
--   This is the migration that should have accompanied the feature.
--
-- NOT sql/033. That one adds `extras` — the priced services picked from the
-- settings list — which is a different column and a different feature. The two
-- names being one word apart is exactly why this was missed.
--
-- SAFE ON EXISTING ROWS
--   NOT NULL with a '[]' default, matching `extras`. Existing jobs get an empty
--   list, which is what "no ad-hoc costs recorded" already meant to every read.
-- ============================================================================

set lock_timeout = '10s';

alter table public.jobs
  add column if not exists extra_costs jsonb not null default '[]'::jsonb;

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'jobs'
--    and column_name in ('extras', 'extra_costs');
--   -> two rows, both jsonb, both not null, both defaulting to '[]'::jsonb
