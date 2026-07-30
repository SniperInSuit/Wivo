-- ============================================================================
-- Wivo — migration 028: employee vs contractor
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   Töötasud called every amount "brutopalk" and added employer payroll taxes to
--   all of it. For a technician who invoices through their own company that is
--   not merely the wrong word — it is a wrong number. A contractor's invoice is
--   a purchase: there is no gross, no employer social tax, and the tax side is
--   theirs to handle, not the clinic's.
--
--   Presenting a purchase as payroll would overstate the clinic's tax liability
--   and understate nothing — which is exactly the kind of confident wrong figure
--   an owner would plan around.
--
--   'tootaja'  — on the payroll. Gross pay, employer taxes on top.
--   'ettevote' — invoices the clinic (OÜ, FIE). The amount is the invoice sum.
--
--   Default 'tootaja' because that is what the existing figures already assumed;
--   nothing changes until someone is explicitly marked as a contractor.
-- ============================================================================

set lock_timeout = '10s';

alter table public.profiles
  add column if not exists toosuhe text not null default 'tootaja';

alter table public.profiles drop constraint if exists profiles_toosuhe_valid;
alter table public.profiles add constraint profiles_toosuhe_valid
  check (toosuhe in ('tootaja', 'ettevote'));

comment on column public.profiles.toosuhe is
  'tootaja = palgal (bruto + tööandja maksud), ettevote = esitab arve (ost, makse ilma tööandja maksudeta)';
