-- ============================================================================
-- Wivo — migration 125: Resend's sending limit, in the log and for the owner
-- Run AFTER sql/124. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- RIGA-GO-LIVE.md, "Monday 23.11.2026": Riga sends through its own Resend
-- account on the free plan, 100 e-mails a day (3000 a month), and Supabase
-- Auth's own e-mails (password links) count toward the same 100. "When the
-- daily limit is reached, it has to be in the log and visible to the owner."
--
-- What happens now:
--   * Resend answers 429 with `daily_quota_exceeded` or
--     `monthly_quota_exceeded` (supabase/functions/_shared/mailQuota.ts).
--     send-notifications and team-account then call
--     record_mail_quota_hit(kind, source): service role only.
--   * One row per clinic, day (UTC) and kind in mail_quota_hit: when it was
--     first and last hit, how many sends were refused, and by which part.
--     That row is the log. The Edge Function also writes a warning to its
--     own log in Supabase.
--   * The first hit of a day tells every owner: a bell notification
--     `mail_quota` (and a push to their phone, which does not go through
--     Resend). Never an e-mail: that would be refused too.
--   * The owner reads the rows (RLS: own clinic, role owner). Nobody writes
--     them but the function.
--
-- The Resend account belongs to the project, not to one clinic, so a hit is
-- recorded for every clinic in the project (a clinic's project has one).
--
-- Notification e-mails refused by the limit stay unsent and are tried again
-- each minute, for a day (pending_notification_emails, sql/123).
--
-- Tests: sql/test/mailQuota.test.ts, supabase/functions/_shared/notifySender.test.ts,
-- supabase/functions/_shared/mailQuota.test.ts.
-- ============================================================================

set lock_timeout = '10s';

-- ── 1. The log ──────────────────────────────────────────────────────────────

create table if not exists public.mail_quota_hit (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.clinics(id) on delete cascade,
  day        date not null,
  kind       text not null check (kind in ('daily', 'monthly')),
  sources    text[] not null default '{}',
  refused    int not null default 1 check (refused > 0),
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  unique (org_id, day, kind)
);

alter table public.mail_quota_hit enable row level security;
drop policy if exists "mail_quota_hit_select" on public.mail_quota_hit;
create policy "mail_quota_hit_select" on public.mail_quota_hit
  for select using (org_id = public.my_clinic_id() and public.my_role() = 'owner');
-- No insert, update or delete policy: only record_mail_quota_hit writes.

-- ── 2. The notification kind ────────────────────────────────────────────────

alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned',
                  'mfa_removed', 'mfa_reset', 'update_installed', 'update_failed', 'update_stale',
                  'stage_progress', 'stage_assigned', 'mail_quota'));

-- ── 3. Recording a hit ──────────────────────────────────────────────────────

/**
 * Resend refused a send for its limit. `p_kind`: 'daily' or 'monthly';
 * `p_source`: which part was sending ('notifications', 'bug_reports',
 * 'team_invite', 'team_email'). Returns how many clinics were told for the
 * first time today (0 when the day's row already existed).
 */
create or replace function public.record_mail_quota_hit(p_kind text, p_source text)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_src text := left(coalesce(nullif(trim(p_source), ''), 'unknown'), 40);
  v_new int := 0;
  v_id uuid;
  c record;
begin
  if p_kind is null or p_kind not in ('daily', 'monthly') then
    raise exception 'unknown limit: %', p_kind using errcode = '22023';
  end if;
  for c in select id from public.clinics loop
    v_id := null;
    insert into public.mail_quota_hit (org_id, day, kind, sources)
    values (c.id, v_day, p_kind, array[v_src])
    on conflict (org_id, day, kind) do nothing
    returning id into v_id;

    if v_id is null then
      update public.mail_quota_hit h
         set refused = h.refused + 1,
             last_at = now(),
             sources = case when v_src = any (h.sources) then h.sources else h.sources || v_src end
       where h.org_id = c.id and h.day = v_day and h.kind = p_kind;
    else
      v_new := v_new + 1;
      -- The first hit of the day: every owner, in the bell and on the phone.
      insert into public.notification (org_id, user_id, kind, detail)
      select c.id, p.id, 'mail_quota', jsonb_build_object('limit', p_kind, 'day', v_day)
        from public.profiles p
       where p.clinic_id = c.id and p.role = 'owner';
    end if;
  end loop;
  return v_new;
end;
$$;
revoke execute on function public.record_mail_quota_hit(text, text) from public, anon, authenticated;

-- ── 4. Never by e-mail ──────────────────────────────────────────────────────

/** sql/123, without 'mail_quota': Resend refuses it anyway, and it is about Resend. */
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
     and n.kind not in ('stage_assigned', 'mail_quota')
     and case when n.kind = 'stage_progress' then p.notify_every_stage else p.notify_email end
     and u.email is not null and not public.is_standin_email(u.email)
     and n.created_at > now() - interval '1 day'
   order by n.created_at
   limit p_limit
$$;
revoke execute on function public.pending_notification_emails(int) from public, anon, authenticated;

select public.ensure_mfa_policies();
select public.lock_anon_functions();
