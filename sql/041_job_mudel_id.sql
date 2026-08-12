-- Wivo — migration 041: model reference ID on jobs
--
-- Sits next to print_id / disain_id: when a job is marked `mudel`, the printed
-- model has its own job number in the printer software, and that number is what
-- someone looks the model up by. Only meaningful while `mudel` is true — the
-- app writes null back when the flag is turned off.
-- Run in the Supabase SQL editor (Wivo closed).

alter table public.jobs
  add column if not exists mudel_id text;
