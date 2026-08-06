-- Wivo — migration 038: model flag on jobs
--
-- Indicates the job requires a printed model for try-in before final work.
-- Visual: dual-color card on the board (job color + orange).
-- Run in the Supabase SQL editor (Wivo closed).

alter table public.jobs
  add column if not exists mudel boolean not null default false;
