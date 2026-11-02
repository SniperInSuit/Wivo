-- ============================================================================
-- Wivo — migration 095: notifications inside the clinic
-- Run AFTER sql/094. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Until now every notification was about a partner (sql/075, sql/090): a
-- technician of the clinic's own, working in a lab across town, heard nothing
-- when a job reached them. Two new kinds, for the clinic's own members only:
--
--   stage_reached  A job (or a remake on it) moved to a stage. The job's
--                  technician (`assigned_to`) and designers (`designed_by`,
--                  and each work item's) are told — per stage, as the clinic
--                  set it in Settings → Job stages: `notifyTechnician` and
--                  `notifyDesigner` on each stage in clinic_settings.
--                  Unset means yes. A remake tells its own technician and
--                  designer, else the job's.
--   assigned       Someone was made the technician or a designer of a job,
--                  on a new job or by a change.
--
-- Never the person who did it, never anyone outside the job's own clinic
-- (a profile that moved organisation is skipped), nothing for a deleted job.
-- Like every notification, these reach the bell, the phone (push, sql/090)
-- and e-mail when that is switched on. They carry the job code and the stage
-- key — no patient.
--
-- Each person chooses their channels: e-mail already had its switch
-- (`profiles.notify_email`, sql/075); push gets one here
-- (`profiles.notify_push`), for all of that person's phones at once. The bell
-- always shows everything — there is no switch for it.
--
-- Tests: sql/test/teamNotifications.test.ts.
-- ============================================================================

alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned'));

-- ── Each person's channels ──────────────────────────────────────────────────

alter table public.profiles
  add column if not exists notify_push boolean not null default true;

/** Push to all my phones, on or off. Only one's own profile. */
create or replace function public.set_notify_push(p_on boolean)
returns void
language sql
security definer
set search_path = public
as $$ update public.profiles set notify_push = coalesce(p_on, true) where id = auth.uid() $$;
revoke execute on function public.set_notify_push(boolean) from public, anon;

/** As sql/091, without the people who switched push off. */
create or replace function public.pending_pushes(p_limit int default 500)
returns table (notification_id uuid, subscription_id uuid, endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, s.id, s.endpoint, s.p256dh, s.auth
    from public.notification n
    join public.push_subscription s on s.user_id = n.user_id
    join public.profiles p on p.id = n.user_id and p.notify_push
   where n.pushed_at is null and n.read_at is null and n.created_at > now() - interval '1 hour'
   order by n.created_at, n.id
   limit p_limit
$$;
revoke execute on function public.pending_pushes(int) from public, anon, authenticated;

-- ── Who is told ─────────────────────────────────────────────────────────────

/** Does the organisation's stage `p_stage` tell `p_who` ('technician' or 'designer')? Unset: yes. */
create or replace function public.stage_notifies(p_org uuid, p_stage text, p_who text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case e -> (case p_who when 'technician' then 'notifyTechnician' else 'notifyDesigner' end)
              when 'false'::jsonb then false else true end
       from public.clinic_settings s,
            jsonb_array_elements(case when jsonb_typeof(s.pipeline_stages) = 'array' then s.pipeline_stages else '[]'::jsonb end) e
      where s.clinic_id = p_org and e ->> 'key' = p_stage
      limit 1),
    true)
$$;
revoke execute on function public.stage_notifies(uuid, text, text) from public, anon, authenticated;

/** `p` as a uuid when it is one; else null (JSON fields can hold anything). */
create or replace function public.as_uuid(p text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

/** The designers of a job: the job's own and each work item's, without empties. */
create or replace function public.job_designers(p_designed_by uuid, p_items jsonb)
returns uuid[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(distinct d) filter (where d is not null), '{}')
    from (select p_designed_by as d
          union all
          select public.as_uuid(w ->> 'designed_by')
            from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) w) x
$$;

/** One member of the job's clinic, told once — never the person acting. */
create or replace function public.notify_member(p_org uuid, p_user uuid, p_job uuid, p_kind text, p_detail jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notification (org_id, user_id, job_id, job_code, kind, detail)
  select p_org, p.id, p_job, (select job_code from public.jobs where id = p_job), p_kind, coalesce(p_detail, '{}'::jsonb)
    from public.profiles p
   where p.id = p_user and p.clinic_id = p_org and p.role in ('owner', 'worker')
     and p.id is distinct from auth.uid()
$$;
revoke execute on function public.notify_member(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

/** A move to `p_to`: the technician and designers that stage tells, each once. */
create or replace function public.notify_stage_reached(
  p_org uuid, p_job uuid, p_tech uuid, p_designers uuid[], p_from text, p_to text, p_revision text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d uuid;
  v_detail jsonb := jsonb_strip_nulls(jsonb_build_object('from', p_from, 'to', p_to, 'revision', p_revision));
begin
  if p_tech is not null and public.stage_notifies(p_org, p_to, 'technician') then
    perform public.notify_member(p_org, p_tech, p_job, 'stage_reached', v_detail || '{"role": "technician"}');
  end if;
  if public.stage_notifies(p_org, p_to, 'designer') then
    foreach d in array coalesce(p_designers, '{}') loop
      if d is distinct from p_tech or not public.stage_notifies(p_org, p_to, 'technician') then
        perform public.notify_member(p_org, d, p_job, 'stage_reached', v_detail || '{"role": "designer"}');
      end if;
    end loop;
  end if;
end;
$$;
revoke execute on function public.notify_stage_reached(uuid, uuid, uuid, uuid[], text, text, text) from public, anon, authenticated;

create or replace function public.on_job_team_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new  uuid[];
  v_old  uuid[] := '{}';
  v_tech boolean := false;
  d      uuid;
  r      jsonb;
  o      jsonb;
begin
  if new.deleted_at is not null then
    return new;
  end if;
  v_new := public.job_designers(new.designed_by, new.work_items);
  if tg_op = 'UPDATE' then
    v_old := public.job_designers(old.designed_by, old.work_items);
  end if;

  -- Made technician or designer (someone made both hears it once).
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    perform public.notify_member(new.clinic_id, new.assigned_to, new.id, 'assigned', '{"role": "technician"}');
    v_tech := true;
  end if;
  foreach d in array v_new loop
    if not (d = any(v_old)) and not (v_tech and d = new.assigned_to) then
      perform public.notify_member(new.clinic_id, d, new.id, 'assigned', '{"role": "designer"}');
    end if;
  end loop;

  if tg_op = 'INSERT' then
    return new;
  end if;

  -- The job moved.
  if new.status is distinct from old.status then
    perform public.notify_stage_reached(new.clinic_id, new.id, new.assigned_to, v_new, old.status, new.status, null);
  end if;

  -- A remake moved: its own people, else the job's.
  if new.revisions is distinct from old.revisions and jsonb_typeof(new.revisions) = 'array' then
    for r in select * from jsonb_array_elements(new.revisions) loop
      o := null;
      select x into o
        from jsonb_array_elements(case when jsonb_typeof(old.revisions) = 'array' then old.revisions else '[]'::jsonb end) x
       where x ->> 'id' = r ->> 'id';
      if o is not null and (r ->> 'status') is not null and (r ->> 'status') is distinct from (o ->> 'status') then
        perform public.notify_stage_reached(
          new.clinic_id, new.id,
          coalesce(public.as_uuid(r ->> 'assigned_to'), new.assigned_to),
          case when public.as_uuid(r ->> 'designed_by') is not null then array[public.as_uuid(r ->> 'designed_by')] else v_new end,
          o ->> 'status', r ->> 'status', r ->> 'id');
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists job_team_notify on public.jobs;
create trigger job_team_notify after insert or update of status, revisions, assigned_to, designed_by, work_items on public.jobs
  for each row execute function public.on_job_team_notify();
