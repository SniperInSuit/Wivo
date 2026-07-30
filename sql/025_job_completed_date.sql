-- ============================================================================
-- Wivo — migration 025: when a job was actually FINISHED
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- THE BUG THIS FIXES
--   Payroll decided which period a job belonged to by looking at `valmis_aeg`,
--   which is the DEADLINE, not the completion date. A job due on 28 June but
--   finished on 3 July therefore earned nothing in July and nothing in June
--   either — it simply fell outside whatever month was on screen, and the
--   technician's total showed 0 with no explanation.
--
--   The deadline is a plan. Pay has to follow what happened.
--
-- BACKFILL
--   Existing rows have no record of when they were finished, so the best
--   available evidence is `updated_at` — the last time the row changed, which
--   for a finished job is usually the move into the done stage. That is a
--   GUESS for historical data and is documented as one; going forward the app
--   stamps the real date when the status changes.
-- ============================================================================

set lock_timeout = '10s';

alter table public.jobs
  add column if not exists valmis_kuupaev date;

comment on column public.jobs.valmis_kuupaev is
  'Millal töö tegelikult valmis sai (mitte tähtaeg). Ajaloolistel ridadel tuletatud updated_at pealt.';

-- Only fill what is empty, so re-running cannot overwrite a real date.
update public.jobs
   set valmis_kuupaev = updated_at::date
 where valmis_kuupaev is null;

create index if not exists jobs_valmis_kuupaev_idx on public.jobs (valmis_kuupaev);
