-- ============================================================================
-- Wivo — migration 078: audit log coverage and a readable view of it
-- Run AFTER sql/077. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec: audit_log(action: view, download, share, stage_move), append-only.
-- sql/070–074 log partnership steps, shares, partner views, downloads,
-- uploads, exports and stage moves made through move_job_stage. Two gaps:
--
-- 1. Stage moves made the old way — the board and the job panel update
--    `jobs.status` directly — were not logged. The status trigger now logs
--    every move a signed-in user makes outside the RPC (which logs its own).
-- 2. Opening a job in your own clinic was not logged. `log_job_view` is
--    called by the job panel when it opens one.
--
-- `audit_entries` is what the Settings screen reads: names and job codes
-- resolved, admins only, newest first.
-- ============================================================================

create or replace function public.guard_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or new.status is not distinct from old.status
     or current_setting('wivo.stage_move_checked', true) = 'yes' then
    return new;
  end if;
  if not public.stage_move_allowed(new.clinic_id, old.status, new.status, 'owner') then
    raise exception 'Moving from % to % is not allowed', old.status, new.status using errcode = '42501';
  end if;
  perform public.audit(new.clinic_id, 'stage_move', 'job:' || new.id,
    jsonb_build_object('from', old.status, 'to', new.status));
  return new;
end;
$$;

create or replace function public.log_job_view(p_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_read_own_job(p_job) then
    return; -- nothing to log about a job you cannot see; and nothing to reveal
  end if;
  perform public.audit(public.my_org_id(), 'view', 'job:' || p_job, '{}'::jsonb);
end;
$$;

create or replace function public.audit_entries(
  p_limit int default 200,
  p_action text default null,
  p_before timestamptz default null
) returns table (id bigint, at timestamptz, user_name text, action text, object text, job_code text, detail jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_admin() then
    raise exception 'Only an organisation admin can read the audit log' using errcode = '42501';
  end if;
  return query
    select a.id, a.at, p.full_name, a.action, a.object,
           case when a.object like 'job:%' then (select j.job_code from public.jobs j where j.id::text = substr(a.object, 5)) end,
           a.detail
      from public.audit_log a
      left join public.profiles p on p.id = a.user_id
     where a.org_id = public.my_org_id()
       and (p_action is null or a.action = p_action)
       and (p_before is null or a.at < p_before)
     order by a.at desc, a.id desc
     limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;
