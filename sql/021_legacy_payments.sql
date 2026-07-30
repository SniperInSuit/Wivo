-- ============================================================================
-- Wivo — migration 021: import legacy `jobs.makstud` into payment records
--
-- OPTIONAL. Run it only if you want the old paid/unpaid flags to appear in the
-- new Arved figures. Migration 020 works perfectly well without it.
-- ============================================================================
--
-- READ THIS BEFORE RUNNING
--
-- This script CREATES FINANCIAL RECORDS from data that was never a financial
-- record. A boolean does not know how much was paid, when, or by what method —
-- so the rows it writes are reconstructions, not evidence:
--
--   amount   = the job's price + the prices of its revisions, AS THEY STAND NOW.
--              If a price was edited after the job was paid, this is the edited
--              number, not what actually changed hands.
--   paid_at  = `makse_kuupaev` when it is set, otherwise the job's `kuupaev`.
--              The fallback is a guess, and it is flagged as one.
--   method   = 'muu' — the old data does not record how anything was paid.
--   note     = marks the row as imported, so an accountant can tell these apart
--              from payments that were actually recorded at the time.
--
-- These payments have no invoice_id: they were never invoiced through Wivo.
-- They will show as payments against jobs, not against documents.
--
-- IDEMPOTENT: re-running does not duplicate. Rows already imported are skipped
-- by the `note` marker.
--
-- TO UNDO:
--   delete from public.payments where note = 'Imporditud: makstud-lipp (021)';
-- ============================================================================

set lock_timeout = '10s';

insert into public.payments (clinic_id, invoice_id, job_id, amount, method, paid_at, reference, note)
select
  j.clinic_id,
  null,
  j.id,
  round(
    coalesce(j.hind, 0)
    + coalesce((
        select sum(coalesce((r ->> 'price')::numeric, 0))
        from jsonb_array_elements(coalesce(j.revisions, '[]'::jsonb)) as r
      ), 0)
  , 2) as amount,
  'muu',
  coalesce(j.makse_kuupaev::date, j.kuupaev::date, current_date),
  case when j.makse_kuupaev is null then 'kuupäev tuletatud' else null end,
  'Imporditud: makstud-lipp (021)'
from public.jobs j
where j.makstud = true
  and j.clinic_id is not null
  -- Skip zero-value jobs: a payment of 0 € is noise, and the amount check on
  -- the payments table would reject it anyway.
  and round(
        coalesce(j.hind, 0)
        + coalesce((
            select sum(coalesce((r ->> 'price')::numeric, 0))
            from jsonb_array_elements(coalesce(j.revisions, '[]'::jsonb)) as r
          ), 0)
      , 2) > 0
  -- Idempotency: do not import a job that already has an imported payment
  and not exists (
    select 1 from public.payments p
    where p.job_id = j.id
      and p.note = 'Imporditud: makstud-lipp (021)'
  );

-- How many rows were written, and what they add up to. Compare this against
-- what you expect to be paid before trusting the Arved totals.
select
  count(*)              as imported_payments,
  sum(amount)           as imported_total,
  count(*) filter (where reference = 'kuupäev tuletatud') as guessed_dates
from public.payments
where note = 'Imporditud: makstud-lipp (021)';
