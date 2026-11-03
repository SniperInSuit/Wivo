-- ============================================================================
-- Wivo — migration 099: username accounts are never mailed, and never locked out
-- Run AFTER sql/098 — or directly on sql/091 (production): it uses nothing
-- after sql/075. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- An account made without an e-mail has a stand-in address that can never
-- receive mail: `<username>@example.com` until now (sql/029), and
-- `<username>.<clinic code>@nomail.wivodent.com` from docs/ACCOUNTS.md on.
--
-- 1. NO MAIL TO A STAND-IN. The notification sender read every address in
--    auth.users, stand-ins included, and "E-mail me" is on by default. The
--    moment the Resend key is set, every username account would be mailed at
--    an address that does not exist, and the bounces would count against the
--    sending domain. `pending_notification_emails` now skips them.
--
-- 2. NOBODY LOCKED OUT. With "Confirm email" on, an account whose address was
--    never confirmed cannot sign in, and a stand-in can never be confirmed.
--    This confirms, once, exactly the Wivo stand-ins: the address is
--    `<that account's own username>@example.com` (or the older wivo.invalid /
--    wivo.local). A real address, an example.com address that is not its
--    account's username, a deleted account and an already confirmed one are
--    left as they are. Only `email_confirmed_at` is written. It reports how
--    many it confirmed, to compare with the count in docs/ACCOUNTS.md §4.1.
--    Running it again confirms nothing new.
--
-- Tests: sql/test/standinLogins.test.ts.
-- ============================================================================

-- ── 1. Addresses that can never receive mail ────────────────────────────────

/**
 * A Wivo stand-in, or any other address on a domain that cannot receive mail.
 * Every example.com address counts: IANA's domain accepts no mail for anyone.
 * Another instance with its own stand-in domain adds it here.
 */
create or replace function public.is_standin_email(p_email text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(lower(split_part(btrim(p_email), '@', 2))
           in ('nomail.wivodent.com', 'example.com', 'wivo.invalid', 'wivo.local'), false)
$$;
grant execute on function public.is_standin_email(text) to authenticated, service_role;

/** 075's list, without stand-ins. */
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
     and u.email is not null and not public.is_standin_email(u.email)
     and n.created_at > now() - interval '1 day'
   order by n.created_at
   limit p_limit
$$;
revoke execute on function public.pending_notification_emails(int) from public, anon, authenticated;

-- ── 2. Confirm the existing stand-ins, once ─────────────────────────────────

do $$
declare
  n int;
begin
  update auth.users u
     set email_confirmed_at = now()
    from public.profiles p
   where p.id = u.id
     and p.username is not null
     and u.email_confirmed_at is null
     and u.deleted_at is null
     and lower(u.email) in (lower(p.username) || '@example.com',
                            lower(p.username) || '@wivo.invalid',
                            lower(p.username) || '@wivo.local');
  get diagnostics n = row_count;
  raise notice '099: confirmed % stand-in account(s)', n;
end $$;
