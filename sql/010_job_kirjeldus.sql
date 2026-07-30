-- Add a free-text description field to the jobs table.
-- Revisions already carry a `note` column; the original job had no equivalent.
alter table public.jobs
  add column if not exists kirjeldus text;
