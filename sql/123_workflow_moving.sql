-- ============================================================================
-- Wivo — migration 123: workflow templates, part 2: a job made from a template,
-- who may move it, who is told, who sees it, "I started", and files.write
-- Run AFTER sql/122. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- docs/WORKFLOW-STAGES.md (plan 3). sql/122 made the tables; this makes them
-- do something. A job whose stages have nobody on them (every job before this,
-- and any job made from a template without people) keeps today's rules in
-- every part below: it moves, notifies and is seen exactly as before.
--
-- 1. A JOB FROM ITS TEMPLATE (§2.3–2.6a). Every new job gets its own stages
--    the moment it is created (trigger job_stages_from_template): the
--    template's stages, kept by their switch or their rules, each with the
--    template's people, the orderer on an orderer stage, and the clinic's
--    default people on a stage left with nobody. Copied, never referenced.
--    A job inserted directly (an older build) uses its clinic's default
--    template with every switch at its default. create_job(job, switches)
--    is the same insert with the switches chosen at creation; it takes the
--    first stage of the job as its stage when the app sends none.
--    Same as shared/workflow materialiseTemplate(); the tests run both.
--
-- 2. THE DEFAULT TEMPLATE follows the clinic's stage list (§2.7): it is made
--    when a clinic is made, and every save of Settings → Job stages adds,
--    removes and orders its stages to match. What is set on a stage that
--    stays (people, task, pay kind) is kept.
--
-- 3. WHO MAY MOVE A JOB (§5): can_move_stage(job, target). The current stage's
--    people and the owner may; the target stage's people may pull it only from
--    the stage right before it, skipped stages not counted. Nobody else, with
--    jobs.write or without. guard_stage_change (a direct update) and
--    move_job_stage (the RPC) both ask it. A stage person needs no jobs.write
--    to move through move_job_stage: IT, on the intake stage, moves the job
--    from intake and from nowhere else (§7.3). The clinic's own transition
--    rules (stage_transition, sql/071) still apply on top.
--    Same as shared/workflow canMoveStage().
--
-- 4. DONE AND STARTED (§4). Leaving a stage for a later one marks it done (by
--    whom, when); entering a stage clears its done mark. start_job_stage(job)
--    is "I started" on the job's current stage: the first person to press it
--    stays on it, and every press is in the audit log ('stage_start').
--
-- 5. EDITING A JOB'S STAGES (§2.4): add a stage, skip or un-skip one, change
--    its people. The owner, an organisation admin, Manage stages
--    (pipeline.write), or the doctor who ordered the job with jobs.write.
--    Not jobs.write alone: a person who puts themselves on a stage gets to
--    move the job and its pay (§10), which is exactly what §5 takes away
--    from jobs.write. Every change is in the audit log ('stage_edit').
--
-- 6. NOTIFICATIONS (§3, §3.1). "Your turn" (stage_reached) goes to the target
--    stage's people; when it has none, to the job's technician and designers
--    as before; when the job has none either, to the clinic's owner. Never
--    the mover, never the previous stage's own people (one person on design
--    and print hears nothing from themselves), never a skipped stage.
--    Two new kinds:
--      stage_progress  the job moved, to everyone else on its stages who
--                      switched on profiles.notify_every_stage (off by
--                      default). Bell and e-mail, never a push.
--      stage_assigned  a new job, once per person on its stages ("you are on
--                      stage X", their first), or being put on a stage later.
--                      The bell only: no e-mail, no push.
--    No notification carries the patient.
--
-- 7. WHO SEES A JOB (§3.2). Every person on one of a job's stages (not a
--    skipped one) reads it from the moment it is created, as a technician
--    reads their own job today: jobs_select and can_read_own_job get that
--    branch. jobs.read is unchanged. Taken off the stage, they no longer see it.
--
-- 8. files.write (§7.3): adds files to a job the person is on a stage of. Not
--    a new version of someone's file, not deleting, not editing the job.
--    Granted per person, like every permission; nobody has it by default.
--
-- Decided here, where the plan left it open: who edits a job's stages (5);
-- that a skipped stage's people neither see the job nor add files to it; that
-- stage_progress e-mails follow notify_every_stage alone (it is itself an
-- e-mail switch); that someone told 'assigned' (technician or designer) by a
-- new job is not told stage_assigned as well; that "I started" is for the
-- job's current stage; that remakes move and notify as before (sql/087).
--
-- Known and unchanged: anyone who reads a job reads its price (the "money on
-- jobs" release, docs/PERMISSIONS.md). A stage person reads it like a
-- technician reads their own job's today; files.write adds nothing to that.
--
-- Tests: sql/test/workflowMoving.test.ts.
-- ============================================================================

set lock_timeout = '10s';

-- ── 0. New kinds, new actions, the new switch ───────────────────────────────

alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned',
                  'mfa_removed', 'mfa_reset', 'update_installed', 'update_failed', 'update_stale',
                  'stage_progress', 'stage_assigned'));

alter table public.audit_log drop constraint if exists audit_log_action_valid;
alter table public.audit_log add constraint audit_log_action_valid
  check (action in ('view', 'download', 'upload', 'share', 'unshare', 'stage_move',
                    'partnership', 'export', 'question', 'delete', 'restore', 'stock_override',
                    'mfa_added', 'mfa_removed', 'mfa_reset', 'account_deleted',
                    'create', 'edit', 'permission', 'file_deleted', 'update',
                    'stage_start', 'stage_edit'));

alter table public.profiles
  add column if not exists notify_every_stage boolean not null default false;
-- sql/117 names the columns a member may read; the new switch is one of them.
grant select (notify_every_stage) on public.profiles to authenticated;

