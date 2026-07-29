-- ============================================================================
-- Workly — migration 009: two more visit states
-- Introduced in app version 1.4.0
-- Run this in the Supabase SQL editor (Workly closed). Safe on its own.
-- ============================================================================
--
-- 007 allowed three states: planeeritud / toimunud / tuhistatud. Two were missing
-- that a lab actually acts on:
--
--   saabunud   — the patient is here NOW. The state you want visible at a glance.
--   ei_tulnud  — no-show. Distinct from tuhistatud on purpose: both mean "did not
--                happen", but a no-show leaves finished work sitting on the bench
--                waiting for someone, while a cancellation clears it in advance.
--
-- Existing rows keep their current value — all three old states stay valid, so
-- nothing needs migrating.
-- ============================================================================

set lock_timeout = '10s';

alter table public.visits
  drop constraint if exists visits_staatus_valid;

alter table public.visits
  add constraint visits_staatus_valid check (
    staatus in ('planeeritud', 'saabunud', 'toimunud', 'ei_tulnud', 'tuhistatud')
  );

-- ─── Verify: expect the five values in the constraint definition ────────────
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.visits'::regclass and conname = 'visits_staatus_valid';
