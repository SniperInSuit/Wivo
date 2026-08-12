-- Wivo — migration 042: stump (die) shade on jobs
--
-- Köndivärv — the colour of the PREPARED STUMP, not of the finished tooth.
-- Separate from `varv` because it answers a different question: a translucent
-- ceramic lets the stump show through, so an A2 crown over a dead or
-- titanium-backed stump has to be built differently to come out as A2.
-- Recorded on the VITA Natural Die Material scale (ND1–ND9), free text allowed.
--
-- Run in the Supabase SQL editor (Wivo closed).

alter table public.jobs
  add column if not exists kondivarv text;
