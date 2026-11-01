-- ============================================================================
-- Wivo — migration 084: partner-side fixes from the review of 068–079
-- Run AFTER sql/083. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- The partner features have no partnership on production yet, so nothing here
-- has been exploitable there. Each item was confirmed by the reviewer and is
-- now a test (sql/test/partnerFixes.test.ts). Apply BEFORE the first
-- partnership is created. Numbers refer to docs/night-run/review-068-079.md.
--
--  #5  The job thread leaked across partners and back in time. A partner now
--      sees its own organisation's messages and the owner's messages written
--      after the job was shared with it — never another partner's, never the
--      owner's notes from before, never a channel that is not the job thread.
--  #10 Partner staff ignored their own organisation's permissions: reading a
--      shared job needs `jobs.read`, moving a stage or adding a file needs
--      `jobs.write`, in the PARTNER's own permission set.
--  #9  The partner chose how long it keeps read access after ending (up to
--      any date). The window is at most 90 days. Only the side that paused a
--      partnership can resume it.
--  #7  Wrong codes typed into "accept" were not counted (the error rolled the
--      count back). A wrong code now returns nothing instead of raising.
--  #13 move_job_stage told a stranger a job's stage before checking rights.
--  #14 unshare_job wrote into any organisation's audit log.
--  #15 Revisions kept free-text notes and staff ids for the partner.
--  #16 Lab work could be shared at full visibility without consent. Spec: lab
--      work is partial, full visibility is a referral with a consent mark.
--  #17 A reserved upload slot outlived the right to upload into it.
--  #19 Partner preview views were logged on the owner side only.
--  #20 The partner became `created_by` of the owner's thread channel.
--  #21 Internal helpers were callable by anyone, anon included.
--  #25 Re-sharing after a new partnership kept the old partnership id.
--  #11 A removed worker kept reading and posting in their old channels.
--  #26 An observer could add or remove other channel members.
-- ============================================================================

-- ── #10 The partner's own permissions apply ─────────────────────────────────

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
     and public.has_perm('jobs.read')
     and (p.status in ('active', 'suspended')
          or (p.status = 'ended' and p.readonly_until > now()))
$$;

create or replace function public.may_upload_job_file(p_job uuid, p_type text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.job_share;
begin
  if exists (select 1 from public.jobs where id = p_job and clinic_id = public.my_org_id())
     and public.has_perm('jobs.write') then
    return true;
  end if;
  s := public.my_share(p_job);
  return s.id is not null and public.share_is_active(s) and public.has_perm('jobs.write')
     and p_type in ('print', 'design');
end;
$$;

-- ── #15 What a partner sees of revisions and work items ─────────────────────

create or replace function public.partner_work_items(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(w - 'note' - 'designed_by'), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) w
$$;

create or replace function public.partner_revisions(p_revisions jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(
           (r - 'price' - 'extra_costs' - 'taspidev' - 'uusi_tarvikuid' - 'note' - 'assigned_to' - 'designed_by')
           || case when r ? 'work_items' then jsonb_build_object('work_items', public.partner_work_items(r -> 'work_items'))
                   else '{}'::jsonb end
         ), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_revisions) = 'array' then p_revisions else '[]'::jsonb end) r
$$;

-- ── #5 Which thread messages a partner sees ─────────────────────────────────

/** A message the partner of share `s` may see: theirs or the owner's, since the share. */
create or replace function public.partner_sees_message(p_author uuid, p_created timestamptz, s public.job_share)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_created >= s.created_at
     and exists (select 1 from public.profiles p where p.id = p_author and p.clinic_id in (s.partner_org, s.owner_org))
$$;

