-- ============================================================================
-- Wivo — migration 105: searching the audit log
-- Run AFTER sql/104. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Seaded → Audit log showed the newest 300 rows, filtered by action only, so
-- an entry from months back could not be found. Now owners and admins search
-- it: by person, by action, by job code and by date range, a page at a time,
-- and export what they found (the app writes the CSV from these rows).
--
-- Nothing new is shown: the same rows and columns as audit_entries (sql/078),
-- to the same people (organisation owners and admins, with the second
-- factor), of their own organisation only. audit_entries stays for older app
-- builds.
--
-- 1. Indexes for the three filters, newest first, so a search over a year of
--    rows reads only what it returns.
-- 2. audit_search(): the filters, and paging by (at, id) — "the page before
--    this row" — which stays fast and never skips or repeats a row when new
--    ones are written meanwhile.
-- 3. audit_people(): who appears in the log, for the person filter. Only
--    names the log already shows.
--
-- Both are `stable`: reads (sql/104 never refuses them to an old build).
-- No new table. Tests: sql/test/auditSearch.test.ts.
-- ============================================================================

-- ── 1. Indexes ──────────────────────────────────────────────────────────────

create index if not exists audit_log_org_user_at_idx   on public.audit_log (org_id, user_id, at desc, id desc);
create index if not exists audit_log_org_action_at_idx on public.audit_log (org_id, action, at desc, id desc);
create index if not exists audit_log_org_object_at_idx on public.audit_log (org_id, object, at desc, id desc);

-- ── 2. The search ───────────────────────────────────────────────────────────

/** A job code as typed or stored, for comparing: lower case, no spaces or dashes (as the job search, lib/jobSearch). */
create or replace function public.job_code_key(p_code text)
returns text
language sql
immutable
set search_path = public
as $$ select lower(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')) $$;

/**
 * The audit log, filtered, newest first, one page at a time. Each filter is
 * optional:
 *   p_user        one person
 *   p_action      one kind of entry
 *   p_job_code    jobs whose code contains this (case, spaces and dashes ignored)
 *   p_from, p_to  at >= p_from and at < p_to
 *   p_before_at, p_before_id   the last row of the previous page (paging)
 * Same columns as audit_entries.
 */
create or replace function public.audit_search(
  p_user        uuid        default null,
  p_action      text        default null,
  p_job_code    text        default null,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_before_at   timestamptz default null,
  p_before_id   bigint      default null,
  p_limit       int         default 50
) returns table (id bigint, at timestamptz, user_name text, action text, object text, job_code text, detail jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.my_org_id();
  v_code text := nullif(public.job_code_key(p_job_code), '');
begin
  if not public.has_mfa() then
    raise exception 'Sign in with your second factor first' using errcode = '42501', hint = 'mfa_required';
  end if;
  if v_org is null or not public.is_org_admin() then
    raise exception 'Only an organisation admin can read the audit log' using errcode = '42501';
  end if;
  return query
    select a.id, a.at, p.full_name, a.action, a.object,
           case when a.object like 'job:%' then (select j.job_code from public.jobs j where j.id::text = substr(a.object, 5)) end,
           a.detail
      from public.audit_log a
      left join public.profiles p on p.id = a.user_id
     where a.org_id = v_org
       and (p_user is null or a.user_id = p_user)
       and (p_action is null or a.action = p_action)
       and (p_from is null or a.at >= p_from)
       and (p_to is null or a.at < p_to)
       and (p_before_at is null or (a.at, a.id) < (p_before_at, coalesce(p_before_id, 9223372036854775807)))
       and (v_code is null or a.object in (
             select 'job:' || j.id from public.jobs j
              where position(v_code in public.job_code_key(j.job_code)) > 0))
     order by a.at desc, a.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 1000);
end;
$$;
revoke execute on function public.audit_search(uuid, text, text, timestamptz, timestamptz, timestamptz, bigint, int) from public, anon;
grant execute on function public.audit_search(uuid, text, text, timestamptz, timestamptz, timestamptz, bigint, int) to authenticated;

-- ── 3. Who appears in the log ───────────────────────────────────────────────

/** The people in this organisation's audit log, for the person filter: names the log already shows. */
create or replace function public.audit_people()
returns table (user_id uuid, name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.my_org_id();
begin
  if not public.has_mfa() then
    raise exception 'Sign in with your second factor first' using errcode = '42501', hint = 'mfa_required';
  end if;
  if v_org is null or not public.is_org_admin() then
    raise exception 'Only an organisation admin can read the audit log' using errcode = '42501';
  end if;
  return query
    select u.user_id, coalesce(p.full_name, '') from (
      select distinct a.user_id from public.audit_log a where a.org_id = v_org and a.user_id is not null
    ) u
    left join public.profiles p on p.id = u.user_id
    order by 2, 1;
end;
$$;
revoke execute on function public.audit_people() from public, anon;
grant execute on function public.audit_people() to authenticated;

select public.lock_anon_functions();
