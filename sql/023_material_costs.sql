-- ============================================================================
-- Wivo — migration 023: what materials COST (as opposed to what they sell for)
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   `material_prices` is the SELLING price — it feeds the job's auto-calculated
--   price and therefore the invoice. Nothing anywhere recorded what the resin
--   actually costs the lab, so "what is this job worth" could be answered and
--   "what did this job earn us" could not.
--
--   Same shape as the price table (€ per small tooth / € per large tooth) so the
--   two sit side by side in Seaded → Hinnad and are read the same way.
--
--   Empty is fine and means "unknown", not "free". The finance dashboard counts
--   how many jobs it could not cost and says so, rather than reporting a margin
--   that quietly assumed zero.
-- ============================================================================

alter table public.clinic_settings
  add column if not exists material_costs jsonb not null default '{}'::jsonb;

comment on column public.clinic_settings.material_costs is
  'Omahind materjali kohta: { "Crown HT": { "small": 4.5, "large": 6 } }. Tühi = teadmata.';
