-- ============================================================================
-- Wivo — migration 085: fixes from the second review (of 080–084)
-- Run AFTER sql/084. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- A second independent review read 080–084 (themselves fixes) and confirmed
-- these against the real migrations. Each is a test in
-- sql/test/secondReview.test.ts. Numbers follow docs/night-run/review-080-084.md.
--
-- 1. The 10-minute "new signup" window (083) was open to ANY owner — and
--    anyone can found a clinic in three calls, and a removed owner kept the
--    role. Now: only an owner who is IN a clinic, only for 2 minutes (the app
--    links within seconds), and nobody but the person themselves may change a
--    clinic-less profile except to link it. Invite tokens remain the real fix.
-- 2. `can_manage_payroll` still counted a grant from another clinic, and such
--    a stale row blocked the rightful owner's grant (unique per person and
--    permission, invisible to that owner). It counts only its own clinic now,
--    and granting replaces a stale row from another clinic.
-- 3. A partner's view of the thread used the author's CURRENT organisation:
--    someone who moved between partners took their old messages along, and
--    owner staff who left vanished. The author's organisation is now stored
--    on the message when it is written. After a partnership ends the partner
--    sees nothing written after the end.
-- 4. open_questions() answered for jobs the caller cannot see.
-- 5. Job number 10 000 in a year collided with number 1 000 (lpad truncates)
--    and every insert after it failed.
-- 6. A job code's year came from the client's created_at (any century, same
--    two digits), and a restore by INSERT from the SQL editor renumbered jobs.
--    New jobs take the year from now(); an insert with no user (restore,
--    service role) keeps the code it brings.
-- 7. Any old non-thread channel carrying a job id is detached, and the
--    "only a thread has a job id" rule is now enforced on every row.
-- 8. Resuming a pause depended on the pausing admin still being a member:
--    the pausing ORGANISATION is recorded.
-- 9. A removed worker still saw the names of channels they had created.
-- ============================================================================

-- ── 1 ───────────────────────────────────────────────────────────────────────

drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select using (
    id = auth.uid()
    or clinic_id = public.my_clinic_id()
    or (clinic_id is null and removed_from = public.my_clinic_id())
    or (clinic_id is null and removed_from is null and role = 'worker'
        and created_at > now() - interval '2 minutes'
        and public.my_role() = 'owner' and public.my_clinic_id() is not null)
  );

drop policy if exists "profiles_update_clinic_owner" on public.profiles;
create policy "profiles_update_clinic_owner" on public.profiles
  for update using (
    public.my_role() = 'owner' and public.my_clinic_id() is not null and (
      clinic_id = public.my_clinic_id()
      or (clinic_id is null and (
            removed_from = public.my_clinic_id()
            or (removed_from is null and created_at > now() - interval '2 minutes')))
    )
  );

/**
 * 083's guard plus one rule: nobody but the person themselves edits a
 * clinic-less profile, except to link it (rule 3). Before, an owner could
 * rename or re-username any fresh signup in their sight.
 */
create or replace function public.guard_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_clin uuid;
  v_role text;
