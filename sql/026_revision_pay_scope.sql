-- ============================================================================
-- Wivo — migration 026: revisions can have their own pay rate
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHAT WAS MISSING
--   Revision pay could only ever be "the same rule as the job, on or off"
--   (`pay_revisions`). A lab that pays 15 €/tooth for the work but 8 €/tooth for
--   redoing it had no way to say so — and that is the normal arrangement, since
--   rework is cheaper labour than the original.
--
--   `applies_to` gains a third value. A rule now answers "what does this pay
--   for": the work, the design of it, or a revision to it. Each is priced by
--   whichever `kind` suits, so a revision rate can be per tooth, flat, or a
--   percentage, independently of what the job itself pays.
--
--   `pay_revisions` stays and keeps its meaning as the fallback: when no
--   revision-specific rule exists, it decides whether the job's own rule also
--   covers rework. Existing setups therefore keep behaving exactly as they did.
-- ============================================================================

set lock_timeout = '10s';

alter table public.worker_rates drop constraint if exists worker_rates_applies_valid;
alter table public.worker_rates add constraint worker_rates_applies_valid
  check (applies_to in ('too', 'disain', 'muudatus'));

comment on column public.worker_rates.applies_to is
  'Mille eest makstakse: too = teostatud töö, disain = töö disain, muudatus = ümbertegemine';

comment on column public.worker_rates.pay_revisions is
  'Kui eraldi muudatuse reeglit ei ole, kas see reegel katab ka muudatused';
