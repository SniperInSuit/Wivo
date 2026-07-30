-- ============================================================================
-- Wivo — migration 022: worker pay (Phase 4b)
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHAT THIS IS FOR
--   The other half of the money: invoices bill the client, this pays the staff.
--   Both read the same production data, so a job that was billed at 180 € and
--   earned the technician 45 € is one record, not two systems that disagree.
--
-- WHY RULES RATHER THAN A SALARY FIELD
--   A lab does not pay one way. An administrator is on an hourly rate, a
--   technician might be 15 €/tooth on crowns but a flat 200 € on a full arch,
--   and whoever did the design gets something on top. One `salary` column
--   cannot express that, so pay is a LIST of rules per person, matched against
--   the work.
--
-- HOW A RULE IS CHOSEN FOR A JOB
--   Among that worker's rules, the ones that match the job's work type win over
--   the catch-all ones (a rule with `work_type` set beats a rule without), and
--   `priority` breaks ties. Exactly one production rule applies per job. The
--   design bonus is separate and ADDS to it.
--
-- WHY PAYOUTS COPY THEIR LINES
--   Same reason invoices do. Once a period is paid out, its lines are frozen.
--   Changing someone's rate next month must not restate what they were already
--   paid — that is a payroll dispute, not a recalculation.
-- ============================================================================

set lock_timeout = '10s';

-- ── Who did the work ─────────────────────────────────────────────────────────
-- Two people, because the design is separately compensated: often the same
-- person, sometimes not, sometimes outsourced entirely (then neither is set).
alter table public.jobs add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
alter table public.jobs add column if not exists designed_by uuid references public.profiles(id) on delete set null;

create index if not exists jobs_assigned_to_idx on public.jobs (assigned_to);
create index if not exists jobs_designed_by_idx on public.jobs (designed_by);

-- ── Pay rules ────────────────────────────────────────────────────────────────
create table if not exists public.worker_rates (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,

  -- tund     — per hour, from work_hours
  -- hammas   — per tooth on the job
  -- too      — flat amount per job
  -- protsent — % of what the job is priced at
  -- kuu      — flat amount per payout period (salary)
  -- disain   — ADDED on top when this person is the job's designer
  kind          text not null,

  amount        numeric(12,2) not null default 0,

  -- NULL = applies to every work type. A rule naming a work type outranks a
  -- catch-all, which is what makes "15 €/tooth, but Allon4 is 200 € flat" work.
  work_type     text,

  priority      int not null default 0,
  -- Rework is unpaid by default: the common case is a revision caused by the
  -- lab's own error, and paying twice for it is not what most labs do. Turn it
  -- on per rule when revisions are chargeable work.
  pay_revisions boolean not null default false,

  active_from   date,
  active_to     date,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint worker_rates_kind_valid check (
    kind in ('tund', 'hammas', 'too', 'protsent', 'kuu', 'disain')
  ),
  constraint worker_rates_amount_positive check (amount >= 0)
);

create index if not exists worker_rates_profile_idx on public.worker_rates (profile_id);
create index if not exists worker_rates_clinic_idx  on public.worker_rates (clinic_id);

-- ── Hours ────────────────────────────────────────────────────────────────────
-- Only needed by people on an hourly rate. Jobs carry their own quantity
-- (teeth, price); hours are the one input production data cannot supply.
create table if not exists public.work_hours (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  work_date    date not null default current_date,
  hours        numeric(6,2) not null,
  note         text,
  recorded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint work_hours_positive check (hours > 0 and hours <= 24)
);

create index if not exists work_hours_profile_idx on public.work_hours (profile_id, work_date desc);

-- ── Payouts ──────────────────────────────────────────────────────────────────
create table if not exists public.worker_payouts (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  total        numeric(12,2) not null default 0,
  status       text not null default 'kinnitatud',
  paid_at      date,
  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint worker_payouts_status_valid check (status in ('kinnitatud', 'makstud')),
  constraint worker_payouts_period_valid check (period_end >= period_start)
);

create index if not exists worker_payouts_profile_idx on public.worker_payouts (profile_id, period_end desc);

-- The frozen breakdown. `job_id` is ON DELETE SET NULL, never CASCADE: deleting
-- a job must not quietly reduce what someone was already paid.
create table if not exists public.worker_payout_lines (
  id           uuid primary key default gen_random_uuid(),
  payout_id    uuid not null references public.worker_payouts(id) on delete cascade,
  job_id       uuid references public.jobs(id) on delete set null,
  revision_id  text,
  work_hours_id uuid references public.work_hours(id) on delete set null,
  kind         text not null,
  description  text not null,
  qty          numeric(10,2) not null default 1,
  rate         numeric(12,2) not null default 0,
  amount       numeric(12,2) not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists worker_payout_lines_payout_idx on public.worker_payout_lines (payout_id);
create index if not exists worker_payout_lines_job_idx    on public.worker_payout_lines (job_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.worker_rates        enable row level security;
alter table public.work_hours          enable row level security;
alter table public.worker_payouts      enable row level security;
alter table public.worker_payout_lines enable row level security;

-- What someone is paid is their own business and the owner's — not the whole
-- clinic's. Everyone may read THEIR OWN rate and payout; only the owner sees
-- and writes everyone's.
create policy "worker_rates_select" on public.worker_rates
  for select using (
    clinic_id = my_clinic_id()
    and (profile_id = auth.uid()
         or exists (select 1 from public.profiles p
                    where p.id = auth.uid() and p.role = 'owner'))
  );

create policy "worker_rates_write_owner" on public.worker_rates
  for all using (
    clinic_id = my_clinic_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  ) with check (
    clinic_id = my_clinic_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  );

-- Hours: a worker logs their own; the owner logs and edits anyone's.
create policy "work_hours_select" on public.work_hours
  for select using (
    clinic_id = my_clinic_id()
    and (profile_id = auth.uid()
         or exists (select 1 from public.profiles p
                    where p.id = auth.uid() and p.role = 'owner'))
  );

create policy "work_hours_insert" on public.work_hours
  for insert with check (
    clinic_id = my_clinic_id()
    and (profile_id = auth.uid()
         or exists (select 1 from public.profiles p
                    where p.id = auth.uid() and p.role = 'owner'))
  );

create policy "work_hours_write_owner" on public.work_hours
  for all using (
    clinic_id = my_clinic_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  ) with check (
    clinic_id = my_clinic_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  );

create policy "worker_payouts_select" on public.worker_payouts
  for select using (
    clinic_id = my_clinic_id()
    and (profile_id = auth.uid()
         or exists (select 1 from public.profiles p
                    where p.id = auth.uid() and p.role = 'owner'))
  );

create policy "worker_payouts_write_owner" on public.worker_payouts
  for all using (
    clinic_id = my_clinic_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  ) with check (
    clinic_id = my_clinic_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  );

-- Lines inherit visibility from their payout
create policy "worker_payout_lines_select" on public.worker_payout_lines
  for select using (
    payout_id in (select id from public.worker_payouts)
  );

create policy "worker_payout_lines_write_owner" on public.worker_payout_lines
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
    and payout_id in (select id from public.worker_payouts where clinic_id = my_clinic_id())
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
    and payout_id in (select id from public.worker_payouts where clinic_id = my_clinic_id())
  );

-- ── Realtime ─────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'worker_rates') then
    alter publication supabase_realtime add table public.worker_rates;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'work_hours') then
    alter publication supabase_realtime add table public.work_hours;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'worker_payouts') then
    alter publication supabase_realtime add table public.worker_payouts;
  end if;
end $$;