begin
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.clinic_id := null;
    new.role := 'worker';
    new.org_role := null;
    new.removed_from := null;
    new.created_at := now();
    return new;
  end if;

  new.created_at := old.created_at;

  if new.id <> v_uid and old.clinic_id is null and new.clinic_id is null then
    raise exception 'Not allowed to change this profile' using errcode = '42501';
  end if;

  if new.role is not distinct from old.role
     and new.org_role is not distinct from old.org_role
     and new.clinic_id is not distinct from old.clinic_id
     and new.removed_from is not distinct from old.removed_from then
    return new;
  end if;

  select clinic_id, role into v_clin, v_role from public.profiles where id = v_uid;

  if new.id = v_uid and old.clinic_id is null and new.clinic_id is not null
     and old.removed_from is distinct from new.clinic_id
     and exists (select 1 from public.clinics c where c.id = new.clinic_id and c.created_by = v_uid)
     and not public.clinic_has_members(new.clinic_id) then
    new.role := 'owner';
    new.org_role := 'owner';
    new.removed_from := null;
    return new;
  end if;

  if v_role = 'owner' and v_clin is not null and new.id <> v_uid
     and new.role is not distinct from old.role then
    if old.clinic_id = v_clin and new.clinic_id is null then
      new.removed_from := v_clin;
      return new;
    end if;
    if old.clinic_id is null and new.clinic_id = v_clin
       and (old.removed_from = v_clin
            or (old.removed_from is null and old.created_at > now() - interval '1 hour')) then
      new.removed_from := null;
      new.role := 'worker';
      if new.org_role is null or new.org_role = 'owner' then
        new.org_role := 'technician';
      end if;
      return new;
    end if;
  end if;

  if v_role = 'owner' and new.id <> v_uid
     and old.clinic_id = v_clin and new.clinic_id is not distinct from old.clinic_id
     and old.role in ('owner', 'worker') and new.role in ('owner', 'worker')
     and new.removed_from is not distinct from old.removed_from then
    if new.org_role is distinct from old.org_role then
      new.role := case when new.org_role = 'owner' then 'owner' else 'worker' end;
    elsif new.role is distinct from old.role then
      new.org_role := case when new.role = 'owner' then 'owner' else 'technician' end;
    end if;
    return new;
  end if;

  raise exception 'Not allowed to change role or clinic of this profile'
    using errcode = '42501';
end;
$$;

-- ── 2 ───────────────────────────────────────────────────────────────────────

create or replace function public.can_manage_payroll()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role() = 'owner'
      or exists (
        select 1 from public.worker_permissions
         where profile_id = auth.uid()
           and clinic_id = public.my_clinic_id()
           and permission = 'payroll.manage'
           and granted
      )
$$;

/**
 * A grant row from another clinic (or a clinic the person has left) for the
 * same person and permission would make the rightful owner's grant fail on
 * the unique key, invisibly. The owner's grant replaces it.
 */
create or replace function public.replace_stale_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.worker_permissions
   where profile_id = new.profile_id and permission = new.permission
     and clinic_id is distinct from new.clinic_id;
  return new;
end;
$$;

drop trigger if exists replace_stale_grant on public.worker_permissions;
create trigger replace_stale_grant before insert on public.worker_permissions
  for each row execute function public.replace_stale_grant();

-- ── 3 ───────────────────────────────────────────────────────────────────────

alter table public.messages add column if not exists author_org uuid references public.clinics(id) on delete set null;

update public.messages m set author_org = p.clinic_id
  from public.profiles p where p.id = m.author_id and m.author_org is null;

create or replace function public.stamp_message_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_org := (select clinic_id from public.profiles where id = new.author_id);
  return new;
end;
$$;

drop trigger if exists stamp_message_org on public.messages;
create trigger stamp_message_org before insert on public.messages
  for each row execute function public.stamp_message_org();

/**
 * A message the partner of share `s` may see: written by the partner's or the
 * owner's organisation (as they were WHEN they wrote it), after the share was
 * made, and — once the partnership has ended — before it ended.
 */
create or replace function public.partner_sees(p_author_org uuid, p_created timestamptz, s public.job_share)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_created >= s.created_at
     and p_author_org in (s.partner_org, s.owner_org)
     and not exists (select 1 from public.partnership p
                      where p.id = s.partnership_id and p.ended_at is not null and p_created > p.ended_at)
$$;
revoke execute on function public.partner_sees(uuid, timestamptz, public.job_share) from public, anon, authenticated;

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
      left join public.clinics c on c.id = m.author_org
      left join public.job_file f on f.id = m.file_id and f.deleted_at is null
     where ch.job_id = p_job
       and (v_own or public.partner_sees(m.author_org, m.created_at, s))
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
  v_org     uuid;
  v_created timestamptz;
  s         public.job_share;
