-- ============================================================================
-- Wivo — migration 089: deleting a job keeps it
-- Run AFTER sql/088. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec: nothing is deleted for real; files have versions and soft delete. A
-- job delete cascaded to its `job_file` rows (the stored objects stayed,
-- orphaned) and to its shares, so the partner lost access with no "unshare"
-- in the audit log (review-068-079.md #23).
--
-- A delete from the app — any build, it is a plain DELETE — now marks the job
-- deleted instead: `deleted_at` / `deleted_by`, every live share ended and
-- audited on both sides, a `delete` row in the audit log, and the physical
-- delete skipped. The job, its files, revisions and invoices stay intact and
-- an owner can restore it. A delete with no user (service role, the SQL
-- editor) is still real: that is the organisation-exit path of Phase 3.
-- ============================================================================

alter table public.jobs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

alter table public.audit_log drop constraint if exists audit_log_action_valid;
alter table public.audit_log add constraint audit_log_action_valid
  check (action in ('view', 'download', 'upload', 'share', 'unshare', 'stage_move',
                    'partnership', 'export', 'question', 'delete', 'restore'));

create or replace function public.soft_delete_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s record;
begin
  if auth.uid() is null then
    return old;   -- service role / SQL editor: a real delete (organisation exit)
  end if;
  update public.jobs set deleted_at = now(), deleted_by = auth.uid()
   where id = old.id and deleted_at is null;
  for s in
    update public.job_share set revoked_at = now()
     where job_id = old.id and revoked_at is null
    returning partner_org
  loop
    perform public.audit(old.clinic_id, 'unshare', 'job:' || old.id, jsonb_build_object('partner_org', s.partner_org, 'reason', 'job deleted'));
    perform public.audit(s.partner_org, 'unshare', 'job:' || old.id, jsonb_build_object('owner_org', old.clinic_id, 'reason', 'job deleted'));
  end loop;
  perform public.audit(old.clinic_id, 'delete', 'job:' || old.id, jsonb_build_object('job_code', old.job_code));
  return null;  -- the row stays
end;
$$;

drop trigger if exists soft_delete_job on public.jobs;
create trigger soft_delete_job before delete on public.jobs
  for each row execute function public.soft_delete_job();

-- A deleted job is gone from every view of the app.
drop policy if exists "jobs_select" on public.jobs;
create policy "jobs_select" on public.jobs
  for select using (
    clinic_id = public.my_clinic_id() and deleted_at is null
    and (public.has_perm('jobs.read') or public.job_is_mine(assigned_to, designed_by, work_items))
  );
drop policy if exists "jobs_update" on public.jobs;
create policy "jobs_update" on public.jobs
  for update using (clinic_id = public.my_clinic_id() and deleted_at is null and public.has_perm('jobs.write'))
  with check (clinic_id = public.my_clinic_id() and public.has_perm('jobs.write'));

create or replace function public.can_read_own_job(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs j
     where j.id = p_job and j.clinic_id = public.my_org_id() and j.deleted_at is null
       and (public.has_perm('jobs.read') or public.job_is_mine(j.assigned_to, j.designed_by, j.work_items))
  )
$$;

/** Deleted jobs of the caller's clinic, newest first — for restoring. */
create or replace function public.deleted_jobs()
returns table (id uuid, job_code text, patient text, work_type text, deleted_at timestamptz, deleted_by_name text)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, j.job_code, j.patsient, j.too, j.deleted_at, p.full_name
    from public.jobs j left join public.profiles p on p.id = j.deleted_by
   where j.clinic_id = public.my_org_id() and j.deleted_at is not null and public.has_perm('jobs.write')
   order by j.deleted_at desc
$$;

create or replace function public.restore_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.my_org_id();
begin
  if not public.has_perm('jobs.write')
     or not exists (select 1 from public.jobs where id = p_job and clinic_id = v_org and deleted_at is not null) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  update public.jobs set deleted_at = null, deleted_by = null where id = p_job;
  perform public.audit(v_org, 'restore', 'job:' || p_job, '{}'::jsonb);
end;
$$;