/** "E-mail me about every stage of jobs I am on" (§3.1), on or off. Only one's own profile. */
create or replace function public.set_notify_every_stage(p_on boolean)
returns void
language sql
security definer
set search_path = public
as $$ update public.profiles set notify_every_stage = coalesce(p_on, false) where id = auth.uid() $$;
revoke execute on function public.set_notify_every_stage(boolean) from public, anon;
grant execute on function public.set_notify_every_stage(boolean) to authenticated;

-- ── 1. Who is on a job ──────────────────────────────────────────────────────

/** Is this profile a member of that clinic who can be put on a job (owner or worker)? */
create or replace function public.is_clinic_member(p_org uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles
                  where id = p_profile and clinic_id = p_org and role in ('owner', 'worker'))
$$;
revoke execute on function public.is_clinic_member(uuid, uuid) from public, anon, authenticated;

/** The people on one stage of a job. */
create or replace function public.job_stage_people(p_job uuid, p_stage text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(p.profile_id order by p.profile_id), '{}')
    from public.job_stage s join public.job_stage_person p on p.job_stage_id = s.id
   where s.job_id = p_job and s.stage_key = p_stage
$$;
revoke execute on function public.job_stage_people(uuid, text) from public, anon, authenticated;

/** Does the job have anybody on any stage? None: today's rules (§5, §10). */
create or replace function public.job_has_stage_people(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.job_stage s join public.job_stage_person p on p.job_stage_id = s.id
                  where s.job_id = p_job)
$$;
revoke execute on function public.job_has_stage_people(uuid) from public, anon, authenticated;

/** Am I on a stage of this job that is not skipped? (§3.2, §7.3) */
create or replace function public.on_job_stage(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.job_stage s join public.job_stage_person p on p.job_stage_id = s.id
     where s.job_id = p_job and s.skipped_at is null
       and p.profile_id = auth.uid() and p.org_id = public.my_org_id())
$$;
revoke execute on function public.on_job_stage(uuid) from public, anon;
grant execute on function public.on_job_stage(uuid) to authenticated;

/** The jobs I am on a stage of, not skipped: for jobs_select, evaluated once per query. */
create or replace function public.my_stage_jobs()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct s.job_id), '{}')
    from public.job_stage_person p join public.job_stage s on s.id = p.job_stage_id
   where auth.uid() is not null and p.profile_id = auth.uid() and p.org_id = public.my_org_id()
     and s.skipped_at is null
$$;
revoke execute on function public.my_stage_jobs() from public, anon;
grant execute on function public.my_stage_jobs() to authenticated;

-- ── 2. Who sees a job (§3.2) ────────────────────────────────────────────────

drop policy if exists "jobs_select" on public.jobs;
create policy "jobs_select" on public.jobs
  for select using (
    clinic_id = public.my_clinic_id() and deleted_at is null
    and (public.has_perm('jobs.read')
         or public.job_is_mine(assigned_to, designed_by, work_items)
         or id = any ((select public.my_stage_jobs())::uuid[]))
  );

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
       and (public.has_perm('jobs.read')
            or public.job_is_mine(j.assigned_to, j.designed_by, j.work_items)
            or public.on_job_stage(j.id))
  )
$$;

-- ── 3. A job from its template (§2.3–2.6a) ──────────────────────────────────

/** One rule of §2.5 against a job's fields. A field not filled in makes its rule false. */
create or replace function public.workflow_rule_holds(
  p_rule text, p_impression text, p_implants int, p_method text, p_printed boolean
) returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(case p_rule
    when 'digital'       then p_impression = 'digital'
    when 'conventional'  then p_impression = 'conventional'
    when 'implants_gt_1' then p_implants > 1
    when 'print'         then p_method = 'print'
    when 'mill'          then p_method = 'mill'
    when 'printed_model' then p_printed
    else false end, false)
$$;

/**
 * The stages a job gets from a template: shared/workflow materialiseTemplate().
 * A switch stage by its switch (absent: default_on); a rule stage when every
 * rule holds; people: the template's, plus the orderer on an orderer stage,
 * else the clinic's defaults for that stage. Only members of the clinic.
 */
create or replace function public.job_stage_plan(
  p_org uuid, p_template uuid, p_impression text, p_implants int, p_method text, p_printed boolean,
  p_switches jsonb, p_orderer uuid
) returns table (stage_key text, "position" int, task text, people uuid[])
language sql
stable
security definer
set search_path = public
as $$
  with kept as (
    select s.id, s.stage_key, s.position as tpos, s.task, s.orderer
      from public.workflow_template_stage s
     where s.template_id = p_template and s.org_id = p_org
       and case when s.optional
                then coalesce(case when jsonb_typeof(p_switches -> s.stage_key) = 'boolean'
                                   then (p_switches ->> s.stage_key)::boolean end, s.default_on)
                else not exists (select 1 from unnest(s.only_if) r
                                  where not public.workflow_rule_holds(r, p_impression, p_implants, p_method, p_printed))
           end
  ), named as (
    select k.id,
           array(select x from (
                   select tp.profile_id as x from public.workflow_template_stage_person tp where tp.template_stage_id = k.id
                   union
                   select p_orderer where k.orderer and p_orderer is not null) n
                 where public.is_clinic_member(p_org, x) order by x) as people
      from kept k
  )
  select k.stage_key,
         (row_number() over (order by k.tpos) - 1)::int,
         case when btrim(coalesce(k.task, '')) <> '' then k.task end,
         case when cardinality(n.people) > 0 then n.people
              else array(select d.profile_id from public.clinic_stage_default d
                          where d.org_id = p_org and d.stage_key = k.stage_key
                            and public.is_clinic_member(p_org, d.profile_id) order by d.profile_id) end
    from kept k join named n on n.id = k.id