begin
  select ch.job_id, m.author_org, m.created_at into v_job, v_org, v_created
    from public.messages m join public.channels ch on ch.id = m.channel_id and ch.kind = 'too'
   where m.id = p_message and m.is_question;
  if v_job is null then
    raise exception 'Question not found' using errcode = '42501';
  end if;
  if not public.can_read_own_job(v_job) then
    s := public.my_share(v_job);
    if s.id is null or not public.share_is_active(s) or not public.partner_sees(v_org, v_created, s) then
      raise exception 'Question not found' using errcode = '42501';
    end if;
  end if;
  update public.messages set resolved_at = now(), resolved_by = auth.uid() where id = p_message and resolved_at is null;
end;
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
             and m.deleted_at is null and public.partner_sees(m.author_org, m.created_at, s)),
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

-- ── 4 ───────────────────────────────────────────────────────────────────────

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
   where j.clinic_id = public.my_org_id() and public.can_read_own_job(j.id)
     and m.is_question and m.resolved_at is null and m.deleted_at is null
   group by ch.job_id
$$;

-- ── 5 + 6 ───────────────────────────────────────────────────────────────────

create or replace function public.next_job_code(p_org uuid, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from coalesce(p_at, now()))::int;
  v_n    int;
begin
  insert into public.job_code_counter (org_id, year, last) values (p_org, v_year, 1)
  on conflict (org_id, year) do update set last = public.job_code_counter.last + 1
  returning last into v_n;
  -- lpad would TRUNCATE 10 000 to "1000"; past four digits the number grows.
  return (select code_prefix from public.clinics where id = p_org)
         || '-' || lpad((v_year % 100)::text, 2, '0') || '-'
         || case when v_n < 10000 then lpad(v_n::text, 4, '0') else v_n::text end;
end;
$$;
revoke execute on function public.next_job_code(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.set_job_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- No user (SQL editor, service role, a restore): keep the code it brings.
    if auth.uid() is null and new.job_code is not null then
      return new;
    end if;
    -- The year is today's, not whatever created_at the client sent.
    new.job_code := case when new.clinic_id is not null then public.next_job_code(new.clinic_id, now()) end;
  else
    new.job_code := coalesce(old.job_code,
      case when new.clinic_id is not null then public.next_job_code(new.clinic_id, now()) end);
  end if;
  return new;
end;
$$;

-- ── 7 ───────────────────────────────────────────────────────────────────────

update public.channels set job_id = null where job_id is not null and kind <> 'too';
alter table public.channels validate constraint channels_job_is_thread;

-- ── 8 ───────────────────────────────────────────────────────────────────────

alter table public.partnership add column if not exists suspended_by_org uuid references public.clinics(id) on delete set null;

update public.partnership p set suspended_by_org = pr.clinic_id
  from public.profiles pr
 where pr.id = p.suspended_by and p.status = 'suspended' and p.suspended_by_org is null;

create or replace function public.set_partnership_status(p_id uuid, p_status text, p_readonly_days int default 90)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.require_admin_mfa();
  p     public.partnership;
begin
  select * into p from public.partnership where id = p_id for update;
  if p.id is null or v_org not in (p.org_a, p.org_b) then
    raise exception 'Partnership not found' using errcode = '22023';
  end if;
  if p_status = 'suspended' and p.status = 'active' then
    update public.partnership
       set status = 'suspended', suspended_by = auth.uid(), suspended_by_org = v_org, suspended_at = now()
     where id = p_id;
  elsif p_status = 'active' and p.status = 'suspended' then
    if p.suspended_by_org is distinct from v_org then
      raise exception 'Only the organisation that paused the partnership can resume it' using errcode = '42501';
    end if;
    update public.partnership
       set status = 'active', suspended_by = null, suspended_by_org = null, suspended_at = null
     where id = p_id;
  elsif p_status = 'ended' and p.status <> 'ended' then
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

-- ── 9 ───────────────────────────────────────────────────────────────────────

drop policy if exists "channels_select" on public.channels;
create policy "channels_select" on public.channels
  for select using (
    public.in_channel(id)
    or (created_by = auth.uid() and clinic_id = public.my_clinic_id())
  );
