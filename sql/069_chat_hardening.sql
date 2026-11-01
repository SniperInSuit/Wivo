-- ============================================================================
-- Wivo — migration 069: chat, finished for Phase 1
-- Run AFTER sql/068. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- The chat schema (065–067) had no user interface yet, so nothing had leaned
-- on its rules. The Phase 0 inventory (docs/night-run/chat-inventory.md) ran
-- them as two tenants and found six gaps, each a failing test in
-- sql/test/chat.test.ts before this file:
--
-- 1. A member could add a user of ANOTHER clinic to their channel, handing
--    that user every message in it. Members now come from the channel's own
--    clinic only. A partner reaches a shared job's thread through the partner
--    RPCs (Phase 1), never through membership.
-- 2. A channel could be opened for another clinic's job. `job_id` is unique,
--    so that also blocked the real clinic from ever opening one: a denial of
--    service with one insert. The job must now be one you can see.
-- 3. A message could be tagged with another clinic's job id. Same check.
-- 4. A member could promote their own membership from observer to member.
-- 5. An observer ('vaatleja') could post. The role existed but meant nothing.
-- 6. Whoever created a channel could not read it back until they had added
--    themselves, so `insert … returning` (what supabase-js does) failed.
--
-- Also: `messages_update` gets an explicit WITH CHECK. Moving a message to
-- another channel was already refused (the new row fails the select rule), but
-- by accident of semantics; this says it on purpose.
-- ============================================================================

/** Members who may write in a channel: in it, and not just watching it. */
create or replace function public.can_post(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channel_members
     where channel_id = cid and profile_id = auth.uid() and role <> 'vaatleja'
  )
$$;

drop policy if exists "channels_select" on public.channels;
create policy "channels_select" on public.channels
  for select using (public.in_channel(id) or created_by = auth.uid());

drop policy if exists "channels_insert" on public.channels;
create policy "channels_insert" on public.channels
  for insert with check (
    clinic_id = public.my_clinic_id()
    and created_by = auth.uid()
    -- jobs' own RLS answers "is this a job I can see": own clinic, readable.
    and (job_id is null or exists (select 1 from public.jobs j where j.id = job_id))
  );

drop policy if exists "channel_members_insert" on public.channel_members;
create policy "channel_members_insert" on public.channel_members
  for insert with check (
    (public.in_channel(channel_id) or profile_id = auth.uid())
    and exists (
      select 1 from public.channels c
       where c.id = channel_id and c.clinic_id = public.my_clinic_id())
    and exists (
      select 1 from public.profiles p
       where p.id = profile_id and p.clinic_id = public.my_clinic_id())
  );

drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages
  for insert with check (public.can_post(channel_id) and author_id = auth.uid());

drop policy if exists "messages_update" on public.messages;
create policy "messages_update" on public.messages
  for update using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.in_channel(channel_id));

drop policy if exists "message_jobs_insert" on public.message_jobs;
create policy "message_jobs_insert" on public.message_jobs
  for insert with check (
    exists (select 1 from public.messages m where m.id = message_id and m.author_id = auth.uid())
    and exists (select 1 from public.jobs j where j.id = job_id)
  );

/**
 * What a member may change on their own membership row: when they last read
 * it. Not which channel it is, not who it is, not their role in it.
 */
create or replace function public.guard_channel_member_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.channel_id is distinct from old.channel_id
     or new.profile_id is distinct from old.profile_id
     or new.role is distinct from old.role
     or new.joined_at is distinct from old.joined_at then
    raise exception 'Only last_read_at can be changed on a membership'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_channel_member_change on public.channel_members;
create trigger guard_channel_member_change
  before update on public.channel_members
  for each row execute function public.guard_channel_member_change();
