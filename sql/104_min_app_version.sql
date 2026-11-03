-- ============================================================================
-- Wivo — migration 104: a minimum app version for saving
-- Run AFTER sql/103. Then, as a SEPARATE query:
--   notify pgrst, 'reload config';  notify pgrst, 'reload schema';
-- ============================================================================
--
-- docs/MIN-VERSION.md. A build that is too old may still open and READ, but
-- it may not SAVE: it is told "Update Wivo" (HTTP 426) and gets the update.
-- In 2.0.1 an old build saved jobs without their producer and designer.
--
-- THIS GUARDS AGAINST OLD BUILDS LOSING DATA. IT IS NOT A SECURITY CONTROL.
-- The version arrives in a request header (`x-wivo-version`), which anyone can
-- set. It never decides who may do what — RLS, the second factor (sql/098)
-- and the permissions (sql/102) do — and nothing here can allow more than they
-- do: at worst it refuses saves until the minimum is lowered.
--
-- 1. THE SETTING: public.app_min_version. One global row (org_id null), and at
--    most one per organisation to raise it for one clinic first. EMPTY = OFF,
--    which is how this migration leaves it. Kevin sets it in the SQL Editor:
--      select public.set_app_min_version('2.1.0', false, 'why');            -- everyone
--      select public.set_app_min_version('2.1.0', true, 'why', '<org id>');  -- one clinic, restart required
--      select public.clear_app_min_version();                               -- off again
--    `required`: desktops below it restart by themselves once the update is
--    downloaded and nothing is open (docs/MIN-VERSION.md §4).
--
-- 2. THE CHECK: PostgREST's pre-request becomes public.pre_request(), which
--    runs 098's require_mfa_for_api() and then require_app_version(). The
--    latter acts only for a signed-in user, only when a minimum applies, and
--    only on saves: POST/PATCH/PUT/DELETE on a table, or a call to a VOLATILE
--    function (stable and immutable ones are reads). A missing or lower
--    version is refused with SQLSTATE PT426 -> HTTP 426, hint update_required.
--    save_push_subscription stays allowed: an old phone keeps its pushes.
--
-- 3. app_min_version_for_me(): the minimum that applies to the caller, for
--    the app's restart (desktop) and reload (phone). A read.
--
-- 4. app_version_probe(): for the service role only, so the check script
--    (scripts/check-version-header.sh) can see the header arrive and a 426
--    come back from the real API.
--
-- Ends with ensure_mfa_policies() (new table) and lock_anon_functions().
-- Tests: sql/test/minAppVersion.test.ts.
-- ============================================================================

-- ── Versions ────────────────────────────────────────────────────────────────

/** '2.0.10' → {2,0,10}; always three parts ('2.1' → {2,1,0}); null if it is not a version. */
create or replace function public.version_parts(p_version text)
returns int[]
language sql
immutable
set search_path = public
as $$
  select case when coalesce(p_version, '') ~ '^\s*\d+(\.\d+){0,2}'
    then (string_to_array(substring(btrim(p_version) from '^\d+(?:\.\d+){0,2}'), '.')::int[] || array[0, 0, 0])[1:3]
  end
$$;

