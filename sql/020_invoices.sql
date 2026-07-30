-- ============================================================================
-- Wivo — migration 020: invoices, invoice lines, payments (Phase 4)
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   Until now "paid" was a boolean on the job (`makstud`) plus a date. That
--   answers "did this get paid" and nothing else: not what was billed, not
--   under which document number, not partially, not who recorded it. An
--   accountant cannot work from a boolean, and neither can a tax audit.
--
-- RELATIONSHIP TO JOBS
--   An invoice line MAY point at a job, and usually does. It does not have to:
--   labs bill for things that are not jobs (delivery, a discount line). The
--   line carries its own description and price, captured AT BILLING TIME —
--   editing a job's price later must not silently rewrite an issued invoice.
--   That is the whole point of copying rather than joining.
--
-- LEGACY `jobs.makstud`
--   Left alone by this migration. Converting a boolean into payment rows means
--   inventing financial records, so it is a separate, optional script the owner
--   runs deliberately: sql/021_legacy_payments.sql.
-- ============================================================================

set lock_timeout = '10s';

-- ── invoices ─────────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,

  -- Sequential per clinic per year, e.g. "2026-0007". Unique per clinic: a gap
  -- or a duplicate in an invoice sequence is an audit finding.
  number       text not null,

  -- Same denormalisation as jobs/visits: the FK is the truth, the text keeps the
  -- document readable if the patient record is later deleted. An issued invoice
  -- must not lose the name it was addressed to.
  patient_id   uuid references public.patients(id) on delete set null,
  patsient     text not null,

  status       text not null default 'mustand',
  issue_date   date not null default current_date,
  due_date     date,

  -- Rate stored PER INVOICE, not read from settings at render time — changing
  -- the clinic's VAT rate next year must not restate last year's documents.
  vat_rate     numeric(5,2) not null default 0,
  net_total    numeric(12,2) not null default 0,
  vat_total    numeric(12,2) not null default 0,
  gross_total  numeric(12,2) not null default 0,

  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint invoices_status_valid check (
    status in ('mustand', 'saadetud', 'makstud', 'tuhistatud')
  ),
  constraint invoices_number_per_clinic unique (clinic_id, number)
);

create index if not exists invoices_clinic_idx     on public.invoices (clinic_id, issue_date desc);
create index if not exists invoices_patient_idx    on public.invoices (patient_id);
create index if not exists invoices_status_idx     on public.invoices (status);

-- ── invoice_lines ────────────────────────────────────────────────────────────
create table if not exists public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices(id) on delete cascade,

  -- Nullable on purpose, and ON DELETE SET NULL rather than CASCADE: deleting a
  -- job must never silently remove a line from an invoice that has been issued.
  job_id       uuid references public.jobs(id) on delete set null,
  -- Which revision this line bills, when it bills one. Revisions live in the
  -- job's JSONB, so this is their uuid, not an FK.
  revision_id  text,

  description  text not null,
  qty          numeric(10,2) not null default 1,
  unit_price   numeric(12,2) not null default 0,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id, sort_order);
create index if not exists invoice_lines_job_idx     on public.invoice_lines (job_id);

-- ── payments ─────────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  invoice_id   uuid references public.invoices(id) on delete cascade,
  -- Payments imported from the old per-job boolean have no invoice
  job_id       uuid references public.jobs(id) on delete set null,

  amount       numeric(12,2) not null,
  method       text not null default 'ulekanne',
  paid_at      date not null default current_date,
  reference    text,
  note         text,
  recorded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint payments_method_valid check (
    method in ('ulekanne', 'sularaha', 'kaart', 'muu')
  ),
  -- A zero-euro payment is a mistake, a negative one is a refund and needs its
  -- own thinking; block both until refunds are designed properly.
  constraint payments_amount_positive check (amount > 0)
);

create index if not exists payments_clinic_idx  on public.payments (clinic_id, paid_at desc);
create index if not exists payments_invoice_idx on public.payments (invoice_id);

