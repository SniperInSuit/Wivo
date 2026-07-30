-- Add a design reference ID field to the jobs table (sits next to print_id).
alter table public.jobs
  add column if not exists disain_id text;
