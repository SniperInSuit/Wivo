-- ============================================================================
-- Wivo — migration 044: repair job deadlines stored as if they were UTC
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   `jobs.valmis_aeg` is timestamptz. Until 1.32.3 the app sent a NAIVE local
--   string ('2026-08-13T15:00'), so Postgres applied the SERVER's timezone —
--   UTC on Supabase. A 15:00 Tallinn deadline was therefore stored as 15:00Z,
--   which is 18:00 in Tallinn, and every screen that formats it back into local
--   time showed 18:00. The Edit form disagreed and showed 15:00, because it
--   sliced the string instead of converting it.
--
--   1.32.3 sends a real instant, so NEW and EDITED rows are correct. This
--   repairs the rows written before that.
--
-- WHAT THE REPAIR DOES
--   Takes the stored instant back to the wall time the user typed
--   (`AT TIME ZONE 'UTC'`), then re-reads that wall time as Tallinn local
--   (`AT TIME ZONE 'Europe/Tallinn'`). Per row, so winter (+02) and summer
--   (+03) are each handled correctly — a flat "minus 3 hours" would break every
--   winter deadline.
--
-- VISITS NEED NO REPAIR
--   `visits.algus` was always written with toISOString(), i.e. a real instant.
--   Only its EDIT FORM displayed the wrong hour, which is a client-side fix.
--
-- ⚠  RUN STEP 1 AND SEND THE RESULT BEFORE RUNNING STEP 2.
--    Applying step 2 to rows that are already correct shifts them the wrong
--    way, and there is no way to tell a repaired row from a fresh one
--    afterwards. Step 2 is bounded by a cutoff you must fill in.
-- ============================================================================

set lock_timeout = '10s';

-- ── 1. LOOK FIRST ───────────────────────────────────────────────────────────
-- `kohalik_praegu` is what the board shows today. `kavatsetud` is what the user
-- most likely typed. If kavatsetud looks right and kohalik_praegu is 2–3 h
-- later, the diagnosis holds.

select
  current_setting('TimeZone')                                   as serveri_ajavoond,
  id,
  patsient,
  valmis_aeg                                                    as salvestatud,
  valmis_aeg at time zone 'Europe/Tallinn'                      as kohalik_praegu,
  (valmis_aeg at time zone 'UTC') at time zone 'Europe/Tallinn' as kavatsetud,
  updated_at
from public.jobs
where valmis_aeg is not null
order by updated_at desc
limit 10;

-- ── 2. REPAIR — do not run until step 1 has been checked ────────────────────
-- Set the cutoff to the moment you installed 1.32.3. Rows touched after it were
-- written by the fixed code and must NOT be shifted.
--
-- begin;
--
-- update public.jobs
--    set valmis_aeg = (valmis_aeg at time zone 'UTC') at time zone 'Europe/Tallinn',
--        updated_at = updated_at        -- deliberately NOT bumped: this corrects
--                                       -- a storage bug, it is not a user edit
--  where valmis_aeg is not null
--    and updated_at < '2026-08-13 00:00:00+03';   -- ← FILL IN
--
-- -- Re-run step 1 here and confirm kohalik_praegu now equals what was
-- -- previously in kavatsetud. Only then:
-- commit;
-- -- ...or `rollback;` if anything looks wrong. Nothing is written until commit.

-- ── 3. NOTE ─────────────────────────────────────────────────────────────────
-- `kuupaev`, `valmis_kuupaev` and `makse_kuupaev` are DATE columns with no time
-- component and no timezone. They are unaffected and must not be touched.
