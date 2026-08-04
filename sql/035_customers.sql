-- ============================================================================
-- Wivo — migration 035: customers (ordering clinics), Phase 5
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   The lab's customer is a dental practice, and until now no such thing
--   existed in this schema. Every invoice was addressed to a PATIENT
--   (`invoices.patient_id` + `invoices.patsient`), which is how a clinic bills
--   the person in the chair — not how a laboratory bills the practice that
--   sent it the case. `patients.arst` / `patients.kliinik` were free text with
--   no billing meaning at all.
--
-- TWO SENSES OF "CLINIC" — DO NOT MERGE THEM
--   `public.clinics`   = the TENANT. One row per lab using Wivo. This is what
--                        `my_clinic_id()` returns and what every RLS policy
--                        scopes on.
--   `public.customers` = who that lab SELLS TO. An external dental practice.
--   They are different things and the naming collision is historical. A
--   customer is scoped BY clinic_id; it is not a clinic.
--
-- HOW THIS AVOIDS RESTATING ANY EXISTING DOCUMENT
--   `invoices.patsient` stops meaning "the patient" and starts meaning "the
--   name this document is addressed to, as text". A new `bill_to_kind` column
--   says which kind of thing that name is. Consequence: ZERO backfill, ZERO
--   restatement. Every existing row is 'patient', which is what it was, and
--   the print view, exports and every select that renders `patsient` keep
--   working untouched.
-- ============================================================================

set lock_timeout = '10s';

-- ── customers ────────────────────────────────────────────────────────────────
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,

  name          text not null,
  reg_code      text,
  vat_number    text,
  address       text,
  -- Where portal mail goes once Phase 6 exists. Nullable: plenty of customers
  -- are phoned, and inventing an address to satisfy a constraint is worse.
  email         text,
  cc_emails     text[] not null default '{}',
  phone         text,
  contact_name  text,

  -- 'per_job'  — bill each job as it finishes (today's rhythm, new payer)
  -- 'monthly'  — one statement per calendar month
  billing_mode  text not null default 'per_job'
                check (billing_mode in ('per_job', 'monthly')),
  payment_terms_days int not null default 14,

  -- Price overrides layered on top of clinic_settings, same shape as
  -- clinic_settings.work_types / material_prices. Kept as jsonb so the shared
  -- quote module can take ONE merged price book and never learn that customers
  -- exist. Empty object = this customer pays the list price.
  price_overrides jsonb not null default '{}'::jsonb,

  -- Archived rather than deleted: a customer with invoices behind them is
  -- history. Archived customers stay readable and stop being offered.
  archived_at   timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists customers_clinic_idx
  on public.customers (clinic_id, lower(name));

alter table public.customers enable row level security;

create policy "customers_select" on public.customers
  for select using (clinic_id = my_clinic_id());
create policy "customers_insert" on public.customers
  for insert with check (clinic_id = my_clinic_id());
create policy "customers_update" on public.customers
  for update using (clinic_id = my_clinic_id())
  with check (clinic_id = my_clinic_id());
create policy "customers_delete" on public.customers
  for delete using (clinic_id = my_clinic_id());

-- ── jobs ─────────────────────────────────────────────────────────────────────
alter table public.jobs
  add column if not exists customer_id uuid
    references public.customers(id) on delete set null,

  -- The ORDERING PRACTICE'S OWN case number, as they wrote it. This is the
  -- identifier a public status link is allowed to show: a dentist recognises
  -- the case by the reference they invented, and a patient name has no business
  -- on an unauthenticated URL. See the projection rules in the plan.
  add column if not exists customer_ref text,

  -- Where the finished work physically is. The pipeline ends at "done", which
  -- says the bench is finished with it — not that the practice has it.
  --   'labor'    — still at the lab
  --   'teel'     — handed to courier / posted
  --   'yle_antud'— the practice has it
  add column if not exists delivery_status text not null default 'labor'
    check (delivery_status in ('labor', 'teel', 'yle_antud')),
  add column if not exists delivered_at timestamptz;

create index if not exists jobs_customer_idx
  on public.jobs (customer_id, valmis_kuupaev);

-- ── invoices ─────────────────────────────────────────────────────────────────
alter table public.invoices
  add column if not exists customer_id uuid
    references public.customers(id) on delete set null,
  add column if not exists bill_to_kind text not null default 'patient',
  -- Monthly statements: which period this document covers. Null on per-job
  -- invoices, which cover whatever their lines say and nothing more.
  add column if not exists period_start date,
  add column if not exists period_end   date;

-- `patsient` is UNCHANGED and still NOT NULL. It now holds the addressee's name
-- as text — a patient's or a customer's. Every existing screen, print view and
-- export therefore keeps rendering with no change; `bill_to_kind` is what lets
-- a screen that CARES tell the two apart. Nothing is backfilled: every existing
-- row defaults to 'patient', which is what it was.
do $$
begin
  alter table public.invoices
    add constraint invoices_bill_to_valid
    check (bill_to_kind in ('patient', 'customer'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.invoices
    add constraint invoices_bill_to_consistent check (
      (bill_to_kind = 'patient'  and customer_id is null) or
      (bill_to_kind = 'customer' and customer_id is not null)
    );
exception when duplicate_object then null;
end $$;

create index if not exists invoices_customer_idx
  on public.invoices (customer_id, issue_date desc);

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- Every existing invoice must still be addressed to a patient and unchanged:
--   select bill_to_kind, count(*) from public.invoices group by 1;
--     -> one row: patient | <all of them>
--
-- Jobs gained three nullable/defaulted columns and nothing else moved:
--   select count(*) filter (where delivery_status = 'labor') as at_lab,
--          count(*) filter (where customer_id is not null)   as with_customer
--     from public.jobs;
--     -> at_lab = every job, with_customer = 0, until you start linking them.