-- ── Invoice numbering ────────────────────────────────────────────────────────
-- Sequential per clinic per year. Done in the database, not the client: two
-- workstations issuing an invoice at the same moment would otherwise both read
-- "last was 6" and both write 7.
create table if not exists public.invoice_counters (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  year      int  not null,
  last_no   int  not null default 0,
  primary key (clinic_id, year)
);

alter table public.invoice_counters enable row level security;

create policy "invoice_counters_all" on public.invoice_counters
  for all using (clinic_id = my_clinic_id()) with check (clinic_id = my_clinic_id());

create or replace function public.next_invoice_number(p_clinic uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from current_date);
  v_no   int;
begin
  if p_clinic is null or p_clinic <> my_clinic_id() then
    raise exception 'not allowed to number invoices for this clinic';
  end if;

  -- ON CONFLICT DO UPDATE takes a row lock, so concurrent callers queue here
  -- instead of racing.
  insert into public.invoice_counters (clinic_id, year, last_no)
  values (p_clinic, v_year, 1)
  on conflict (clinic_id, year)
  do update set last_no = public.invoice_counters.last_no + 1
  returning last_no into v_no;

  return v_year || '-' || lpad(v_no::text, 4, '0');
end;
$$;

-- ── Totals ───────────────────────────────────────────────────────────────────
-- Recomputed in the database whenever a line changes. Storing totals the client
-- calculated would mean an invoice whose header disagreed with its own lines
-- after any bug or partial write.
create or replace function public.recalc_invoice_totals(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_net  numeric(12,2);
  v_rate numeric(5,2);
begin
  select coalesce(sum(round(qty * unit_price, 2)), 0) into v_net
  from public.invoice_lines where invoice_id = p_invoice;

  select vat_rate into v_rate from public.invoices where id = p_invoice;

  update public.invoices
     set net_total   = v_net,
         vat_total   = round(v_net * coalesce(v_rate, 0) / 100, 2),
         gross_total = v_net + round(v_net * coalesce(v_rate, 0) / 100, 2),
         updated_at  = now()
   where id = p_invoice;
end;
$$;

create or replace function public.invoice_lines_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_invoice_totals(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists invoice_lines_recalc on public.invoice_lines;
create trigger invoice_lines_recalc
  after insert or update or delete on public.invoice_lines
  for each row execute function public.invoice_lines_touch();

-- Changing the rate on the invoice itself must restate its own totals too
create or replace function public.invoices_rate_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vat_rate is distinct from old.vat_rate then
    perform public.recalc_invoice_totals(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_recalc_on_rate on public.invoices;
create trigger invoices_recalc_on_rate
  after update on public.invoices
  for each row execute function public.invoices_rate_touch();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.invoices      enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments      enable row level security;

create policy "invoices_select" on public.invoices
  for select using (clinic_id = my_clinic_id());
create policy "invoices_insert" on public.invoices
  for insert with check (clinic_id = my_clinic_id());
create policy "invoices_update" on public.invoices
  for update using (clinic_id = my_clinic_id());
create policy "invoices_delete" on public.invoices
  for delete using (clinic_id = my_clinic_id());

-- Lines and payments inherit isolation through their invoice
create policy "invoice_lines_all" on public.invoice_lines
  for all using (
    invoice_id in (select id from public.invoices where clinic_id = my_clinic_id())
  ) with check (
    invoice_id in (select id from public.invoices where clinic_id = my_clinic_id())
  );

create policy "payments_all" on public.payments
  for all using (clinic_id = my_clinic_id()) with check (clinic_id = my_clinic_id());

-- ── Realtime ─────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'invoices') then
    alter publication supabase_realtime add table public.invoices;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'invoice_lines') then
    alter publication supabase_realtime add table public.invoice_lines;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'payments') then
    alter publication supabase_realtime add table public.payments;
  end if;
end $$;
