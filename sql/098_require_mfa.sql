-- ============================================================================
-- Wivo — migration 098: the database itself requires the second factor
-- Run AFTER sql/097 — or directly on sql/091 (production): it uses nothing
-- from 092–097. Then, as a SEPARATE query:
--   notify pgrst, 'reload config';  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Until now the second factor was asked for by the app's screens (MfaGate)
-- and by a handful of functions. The data itself did not ask: a session signed
-- in with the password alone (aal1) could read and change jobs, patients,
-- files and money through the API with the public key — everything RLS allows
-- that person, without the code. And a session that had been ended (an owner's
-- reset, "sign out everywhere") kept working until its token ran out, up to an
-- hour, because nothing checked that the session still existed.
--
-- Now:
-- 1. `has_mfa()` means: the token says aal2 AND its session still exists in
--    GoTrue's own table. Ending a session ends its access at once.
-- 2. Every table in `public` has a RESTRICTIVE policy for `authenticated`:
--    nothing without `has_mfa()`. Restrictive means it is ANDed with every
--    other policy — no permissive policy can open what it closes. Views are
--    all security_invoker, so they follow. Realtime follows the same policies.
--    The one exception: a person may read their OWN profile row before the
--    code (the app needs it to show the sign-in step). Nothing else.
-- 3. storage.objects (job files, bug screenshots): the same restrictive rule.
-- 4. Functions: a SECURITY DEFINER function does not see RLS, and 75 of them
--    can be called. So every API request is checked before it runs
--    (PostgREST's db_pre_request): a signed-in person without the second
--    factor gets 403 for anything but reading their own profile.
--
-- `ensure_mfa_policies()` puts the policy on every table that lacks it. This
-- migration calls it; on production, where 092–097 arrive AFTER this file,
-- run `select public.ensure_mfa_policies();` once after 097. Every new table
-- from now on gets the policy in its own migration (CLAUDE.md); the test
-- sql/test/requireMfa.test.ts fails for a table without it.
--
-- Service-role work (cron, Edge Functions with the service key) is untouched:
-- that role bypasses RLS and is not `authenticated`.
--
-- Tests: sql/test/requireMfa.test.ts.
-- ============================================================================

do $$ begin
  if not has_table_privilege('auth.sessions', 'select') then
    raise exception '098: this role cannot read auth.sessions';
  end if;
end $$;

-- ── 1. The second factor, in a session that still exists ────────────────────

/**
 * Signed in with a second factor in THIS session (Supabase: aal2), and the
 * session has not been ended since. Security definer: auth.sessions is GoTrue's.
 */
create or replace function public.has_mfa()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     and exists (select 1 from auth.sessions s
                  -- CASE, not AND: only it guarantees the text is checked before the cast.
                  where s.id = case when coalesce(auth.jwt() ->> 'session_id', '')
                                         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                    then (auth.jwt() ->> 'session_id')::uuid end
                    and s.user_id = auth.uid())
$$;
grant execute on function public.has_mfa() to anon, authenticated;

-- ── 2. Every table ──────────────────────────────────────────────────────────

/**
 * The restrictive policy on every table in `public` and on storage.objects.
 * Safe to run again: it replaces its own policies and nothing else.
 */
create or replace function public.ensure_mfa_policies()
returns int
language plpgsql
set search_path = public
as $$
declare
  t record;
  n int := 0;
begin
  for t in
    select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'profiles'
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('drop policy if exists "mfa_required" on public.%I', t.relname);
    execute format(
      'create policy "mfa_required" on public.%I as restrictive for all to authenticated
         using ((select public.has_mfa())) with check ((select public.has_mfa()))', t.relname);
    n := n + 1;
  end loop;

  -- Their own row, to read only: the sign-in step shows their name and language.
  drop policy if exists "mfa_required" on public.profiles;
  drop policy if exists "mfa_required_read" on public.profiles;
  drop policy if exists "mfa_required_insert" on public.profiles;
  drop policy if exists "mfa_required_update" on public.profiles;
  drop policy if exists "mfa_required_delete" on public.profiles;
  create policy "mfa_required_read" on public.profiles as restrictive for select to authenticated
    using ((select public.has_mfa()) or id = auth.uid());
  create policy "mfa_required_insert" on public.profiles as restrictive for insert to authenticated
    with check ((select public.has_mfa()));
  create policy "mfa_required_update" on public.profiles as restrictive for update to authenticated
    using ((select public.has_mfa())) with check ((select public.has_mfa()));
  create policy "mfa_required_delete" on public.profiles as restrictive for delete to authenticated
    using ((select public.has_mfa()));
  n := n + 1;

  drop policy if exists "mfa_required" on storage.objects;
  create policy "mfa_required" on storage.objects as restrictive for all to authenticated
    using ((select public.has_mfa())) with check ((select public.has_mfa()));

  return n;
end;
$$;
revoke execute on function public.ensure_mfa_policies() from public, anon, authenticated;

select public.ensure_mfa_policies();

-- ── 4. Every API request ────────────────────────────────────────────────────

/**
 * Runs before every PostgREST request (db_pre_request). A signed-in person
 * without the second factor may only read their own profile (RLS narrows that
 * to their row); everything else — tables, views, every function — is 403.
 * Anonymous and service-role requests are not this function's business.
 */
create or replace function public.require_mfa_for_api()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or public.has_mfa() then
    return;
  end if;
  if current_setting('request.method', true) = 'GET'
     and coalesce(current_setting('request.path', true), '') ~ '(^|/)profiles/?$' then
    return;
  end if;
  raise exception 'Sign in with your second factor first' using errcode = '42501', hint = 'mfa_required';
end;
$$;
grant execute on function public.require_mfa_for_api() to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_pre_request = 'public.require_mfa_for_api';
  end if;
end $$;