create or replace function public.partner_jobs()
returns table (
  share_id uuid, job_id uuid, job_code text, owner_org uuid, owner_org_name text, case_type text,
  visibility text, role text, assigned_stages text[], status text, can_move boolean, next_stage text,
  received_on date, due_at timestamptz, work_type text, work_items jsonb, teeth text, material text,
  shade text, stump_shade text, description text, rush boolean, model boolean, revisions jsonb,
  partner_price numeric, patient_age int, patient_sex text, patient_name text, patient_phone text,
  patient_email text, open_questions int, shared_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, j.id, j.job_code, s.owner_org, c.name, s.case_type, s.visibility, s.role, s.assigned_stages,
         j.status,
         public.share_is_active(s) and j.status = any(s.assigned_stages) and public.has_perm('jobs.write'),
         public.next_stage(s.owner_org, j.status),
         j.kuupaev, j.valmis_aeg, j.too,
         public.partner_work_items(j.work_items),
         j.hambad, j.materjal, j.varv, j.kondivarv, j.kirjeldus, j.kiirtoo, coalesce(j.mudel, false),
         public.partner_revisions(j.revisions),
         s.partner_price,
         case when pt.synniaeg is not null then date_part('year', age(pt.synniaeg))::int end,
         null::text,
         case when s.visibility = 'full' then coalesce(pt.nimi, j.patsient) end,
         case when s.visibility = 'full' then pt.telefon end,
         case when s.visibility = 'full' then pt.email end,
         (select count(*)::int from public.messages m join public.channels ch on ch.id = m.channel_id
           where ch.job_id = j.id and ch.kind = 'too' and m.is_question and m.resolved_at is null
             and m.deleted_at is null and public.partner_sees_message(m.author_id, m.created_at, s)),
         s.created_at
    from public.job_share s
    join public.partnership p on p.id = s.partnership_id
    join public.jobs j on j.id = s.job_id
    join public.clinics c on c.id = s.owner_org
    left join public.patients pt on pt.id = j.patient_id
   where s.partner_org = public.my_org_id()
     and s.revoked_at is null
     and public.has_perm('jobs.read')
     and (p.status in ('active', 'suspended') or (p.status = 'ended' and p.readonly_until > now()))
$$;

/** The job's thread channel (kind 'too'), made on first use. Owned by the owner side. */
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
  select id into v_id from public.channels where job_id = p_job and kind = 'too';
  if v_id is null then
    select clinic_id into v_org from public.jobs where id = p_job;
    insert into public.channels (clinic_id, kind, job_id, created_by)
    values (v_org, 'too', p_job, case when public.my_org_id() = v_org then auth.uid() end)
    on conflict (job_id) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.channels where job_id = p_job and kind = 'too';
    end if;
    if v_id is null then
      raise exception 'This job already has a non-thread channel attached' using errcode = '22023';
    end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.job_channel(uuid) from public, anon, authenticated;

-- Only a job THREAD carries a job id from now on (existing rows untouched).
do $$ begin
  alter table public.channels add constraint channels_job_is_thread
    check (job_id is null or kind = 'too') not valid;
exception when duplicate_object then null; end $$;

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
               mine boolean, file_id uuid, file_name text, file_type text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_own boolean := public.can_read_own_job(p_job);
  s     public.job_share;
begin
  if not v_own then
    s := public.my_share(p_job);
    if s.id is null then
      raise exception 'Job not found' using errcode = '42501';
    end if;
  end if;
  return query
    select m.id, case when m.deleted_at is null then m.body else '' end, m.author_id,
           pr.full_name, c.name, m.is_question, m.resolved_at, m.created_at, m.edited_at,
           m.author_id = auth.uid(),
           f.id, f.file_name, f.type
      from public.messages m
      join public.channels ch on ch.id = m.channel_id and ch.kind = 'too'
      left join public.profiles pr on pr.id = m.author_id
      left join public.clinics c on c.id = pr.clinic_id
      left join public.job_file f on f.id = m.file_id and f.deleted_at is null
     where ch.job_id = p_job
       and (v_own or public.partner_sees_message(m.author_id, m.created_at, s))
     order by m.created_at;
end;
$$;

create or replace function public.resolve_question(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job     uuid;
  v_author  uuid;
  v_created timestamptz;
  s         public.job_share;
begin
  select ch.job_id, m.author_id, m.created_at into v_job, v_author, v_created
    from public.messages m join public.channels ch on ch.id = m.channel_id and ch.kind = 'too'
   where m.id = p_message and m.is_question;
  if v_job is null then
    raise exception 'Question not found' using errcode = '42501';
  end if;
  if not public.can_read_own_job(v_job) then
    s := public.my_share(v_job);
    if s.id is null or not public.share_is_active(s) or not public.partner_sees_message(v_author, v_created, s) then
      raise exception 'Question not found' using errcode = '42501';
    end if;
  end if;
  update public.messages set resolved_at = now(), resolved_by = auth.uid() where id = p_message and resolved_at is null;
end;
$$;

create or replace function public.open_questions()
returns table (job_id uuid, open_count int)
language sql
stable
security definer
set search_path = public
as $$
  select ch.job_id, count(*)::int
    from public.messages m
    join public.channels ch on ch.id = m.channel_id and ch.kind = 'too'
    join public.jobs j on j.id = ch.job_id
   where j.clinic_id = public.my_org_id() and m.is_question and m.resolved_at is null and m.deleted_at is null
   group by ch.job_id
$$;

-- ── #16 #25 Sharing ─────────────────────────────────────────────────────────

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
    -- Spec: lab work gives the partner PARTIAL visibility. Full visibility is
    -- a referral, with consent — whatever the caller or the partnership asks.
    v_vis := 'partial';
  end if;

  update public.job_share
     set case_type = p_case_type, role = p_role, assigned_stages = coalesce(p_stages, '{}'),
         visibility = v_vis, partner_price = p_partner_price, partnership_id = p.id,
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

-- ── #14 ─────────────────────────────────────────────────────────────────────

create or replace function public.unshare_job(p_job uuid, p_partner_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  v_n   int;
begin
  if not exists (select 1 from public.jobs where id = p_job and clinic_id = v_org) or not public.has_perm('jobs.write') then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  update public.job_share set revoked_at = now()
   where job_id = p_job and partner_org = p_partner_org and revoked_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public.audit(v_org, 'unshare', 'job:' || p_job, jsonb_build_object('partner_org', p_partner_org));
    perform public.audit(p_partner_org, 'unshare', 'job:' || p_job, jsonb_build_object('owner_org', v_org));
  end if;
end;
$$;

-- ── #13 move_job_stage: rights first, then anything about the job ───────────

create or replace function public.move_job_stage(p_job uuid, p_to text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.my_org_id();
  v_owner uuid;
  j       public.jobs;
  s       public.job_share;
begin
  select clinic_id into v_owner from public.jobs where id = p_job;
  if v_owner is null then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  if v_owner = v_org then
    if not public.has_perm('jobs.write') then
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
  if j.status = p_to then
    return p_to;
  end if;
  if not (p_to = any(public.stage_order(j.clinic_id))) then
    raise exception 'Unknown stage %', p_to using errcode = '22023';
  end if;
  if v_owner = v_org then
    if not public.stage_move_allowed(v_org, j.status, p_to, 'owner') then
      raise exception 'Moving from % to % is not allowed', j.status, p_to using errcode = '42501';
    end if;
  else
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

-- ── #9 Ending, pausing, resuming ────────────────────────────────────────────

create or replace function public.set_partnership_status(p_id uuid, p_status text, p_readonly_days int default 90)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.require_admin_mfa();
  p     public.partnership;
  v_paused_by_org uuid;
begin
  select * into p from public.partnership where id = p_id for update;
  if p.id is null or v_org not in (p.org_a, p.org_b) then
    raise exception 'Partnership not found' using errcode = '22023';
  end if;
  select clinic_id into v_paused_by_org from public.profiles where id = p.suspended_by;
  if p_status = 'suspended' and p.status = 'active' then
    update public.partnership set status = 'suspended', suspended_by = auth.uid(), suspended_at = now() where id = p_id;
  elsif p_status = 'active' and p.status = 'suspended' then
    -- Only the side that paused it can resume it.
    if v_paused_by_org is distinct from v_org then
      raise exception 'Only the organisation that paused the partnership can resume it' using errcode = '42501';
    end if;
    update public.partnership set status = 'active', suspended_by = null, suspended_at = null where id = p_id;
  elsif p_status = 'ended' and p.status <> 'ended' then
    -- At most 90 days of read-only access afterwards, whoever ends it.
    update public.partnership
       set status = 'ended', ended_by = auth.uid(), ended_at = now(),
           readonly_until = now() + make_interval(days => least(greatest(coalesce(p_readonly_days, 90), 0), 90))
     where id = p_id;
  else
    raise exception 'Cannot change a % partnership to %', p.status, p_status using errcode = '22023';
  end if;
  perform public.audit(p.org_a, 'partnership', 'partnership:' || p_id, jsonb_build_object('step', p_status));
  perform public.audit(p.org_b, 'partnership', 'partnership:' || p_id, jsonb_build_object('step', p_status));
end;
$$;

-- ── #7 A wrong code typed into "accept" is counted ──────────────────────────

create or replace function public.accept_partnership_invite(
  p_code text,
  p_share_stock boolean,
  p_default_visibility text,
  p_roles text[],
  p_dpa_reference text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.require_admin_mfa();
  v     public.partnership_invite;
  v_id  uuid;
begin
  if coalesce(btrim(p_dpa_reference), '') = '' then
    raise exception 'A reference to the signed data processing agreement is required' using errcode = '22023';
  end if;
  v := public.find_invite(v_org, p_code);
  if v.id is null then
    -- Returning (not raising) keeps the attempt find_invite just recorded:
    -- an exception would roll it back and make wrong codes free.
    return null;
  end if;
  insert into public.partnership (org_a, org_b, share_stock, default_visibility, roles, dpa_reference,
                                  status, accepted_by, accepted_at)
  values (v.org_id, v_org, coalesce(p_share_stock, false), coalesce(p_default_visibility, 'partial'),
          coalesce(p_roles, '{}'), btrim(p_dpa_reference), 'awaiting_inviter', auth.uid(), now())
  returning id into v_id;
  update public.partnership_invite set used_at = now(), used_by_org = v_org where id = v.id;
  perform public.audit(v.org_id, 'partnership', 'partnership:' || v_id, jsonb_build_object('step', 'accepted_by_partner'));
  perform public.audit(v_org, 'partnership', 'partnership:' || v_id, jsonb_build_object('step', 'accepted'));
  return v_id;
end;
$$;

-- ── #17 Upload slots expire with the right to upload ────────────────────────

create or replace function public.upload_slot_open(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.job_file f
     where f.storage_path = p_path and f.uploaded_by = auth.uid()
       and f.completed_at is null and f.deleted_at is null
       and f.uploaded_at > now() - interval '1 day'
       and public.may_upload_job_file(f.job_id, f.type))
$$;

create or replace function public.preview_slot_open(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.job_file f
     where f.preview_path = p_path and f.uploaded_by = auth.uid()
       and f.preview_ready_at is null and f.deleted_at is null
       and f.uploaded_at > now() - interval '1 day'
       and public.may_upload_job_file(f.job_id, f.type))
$$;

-- ── #19 Previews are a view on both sides ───────────────────────────────────

create or replace function public.request_job_previews(p_job uuid)
returns table (file_id uuid, preview_path text)
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  if not public.may_read_job_files(p_job) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  select clinic_id into v_owner from public.jobs where id = p_job;
  insert into public.file_download_grant (org_id, user_id, storage_path)
  select public.my_org_id(), auth.uid(), f.preview_path
    from public.job_file f
   where f.job_id = p_job and f.deleted_at is null and f.preview_ready_at is not null;
  perform public.audit(v_owner, 'view', 'job:' || p_job, jsonb_build_object('previews', true, 'by_org', public.my_org_id()));
  if public.my_org_id() <> v_owner then
    perform public.audit(public.my_org_id(), 'view', 'job:' || p_job, jsonb_build_object('previews', true));
  end if;
  return query
    select f.id, f.preview_path from public.job_file f
     where f.job_id = p_job and f.deleted_at is null and f.preview_ready_at is not null;
end;
$$;

-- ── #11 #26 Chat membership follows the clinic; observers only watch ────────

create or replace function public.in_channel(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channel_members cm join public.channels c on c.id = cm.channel_id
     where cm.channel_id = cid and cm.profile_id = auth.uid() and c.clinic_id = public.my_clinic_id()
  )
$$;

create or replace function public.can_post(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channel_members cm join public.channels c on c.id = cm.channel_id
     where cm.channel_id = cid and cm.profile_id = auth.uid() and cm.role <> 'vaatleja'
       and c.clinic_id = public.my_clinic_id()
  )
$$;

drop policy if exists "channel_members_insert" on public.channel_members;
create policy "channel_members_insert" on public.channel_members
  for insert with check (
    (public.can_post(channel_id) or profile_id = auth.uid())
    and exists (select 1 from public.channels c where c.id = channel_id and c.clinic_id = public.my_clinic_id())
    and exists (select 1 from public.profiles p where p.id = profile_id and p.clinic_id = public.my_clinic_id())
  );

drop policy if exists "channel_members_delete" on public.channel_members;
create policy "channel_members_delete" on public.channel_members
  for delete using (profile_id = auth.uid() or public.can_post(channel_id));

-- ── #21 Internal helpers are not an API ─────────────────────────────────────
-- Used only inside other SECURITY DEFINER functions, which run with their
-- owner's rights. The helpers RLS policies call (can_read_own_job, in_channel,
-- can_post, the *_slot_open functions, clinic_has_members,
-- profile_in_my_clinic) must stay callable and are not in this list.

revoke execute on function public.invite_attempts_left(uuid) from public, anon, authenticated;
revoke execute on function public.stage_order(uuid) from public, anon, authenticated;
revoke execute on function public.next_stage(uuid, text) from public, anon, authenticated;
revoke execute on function public.stage_move_allowed(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.share_is_active(public.job_share) from public, anon, authenticated;
revoke execute on function public.my_share(uuid) from public, anon, authenticated;
revoke execute on function public.may_read_job_files(uuid) from public, anon, authenticated;
revoke execute on function public.may_upload_job_file(uuid, text) from public, anon, authenticated;
revoke execute on function public.may_use_job_thread(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.partner_sees_message(uuid, timestamptz, public.job_share) from public, anon, authenticated;
revoke execute on function public.free_code_prefix(text, uuid) from public, anon, authenticated;
