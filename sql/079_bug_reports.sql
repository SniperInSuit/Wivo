-- ============================================================================
-- Wivo — migration 079: "Report a bug"
-- Run AFTER sql/078. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec, Phase 1 "Bug reports": the button sends the version, organisation,
-- screen name, the description and the latest errors. A screenshot ONLY if the
-- user adds one. The report lands in `bug_report` and Kevin gets an e-mail.
--
-- `bug_report` is a PLATFORM table (spec, "Platform (admin console only)"):
-- "the clinics' app does not see these tables; RLS denies everyone but the
-- admin console's Edge Functions". So: RLS on, and NO policy at all. A clinic
-- user can file a report (through `submit_bug_report`) and attach the one
-- screenshot they chose (one reserved Storage slot), and can read nothing —
-- not even their own report back.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-reports', 'bug-reports', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create table if not exists public.bug_report (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references public.clinics(id) on delete set null,
  user_id          uuid references auth.users(id) on delete set null,
  app_version      text,
  screen           text,
  message          text not null,
  recent_errors    jsonb not null default '[]'::jsonb,
  screenshot_path  text,
  screenshot_at    timestamptz,
  status           text not null default 'new',
  created_at       timestamptz not null default now(),
  emailed_at       timestamptz,
  constraint bug_report_status_valid check (status in ('new', 'in_progress', 'fixed')),
  constraint bug_report_message_present check (length(btrim(message)) > 0),
  constraint bug_report_message_length check (length(message) <= 5000)
);
alter table public.bug_report enable row level security;
-- Deliberately no policy: see the header.

/**
 * File a report. `p_with_screenshot` reserves a Storage slot for the one image
 * the user picked; the path comes back for the upload. Returns the report id
 * and that path (null without a screenshot).
 */
create or replace function public.submit_bug_report(
  p_message text,
  p_screen text,
  p_app_version text,
  p_recent_errors jsonb,
  p_with_screenshot boolean default false
) returns table (id uuid, screenshot_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid := gen_random_uuid();
  v_path text := case when p_with_screenshot then v_id || '/screenshot' end;
begin
  if auth.uid() is null then
    raise exception 'Sign in to report a bug' using errcode = '42501';
  end if;
  -- A runaway client must not be able to fill the table: 20 reports an hour.
  if (select count(*) from public.bug_report where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many reports in an hour' using errcode = '42501';
  end if;
  insert into public.bug_report (id, org_id, user_id, app_version, screen, message, recent_errors, screenshot_path)
  values (v_id, public.my_org_id(), auth.uid(), left(p_app_version, 40), left(p_screen, 80),
          left(btrim(p_message), 5000),
          case when jsonb_typeof(p_recent_errors) = 'array' then p_recent_errors else '[]'::jsonb end,
          v_path);
  return query select v_id, v_path;
end;
$$;

/** The reserved screenshot slot of one of your own reports, not filled yet. */
create or replace function public.bug_screenshot_slot_open(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bug_report
     where screenshot_path = p_path and user_id = auth.uid() and screenshot_at is null
       and created_at > now() - interval '1 hour')
$$;

drop policy if exists "bug_reports_insert" on storage.objects;
create policy "bug_reports_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'bug-reports' and public.bug_screenshot_slot_open(name)
  );
-- No select / update / delete policy on this bucket: only the service role reads it.

create or replace function public.confirm_bug_screenshot(p_report uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.bug_report set screenshot_at = now()
   where id = p_report and user_id = auth.uid() and screenshot_path is not null
     and exists (select 1 from storage.objects o where o.bucket_id = 'bug-reports' and o.name = bug_report.screenshot_path)
$$;

-- ── For the e-mail to Kevin (Edge Function, service role) ───────────────────

create or replace function public.pending_bug_reports(p_limit int default 50)
returns table (id uuid, org_name text, app_version text, screen text, message text,
               recent_errors jsonb, has_screenshot boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, c.name, b.app_version, b.screen, b.message, b.recent_errors,
         b.screenshot_at is not null, b.created_at
    from public.bug_report b left join public.clinics c on c.id = b.org_id
   where b.emailed_at is null
   order by b.created_at
   limit p_limit
$$;
revoke execute on function public.pending_bug_reports(int) from public, anon, authenticated;

create or replace function public.mark_bug_reports_emailed(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$ update public.bug_report set emailed_at = now() where id = any(p_ids) $$;
revoke execute on function public.mark_bug_reports_emailed(uuid[]) from public, anon, authenticated;
