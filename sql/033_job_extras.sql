-- Wivo — migration 033: extra services on jobs
--
-- Jobs can have additional services (e.g. Ülesehitus, Ajutine kroon)
-- selected from a price list defined in settings.
-- Run in the Supabase SQL editor (Wivo closed).

alter table public.jobs
  add column if not exists extras jsonb not null default '[]'::jsonb;
