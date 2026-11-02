-- ============================================================================
-- Wivo — migration 090: what the phone app needs from the database
-- Run AFTER sql/089. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec, Phase 1b: "push notifications (on iPhone after adding to the home
-- screen), e-mail as fallback"; acceptance: "a photo taken on the phone
-- reaches the job AND THE OTHER SIDE'S NOTIFICATION in under a minute".
--
-- 1. `push_subscription`: one row per browser that allowed notifications.
--    Each user sees and removes only their own. The sender (Edge Function,
--    service role) reads them through `pending_pushes()`.
-- 2. A finished upload on a shared job tells the other side (`files_added`):
--    the owner's photo reaches the partner, the partner's print file reaches
--    the owner ("files ready for print" in wivo-2.0-spec.md, Sounds).
-- 3. `notification.pushed_at`, so each notification is pushed once.
--
-- A push carries NO content: it wakes the phone, which shows "New in Wivo"
-- and opens the app; the details are read after sign-in, under RLS. Nothing
-- about a patient or a job leaves through the push service.
-- ============================================================================

create table if not exists public.push_subscription (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.clinics(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subscription_user_idx on public.push_subscription (user_id);
alter table public.push_subscription enable row level security;

drop policy if exists "push_subscription_own" on public.push_subscription;
create policy "push_subscription_own" on public.push_subscription
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and org_id = public.my_org_id());

/** Register this browser (or refresh its keys). */
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
  if p_endpoint !~ '^https://' then
    raise exception 'Not a push endpoint' using errcode = '22023';
  end if;
  insert into public.push_subscription (org_id, user_id, endpoint, p256dh, auth, user_agent)
  values (public.my_org_id(), auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set org_id = excluded.org_id, user_id = excluded.user_id, p256dh = excluded.p256dh,
        auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;

-- ── Notifications: files added, and push bookkeeping ────────────────────────

alter table public.notification add column if not exists pushed_at timestamptz;
alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added'));

/** A finished upload on a shared job tells the side that did not upload it. */
create or replace function public.on_file_added_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s record;
begin
  if old.completed_at is not null or new.completed_at is null then
    return new;
  end if;
  for s in
    select js.partner_org, js.owner_org from public.job_share js
      join public.partnership p on p.id = js.partnership_id
     where js.job_id = new.job_id and js.revoked_at is null and p.status = 'active'
  loop
    if new.uploaded_by_org = s.owner_org then
      perform public.notify_org(s.partner_org, new.job_id, 'files_added', jsonb_build_object('type', new.type));
    elsif new.uploaded_by_org = s.partner_org then
      perform public.notify_org(s.owner_org, new.job_id, 'files_added', jsonb_build_object('type', new.type));
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists file_added_notify on public.job_file;
create trigger file_added_notify after update of completed_at on public.job_file
  for each row execute function public.on_file_added_notify();

-- ── For the sender (Edge Function, service role) ────────────────────────────

/** Notifications not yet pushed (last hour), with every subscription of their user. */
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
   order by n.created_at
   limit p_limit
$$;
revoke execute on function public.pending_pushes(int) from public, anon, authenticated;

create or replace function public.mark_pushed(p_notifications uuid[], p_ok_subscriptions uuid[], p_gone_subscriptions uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification set pushed_at = now() where id = any(p_notifications);
  update public.push_subscription set last_ok_at = now() where id = any(p_ok_subscriptions);
  -- 404/410 from the push service: the browser unsubscribed or the phone was reset.
  delete from public.push_subscription where id = any(p_gone_subscriptions);
$$;
revoke execute on function public.mark_pushed(uuid[], uuid[], uuid[]) from public, anon, authenticated;