$$;
revoke execute on function public.job_stage_plan(uuid, uuid, text, int, text, boolean, jsonb, uuid) from public, anon, authenticated;

/** The clinic's default template (sql/122), or null. */
create or replace function public.default_template(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select id from public.workflow_template where org_id = p_org and is_default $$;
revoke execute on function public.default_template(uuid) from public, anon, authenticated;

/** Tell one member of the job's clinic, in the bell only, that they are on a stage of it. */
create or replace function public.notify_stage_assigned(p_org uuid, p_job uuid, p_user uuid, p_stage text, p_new boolean)
returns void
language sql
security definer
set search_path = public
as $$
  select public.notify_member(p_org, p_user, p_job, 'stage_assigned',
    jsonb_build_object('stage', p_stage, 'new', p_new))
$$;
revoke execute on function public.notify_stage_assigned(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;

/**
 * A new job's own stages, written as it is created. The switches chosen at
 * creation come from create_job() (a setting for this transaction only);
 * without them every switch is at its default.
 */
create or replace function public.on_job_created_stages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template uuid;
  v_switches jsonb;
  v_archived timestamptz;
  v_stage    uuid;
  r          record;
  v_told     uuid[];
  p          uuid;
  v_first    text;
begin
  if new.clinic_id is null or new.deleted_at is not null
     or exists (select 1 from public.job_stage where job_id = new.id) then
    return new;
  end if;
  v_template := coalesce(new.template_id, public.default_template(new.clinic_id));
  select archived_at into v_archived from public.workflow_template where id = v_template;
  if v_archived is not null then
    raise exception 'This template is archived' using errcode = '22023';
  end if;
  begin
    v_switches := nullif(current_setting('wivo.job_switches', true), '')::jsonb;
  exception when others then
    v_switches := null;
  end;

  for r in select * from public.job_stage_plan(new.clinic_id, v_template, new.impression_type, new.implant_count,
                                               new.production_method, new.printed_model,
                                               coalesce(v_switches, '{}'::jsonb), new.ordered_by) loop
    insert into public.job_stage (org_id, job_id, stage_key, position, task)
    values (new.clinic_id, new.id, r.stage_key, r.position, r.task)
    returning id into v_stage;
    insert into public.job_stage_person (job_stage_id, profile_id, org_id, added_by)
    select v_stage, x, new.clinic_id, auth.uid() from unnest(r.people) x;
  end loop;

  -- The job's stage must be one of its stages (as the backfill, sql/122).
  if coalesce(btrim(new.status), '') <> '' and not exists (
       select 1 from public.job_stage where job_id = new.id and stage_key = new.status) then
    insert into public.job_stage (org_id, job_id, stage_key, position)
    values (new.clinic_id, new.id, new.status,
            coalesce((select max(position) + 1 from public.job_stage where job_id = new.id), 0));
  end if;

  -- "New job, you are on stage X" (§3.1): the bell only, once per person,
  -- naming their first stage. Not the creator (notify_member), and not who
  -- this insert already told as technician or designer ('assigned', sql/095).
  v_told := array_append(public.job_designers(new.designed_by, new.work_items), new.assigned_to);
  for p in select distinct jp.profile_id from public.job_stage s
             join public.job_stage_person jp on jp.job_stage_id = s.id
            where s.job_id = new.id loop
    continue when p = any(v_told);
    select s.stage_key into v_first from public.job_stage s join public.job_stage_person jp on jp.job_stage_id = s.id
     where s.job_id = new.id and jp.profile_id = p order by s.position limit 1;
    perform public.notify_stage_assigned(new.clinic_id, new.id, p, v_first, true);
  end loop;
  return new;
end;
$$;
revoke execute on function public.on_job_created_stages() from public, anon, authenticated;

drop trigger if exists job_stages_from_template on public.jobs;
create trigger job_stages_from_template after insert on public.jobs
  for each row execute function public.on_job_created_stages();

/** My clinic's default template. For create_job, which runs as the caller. */
create or replace function public.my_default_template()
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select public.default_template(public.my_org_id()) $$;
revoke execute on function public.my_default_template() from public, anon;
grant execute on function public.my_default_template() to authenticated;

/**
 * The first stage a job would get, for a job of my own clinic (its template
 * and its rule fields as `p_job` has them). Null for anyone else's template.
 */
create or replace function public.job_first_stage(p_job jsonb, p_switches jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.stage_key
    from public.workflow_template t
   cross join lateral public.job_stage_plan(t.org_id, t.id, p_job ->> 'impression_type',
           (p_job ->> 'implant_count')::int, p_job ->> 'production_method', (p_job ->> 'printed_model')::boolean,
           coalesce(p_switches, '{}'::jsonb), auth.uid()) p
   where t.id = public.as_uuid(p_job ->> 'template_id') and t.org_id = public.my_org_id()
   order by p.position
   limit 1
$$;
revoke execute on function public.job_first_stage(jsonb, jsonb) from public, anon;
grant execute on function public.job_first_stage(jsonb, jsonb) to authenticated;

/**
 * Create a job from its template, with the switches ticked at creation
 * (§2.5): `p_job` is the row as the app would insert it (the same columns,
 * the same rights: this runs as the caller, so jobs_insert decides), and
 * `p_switches` is {stage_key: true|false}. Without template_id the clinic's
 * default template; without status the job's first stage. Returns the job.
 */
create or replace function public.create_job(p_job jsonb, p_switches jsonb default '{}'::jsonb)
returns public.jobs
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job   jsonb := coalesce(p_job, '{}'::jsonb);
  v_sw    jsonb := coalesce(p_switches, '{}'::jsonb);
  v_org   uuid  := public.my_org_id();
  v_cols  text;
  v_bad   text;
  r       public.jobs;
begin
  if jsonb_typeof(v_job) <> 'object' or jsonb_typeof(v_sw) <> 'object' then
    raise exception 'A job and its switches are objects' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(v_sw) e where jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'A switch is true or false' using errcode = '22023';
  end if;
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(v_job) k
   where not exists (select 1 from pg_attribute a
                      where a.attrelid = 'public.jobs'::regclass and a.attnum > 0 and not a.attisdropped
                        and a.attname = k and a.attgenerated = '');
  if v_bad is not null then
    raise exception 'Unknown job field: %', v_bad using errcode = '42703';
  end if;
  if v_org is null then
    raise exception 'Not a member of a clinic' using errcode = '42501';
  end if;
  if not v_job ? 'clinic_id' then
    v_job := v_job || jsonb_build_object('clinic_id', v_org);
  end if;
  if coalesce(v_job -> 'template_id', 'null'::jsonb) = 'null'::jsonb then
    v_job := (v_job - 'template_id') || jsonb_strip_nulls(jsonb_build_object('template_id', public.my_default_template()));
  end if;
  if coalesce(btrim(v_job ->> 'status'), '') = '' then
    v_job := (v_job - 'status') || jsonb_strip_nulls(jsonb_build_object('status', public.job_first_stage(v_job, v_sw)));
  end if;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.jobs'::regclass and a.attnum > 0 and not a.attisdropped and v_job ? a.attname;

  perform set_config('wivo.job_switches', v_sw::text, true);
  execute format('insert into public.jobs (%1$s) select %1$s from jsonb_populate_record(null::public.jobs, $1) returning *', v_cols)
    into r using v_job;
  perform set_config('wivo.job_switches', '', true);
  return r;
end;
$$;
revoke execute on function public.create_job(jsonb, jsonb) from public, anon;
grant execute on function public.create_job(jsonb, jsonb) to authenticated;

-- ── 4. The default template follows the clinic's stages (§2.7) ──────────────

/**
 * Make the clinic's default template if it has none, and give it exactly the
 * clinic's stages in their order (stage_order(): the saved list, or the app's
 * built-in one). A stage that stays keeps its people, task and pay kind.
 */
create or replace function public.sync_default_template(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tpl  uuid;
  v_keys text[];
begin
  v_tpl := public.default_template(p_org);
  if v_tpl is null then
    insert into public.workflow_template (org_id, name, is_default)
    values (p_org, case when exists (select 1 from public.workflow_template where org_id = p_org and name = 'Default')
                        then 'Default (' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS') || ')' else 'Default' end, true)
    returning id into v_tpl;
  end if;

  -- The clinic's keys, each once, in their first place.
  v_keys := array(select k from unnest(public.stage_order(p_org)) with ordinality u(k, ord)
                   where length(btrim(coalesce(k, ''))) between 1 and 80
                   group by k order by min(ord));

  delete from public.workflow_template_stage
   where template_id = v_tpl and not (stage_key = any(v_keys));
  -- Out of the way first: positions are unique within a template.
  update public.workflow_template_stage set position = -1 - position where template_id = v_tpl;
  insert into public.workflow_template_stage (org_id, template_id, stage_key, position)
  select p_org, v_tpl, k, (ord - 1)::int from unnest(v_keys) with ordinality u(k, ord)
  on conflict (template_id, stage_key) do update set position = excluded.position;
  update public.workflow_template set updated_at = now() where id = v_tpl;
end;
$$;
revoke execute on function public.sync_default_template(uuid) from public, anon, authenticated;

create or replace function public.on_clinic_default_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'clinics' then
    perform public.sync_default_template(new.id);
  elsif tg_op = 'INSERT' or new.pipeline_stages is distinct from old.pipeline_stages then
    perform public.sync_default_template(new.clinic_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.on_clinic_default_template() from public, anon, authenticated;

drop trigger if exists clinic_default_template on public.clinics;
create trigger clinic_default_template after insert on public.clinics
  for each row execute function public.on_clinic_default_template();
drop trigger if exists stages_default_template on public.clinic_settings;
create trigger stages_default_template after insert or update of pipeline_stages on public.clinic_settings
  for each row execute function public.on_clinic_default_template();

-- A clinic made between 122 and this has none yet. (The ones 122 made are
-- left as they are: they already match.)
select public.sync_default_template(c.id) from public.clinics c
 where not exists (select 1 from public.workflow_template t where t.org_id = c.id and t.is_default);

-- ── 5. Who may move a job (§5) ──────────────────────────────────────────────

/**
 * shared/workflow canMoveStage(): 'legacy' when the job has nobody on any
 * stage (today's rule applies), else 'allowed' or 'refused' for `p_actor`
 * moving it from `p_from` to `p_to`.
 */
create or replace function public.stage_move_verdict(p_job uuid, p_from text, p_to text, p_actor uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  t        public.job_stage;
  v_prev   text;
begin
  if not public.job_has_stage_people(p_job) then
    return 'legacy';
  end if;
  if p_from is not distinct from p_to or p_actor is null then
    return 'refused';
  end if;
  select * into t from public.job_stage where job_id = p_job and stage_key = p_to;
  if t.id is null or t.skipped_at is not null then
    return 'refused';
  end if;
  select clinic_id into v_org from public.jobs where id = p_job;
  if exists (select 1 from public.profiles where id = p_actor and clinic_id = v_org and role = 'owner') then
    return 'allowed';
  end if;
  if p_actor = any(public.job_stage_people(p_job, p_from)) then
    return 'allowed';
  end if;
  if p_actor = any(public.job_stage_people(p_job, p_to)) then
    select s.stage_key into v_prev from public.job_stage s
     where s.job_id = p_job and s.skipped_at is null and s.position < t.position
     order by s.position desc limit 1;
    if v_prev is not distinct from p_from and v_prev is not null then
      return 'allowed';
    end if;
  end if;
  return 'refused';
end;
$$;
revoke execute on function public.stage_move_verdict(uuid, text, text, uuid) from public, anon, authenticated;

/**
 * May I move this job to `p_to` now? For the buttons on the desktop and the
 * phone; the database asks the same when the move is made. False for a job I
 * cannot read.
 */
create or replace function public.can_move_stage(p_job uuid, p_to text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case v.verdict
             when 'allowed' then public.stage_move_allowed(j.clinic_id, j.status, p_to, 'owner')
             when 'refused' then false
             else public.has_perm('jobs.write') and j.status is distinct from p_to
                  and p_to = any(public.stage_order(j.clinic_id))
                  and public.stage_move_allowed(j.clinic_id, j.status, p_to, 'owner')
           end
      from public.jobs j
     cross join lateral (select public.stage_move_verdict(j.id, j.status, p_to, auth.uid()) as verdict) v
     where j.id = p_job and public.can_read_own_job(j.id)), false)
$$;
revoke execute on function public.can_move_stage(uuid, text) from public, anon;
grant execute on function public.can_move_stage(uuid, text) to authenticated;

/** sql/114, asking §5 first. A job with nobody on its stages: exactly as before. */
create or replace function public.guard_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other boolean;
begin
  if auth.uid() is null or new.status is not distinct from old.status
     or current_setting('wivo.stage_move_checked', true) = 'yes' then
    return new;
  end if;
  if public.stage_move_verdict(new.id, old.status, new.status, auth.uid()) = 'refused' then
    raise exception 'You may not move this job from % to %', old.status, new.status using errcode = '42501';
  end if;
  if not public.stage_move_allowed(new.clinic_id, old.status, new.status, 'owner') then
    raise exception 'Moving from % to % is not allowed', old.status, new.status using errcode = '42501';
  end if;
  begin
    v_other := public.audit_job_diff(to_jsonb(old), to_jsonb(new)) is not null;
  exception when others then
    v_other := true;  -- audit_job_change records the save as unreadable
  end;
  if not v_other then
    perform public.audit(new.clinic_id, 'stage_move', 'job:' || new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

/**
 * sql/084, with §5 for the clinic's own jobs: a job with people on its stages
 * moves by can_move_stage's rule, and a stage person needs no jobs.write for
 * it. A job without: jobs.write, as before. A partner: as before.
 */
create or replace function public.move_job_stage(p_job uuid, p_to text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.my_org_id();
  v_owner   uuid;
  v_verdict text;
  j         public.jobs;
  s         public.job_share;
begin
  select clinic_id into v_owner from public.jobs where id = p_job;
  if v_owner is null then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  if v_owner = v_org then
    if not public.has_perm('jobs.write') and not public.on_job_stage(p_job) and public.my_role() <> 'owner' then
      raise exception 'No permission to move jobs' using errcode = '42501';
    end if;
  else
    s := public.my_share(p_job);
    if s.id is null then
      raise exception 'Job not found' using errcode = '42501';
    end if;
    if not public.has_perm('jobs.write') then
      raise exception 'No permission to move jobs' using errcode = '42501';
    end if;
    if not public.share_is_active(s) then
      raise exception 'The partnership is not active' using errcode = '42501';
    end if;
  end if;

  select * into j from public.jobs where id = p_job for update;
  if j.deleted_at is not null then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  if j.status = p_to then
    return p_to;
  end if;
  if v_owner = v_org then
    v_verdict := public.stage_move_verdict(p_job, j.status, p_to, auth.uid());
    if v_verdict = 'refused' then
      raise exception 'You may not move this job from % to %', j.status, p_to using errcode = '42501';
    elsif v_verdict = 'legacy' then
      if not public.has_perm('jobs.write') then
        raise exception 'No permission to move jobs' using errcode = '42501';
      end if;
      if not (p_to = any(public.stage_order(j.clinic_id))) then
        raise exception 'Unknown stage %', p_to using errcode = '22023';
      end if;
    end if;
    if not public.stage_move_allowed(v_org, j.status, p_to, 'owner') then
      raise exception 'Moving from % to % is not allowed', j.status, p_to using errcode = '42501';
    end if;
  else
    if not (p_to = any(public.stage_order(j.clinic_id))) then
      raise exception 'Unknown stage %', p_to using errcode = '22023';
    end if;
    if not (j.status = any(s.assigned_stages)) then
      raise exception 'Stage % is not yours to move', j.status using errcode = '42501';
    end if;
    if not public.stage_move_allowed(j.clinic_id, j.status, p_to, 'partner') then
      raise exception 'Moving from % to % is not allowed', j.status, p_to using errcode = '42501';
    end if;
  end if;

  perform set_config('wivo.stage_move_checked', 'yes', true);
  update public.jobs set status = p_to, updated_at = now() where id = p_job;
  perform set_config('wivo.stage_move_checked', '', true);

  perform public.audit(j.clinic_id, 'stage_move', 'job:' || p_job,
    jsonb_build_object('from', j.status, 'to', p_to, 'by_org', v_org));
  if v_org <> j.clinic_id then
    perform public.audit(v_org, 'stage_move', 'job:' || p_job, jsonb_build_object('from', j.status, 'to', p_to));
  end if;
  return p_to;
end;
$$;
revoke execute on function public.move_job_stage(uuid, text) from public, anon;
grant execute on function public.move_job_stage(uuid, text) to authenticated;

-- ── 6. Done, and "I started" (§4) ───────────────────────────────────────────

/** A move: the stage left for a later one is done; the stage entered is not. */
create or replace function public.on_job_stage_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from int;
  v_to   int;
begin
  if new.status is not distinct from old.status or new.deleted_at is not null or new.clinic_id is null then
    return new;
  end if;
  select position into v_from from public.job_stage where job_id = new.id and stage_key = old.status;
  select position into v_to from public.job_stage where job_id = new.id and stage_key = new.status;
  if v_to is null and coalesce(btrim(new.status), '') <> '' then
    -- A stage the job did not have (a job of today's rule, moved to a stage
    -- added since): it joins the end, as in the backfill.
    v_to := coalesce((select max(position) + 1 from public.job_stage where job_id = new.id), 0);
    insert into public.job_stage (org_id, job_id, stage_key, position)
    values (new.clinic_id, new.id, new.status, v_to)
    on conflict (job_id, stage_key) do nothing;
  end if;
  if v_from is not null and v_to is not null and v_to > v_from then
    update public.job_stage set done_at = now(), done_by = auth.uid()
     where job_id = new.id and stage_key = old.status;
  end if;
  update public.job_stage set done_at = null, done_by = null
   where job_id = new.id and stage_key = new.status and done_at is not null;
  return new;
end;
$$;
revoke execute on function public.on_job_stage_progress() from public, anon, authenticated;

drop trigger if exists job_stage_progress on public.jobs;
create trigger job_stage_progress after update of status on public.jobs
  for each row execute function public.on_job_stage_progress();

/**
 * "I started" on the job's current stage. The first person to press it stays
 * on it; every press is in the audit log. Who: that stage's people and the
 * owner; on a job with nobody on its stages, whoever may edit it (jobs.write).
 */
create or replace function public.start_job_stage(p_job uuid)
returns public.job_stage
language plpgsql
security definer
set search_path = public
as $$
declare
  j       public.jobs;
  s       public.job_stage;
  v_first boolean;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not public.can_read_own_job(p_job) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  select * into s from public.job_stage where job_id = p_job and stage_key = j.status for update;
  if s.id is null or s.skipped_at is not null then
    raise exception 'The job is not at a stage that can be started' using errcode = '22023';
  end if;
  if public.job_has_stage_people(p_job) then
    if not (auth.uid() = any(public.job_stage_people(p_job, s.stage_key)) or public.my_role() = 'owner') then
      raise exception 'This stage is not yours' using errcode = '42501';
    end if;
  elsif not public.has_perm('jobs.write') then
    raise exception 'No permission to edit jobs' using errcode = '42501';
  end if;
  v_first := s.started_at is null;
  if v_first then
    update public.job_stage set started_at = now(), started_by = auth.uid() where id = s.id returning * into s;
  end if;
  perform public.audit(j.clinic_id, 'stage_start', 'job:' || p_job,
    jsonb_build_object('stage', s.stage_key, 'first', v_first));
  return s;
end;
$$;
revoke execute on function public.start_job_stage(uuid) from public, anon;
grant execute on function public.start_job_stage(uuid) to authenticated;

-- ── 7. Editing a job's stages (§2.4) ────────────────────────────────────────

/** May I change this job's stages: add, skip, people? (Header, point 5.) */
create or replace function public.may_edit_job_stages(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs j
     where j.id = p_job and j.clinic_id = public.my_org_id() and j.deleted_at is null
       and public.can_read_own_job(j.id)
       and (public.my_role() = 'owner' or public.is_org_admin() or public.has_perm('pipeline.write')
            or (j.ordered_by = auth.uid() and public.has_perm('jobs.write'))))
$$;
revoke execute on function public.may_edit_job_stages(uuid) from public, anon;
grant execute on function public.may_edit_job_stages(uuid) to authenticated;

/**
 * The people of one stage of a job, replaced. Members of the job's clinic
 * only. Whoever is new on it hears it in the bell (stage_assigned).
 */
create or replace function public.set_job_stage_people(p_job uuid, p_stage text, p_people uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.my_org_id();
  s         public.job_stage;
  v_old     uuid[];
  v_new     uuid[];
  p         uuid;
begin
  if not public.may_edit_job_stages(p_job) then
    raise exception 'Not allowed to change this job''s stages' using errcode = '42501';
  end if;
  select * into s from public.job_stage where job_id = p_job and stage_key = p_stage for update;
  if s.id is null then
    raise exception 'The job has no stage %', p_stage using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_new from unnest(coalesce(p_people, '{}')) x where x is not null;
  if exists (select 1 from unnest(v_new) x where not public.is_clinic_member(v_org, x)) then
    raise exception 'Only members of the clinic can be put on a stage' using errcode = '42501';
  end if;
  v_old := public.job_stage_people(p_job, p_stage);
  if v_old = v_new then
    return;
  end if;
  delete from public.job_stage_person where job_stage_id = s.id and not (profile_id = any(v_new));
  insert into public.job_stage_person (job_stage_id, profile_id, org_id, added_by)
  select s.id, x, v_org, auth.uid() from unnest(v_new) x where not (x = any(v_old));
  perform public.audit(v_org, 'stage_edit', 'job:' || p_job, jsonb_build_object(
    'stage', p_stage, 'change', 'people',
    'added', to_jsonb(array(select x from unnest(v_new) x where not (x = any(v_old)))),
    'removed', to_jsonb(array(select x from unnest(v_old) x where not (x = any(v_new))))));
  if s.skipped_at is null then
    foreach p in array v_new loop
      if not (p = any(v_old)) then
        perform public.notify_stage_assigned(v_org, p_job, p, p_stage, false);
      end if;
    end loop;
  end if;
end;
$$;
revoke execute on function public.set_job_stage_people(uuid, text, uuid[]) from public, anon;
grant execute on function public.set_job_stage_people(uuid, text, uuid[]) to authenticated;

/** Skip a stage of a job, or take it back. Not the stage the job is at, and not a done one. */
create or replace function public.set_job_stage_skipped(p_job uuid, p_stage text, p_skipped boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.job_stage;
  v_status text;
begin
  if not public.may_edit_job_stages(p_job) then
    raise exception 'Not allowed to change this job''s stages' using errcode = '42501';
  end if;
  select status into v_status from public.jobs where id = p_job;
  select * into s from public.job_stage where job_id = p_job and stage_key = p_stage for update;
  if s.id is null then
    raise exception 'The job has no stage %', p_stage using errcode = '22023';
  end if;
  if coalesce(p_skipped, false) = (s.skipped_at is not null) then
    return;
  end if;
  if p_skipped and p_stage = v_status then
    raise exception 'The stage the job is at cannot be skipped' using errcode = '22023';
  end if;
  if p_skipped and s.done_at is not null then
    raise exception 'A done stage cannot be skipped' using errcode = '22023';
  end if;
  update public.job_stage set skipped_at = case when p_skipped then now() end where id = s.id;
  perform public.audit(s.org_id, 'stage_edit', 'job:' || p_job, jsonb_build_object(
    'stage', p_stage, 'change', case when p_skipped then 'skipped' else 'unskipped' end));
end;
$$;
revoke execute on function public.set_job_stage_skipped(uuid, text, boolean) from public, anon;
grant execute on function public.set_job_stage_skipped(uuid, text, boolean) to authenticated;

/** Add one of the clinic's stages to a job, right after `p_after` (null: first). */
create or replace function public.add_job_stage(p_job uuid, p_stage text, p_after text, p_task text default null)
returns public.job_stage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  v_pos int;
  r     public.job_stage;
begin
  if not public.may_edit_job_stages(p_job) then
    raise exception 'Not allowed to change this job''s stages' using errcode = '42501';
  end if;
  if not (p_stage = any(public.stage_order(v_org))) then
    raise exception 'Unknown stage %', p_stage using errcode = '22023';
  end if;
  if exists (select 1 from public.job_stage where job_id = p_job and stage_key = p_stage) then
    raise exception 'The job already has stage %', p_stage using errcode = '22023';
  end if;
  perform 1 from public.jobs where id = p_job for update;
  if p_after is null then
    v_pos := 0;
  else
    select position + 1 into v_pos from public.job_stage where job_id = p_job and stage_key = p_after;
    if v_pos is null then
      raise exception 'The job has no stage %', p_after using errcode = '22023';
    end if;
  end if;
  update public.job_stage set position = position + 1 where job_id = p_job and position >= v_pos;
  insert into public.job_stage (org_id, job_id, stage_key, position, task)
  values (v_org, p_job, p_stage, v_pos, case when btrim(coalesce(p_task, '')) <> '' then p_task end)
  returning * into r;
  perform public.audit(v_org, 'stage_edit', 'job:' || p_job, jsonb_build_object(
    'stage', p_stage, 'change', 'added', 'after', p_after));
  return r;
end;
$$;
revoke execute on function public.add_job_stage(uuid, text, text, text) from public, anon;
grant execute on function public.add_job_stage(uuid, text, text, text) to authenticated;

-- ── 8. Who is told (§3, §3.1) ───────────────────────────────────────────────

/**
 * The job moved from `p_from` to `p_to` (not a remake: sql/095 as before).
 * "Your turn" to the target stage's people, else the job's technician and
 * designers as sql/095, else the owner; then everyone else on its stages who
 * asked for every stage. Never the mover (notify_member), never the previous
 * stage's own people for "your turn", never a skipped stage.
 */
create or replace function public.notify_job_moved(p_job uuid, p_from text, p_to text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j        public.jobs;
  t        public.job_stage;
  v_turn   uuid[];
  v_prev   uuid[];
  v_detail jsonb := jsonb_strip_nulls(jsonb_build_object('from', p_from, 'to', p_to));
  v_des    uuid[];
  p        uuid;
begin
  select * into j from public.jobs where id = p_job;
  select * into t from public.job_stage where job_id = p_job and stage_key = p_to;
  if t.skipped_at is not null then
    return;
  end if;
  v_turn := public.job_stage_people(p_job, p_to);
  v_prev := public.job_stage_people(p_job, p_from);
  v_des := public.job_designers(j.designed_by, j.work_items);

  if cardinality(v_turn) > 0 then
    foreach p in array v_turn loop
      if not (p = any(v_prev)) then
        perform public.notify_member(j.clinic_id, p, p_job, 'stage_reached', v_detail || '{"role": "stage"}');
      end if;
    end loop;
  elsif j.assigned_to is not null or cardinality(v_des) > 0 then
    perform public.notify_stage_reached(j.clinic_id, p_job, j.assigned_to, v_des, p_from, p_to, null);
  else
    -- An owner a partner just handed the job back to was told that already
    -- (stage_handover, sql/075, whose trigger runs first).
    for p in select o.id from public.profiles o where o.clinic_id = j.clinic_id and o.role = 'owner' loop
      if not (p = any(v_prev)) and not exists (
           select 1 from public.notification n
            where n.user_id = p and n.job_id = p_job and n.kind = 'stage_handover' and n.created_at = now()) then
        perform public.notify_member(j.clinic_id, p, p_job, 'stage_reached', v_detail || '{"role": "owner"}');
      end if;
    end loop;
  end if;

  -- The others on the job's stages who asked for every stage: bell and e-mail.
  for p in
    select distinct jp.profile_id
      from public.job_stage s join public.job_stage_person jp on jp.job_stage_id = s.id
      join public.profiles pr on pr.id = jp.profile_id and pr.notify_every_stage
     where s.job_id = p_job and s.skipped_at is null and not (jp.profile_id = any(v_turn))
  loop
    continue when exists (select 1 from public.notification n
                           where n.user_id = p and n.job_id = p_job and n.kind = 'stage_reached' and n.created_at = now());
    perform public.notify_member(j.clinic_id, p, p_job, 'stage_progress', v_detail);
  end loop;
end;
$$;
revoke execute on function public.notify_job_moved(uuid, text, text) from public, anon, authenticated;

/** sql/095, with the job's own move told by notify_job_moved. */
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

  -- The job moved (§3).
  if new.status is distinct from old.status then
    perform public.notify_job_moved(new.id, old.status, new.status);
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

/** sql/099: stage_assigned is never e-mailed; stage_progress follows notify_every_stage. */
create or replace function public.pending_notification_emails(p_limit int default 200)
returns table (id uuid, email text, job_id uuid, job_code text, kind text, language text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, u.email, n.job_id, n.job_code, n.kind,
         coalesce(p.language, c.default_language, 'en'), n.created_at
    from public.notification n
    join public.profiles p on p.id = n.user_id
    join auth.users u on u.id = n.user_id
    join public.clinics c on c.id = n.org_id
   where n.emailed_at is null and n.read_at is null
     and n.kind <> 'stage_assigned'
     and case when n.kind = 'stage_progress' then p.notify_every_stage else p.notify_email end
     and u.email is not null and not public.is_standin_email(u.email)
     and n.created_at > now() - interval '1 day'
   order by n.created_at
   limit p_limit
$$;
revoke execute on function public.pending_notification_emails(int) from public, anon, authenticated;

/** sql/103, without the two kinds that never go to a phone. */
create or replace function public.pending_pushes(p_limit int default 500)
returns table (notification_id uuid, subscription_id uuid, endpoint text, p256dh text, auth text,
               kind text, language text, unread int)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, s.id, s.endpoint, s.p256dh, s.auth,
         n.kind,
         coalesce(p.language, c.default_language, 'en'),
         (select count(*)::int from public.notification u where u.user_id = n.user_id and u.read_at is null)
    from public.notification n
    join public.push_subscription s on s.user_id = n.user_id
    join public.profiles p on p.id = n.user_id and p.notify_push
    left join public.clinics c on c.id = n.org_id
   where n.pushed_at is null and n.read_at is null and n.created_at > now() - interval '1 hour'
     and n.kind not in ('stage_progress', 'stage_assigned')
   order by n.created_at, n.id
   limit p_limit
$$;
revoke execute on function public.pending_pushes(int) from public, anon, authenticated;

-- ── 9. files.write (§7.3) ───────────────────────────────────────────────────

/**
 * sql/084, plus files.write: a member on a stage of the job (not skipped)
 * may add files to it without jobs.write.
 */
create or replace function public.may_upload_job_file(p_job uuid, p_type text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.job_share;
begin
  if exists (select 1 from public.jobs where id = p_job and clinic_id = public.my_org_id() and deleted_at is null)
     and (public.has_perm('jobs.write')
          or (public.has_perm('files.write') and public.on_job_stage(p_job))) then
    return true;
  end if;
  s := public.my_share(p_job);
  return s.id is not null and public.share_is_active(s) and public.has_perm('jobs.write')
     and p_type in ('print', 'design');
end;
$$;
revoke execute on function public.may_upload_job_file(uuid, text) from public, anon, authenticated;

/** sql/072; a new version of a file of the clinic's own job needs jobs.write (files.write only adds). */
create or replace function public.register_job_file(
  p_job uuid,
  p_type text,
  p_sha256 text,
  p_size bigint,
  p_mime text,
  p_extension text,
  p_supersedes uuid default null
) returns public.job_file
language plpgsql
security definer
set search_path = public
as $$
declare
  j       public.jobs;
  prev    public.job_file;
  v_id    uuid := gen_random_uuid();
  v_ver   int := 1;
  v_ext   text := lower(regexp_replace(coalesce(p_extension, ''), '[^A-Za-z0-9]', '', 'g'));
  r       public.job_file;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not public.may_upload_job_file(p_job, p_type) then
    raise exception 'Not allowed to add this file to this job' using errcode = '42501';
  end if;
  if p_supersedes is not null then
    if j.clinic_id = public.my_org_id() and not public.has_perm('jobs.write') then
      raise exception 'Not allowed to replace a file of this job' using errcode = '42501';
    end if;
    select * into prev from public.job_file where id = p_supersedes and job_id = p_job and deleted_at is null;
    if prev.id is null then
      raise exception 'The file to replace was not found' using errcode = '22023';
    end if;
    if prev.type <> p_type then
      raise exception 'A new version must have the same type' using errcode = '22023';
    end if;
    v_ver := prev.version + 1;
  end if;

  insert into public.job_file (id, job_id, org_id, type, version, supersedes, sha256, size, mime_type,
                               file_name, storage_path, uploaded_by, uploaded_by_org)
  values (v_id, p_job, j.clinic_id, p_type, v_ver, p_supersedes, lower(p_sha256), p_size, p_mime,
          coalesce(j.job_code, j.id::text) || '_' || p_type || '_v' || v_ver
            || case when v_ext <> '' then '.' || v_ext else '' end,
          j.clinic_id || '/' || p_job || '/' || v_id,
          auth.uid(), public.my_org_id())
  returning * into r;

  perform public.audit(j.clinic_id, 'upload', 'file:' || v_id,
    jsonb_build_object('job', p_job, 'type', p_type, 'version', v_ver, 'size', p_size, 'by_org', public.my_org_id()));
  if public.my_org_id() <> j.clinic_id then
    perform public.audit(public.my_org_id(), 'upload', 'file:' || v_id, jsonb_build_object('job', p_job));
  end if;
  return r;
end;
$$;

select public.ensure_mfa_policies();
select public.lock_anon_functions();
