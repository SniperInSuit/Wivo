-- ============================================================================
-- Wivo — migration 121: a payout saved in one step; the accountant's monthly export
-- Run AFTER sql/120. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- docs/ARCHITECTURE-INSTANCES.md §9, "Riga's workers and pay" (phase 1,
-- slice 7, option a).
--
-- 1. create_payout(): a payout and its lines in one call, so in one
--    transaction. The app used to save them in two requests, and a failure
--    between the two left an empty payout behind, which then read as "paid
--    nothing". It runs as the caller, so the rules are exactly today's
--    (sql/027): the caller's own clinic, and Manage payroll. It also checks
--    that the person is in the caller's clinic, and computes the total from
--    the lines instead of taking one from the app.
--
-- 2. export_kinds(): two new exports, the accountant's monthly pay export:
--      pay_people   one row per person: gross pay split by kind, hours, jobs
--      pay_lines    the lines behind it, by job code, never a patient's name
--    Each is recorded in the audit log before the file is made (sql/106).
--
-- No new table. Tests: sql/test/payoutOneStep.test.ts, sql/test/auditExports.test.ts.
-- ============================================================================

set lock_timeout = '10s';

/**
 * One payout of one person for one period, with its lines, or nothing at all.
 * p_lines: [{ job_id, revision_id, work_hours_id, kind, description, qty, rate,
 * amount, line_key }], as lib/earnings makes them. Returns the payout's id.
 */
create or replace function public.create_payout(
  p_profile uuid, p_period_start date, p_period_end date, p_note text, p_lines jsonb)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_clinic uuid := public.my_clinic_id();
  v_id     uuid;
  v_total  numeric(12,2);
begin
  if auth.uid() is null or v_clinic is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile and clinic_id = v_clinic) then
    raise exception 'Not a member of this clinic' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'There is nothing to pay out' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 5000 then
    raise exception 'Too many lines for one payout' using errcode = '22023';
  end if;

  select round(sum((l ->> 'amount')::numeric), 2) into v_total
    from jsonb_array_elements(p_lines) l;

  insert into public.worker_payouts (clinic_id, profile_id, period_start, period_end, total, note, created_by)
  values (v_clinic, p_profile, p_period_start, p_period_end, coalesce(v_total, 0), p_note, auth.uid())
  returning id into v_id;

  insert into public.worker_payout_lines
    (payout_id, job_id, revision_id, work_hours_id, kind, description, qty, rate, amount, line_key)
  select v_id, r.job_id, r.revision_id, r.work_hours_id, r.kind, r.description,
         coalesce(r.qty, 1), coalesce(r.rate, 0), r.amount, r.line_key
    from jsonb_to_recordset(p_lines) as r(
      job_id uuid, revision_id text, work_hours_id uuid, kind text, description text,
      qty numeric, rate numeric, amount numeric, line_key text);

  return v_id;
end;
$$;

revoke execute on function public.create_payout(uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.create_payout(uuid, date, date, text, jsonb) to authenticated;

/** The CSV exports the app has (sql/106), with the accountant's monthly pay export. */
create or replace function public.export_kinds()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['audit_log', 'jobs', 'customers', 'invoices', 'patient_contacts',
               'payouts', 'payout_lines', 'revision_repricing',
               'pay_people', 'pay_lines']
$$;

select public.lock_anon_functions();
