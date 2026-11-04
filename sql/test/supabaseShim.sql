-- ============================================================================
-- The parts of a Supabase project that the migrations assume already exist.
--
-- Loaded by sql/test/harness.ts into PGlite BEFORE sql/000. Test-only: it is
-- never run against a real project, which has the real versions of all of this.
-- See docs/night-run/DECISIONS.md (D3) for why PGlite and not local Supabase.
--
-- Each piece copies what Supabase actually does, because a shim that is kinder
-- than the real thing would hide exactly the bugs these tests are for. The one
-- that matters most is the default privileges: on Supabase every new table in
-- `public` is granted to `anon` and `authenticated`, so a table without RLS is
-- readable by anyone holding the anon key. The audit test depends on that.
-- ============================================================================

-- ── Roles ───────────────────────────────────────────────────────────────────
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_auth_admin nologin noinherit;
create role supabase_storage_admin nologin noinherit;
-- PostgREST connects as this role; sql/098 sets its db_pre_request.
create role authenticator nologin noinherit;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ── Extensions schema (pgcrypto lives here on Supabase) ─────────────────────
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension pgcrypto with schema extensions;
set search_path = "$user", public, extensions;

-- ── auth ────────────────────────────────────────────────────────────────────
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

-- The column types are GoTrue's: email and the other strings are varchar(255),
-- phone is text. A function that hands auth.users.email back as `text`
-- without a cast fails on Supabase ("structure of query does not match
-- function result type") and must fail here too (sql/111).
create table auth.users (
  instance_id          uuid,
  id                   uuid primary key default gen_random_uuid(),
  aud                  character varying(255) default 'authenticated',
  role                 character varying(255) default 'authenticated',
  email                character varying(255) unique,
  encrypted_password   character varying(255),
  email_confirmed_at   timestamptz,
  invited_at           timestamptz,
  confirmation_token   character varying(255),
  recovery_token       character varying(255),
  last_sign_in_at      timestamptz,
  raw_app_meta_data    jsonb not null default '{}',
  raw_user_meta_data   jsonb not null default '{}',
  is_super_admin       boolean,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now(),
  phone                text,
  banned_until         timestamptz,
  deleted_at           timestamptz,
  is_anonymous         boolean not null default false
);

-- Second factors and sessions, as GoTrue keeps them (sql/097 reads them).
create type auth.factor_type as enum ('totp', 'webauthn', 'phone');
create type auth.factor_status as enum ('unverified', 'verified');
create type auth.aal_level as enum ('aal1', 'aal2', 'aal3');
create table auth.mfa_factors (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  friendly_name       text,
  factor_type         auth.factor_type not null default 'totp',
  status              auth.factor_status not null default 'verified',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  secret              text,
  last_challenged_at  timestamptz
);
create table auth.mfa_challenges (
  id           uuid primary key default gen_random_uuid(),
  factor_id    uuid not null references auth.mfa_factors(id) on delete cascade,
  created_at   timestamptz not null default now(),
  verified_at  timestamptz
);
create table auth.sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  factor_id   uuid,
  aal         auth.aal_level,
  not_after   timestamptz
);
create table auth.refresh_tokens (
  id          bigserial primary key,
  token       text,
  user_id     text,
  revoked     boolean,
  session_id  uuid references auth.sessions(id) on delete cascade
);

-- The same settings PostgREST writes for every request.
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role'
$$;
create function auth.email() returns text language sql stable as $$
  select auth.jwt() ->> 'email'
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- ── storage ─────────────────────────────────────────────────────────────────
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id                  text primary key,
  name                text not null unique,
  owner               uuid,
  public              boolean default false,
  file_size_limit     bigint,
  allowed_mime_types  text[],
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create table storage.objects (
  id                uuid primary key default gen_random_uuid(),
  bucket_id         text references storage.buckets(id),
  name              text,
  owner             uuid,
  owner_id          text,
  metadata          jsonb,
  path_tokens       text[] generated always as (string_to_array(name, '/')) stored,
  version           text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  last_accessed_at  timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
create function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
create function storage.extension(name text) returns text language sql immutable as $$
  select reverse(split_part(reverse(storage.filename(name)), '.', 1))
$$;
grant execute on all functions in schema storage to anon, authenticated, service_role;

-- ── Realtime ────────────────────────────────────────────────────────────────
create publication supabase_realtime;

-- ── pg_cron, pg_net, Vault: stubs ───────────────────────────────────────────
-- PGlite has none of the three. Each stub keeps the same names and argument
-- lists so the migrations that call them apply unchanged; none of them does
-- anything. The harness comments out the `create extension pg_cron / pg_net`
-- lines for the same reason.
create schema cron;
create table cron.job (
  jobid     bigserial primary key,
  jobname   text unique,
  schedule  text,
  command   text,
  active    boolean default true
);
create table cron.job_run_details (
  runid           bigserial primary key,
  jobid           bigint,
  status          text,
  return_message  text,
  start_time      timestamptz,
  end_time        timestamptz
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create function cron.unschedule(job_name text) returns boolean
language sql as $$
  with d as (delete from cron.job where jobname = job_name returning 1) select exists (select 1 from d)
$$;

create schema net;
create table net._http_response (
  id           bigint,
  status_code  integer,
  content      text,
  created      timestamptz default now()
);
create function net.http_post(
  url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds integer default 5000
) returns bigint language sql as $$ select 0::bigint $$;

create schema vault;
create table vault.secrets (
  id           uuid primary key default gen_random_uuid(),
  name         text unique,
  description  text,
  secret       text
);
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret) returning id
$$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
returns void language sql as $$
  update vault.secrets
     set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
         description = coalesce(new_description, description)
   where id = secret_id
$$;
