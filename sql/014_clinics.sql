-- Wivo — migration 014: clinics table
--
-- Every piece of data belongs to a clinic. This is the foundation for
-- multi-clinic isolation and future accounting/tax filing.
-- Run in the Supabase SQL editor (Wivo closed).

create table if not exists public.clinics (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                -- Kliiniku nimi
  address       text,                         -- Aadress
  city          text,                         -- Linn
  postal_code   text,                         -- Postiindeks
  phone         text,                         -- Telefon
  email         text,                         -- E-post
  reg_code      text,                         -- Registrikood (Äriregistri nr)
  vat_number    text,                         -- KMKR number (käibemaksukohuslane)
  bank_name     text,                         -- Pank
  bank_account  text,                         -- IBAN
  logo_url      text,                         -- Logo URL (for invoices)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.clinics enable row level security;

-- Authenticated users can read any clinic (needed for the insert+select pattern
-- and for workers who haven't been linked yet). Clinic data is not sensitive —
-- the sensitive data lives in jobs/patients which have their own clinic_id RLS.
create policy "clinic_read" on public.clinics
  for select using (auth.uid() is not null);

-- Only the owner can update clinic details
create policy "clinic_update_owner" on public.clinics
  for update using (
    id in (select clinic_id from public.profiles where id = auth.uid() and role = 'owner')
  );

-- Any authenticated user can create a clinic (first-run wizard)
create policy "clinic_insert" on public.clinics
  for insert with check (auth.uid() is not null);
