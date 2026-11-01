-- ============================================================================
-- Wivo — migration 071: what a partner can see and do on a shared job
-- Run AFTER sql/070. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec, "Rights and visibility":
--   - partner_job_view derives age (and sex, when recorded) and the FDI chart.
--     PARTIAL visibility has no identity fields AT ALL. FULL (referral) adds
--     name and contacts. Patient prices never; the partner's own price yes.
--   - Search goes through the same view; a partner searches by job code.
--   - Stages move only through move_job_stage, which checks stage_transition
--     and the partner's assigned stages. Other stages are read-only to them.
--   - Partners do not edit job fields; a change goes through a "Question".
--   - A revision inherits the original job's share.
--
-- Everything a partner reaches goes through a SECURITY DEFINER function here
-- that starts from `job_share` and checks the caller's organisation. No
-- policy on jobs, patients or channels is widened: a partner's direct query to
-- those tables still returns nothing (sql/test/partnerAccess.test.ts).
-- ============================================================================

-- ── Job threads: comments and questions on top of chat (sql/065) ────────────

alter table public.messages
  add column if not exists is_question  boolean not null default false,
  add column if not exists resolved_at  timestamptz,
  add column if not exists resolved_by  uuid references auth.users(id) on delete set null;

-- ── Helpers ─────────────────────────────────────────────────────────────────

/** The live share of a job with the caller's organisation, if any. */
create or replace function public.my_share(p_job uuid)
returns public.job_share
language sql
stable
security definer
set search_path = public
as $$
  select s.* from public.job_share s
    join public.partnership p on p.id = s.partnership_id
   where s.job_id = p_job and s.partner_org = public.my_org_id() and s.revoked_at is null
     and (p.status in ('active', 'suspended')
          or (p.status = 'ended' and p.readonly_until > now()))
$$;

/** Can the caller act (not just read) on this share right now? */
create or replace function public.share_is_active(s public.job_share)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.partnership p where p.id = s.partnership_id and p.status = 'active')
$$;

/** Can the caller see this job as a member of the owning organisation? */
create or replace function public.can_read_own_job(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs j
     where j.id = p_job and j.clinic_id = public.my_org_id()
       and (public.has_perm('jobs.read') or public.job_is_mine(j.assigned_to, j.designed_by, j.work_items))
  )
$$;

/** An organisation's stages in order: its own pipeline, else the default. */
create or replace function public.stage_order(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select array_agg(e ->> 'key' order by ord)
       from public.clinic_settings s,
            jsonb_array_elements(case when jsonb_typeof(s.pipeline_stages) = 'array' then s.pipeline_stages else '[]'::jsonb end)
              with ordinality as t(e, ord)
      where s.clinic_id = p_org and e ? 'key'
     having count(*) > 0),
    array['disain', 'print', 'poleeri', 'puhasta', 'varvi', 'valmis'])
$$;

