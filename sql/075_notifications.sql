-- ============================================================================
-- Wivo — migration 075: notifications
-- Run AFTER sql/074. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- Then sql/076 (realtime) and sql/077 (e-mail cron) — separate files on
-- purpose, see their headers.
-- ============================================================================
--
-- Spec, Phase 1: "Notifications: realtime badges, e-mail via Resend (only the
-- code and a link). Sent to the other side on a handover; the user picks the
-- channels." Acceptance: "a newly shared job makes a badge and an e-mail in
-- Riga in under a minute".
--
-- What notifies whom — always THE OTHER SIDE, never the person who acted:
--   job shared              → every member of the partner organisation
--   stage handed over       → the side the job moves to (owner ↔ partner)
--   question asked          → the other side of the job
--
-- A row says only what happened and to which job (id + code). No patient
-- field is ever copied into it: the e-mail is built from this row alone, and
-- "only the code and a link" has to be true of the data, not just the template.
-- ============================================================================

alter table public.profiles
  add column if not exists notify_email boolean not null default true;

create table if not exists public.notification (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.clinics(id) on delete cascade,   -- the recipient's
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      uuid references public.jobs(id) on delete cascade,
  job_code    text,
  kind        text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  emailed_at  timestamptz,
  constraint notification_kind_valid check (kind in ('job_shared', 'stage_handover', 'question'))
);
create index if not exists notification_user_unread_idx on public.notification (user_id, created_at desc) where read_at is null;
create index if not exists notification_email_pending_idx on public.notification (created_at) where emailed_at is null;

alter table public.notification enable row level security;
drop policy if exists "notification_select" on public.notification;
create policy "notification_select" on public.notification
  for select using (user_id = auth.uid());
-- Marking read goes through mark_notifications_read(); nothing else is writable.

/** Members of an organisation who get notifications (not patients, not the actor). */
create or replace function public.notify_org(p_org uuid, p_job uuid, p_kind text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notification (org_id, user_id, job_id, job_code, kind, detail)
  select p_org, p.id, p_job, (select job_code from public.jobs where id = p_job), p_kind, coalesce(p_detail, '{}'::jsonb)
    from public.profiles p
   where p.clinic_id = p_org and p.role in ('owner', 'worker')
     and p.id is distinct from auth.uid()
$$;
revoke execute on function public.notify_org(uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
$$;

create or replace function public.set_notify_email(p_on boolean)
returns void
language sql
security definer
set search_path = public
as $$ update public.profiles set notify_email = coalesce(p_on, true) where id = auth.uid() $$;

-- ── Triggers: who is told what ──────────────────────────────────────────────

create or replace function public.on_job_share_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or (old.revoked_at is not null and new.revoked_at is null) then
    perform public.notify_org(new.partner_org, new.job_id, 'job_shared',
      jsonb_build_object('from_org', (select name from public.clinics where id = new.owner_org),
                         'stages', new.assigned_stages, 'role', new.role));
  end if;
  return new;
end;
$$;

drop trigger if exists job_share_notify on public.job_share;
create trigger job_share_notify after insert or update of revoked_at on public.job_share
  for each row execute function public.on_job_share_notify();

/**
 * A stage change crosses sides when the job leaves the partner's stages
 * (partner → owner) or enters them (owner → partner). Only then is the other
 * side told; moves within one side's own stages are its own business.
 */
create or replace function public.on_job_stage_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s record;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  for s in
    select js.partner_org, js.assigned_stages from public.job_share js
      join public.partnership p on p.id = js.partnership_id
     where js.job_id = new.id and js.revoked_at is null and p.status = 'active'
  loop
    if old.status = any(s.assigned_stages) and not (new.status = any(s.assigned_stages)) then
      perform public.notify_org(new.clinic_id, new.id, 'stage_handover', jsonb_build_object('from', old.status, 'to', new.status));
    elsif new.status = any(s.assigned_stages) and not (old.status = any(s.assigned_stages)) then
      perform public.notify_org(s.partner_org, new.id, 'stage_handover', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists job_stage_notify on public.jobs;
create trigger job_stage_notify after update of status on public.jobs
  for each row execute function public.on_job_stage_notify();

/** A question goes to the side that did NOT ask it. */
create or replace function public.on_question_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job   uuid;
  v_owner uuid;
  v_asker uuid;
  s       record;
begin
  if not new.is_question then
    return new;
  end if;
  select ch.job_id, j.clinic_id into v_job, v_owner
    from public.channels ch join public.jobs j on j.id = ch.job_id where ch.id = new.channel_id;
  if v_job is null then
    return new;
  end if;
  select clinic_id into v_asker from public.profiles where id = new.author_id;
  if v_asker = v_owner then
    for s in select partner_org from public.job_share where job_id = v_job and revoked_at is null loop
      perform public.notify_org(s.partner_org, v_job, 'question', '{}'::jsonb);
    end loop;
  else
    perform public.notify_org(v_owner, v_job, 'question', '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists question_notify on public.messages;
create trigger question_notify after insert on public.messages
  for each row execute function public.on_question_notify();

-- ── For the e-mail sender (Edge Function, service role) ─────────────────────

/**
 * Pending e-mails, one row per notification, with the recipient's address.
 * Only for the service role: it reads auth.users. Marks nothing; the sender
 * calls `mark_notifications_emailed` with what it actually sent.
 */
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
   where n.emailed_at is null and n.read_at is null and p.notify_email
     and u.email is not null and n.created_at > now() - interval '1 day'
   order by n.created_at
   limit p_limit
$$;
revoke execute on function public.pending_notification_emails(int) from public, anon, authenticated;

create or replace function public.mark_notifications_emailed(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$ update public.notification set emailed_at = now() where id = any(p_ids) $$;
revoke execute on function public.mark_notifications_emailed(uuid[]) from public, anon, authenticated;
