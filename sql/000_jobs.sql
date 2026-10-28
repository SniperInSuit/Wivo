-- ============================================================================
-- Wivo — migration 000: the jobs table
--
-- RUN THIS FIRST, before sql/001. Every migration from 001 onward does
-- `alter table public.jobs …`, which fails outright if the table is not there.
-- ============================================================================
--
-- ── Why this exists, and why it is numbered 000 ─────────────────────────────
-- Until now NO migration created `jobs`. The table lived as a snippet in
-- README.md — the 2024 single-table MVP — and everything since was an ALTER on
-- top of it. On the one database that has ever existed that worked, because
-- that database was built by hand in 2024 and has been following along ever
-- since.
--
-- A fresh one could not be stood up at all. `docs/onboarding-audit.md` calls
-- this the blocker it is: a new clinic cannot create a single job, so it blocks
-- selling Wivo more thoroughly than the licence system does.
--
-- Even with the README snippet run by hand, five columns the app writes on
-- every insert are created NOWHERE:
--
--     masina · print_id · kiirtoo · disain_hind · revisions
--
-- Every insert is a raw spread of the object (`useJobs.ts`), so one missing
-- column rejects the whole row. A fresh database would hit all five at once.
--
-- ── It is safe to run on the existing database ──────────────────────────────
-- Every statement is `if not exists`. On a database that already has `jobs` it
-- changes nothing — and if that database has drifted and is missing a column,
-- it adds it back. Running it is a way to find out.
--
-- `add column if not exists` never changes the TYPE of a column that is already
-- there, so this cannot rewrite data on an existing table. It can only add.
--
-- ── What is deliberately NOT here ───────────────────────────────────────────
-- Columns that reference another table — `clinic_id`, `patient_id`,
-- `customer_id`, `assigned_to`, `designed_by` — stay in the migrations that
-- already add them (015, 001, 035, 020). Those tables do not exist yet at this
-- point, and duplicating a foreign key in two files is how two definitions of
-- one column start to drift.
--
-- No RLS policy either. 013 and 016 own the policies, and 064 makes them
-- enforce permissions. A permissive policy created here "for setup" is exactly
-- the kind that survives into production.

-- ── The table ────────────────────────────────────────────────────────────────
create table if not exists public.jobs (
  id             uuid primary key default gen_random_uuid(),

  -- Stage key, not an enum: stages are the clinic's own and are renamed and
  -- reordered in Seaded → Töö etapid. A check constraint here would mean a
  -- clinic could not add a stage without a migration.
  status         text not null default 'disain',

  kuupaev        date not null default current_date,
  -- Denormalised on purpose: a job keeps the name it was booked under even
  -- when it is not linked to a patient record, which is most legacy rows.
  patsient       text not null,

  too            text,
  materjal       text,
  varv           text,
  hambad         text,
  kirjeldus      text,

  -- DEADLINE, a plan — not when the work was finished. `valmis_kuupaev` (025)
  -- is the completion date, and pay follows that one.
  valmis_aeg     timestamptz,

  -- The 2024 single-revision fields. Superseded by the `revisions` JSONB below
  -- and kept because rows still carry them.
  muudatused     text,
  rev_hambad     text,
  rev_varv       text,
  uus_valmis     timestamptz,

  hind           numeric(10,2),
  makstud        boolean not null default false,
  makse_kuupaev  date,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── The five that existed in no file at all ──────────────────────────────────
alter table public.jobs
  add column if not exists masina text,
  -- SprintRay job number, for looking a print back up on the machine.
  add column if not exists print_id text,
  add column if not exists kiirtoo boolean not null default false,
  -- Design fee, charged and paid separately from the work itself.
  add column if not exists disain_hind numeric(10,2),
  -- Every revision as its own entry. 003, 021, 022 and 026 all READ this
  -- column; none of them creates it.
  add column if not exists revisions jsonb not null default '[]'::jsonb;

-- ── updated_at ───────────────────────────────────────────────────────────────
-- `create or replace` so re-running is harmless, and the trigger is dropped
-- first because `create trigger` has no `if not exists` before PostgreSQL 14.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists jobs_updated_at on public.jobs;
create trigger jobs_updated_at
  before update on public.jobs
  for each row execute procedure public.set_updated_at();

-- ── RLS on, policies later ───────────────────────────────────────────────────
-- Enabled here so the table is never readable without one. Between this file
-- and 013 the table is invisible to everybody, which is the correct state for
-- a table that has no policy yet — and the reason the migrations are run in
-- one sitting rather than left half done.
alter table public.jobs enable row level security;

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- The board and the period screens both scan by stage and by date; every
-- payroll and finance figure is a date window.
create index if not exists jobs_status_idx  on public.jobs (status);
create index if not exists jobs_kuupaev_idx on public.jobs (kuupaev desc);
