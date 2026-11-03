-- ============================================================================
-- Wivo — migration 101: the anonymous key runs no function but one
-- Run AFTER sql/100 — or on any earlier base: it depends on nothing. Then, as a
-- SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Follow-up to 098. PostgreSQL lets EVERYONE (the PUBLIC pseudo-role) run a new
-- function, and Supabase also grants it to `anon` by default. So with only the
-- public key, anyone could call every function in `public`: most refuse
-- without a signed-in user, but some do work for anyone, among them
-- chat_prune(), purge_visit_requests() and recalc_invoice_totals(uuid).
--
-- Nothing in Wivo calls the database before sign-in: the sign-in and
-- second-factor screens talk to Supabase Auth, the public booking page goes
-- through its Edge Function with the service key, and both storage buckets
-- are private. So `anon` keeps exactly ONE function:
--
--   require_mfa_for_api()  PostgREST runs it before EVERY request, anonymous
--                          ones included (sql/098, db_pre_request); without it
--                          every anonymous request would fail on the check
--                          itself. It returns at once for anyone who is not a
--                          signed-in user.
--
-- Not touched: trigger functions (nobody can call them; PostgreSQL checks the
-- right only when a trigger is created), and other schemas (auth, storage,
-- extensions belong to Supabase).
--
-- How: from every other function in `public` that `anon` can run, EXECUTE is
-- taken from PUBLIC and from `anon`, and given back explicitly to
-- `authenticated` and `service_role` where they had it — so a signed-in user
-- and the Edge Functions can run exactly what they could before.
--
-- `lock_anon_functions()` does this and is safe to run again: on production,
-- where 092–100 arrive later, run it once after the last of them, and every
-- migration that adds a function ends with it (CLAUDE.md). The test
-- sql/test/anonFunctions.test.ts fails for any function `anon` can run beyond
-- the one above.
-- ============================================================================

/** Functions in `public` the anonymous key may run (see above). */
create or replace function public.anon_allowed_functions()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['public.require_mfa_for_api()']
$$;

/**
 * Takes EXECUTE from PUBLIC and `anon` on every non-trigger function in
 * `public` outside anon_allowed_functions(), keeping what `authenticated` and
 * `service_role` had. Returns how many functions it locked.
 */
create or replace function public.lock_anon_functions()
returns int
language plpgsql
set search_path = public
as $$
declare
  f        record;
  n        int := 0;
  auth_had boolean;
  svc_had  boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public'
       and p.prokind in ('f', 'p')
       and p.prorettype <> 'trigger'::regtype
       and p.prorettype <> 'event_trigger'::regtype
       and has_function_privilege('anon', p.oid, 'execute')
       and not (p.oid::regprocedure::text = any (public.anon_allowed_functions()))
  loop
    auth_had := has_function_privilege('authenticated', f.oid, 'execute');
    svc_had  := has_function_privilege('service_role', f.oid, 'execute');
    execute format('revoke execute on routine %s from public, anon', f.sig);
    if auth_had then execute format('grant execute on routine %s to authenticated', f.sig); end if;
    if svc_had  then execute format('grant execute on routine %s to service_role', f.sig); end if;
    n := n + 1;
  end loop;

  -- The one anon needs, wherever 098 has run.
  if to_regprocedure('public.require_mfa_for_api()') is not null then
    grant execute on function public.require_mfa_for_api() to anon, authenticated;
  end if;
  return n;
end;
$$;
revoke execute on function public.lock_anon_functions() from public, anon, authenticated, service_role;
revoke execute on function public.anon_allowed_functions() from public, anon;
grant execute on function public.anon_allowed_functions() to authenticated, service_role;

-- New functions: no explicit grant to anon from Supabase's default privileges
-- (for functions this role creates in `public`). PostgreSQL's own PUBLIC
-- default cannot be removed per schema, which is why the call below and the
-- test exist.
alter default privileges in schema public revoke execute on functions from anon;

do $$
declare n int;
begin
  n := public.lock_anon_functions();
  raise notice '101: anon can no longer run % function(s)', n;
end $$;
