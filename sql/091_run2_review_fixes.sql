-- ============================================================================
-- Wivo — migration 091: fixes from the independent review of 089 and 090
-- Run AFTER sql/090. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- 1. Push endpoints: only the real push services, written only through
--    save_push_subscription. Any "https://…" string was accepted (and a
--    direct INSERT took anything), so one bad row made the sender throw and
--    stopped phone push for every organisation — or pointed it at any URL.
--    An endpoint already registered to another account is no longer taken
--    over; at most 10 phones per person.
-- 2. A deleted job cannot be shared again (the partner saw it, the owner could
--    not see or end the share), cannot be marked deleted by an UPDATE (that
--    skipped ending the shares), and takes no new files.
-- 3. deleted_jobs() / restore_job(): only jobs the caller could read before
--    the delete. `jobs.write` alone showed every deleted patient name.
-- 4. Files added: one notification per job per burst (10 minutes, while
--    unread), not one per photo — 15 photos were 15 e-mails per person.
-- 5. pending_pushes() comes ordered by notification, so the sender knows
--    which one a full batch cut short.
-- ============================================================================

-- ── 1. Push endpoints ───────────────────────────────────────────────────────

/** Chrome/Edge-on-Android/Samsung (FCM), Firefox, Safari/iOS, Edge on Windows. */
create or replace function public.is_push_endpoint(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p ~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(:[0-9]+)?/', false)
     and length(p) <= 1000
$$;

delete from public.push_subscription where not public.is_push_endpoint(endpoint);
alter table public.push_subscription drop constraint if exists push_subscription_endpoint_known;
alter table public.push_subscription add constraint push_subscription_endpoint_known
  check (public.is_push_endpoint(endpoint) and length(p256dh) <= 200 and length(auth) <= 200);

-- Read and delete your own rows (lib/push.ts); write only through the RPC.
revoke insert, update on public.push_subscription from anon, authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.my_org_id() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.is_push_endpoint(p_endpoint) then
    raise exception 'Not a push endpoint' using errcode = '22023';
  end if;
  if exists (select 1 from public.push_subscription where endpoint = p_endpoint and user_id <> auth.uid()) then
    -- The app asks the browser for a fresh endpoint every time push is
    -- switched on, so a real phone never lands here.
    raise exception 'This endpoint belongs to another account' using errcode = '42501';
  end if;
  insert into public.push_subscription (org_id, user_id, endpoint, p256dh, auth, user_agent)
  values (public.my_org_id(), auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set org_id = excluded.org_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now()
  where public.push_subscription.user_id = auth.uid();
  delete from public.push_subscription
   where user_id = auth.uid()
     and id not in (select id from public.push_subscription where user_id = auth.uid() order by created_at desc limit 10);
end;
$$;

-- ── 2. A deleted job stays out of reach ─────────────────────────────────────

create or replace function public.refuse_share_of_deleted_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.revoked_at is null and exists (select 1 from public.jobs where id = new.job_id and deleted_at is not null) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists refuse_share_of_deleted_job on public.job_share;
create trigger refuse_share_of_deleted_job before insert or update on public.job_share
  for each row execute function public.refuse_share_of_deleted_job();

create or replace function public.refuse_file_on_deleted_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and exists (select 1 from public.jobs where id = new.job_id and deleted_at is not null) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists refuse_file_on_deleted_job on public.job_file;
create trigger refuse_file_on_deleted_job before insert on public.job_file
  for each row execute function public.refuse_file_on_deleted_job();

-- Deleting is a DELETE (soft_delete_job ends the shares and audits it); an
-- UPDATE may not set deleted_at.
drop policy if exists "jobs_update" on public.jobs;
create policy "jobs_update" on public.jobs
  for update using (clinic_id = public.my_clinic_id() and deleted_at is null and public.has_perm('jobs.write'))
  with check (clinic_id = public.my_clinic_id() and deleted_at is null and public.has_perm('jobs.write'));

-- ── 3. Deleted jobs: only what the caller could read ────────────────────────

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
     and (public.has_perm('jobs.read') or public.job_is_mine(j.assigned_to, j.designed_by, j.work_items))
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
     or not exists (select 1 from public.jobs j
                     where j.id = p_job and j.clinic_id = v_org and j.deleted_at is not null
                       and (public.has_perm('jobs.read') or public.job_is_mine(j.assigned_to, j.designed_by, j.work_items))) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  update public.jobs set deleted_at = null, deleted_by = null where id = p_job;
  perform public.audit(v_org, 'restore', 'job:' || p_job, '{}'::jsonb);
end;
$$;

-- ── 4. Files added: one notification per burst ──────────────────────────────

create or replace function public.on_file_added_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s record; v_to uuid;
begin
  if old.completed_at is not null or new.completed_at is null then
    return new;
  end if;
  for s in
    select js.partner_org, js.owner_org from public.job_share js
      join public.partnership p on p.id = js.partnership_id
     where js.job_id = new.job_id and js.revoked_at is null and p.status = 'active'
  loop
    v_to := case when new.uploaded_by_org = s.owner_org then s.partner_org
                 when new.uploaded_by_org = s.partner_org then s.owner_org end;
    if v_to is not null and not exists (
      select 1 from public.notification n
       where n.org_id = v_to and n.job_id = new.job_id and n.kind = 'files_added'
         and n.read_at is null and n.created_at > now() - interval '10 minutes'
    ) then
      perform public.notify_org(v_to, new.job_id, 'files_added', jsonb_build_object('type', new.type));
    end if;
  end loop;
  return new;
end;
$$;

-- ── 5. Pending pushes come grouped by notification ─────────────────────────
-- Ties on created_at (one notify_org call) interleaved notifications, so the
-- sender could not tell which one a full batch had cut short.

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
   where n.pushed_at is null and n.read_at is null and n.created_at > now() - interval '1 hour'
   order by n.created_at, n.id
   limit p_limit
$$;
revoke execute on function public.pending_pushes(int) from public, anon, authenticated;
