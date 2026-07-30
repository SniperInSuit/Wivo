-- ============================================================================
-- Wivo — migration 024: pay rule scope, automatic hours, employer cost
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- 1. `disain` WAS A RULE KIND AND SHOULD NOT HAVE BEEN
--    The kind column answers "how is this paid" — per hour, per tooth, per job,
--    per cent, per month. "Design" is not an answer to that question; it is a
--    kind of WORK. Having it in the same list meant design could only ever be a
--    flat amount, when a lab actually buys design per tooth like everything else.
--
--    So scope moves to its own column: a rule is priced by `kind` and applies to
--    either the work itself or the design. "15 €/tooth for design" is now
--    expressible, and so is "10% of the job price for design".
--
-- 2. AUTOMATIC HOURS
--    An administrator on an hourly rate should not have to type 21 identical
--    rows a month. A rule can now carry a standard day length and the weekdays
--    that count, and the app fills the period in. Manually logged hours always
--    win for a day, so an exception is entered once and never fought with.
--
-- 3. EMPLOYER COST
--    Gross pay is not what an employee costs. The employer's share of taxes sits
--    on top of it, and the owner needs the real number before deciding anything.
--    The RATE is deliberately a setting, not a constant: it changes, it differs
--    by country and by contract type, and this app has no business asserting it.
-- ============================================================================

set lock_timeout = '10s';

alter table public.worker_rates
  add column if not exists applies_to    text    not null default 'too',
  add column if not exists auto_hours    boolean not null default false,
  add column if not exists hours_per_day numeric(5,2),
  add column if not exists work_days     text    not null default '12345';

-- 'too' = the work itself, 'disain' = the design of it
alter table public.worker_rates drop constraint if exists worker_rates_applies_valid;
alter table public.worker_rates add constraint worker_rates_applies_valid
  check (applies_to in ('too', 'disain'));

-- Carry existing design rules over: they were flat amounts per job, so they
-- become kind='too' scoped to design, which is exactly what they already meant.
update public.worker_rates
   set kind = 'too', applies_to = 'disain'
 where kind = 'disain';

-- Now that nothing uses it, drop 'disain' from the kind list so it cannot be
-- chosen again.
alter table public.worker_rates drop constraint if exists worker_rates_kind_valid;
alter table public.worker_rates add constraint worker_rates_kind_valid
  check (kind in ('tund', 'hammas', 'too', 'protsent', 'kuu'));

comment on column public.worker_rates.applies_to is
  'Mille eest makstakse: too = teostatud töö, disain = töö disain';
comment on column public.worker_rates.auto_hours is
  'Tunnitasu puhul: täida perioodi tunnid automaatselt tööpäevade järgi';
comment on column public.worker_rates.work_days is
  'Nädalapäevad, mis loevad tööpäevaks. 1 = esmaspäev … 7 = pühapäev';

-- Employer's share of payroll taxes, as a percentage on top of gross pay.
-- Default 0 on purpose: a wrong tax rate that the app invented is worse than an
-- obviously missing one. Seaded → Hinnad.
alter table public.clinic_settings
  add column if not exists payroll jsonb not null default '{}'::jsonb;

comment on column public.clinic_settings.payroll is
  'Palgaarvestuse seaded: { "tooandjaMaksudProtsent": 33.8 }';
