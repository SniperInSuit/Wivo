-- Wivo — migration 032: work items (multiple work types per job)
--
-- A single job can now contain multiple work types, each with their own teeth.
-- Example: 10 crowns + 4 bridges, all for the same patient in one job.
-- The old `too` and `hambad` fields remain as denormalized summaries.
-- Run in the Supabase SQL editor (Wivo closed).

alter table public.jobs
  add column if not exists work_items jsonb not null default '[]'::jsonb;

-- No data migration needed — existing jobs have work_items = '[]' and the app
-- falls back to reading too/hambad when work_items is empty.
