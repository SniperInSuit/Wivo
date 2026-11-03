-- ============================================================================
-- Wivo — migration 106: every export leaves an audit entry
-- Run AFTER sql/105. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- The patient export already wrote one (patient_export, sql/074/081). The CSV
-- exports did not: the job table, clients, invoices, the patients' marketing
-- contacts, payroll's payouts, payout lines and remake repricing, and the
-- audit log's own CSV (sql/105). Now each writes, BEFORE the file is made:
--
--   action 'export', object 'csv:<kind>', detail { kind, rows, filters }
--
-- who and when come from the row itself (user_id, at). Never the rows'
-- content: the number of rows, and the filters as the app records them —
-- fixed choices as they are (a stage, a status, dates, a period), free text
-- and names only as "set" (a search typed into the job table could be a
-- patient's name). The app makes the file only once this has been written
-- (lib/exportAudit.ts).
--
-- Any member may record their own export, of their own organisation: the
-- data was already theirs to see. It cannot be used to write anything else:
-- a fixed list of kinds, a row count, and a small object of plain values.
--
-- Volatile (it writes), so a build below the minimum version cannot export
-- (sql/104): it is told to update.
-- No new table. Tests: sql/test/auditExports.test.ts.
-- ============================================================================

/** The CSV exports the app has. */
create or replace function public.export_kinds()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['audit_log', 'jobs', 'customers', 'invoices', 'patient_contacts',
               'payouts', 'payout_lines', 'revision_repricing']
$$;

/** Filters as recorded: an object of at most 20 keys, each a plain value or a short list of them. */
create or replace function public.export_filters_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(p) = 'object'
     and length(p::text) <= 2000
     and (select count(*) from jsonb_object_keys(p)) <= 20
     and not exists (
       select 1 from jsonb_each(p) e
        where not (
          jsonb_typeof(e.value) in ('string', 'number', 'boolean', 'null')
          or (jsonb_typeof(e.value) = 'array'
              and jsonb_array_length(e.value) <= 20
              and not exists (select 1 from jsonb_array_elements(e.value) x
                               where jsonb_typeof(x) not in ('string', 'number', 'boolean')))
        )
     )
$$;

/** Record one CSV export by the caller. Returns the audit row's id. */
create or replace function public.audit_export(p_kind text, p_rows int, p_filters jsonb default '{}'::jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  v_id  bigint;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_mfa() then
    raise exception 'Sign in with your second factor first' using errcode = '42501', hint = 'mfa_required';
  end if;
  if p_kind is null or not (p_kind = any (public.export_kinds())) then
    raise exception 'Unknown export' using errcode = '22023';
  end if;
  if p_rows is null or p_rows < 0 or p_rows > 1000000 then
    raise exception 'A row count is a number from 0' using errcode = '22023';
  end if;
  if not public.export_filters_ok(coalesce(p_filters, '{}'::jsonb)) then
    raise exception 'Filters are a small object of plain values' using errcode = '22023';
  end if;
  insert into public.audit_log (org_id, user_id, action, object, detail)
  values (v_org, auth.uid(), 'export', 'csv:' || p_kind,
          jsonb_build_object('kind', p_kind, 'rows', p_rows, 'filters', coalesce(p_filters, '{}'::jsonb)))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.audit_export(text, int, jsonb) from public, anon;
grant execute on function public.audit_export(text, int, jsonb) to authenticated;

select public.lock_anon_functions();