/** Is `p_version` below `p_minimum`? A missing or unreadable version is. Compared as numbers: 2.0.10 > 2.0.9. */
create or replace function public.version_below(p_version text, p_minimum text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when public.version_parts(p_minimum) is null then false
    when public.version_parts(p_version) is null then true
    else public.version_parts(p_version) < public.version_parts(p_minimum)
  end
$$;

-- ── 1. The setting ──────────────────────────────────────────────────────────

create table if not exists public.app_min_version (
  id           uuid primary key default gen_random_uuid(),
  -- Null: every organisation. A row of its own raises it for that one only.
  org_id       uuid references public.clinics(id) on delete cascade,
  min_version  text not null check (min_version ~ '^\d+\.\d+\.\d+$'),
  required     boolean not null default false,
  note         text,
  updated_at   timestamptz not null default now()
);
create unique index if not exists app_min_version_one_global on public.app_min_version ((true)) where org_id is null;
create unique index if not exists app_min_version_one_per_org on public.app_min_version (org_id) where org_id is not null;

alter table public.app_min_version enable row level security;
-- Members read what applies to them (the global row and their organisation's).
-- Nobody writes but the service role and the SQL Editor (no write policy).
drop policy if exists "app_min_version_read" on public.app_min_version;
create policy "app_min_version_read" on public.app_min_version for select to authenticated
  using (org_id is null or org_id = public.my_clinic_id());

/** Set the minimum, for everyone (p_org null) or one organisation. SQL Editor only. */
create or replace function public.set_app_min_version(p_version text, p_required boolean default false, p_note text default null, p_org uuid default null)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_version !~ '^\d+\.\d+\.\d+$' then
    raise exception 'A version is three numbers, like 2.1.0' using errcode = '22023';
  end if;
  if p_org is null then
    update public.app_min_version set min_version = p_version, required = coalesce(p_required, false), note = p_note, updated_at = now()
     where org_id is null;
  else
    update public.app_min_version set min_version = p_version, required = coalesce(p_required, false), note = p_note, updated_at = now()
     where org_id = p_org;
  end if;
  if not found then
    insert into public.app_min_version (org_id, min_version, required, note) values (p_org, p_version, coalesce(p_required, false), p_note);
  end if;
end;
$$;

/** Off again: for everyone (p_org null) or one organisation's own row. SQL Editor only. */
create or replace function public.clear_app_min_version(p_org uuid default null)
returns void
language sql
set search_path = public
as $$
  delete from public.app_min_version where org_id is not distinct from p_org
$$;
revoke execute on function public.set_app_min_version(text, boolean, text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.clear_app_min_version(uuid) from public, anon, authenticated, service_role;

/** The minimum that applies to an organisation: its own row, else the global one, else none. */
create or replace function public.app_min_version_of(p_org uuid)
returns table (min_version text, required boolean)
language sql
stable
security definer
set search_path = public
as $$
  select m.min_version, m.required from public.app_min_version m
   where m.org_id = p_org or m.org_id is null
   order by (m.org_id is null)
   limit 1
$$;
revoke execute on function public.app_min_version_of(uuid) from public, anon, authenticated;

-- ── 3. For the app ──────────────────────────────────────────────────────────

/** The minimum that applies to me, if any. A read (stable): old builds may call it. */
create or replace function public.app_min_version_for_me()
returns table (min_version text, required boolean)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.app_min_version_of(public.my_clinic_id())
$$;
grant execute on function public.app_min_version_for_me() to authenticated;

-- ── 2. The check ────────────────────────────────────────────────────────────

/** Calls a too-old build may still make although they change something. */
create or replace function public.app_version_exempt()
returns text[]
language sql
immutable
set search_path = public
as $$
  -- An old phone keeps its notifications while it updates.
  select array['save_push_subscription']
$$;

/**
 * Refuses a SAVE from a build below the minimum, or one that does not say its
 * version. Reads and everything not done by a signed-in user pass.
 */
create or replace function public.require_app_version()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min     text;
  v_method  text := upper(coalesce(current_setting('request.method', true), ''));
  v_path    text := coalesce(current_setting('request.path', true), '');
  v_fn      text;
  v_version text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then return; end if;
  if v_method in ('', 'GET', 'HEAD', 'OPTIONS') then return; end if;

  select m.min_version into v_min from public.app_min_version_of(public.my_clinic_id()) m;
  if v_min is null then return; end if;

  -- A function call is a save only if the function can change something.
  if v_path ~ '(^|/)rpc/' then
    v_fn := regexp_replace(v_path, '^.*rpc/', '');
    v_fn := split_part(split_part(v_fn, '?', 1), '/', 1);
    if v_fn = any (public.app_version_exempt()) then return; end if;
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_fn and p.provolatile = 'v') then
      return;
    end if;
  end if;

  begin
    v_version := nullif(btrim(current_setting('request.headers', true)::json ->> 'x-wivo-version'), '');
  exception when others then
    v_version := null;
  end;

  if public.version_below(v_version, v_min) then
    raise sqlstate 'PT426' using
      message = 'Update Wivo: this version can no longer save. Close and reopen Wivo, or reload the page.',
      detail  = v_min,
      hint    = 'update_required';
  end if;
end;
$$;

/** PostgREST's pre-request (db_pre_request): the second factor, then the app version. */
create or replace function public.pre_request()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_mfa_for_api();
  perform public.require_app_version();
end;
$$;
grant execute on function public.pre_request() to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_pre_request = 'public.pre_request';
  end if;
end $$;

-- ── 4. For the check script (service role only) ─────────────────────────────

/**
 * What the API sees: the x-wivo-version header this request carried. With
 * p_refuse, answers exactly as a refused save does (HTTP 426), so the script
 * can see the status and message arrive. Changes nothing.
 */
create or replace function public.app_version_probe(p_refuse boolean default false)
returns text
language plpgsql
stable
set search_path = public
as $$
declare v text;
begin
  begin
    v := current_setting('request.headers', true)::json ->> 'x-wivo-version';
  exception when others then v := null;
  end;
  if p_refuse then
    raise sqlstate 'PT426' using message = 'Update Wivo: this version can no longer save. Close and reopen Wivo, or reload the page.',
      detail = 'probe', hint = 'update_required';
  end if;
  return coalesce(v, '(none)');
end;
$$;
revoke execute on function public.app_version_probe(boolean) from public, anon, authenticated;
grant execute on function public.app_version_probe(boolean) to service_role;

-- ── Anon: PostgREST now calls pre_request() for anonymous requests ──────────

create or replace function public.anon_allowed_functions()
returns text[]
language sql
immutable
set search_path = public
as $$
  -- pre_request(): PostgREST runs it before every request (sql/104).
  -- require_mfa_for_api(): what it ran before, until 'reload config' is done.
  select array['public.pre_request()', 'public.require_mfa_for_api()']
$$;

/** 101's lock, granting anon exactly the allowed functions that exist. */
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
  allowed  text;
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

  foreach allowed in array public.anon_allowed_functions() loop
    if to_regprocedure(allowed) is not null then
      execute format('grant execute on function %s to anon, authenticated', allowed);
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.lock_anon_functions() from public, anon, authenticated, service_role;

select public.ensure_mfa_policies();
select public.lock_anon_functions();