/** The stage after `p_stage` in that organisation's order, or null at the end. */
create or replace function public.next_stage(p_org uuid, p_stage text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select (public.stage_order(p_org))[array_position(public.stage_order(p_org), p_stage) + 1]
$$;

/** May `actor` move a job of `p_org` from one stage to another? */
create or replace function public.stage_move_allowed(p_org uuid, p_from text, p_to text, p_actor text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- An organisation that wrote rules for this actor gets exactly those.
    when exists (select 1 from public.stage_transition where org_id = p_org and actor = p_actor)
      then exists (select 1 from public.stage_transition
                    where org_id = p_org and actor = p_actor and from_stage = p_from and to_stage = p_to)
    -- Otherwise: the owner moves freely (as before); a partner hands over to
    -- the next stage only — the "›" button.
    when p_actor = 'owner' then true
    else p_to = public.next_stage(p_org, p_from)
  end
$$;

-- ── Sharing ─────────────────────────────────────────────────────────────────

/**
 * Assign stages of a job to a partner. Creates the share, or updates the
 * stages of a live one. Spec: "assigning a stage to a partner creates a
 * job_share"; a referral is full visibility and needs the consent mark.
 */
create or replace function public.share_job(
  p_job uuid,
  p_partner_org uuid,
  p_case_type text,
  p_role text,
  p_stages text[],
  p_visibility text default null,
  p_consent boolean default false,
  p_partner_price numeric default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  j     public.jobs;
  p     public.partnership;
  v_vis text;
  v_id  uuid;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or j.clinic_id is distinct from v_org or not public.has_perm('jobs.write') then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  select * into p from public.partnership
   where status = 'active'
     and ((org_a = v_org and org_b = p_partner_org) or (org_b = v_org and org_a = p_partner_org));
  if p.id is null then
    raise exception 'No active partnership with that organisation' using errcode = '22023';
  end if;
  if cardinality(p.roles) > 0 and not (p_role = any(p.roles)) then
    raise exception 'The partnership does not include the role %', p_role using errcode = '22023';
  end if;
  if p_case_type = 'referral' then
    if not coalesce(p_consent, false) then
      raise exception 'A referral needs the mark "patient informed and agreed"' using errcode = '22023';
    end if;
    v_vis := 'full';
  else
    v_vis := coalesce(p_visibility, p.default_visibility);
  end if;

  update public.job_share
     set case_type = p_case_type, role = p_role, assigned_stages = coalesce(p_stages, '{}'),
         visibility = v_vis, partner_price = p_partner_price,
         consent_by = case when p_case_type = 'referral' then coalesce(consent_by, auth.uid()) end,
         consent_at = case when p_case_type = 'referral' then coalesce(consent_at, now()) end
   where job_id = p_job and partner_org = p_partner_org and revoked_at is null
  returning id into v_id;

  if v_id is null then
    insert into public.job_share (job_id, owner_org, partner_org, partnership_id, case_type, visibility,
                                  role, assigned_stages, partner_price, consent_by, consent_at, created_by)
    values (p_job, v_org, p_partner_org, p.id, p_case_type, v_vis, p_role, coalesce(p_stages, '{}'),
            p_partner_price,
            case when p_case_type = 'referral' then auth.uid() end,
            case when p_case_type = 'referral' then now() end,
            auth.uid())
    returning id into v_id;
  end if;

  perform public.audit(v_org, 'share', 'job:' || p_job,
    jsonb_build_object('partner_org', p_partner_org, 'case_type', p_case_type, 'visibility', v_vis, 'stages', p_stages));
  perform public.audit(p_partner_org, 'share', 'job:' || p_job,
    jsonb_build_object('owner_org', v_org, 'case_type', p_case_type, 'visibility', v_vis, 'stages', p_stages));
  return v_id;
end;
$$;

create or replace function public.unshare_job(p_job uuid, p_partner_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.my_org_id();
begin
  if not exists (select 1 from public.jobs where id = p_job and clinic_id = v_org) or not public.has_perm('jobs.write') then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  update public.job_share set revoked_at = now()
   where job_id = p_job and partner_org = p_partner_org and revoked_at is null;
  perform public.audit(v_org, 'unshare', 'job:' || p_job, jsonb_build_object('partner_org', p_partner_org));
  perform public.audit(p_partner_org, 'unshare', 'job:' || p_job, jsonb_build_object('owner_org', v_org));
end;
$$;

-- ── What a partner sees ─────────────────────────────────────────────────────

/** A revision as a partner sees it: no price, no costs, no billing flag. */
create or replace function public.partner_revisions(p_revisions jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(r - 'price' - 'extra_costs' - 'taspidev' - 'uusi_tarvikuid'), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_revisions) = 'array' then p_revisions else '[]'::jsonb end) r
$$;

/**
 * Every job shared with the caller's organisation, as the partner may see it.
 *
 * Columns are chosen, never `j.*`: a column added to `jobs` later does not
 * reach a partner until someone decides it should. Identity columns are NULL
 * unless the share is a referral (full visibility). Patient prices (`hind`,
 * extras, payment state) are never here; `partner_price` is the partner's own.
 */
create or replace function public.partner_jobs()
returns table (
  share_id         uuid,
  job_id           uuid,
  job_code         text,
  owner_org        uuid,
  owner_org_name   text,
  case_type        text,
  visibility       text,
  role             text,
  assigned_stages  text[],
  status           text,
  can_move         boolean,
  next_stage       text,
  received_on      date,
  due_at           timestamptz,
  work_type        text,
  work_items       jsonb,
  teeth            text,
  material         text,
  shade            text,
  stump_shade      text,
  description      text,
  rush             boolean,
  model            boolean,
  revisions        jsonb,
  partner_price    numeric,
  patient_age      int,
  patient_sex      text,
  patient_name     text,
  patient_phone    text,
  patient_email    text,
  open_questions   int,
  shared_at        timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, j.id, j.job_code, s.owner_org, c.name, s.case_type, s.visibility, s.role, s.assigned_stages,
         j.status,
         public.share_is_active(s) and j.status = any(s.assigned_stages),
         public.next_stage(s.owner_org, j.status),
         j.kuupaev, j.valmis_aeg, j.too,
         (select coalesce(jsonb_agg(w - 'note'), '[]'::jsonb)
            from jsonb_array_elements(case when jsonb_typeof(j.work_items) = 'array' then j.work_items else '[]'::jsonb end) w),
         j.hambad, j.materjal, j.varv, j.kondivarv, j.kirjeldus, j.kiirtoo, coalesce(j.mudel, false),
         public.partner_revisions(j.revisions),
         s.partner_price,
         case when pt.synniaeg is not null then date_part('year', age(pt.synniaeg))::int end,
         null::text,  -- no sex is recorded on patients yet
         case when s.visibility = 'full' then coalesce(pt.nimi, j.patsient) end,
         case when s.visibility = 'full' then pt.telefon end,
         case when s.visibility = 'full' then pt.email end,
         (select count(*)::int from public.messages m join public.channels ch on ch.id = m.channel_id
           where ch.job_id = j.id and m.is_question and m.resolved_at is null and m.deleted_at is null),
         s.created_at
    from public.job_share s
    join public.partnership p on p.id = s.partnership_id
    join public.jobs j on j.id = s.job_id
    join public.clinics c on c.id = s.owner_org
    left join public.patients pt on pt.id = j.patient_id
   where s.partner_org = public.my_org_id()
     and s.revoked_at is null
     and (p.status in ('active', 'suspended') or (p.status = 'ended' and p.readonly_until > now()))
$$;

-- The spec's name. A view so the client can filter and search it like a table
-- (`.from('partner_job_view').ilike('job_code', …)`); it runs with the
-- caller's rights and all it can reach is the function above.
create or replace view public.partner_job_view with (security_invoker = true) as
  select * from public.partner_jobs();

/** One shared job, opened. Logged as a view in both organisations' audit logs. */
create or replace function public.open_partner_job(p_job uuid)
returns setof public.partner_job_view
language plpgsql
security definer
set search_path = public
as $$
declare s public.job_share := public.my_share(p_job);
begin
  if s.id is null then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  perform public.audit(s.partner_org, 'view', 'job:' || p_job, '{}'::jsonb);
  perform public.audit(s.owner_org, 'view', 'job:' || p_job, jsonb_build_object('by_org', s.partner_org));
  return query select * from public.partner_jobs() v where v.job_id = p_job;
end;
$$;

-- ── Moving stages ───────────────────────────────────────────────────────────

/**
 * The one way a stage changes for a partner, and the owner's path too.
 * Spec acceptance: "a partner cannot move a locked stage, not even by calling
 * the RPC directly".
 */
create or replace function public.move_job_stage(p_job uuid, p_to text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  j     public.jobs;
  s     public.job_share;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  if j.status = p_to then
    return p_to;
  end if;
  if not (p_to = any(public.stage_order(j.clinic_id))) then
    raise exception 'Unknown stage %', p_to using errcode = '22023';
  end if;

  if j.clinic_id = v_org then
    if not public.has_perm('jobs.write') then
      raise exception 'No permission to move jobs' using errcode = '42501';
    end if;
    if not public.stage_move_allowed(v_org, j.status, p_to, 'owner') then
      raise exception 'Moving from % to % is not allowed', j.status, p_to using errcode = '42501';
    end if;
  else
    s := public.my_share(p_job);
    if s.id is null then
      raise exception 'Job not found' using errcode = '42501';
    end if;
    if not public.share_is_active(s) then
      raise exception 'The partnership is not active' using errcode = '42501';
    end if;
    if not (j.status = any(s.assigned_stages)) then
      raise exception 'Stage % is not yours to move', j.status using errcode = '42501';
    end if;
    if not public.stage_move_allowed(j.clinic_id, j.status, p_to, 'partner') then
      raise exception 'Moving from % to % is not allowed', j.status, p_to using errcode = '42501';
    end if;
  end if;

  -- Bypasses the guard trigger below on purpose: this function did the checking.
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

/**
 * The owner organisation's own rules hold however the status is changed —
 * the board, the job panel, or a direct API call — not only through the RPC.
 */
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
  return new;
end;
$$;

drop trigger if exists guard_stage_change on public.jobs;
create trigger guard_stage_change before update of status on public.jobs
  for each row execute function public.guard_stage_change();

-- ── Job thread: comments and questions ──────────────────────────────────────

/** The job's thread channel, made on first use. */
create or replace function public.job_channel(p_job uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_org uuid;
begin
  select id into v_id from public.channels where job_id = p_job;
  if v_id is null then
    select clinic_id into v_org from public.jobs where id = p_job;
    insert into public.channels (clinic_id, kind, job_id, created_by)
    values (v_org, 'too', p_job, auth.uid())
    on conflict (job_id) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.channels where job_id = p_job;
    end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.job_channel(uuid) from public, anon, authenticated;

/** Who may use a job's thread: its own clinic (if they can see the job) or a partner it is shared with. */
create or replace function public.may_use_job_thread(p_job uuid, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.job_share;
begin
  if public.can_read_own_job(p_job) then
    return true;
  end if;
  s := public.my_share(p_job);
  return s.id is not null and (not p_write or public.share_is_active(s));
end;
$$;

create or replace function public.job_thread(p_job uuid)
returns table (id uuid, body text, author_id uuid, author_name text, author_org text,
               is_question boolean, resolved_at timestamptz, created_at timestamptz, edited_at timestamptz,
               mine boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.may_use_job_thread(p_job, false) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  return query
    select m.id, case when m.deleted_at is null then m.body else '' end, m.author_id,
           pr.full_name, c.name, m.is_question, m.resolved_at, m.created_at, m.edited_at,
           m.author_id = auth.uid()
      from public.messages m
      join public.channels ch on ch.id = m.channel_id
      left join public.profiles pr on pr.id = m.author_id
      left join public.clinics c on c.id = pr.clinic_id
     where ch.job_id = p_job
     order by m.created_at;
end;
$$;

create or replace function public.post_job_comment(p_job uuid, p_body text, p_is_question boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.may_use_job_thread(p_job, true) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Empty message' using errcode = '22023';
  end if;
  insert into public.messages (channel_id, author_id, body, is_question)
  values (public.job_channel(p_job), auth.uid(), btrim(p_body), coalesce(p_is_question, false))
  returning id into v_id;
  if p_is_question then
    perform public.audit((select clinic_id from public.jobs where id = p_job), 'question', 'job:' || p_job,
      jsonb_build_object('message', v_id));
  end if;
  return v_id;
end;
$$;

/** Either side closes a question once it is answered. */
create or replace function public.resolve_question(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_job uuid;
begin
  select ch.job_id into v_job from public.messages m join public.channels ch on ch.id = m.channel_id
   where m.id = p_message and m.is_question;
  if v_job is null or not public.may_use_job_thread(v_job, true) then
    raise exception 'Question not found' using errcode = '42501';
  end if;
  update public.messages set resolved_at = now(), resolved_by = auth.uid() where id = p_message and resolved_at is null;
end;
$$;

/** Open-question counts for the caller's own jobs: the flag on the board card. */
create or replace function public.open_questions()
returns table (job_id uuid, open_count int)
language sql
stable
security definer
set search_path = public
as $$
  select ch.job_id, count(*)::int
    from public.messages m
    join public.channels ch on ch.id = m.channel_id
    join public.jobs j on j.id = ch.job_id
   where j.clinic_id = public.my_org_id() and m.is_question and m.resolved_at is null and m.deleted_at is null
   group by ch.job_id
$$;
