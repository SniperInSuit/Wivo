-- ============================================================================
-- Wivo — migration 083: fixes for what is live on production today
-- Run AFTER sql/082. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- An independent review of sql/068–079 (docs/night-run/review-068-079.md)
-- found these, each confirmed against the real migrations. This file is the
-- part that affects the app people use NOW; partner-side fixes are sql/084.
--
-- 1. "ADD WORKER" SILENTLY DID NOTHING (since 068). The app links a new
--    worker with `update profiles set clinic_id … where id = <new user>`.
--    068 hid clinic-less users from everyone, and an UPDATE only reaches rows
--    its caller can SELECT — so 0 rows changed, no error, and the new worker
--    landed in the clinic-setup screen. Owners can again see a brand-new,
--    never-linked signup for ten minutes, which is all the app needs (it links
--    within seconds). The 1-hour guard rule still decides what may happen to
--    the row; and nobody can now move their own `created_at` to stay "new".
--    To replace with owner-issued invite tokens before several organisations
--    sign up on their own (MORNING.md).
--
-- 2. PERMISSIONS FROM ANOTHER CLINIC COUNTED. `has_perm` asked only "is there
--    a grant for me", not "from my clinic", and an owner could write a grant
--    for any profile id. A worker could open a second account, found a clinic
--    and grant themselves `patients.read` — then read their real clinic's
--    patients. Grants now count only in the clinic they were made in, and an
--    owner can grant only to people in their own clinic.
--
-- 3. DELETING A WORKER FAILED once they had an audit row (any board move since
--    078). Deleting a user sets audit_log.user_id to NULL — an UPDATE, which
--    the append-only trigger refused. That one change is now allowed, and
--    only that one: GDPR erasure must work, history must not change.
--
-- 4. FOUNDING A CLINIC FAILED on a code-prefix clash ("Tallinna Labor" next to
--    "Tallinn", or any two non-Latin names): the prefix picker ran with the
--    founder's rights and could not see other clinics. It runs as definer now,
--    and nobody can change a prefix from the app (it is in every job code).
--
-- 5. A REMOVED FOUNDER COULD REJOIN AS OWNER (founding only checked
--    `created_by`), and kept reading the clinic row while removed. Founding is
--    now only into a clinic with no members yet. A re-added former owner comes
--    back as a worker.
--
-- 6. A job that gets its clinic later (adopted by hand) now gets a job code.
-- ============================================================================

-- ── 2. Permissions count only in their own clinic ───────────────────────────

create or replace function public.has_perm(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when public.my_role() = 'owner' then true
    when public.my_role() = 'patient' then perm = 'visits.read'
    else exists (
      select 1 from public.worker_permissions
       where profile_id = auth.uid()
         and clinic_id = public.my_clinic_id()
         and permission = perm
         and granted
    )
  end
$$;

/** Is this profile a member of the caller's clinic? (For policies on other tables.) */
create or replace function public.profile_in_my_clinic(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = p_profile and clinic_id = public.my_clinic_id())
$$;

drop policy if exists "perms_owner_all" on public.worker_permissions;
create policy "perms_owner_all" on public.worker_permissions
  for all using (
    clinic_id = (select clinic_id from public.profiles where id = auth.uid() and role = 'owner')
  ) with check (
    clinic_id = (select clinic_id from public.profiles where id = auth.uid() and role = 'owner')
    and public.profile_in_my_clinic(profile_id)
  );

-- ── 1 + 5. Profiles: the new-worker window, and founding ────────────────────

/** Does this clinic have any member yet? Founding is only into one that does not. */
create or replace function public.clinic_has_members(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.profiles where clinic_id = p_clinic) $$;

drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select using (
    id = auth.uid()
    or clinic_id = public.my_clinic_id()
    or (clinic_id is null and removed_from = public.my_clinic_id())
    -- An owner linking the worker they have just created (see 1 above).
    or (clinic_id is null and removed_from is null and role = 'worker'
        and created_at > now() - interval '10 minutes' and public.my_role() = 'owner')
  );

drop policy if exists "clinic_read" on public.clinics;
create policy "clinic_read" on public.clinics
  for select using (
    id = public.my_clinic_id()
    -- The founder reads back the clinic they just made — until it has members.
    or (created_by = auth.uid() and not public.clinic_has_members(id))
  );

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

  -- Nobody moves their own (or anyone's) sign-up time: "new for ten minutes"
  -- (profiles_read) and "new for an hour" (rule 3) depend on it.
  new.created_at := old.created_at;

  if new.role is not distinct from old.role
     and new.org_role is not distinct from old.org_role
     and new.clinic_id is not distinct from old.clinic_id
     and new.removed_from is not distinct from old.removed_from then
    return new;
  end if;

  select clinic_id, role into v_clin, v_role from public.profiles where id = v_uid;

  -- 1. Founding: your own row, from no clinic, into a clinic YOU created that
  --    has no members yet — and not back into one you were removed from.
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
    -- 2. Removing.
    if old.clinic_id = v_clin and new.clinic_id is null then
      new.removed_from := v_clin;
      return new;
    end if;
    -- 3. Adding: someone this clinic removed, or a signup of the last hour.
    --    Always as a worker — rank is a separate, deliberate change (rule 4).
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

  -- 4. Rank within the clinic, set by an owner for someone else.
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

-- ── 3. Audit log: erasure may null the user, nothing else changes ───────────

create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- Deleting a user sets user_id to NULL (on delete set null): allowed,
    -- and only that — every other column must stay exactly as it was.
    if new.user_id is null and old.user_id is not null
       and new.id = old.id and new.org_id = old.org_id and new.action = old.action
       and new.object = old.object and new.detail = old.detail and new.at = old.at then
      return new;
    end if;
    raise exception 'audit_log is append-only' using errcode = '42501';
  end if;
  if auth.uid() is not null then
    raise exception 'audit_log is append-only' using errcode = '42501';
  end if;
  return old;  -- a DELETE with no user: an organisation being removed (cascade)
end;
$$;

revoke truncate on public.audit_log from anon, authenticated;

-- ── 4. Code prefixes: chosen with full sight, never changed from the app ────

alter function public.free_code_prefix(text, uuid) security definer;
alter function public.set_code_prefix() security definer;

create or replace function public.guard_code_prefix()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and new.code_prefix is distinct from old.code_prefix then
    new.code_prefix := old.code_prefix;  -- printed in every job code: change it in the SQL editor
  end if;
  return new;
end;
$$;

drop trigger if exists guard_code_prefix on public.clinics;
create trigger guard_code_prefix before update of code_prefix on public.clinics
  for each row execute function public.guard_code_prefix();

-- ── 6. A job that gets its clinic later gets a code ─────────────────────────

create or replace function public.set_job_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.job_code := case when new.clinic_id is not null
                         then public.next_job_code(new.clinic_id, coalesce(new.created_at, now())) end;
  else
    -- Never changes once given; given once the job has a clinic.
    new.job_code := coalesce(old.job_code,
      case when new.clinic_id is not null then public.next_job_code(new.clinic_id, now()) end);
  end if;
  return new;
end;
$$;

drop trigger if exists set_job_code on public.jobs;
create trigger set_job_code before insert or update of job_code, clinic_id on public.jobs
  for each row execute function public.set_job_code();
