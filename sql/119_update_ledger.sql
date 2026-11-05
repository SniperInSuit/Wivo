-- ============================================================================
-- Wivo — migration 119: the update ledger, and what a clinic's project trusts
-- Run AFTER sql/118. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- docs/ARCHITECTURE-INSTANCES.md 5b, 5e and 5g: the database side of phase 1,
-- slice 2. NOTHING CHANGES FOR ANYONE TODAY. Until a project is set up as a
-- clinic's own instance (wivo_instance gets its row from `wivo-update` at the
-- first install), update_status() answers null and the app shows nothing
-- new. Production and the test copy stay that way.
--
-- 1. public.wivo_instance: one row. The project's channel ('stable' or
--    'test') and its clinic, set once, after setup has created the clinic.
-- 2. public.wivo_schema_migration: the ledger. One row per migration file
--    applied from an update package: its path and sha256, the package's
--    version and hash, how (setup, manual, automatic) and who approved.
-- 3. public.wivo_trust: every certificate accepted and every revocation seen,
--    kept for good, so a revocation withheld later changes nothing (5g).
-- 4. public.wivo_update_check: every check of the signed list. Accepted: the
--    signing key, serial, sha256 and expiry, and the list's versions the
--    first time that serial is seen. Refused: why. The serial floor and the
--    list's freshness are read from here, and a trigger refuses a lower
--    serial, or the same serial with other content, as a backstop to
--    shared/release checkIndex (TUF: rollback).
-- 5. public.wivo_update_install: every install attempt, installed, refused
--    or failed. A failure records the migration and the SQLSTATE only, never
--    the error's text, which can quote data.
--
--    These five describe the database itself, not a clinic's data, and the
--    ledger is written before any clinic exists (the first install). So they
--    have NO org_id: a deliberate exception to the rule for new tables.
--    Instead, RLS is on with no policy for any app role; every privilege is
--    revoked from anon, authenticated and service_role; and they are
--    append-only for everyone (wivo_instance: its clinic is set once). Only
--    `wivo-update` writes them, over the project's own database connection,
--    through the functions in 7. The app reads them only through
--    update_status(), and only an approver gets an answer.
--
-- 6. Approvers: the owner of the instance's clinic, or a member of it with
--    the new permission 'updates.install'. has_perm() gives an owner every
--    permission and an admin none without a grant, so admins don't get it.
--    No licence check: a security fix must install on an expired licence too.
--
-- 7. For `wivo-update` only, no app role may run them:
--      wivo_instance_create(channel)   the first install
--      wivo_instance_claim(org)        once, after setup created the clinic
--      wivo_record_migration(...)      inside the install's one transaction
--      wivo_record_trust(...)          a certificate or revocation accepted
--      wivo_record_check(...)          each check of the list
--      wivo_record_install(...)        each install attempt
--      wivo_update_floor()             the serial floor, for checkIndex
--    Checks and installs write the audit log (new action 'update', its kind
--    in the detail) and notify the approvers: once when the list goes stale
--    (5g: the owner's warning), after each install, and after each failure.
--
-- 8. update_status(): a read (stable), for approvers. Returns the channel,
--    the installed version, the freshest list (serial, expiry, versions),
--    whether it is stale by the database's clock, the last check, the last
--    20 installs and the update keys accepted. Null for anyone else.
--
-- Ends with ensure_mfa_policies() (new tables) and lock_anon_functions().
-- Tests: sql/test/updateLedger.test.ts.
-- ============================================================================

set lock_timeout = '10s';

-- ── 1–5. The tables ─────────────────────────────────────────────────────────

create table if not exists public.wivo_instance (
  id          boolean primary key default true check (id),
  channel     text not null check (channel in ('stable', 'test')),
  org_id      uuid references public.clinics(id),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz
);

create table if not exists public.wivo_schema_migration (
  file            text primary key check (file ~ '^migrations/[A-Za-z0-9_.-]+\.sql$'),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  package_version text not null check (package_version ~ '^\d{1,4}\.\d{1,4}\.\d{1,5}$'),
  package_sha256  text not null check (package_sha256 ~ '^[0-9a-f]{64}$'),
  mode            text not null check (mode in ('setup', 'manual', 'automatic')),
  -- No foreign key: the ledger outlives any account (as sql/115).
  applied_by      uuid,
  applied_at      timestamptz not null default now()
);

create table if not exists public.wivo_trust (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('certificate', 'revocation')),
  -- A certificate: the key it certifies. A revocation: the key it revokes.
  key_id       text not null check (length(key_id) between 1 and 100),
  token        text not null unique check (length(token) <= 65536),
  accepted_at  timestamptz not null default now()
);

create table if not exists public.wivo_update_check (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  -- Null: the project's own scheduled check.
  by_user       uuid,
  result        text not null check (result in ('accepted', 'refused')),
  reason        text check (length(reason) <= 100),
  key_id        text,
  serial        bigint,
  sha256        text check (sha256 ~ '^[0-9a-f]{64}$'),
  expires       timestamptz,
  -- The list's versions, withdrawn and app: only the first time a serial is seen.
  list          jsonb,
  -- The state after this check: no unexpired list from a key still trusted.
  stale         boolean not null default true,
  constraint wivo_update_check_accepted check (
    result <> 'accepted' or (key_id is not null and serial >= 1 and sha256 is not null and expires is not null))
);
create index if not exists wivo_update_check_key_serial_idx on public.wivo_update_check (key_id, serial) where result = 'accepted';

create table if not exists public.wivo_update_install (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  from_version    text,
  to_version      text not null check (to_version ~ '^\d{1,4}\.\d{1,4}\.\d{1,5}$'),
  package_sha256  text check (package_sha256 ~ '^[0-9a-f]{64}$'),
  mode            text not null check (mode in ('setup', 'manual', 'automatic')),
  by_user         uuid,
  by_name         text,
  result          text not null check (result in ('installed', 'refused', 'failed')),
  -- A refusal's reason ('bad_signature', 'not_approver', …) or, for a failure,
  -- the migration and SQLSTATE ('migrations/120_x.sql 23505'). Never error text.
  reason          text check (length(reason) <= 200),
  -- The read-only checks after an install: per check, how many rows it returned.
  checks          jsonb
);

alter table public.wivo_instance enable row level security;
alter table public.wivo_schema_migration enable row level security;
alter table public.wivo_trust enable row level security;
alter table public.wivo_update_check enable row level security;
alter table public.wivo_update_install enable row level security;

revoke all on public.wivo_instance, public.wivo_schema_migration, public.wivo_trust,
              public.wivo_update_check, public.wivo_update_install
  from public, anon, authenticated, service_role;
revoke all on sequence public.wivo_trust_id_seq, public.wivo_update_check_id_seq, public.wivo_update_install_id_seq
  from public, anon, authenticated, service_role;

-- ── Append-only ─────────────────────────────────────────────────────────────

create or replace function public.wivo_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

-- Its own function, so no table has two triggers on one (sql/test/restoreTriggers.test.ts).
create or replace function public.wivo_no_truncate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['wivo_schema_migration', 'wivo_trust', 'wivo_update_check', 'wivo_update_install'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_append_only', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.wivo_append_only()',
                   t || '_append_only', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.wivo_no_truncate()',
                   t || '_no_truncate', t);
  end loop;
end $$;

/** The instance row: never deleted; its clinic set once, and nothing else ever changes. */
create or replace function public.wivo_instance_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.org_id is null and new.org_id is not null
     and new.id = old.id and new.channel = old.channel and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'wivo_instance: the clinic is set once, and nothing else changes' using errcode = '42501';
end;
$$;

drop trigger if exists wivo_instance_guard on public.wivo_instance;
create trigger wivo_instance_guard before update or delete on public.wivo_instance
  for each row execute function public.wivo_instance_guard();
drop trigger if exists wivo_instance_no_truncate on public.wivo_instance;
create trigger wivo_instance_no_truncate before truncate on public.wivo_instance
  for each statement execute function public.wivo_no_truncate();

/** Is this signing key revoked? A revoked key's lists no longer count, for the floor or for freshness. */
create or replace function public.wivo_key_revoked(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.wivo_trust where kind = 'revocation' and key_id = p_key)
$$;

/**
 * The backstop to checkIndex (TUF: rollback). From a key still trusted, an
 * accepted list may not have a lower serial than one accepted before, nor
 * the same serial with other content. Never expired when accepted.
 */
create or replace function public.wivo_update_check_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.result = 'accepted' then
    if new.expires <= now() then
      raise exception 'an expired list is never accepted' using errcode = '22023';
    end if;
    if not public.wivo_key_revoked(new.key_id) and exists (
      select 1 from public.wivo_update_check c
       where c.result = 'accepted' and c.key_id = new.key_id
         and (c.serial > new.serial or (c.serial = new.serial and c.sha256 <> new.sha256))) then
      raise exception 'an older or re-used list serial' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists wivo_update_check_order on public.wivo_update_check;
create trigger wivo_update_check_order before insert on public.wivo_update_check
  for each row execute function public.wivo_update_check_order();

-- ── 6. Approvers ────────────────────────────────────────────────────────────

/** The caller may approve updates: in the instance's clinic, its owner or a member granted 'updates.install'. */
create or replace function public.is_update_approver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.wivo_instance i where i.org_id is not null and i.org_id = public.my_clinic_id())
     and public.has_perm('updates.install')
$$;

/** Everyone who approves updates for the instance's clinic: who the notifications go to. */
create or replace function public.update_approvers()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from public.profiles p join public.wivo_instance i on i.org_id = p.clinic_id
   where p.role = 'owner'
      or (p.role = 'worker' and exists (
            select 1 from public.worker_permissions w
             where w.profile_id = p.id and w.clinic_id = p.clinic_id
               and w.permission = 'updates.install' and w.granted))
$$;

-- ── The new audit action and notifications ──────────────────────────────────

alter table public.audit_log drop constraint if exists audit_log_action_valid;
alter table public.audit_log add constraint audit_log_action_valid
  check (action in ('view', 'download', 'upload', 'share', 'unshare', 'stage_move',
                    'partnership', 'export', 'question', 'delete', 'restore', 'stock_override',
                    'mfa_added', 'mfa_removed', 'mfa_reset', 'account_deleted',
                    'create', 'edit', 'permission', 'file_deleted', 'update'));

alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned',
                  'mfa_removed', 'mfa_reset', 'update_installed', 'update_failed', 'update_stale'));

/** An 'update' entry in the instance clinic's audit log, by `p_by` (null: automatic or the scheduled check). */
create or replace function public.wivo_audit(p_by uuid, p_object text, p_detail jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log (org_id, user_id, action, object, detail)
  select i.org_id, p_by, 'update', p_object, p_detail
    from public.wivo_instance i where i.org_id is not null
$$;

/** Tell every approver except `p_except` (who just did it). */
create or replace function public.wivo_notify(p_kind text, p_detail jsonb, p_except uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notification (org_id, user_id, kind, detail)
  select i.org_id, a.id, p_kind, p_detail
    from public.wivo_instance i, public.update_approvers() a(id)
   where i.org_id is not null and a.id is distinct from p_except
$$;

-- ── 7. For wivo-update ──────────────────────────────────────────────────────

/** The first install: this project becomes an instance, on one channel. Once. */
create or replace function public.wivo_instance_create(p_channel text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.wivo_instance) then
    raise exception 'already an instance' using errcode = '23505';
  end if;
  insert into public.wivo_instance (channel) values (p_channel);
end;
$$;

/** Setup's last step: the clinic it created is the instance's. Once. */
create or replace function public.wivo_instance_claim(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.clinics where id = p_org) then
    raise exception 'no such clinic' using errcode = '23503';
  end if;
  update public.wivo_instance set org_id = p_org, claimed_at = now() where org_id is null;
  if not found then
    raise exception 'not an instance, or its clinic is already set' using errcode = '42501';
  end if;
end;
$$;

/** One migration of a package, applied: inside the install's transaction, so it stands or falls with it. */
create or replace function public.wivo_record_migration(
  p_file text, p_sha256 text, p_package_version text, p_package_sha256 text, p_mode text, p_by uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.wivo_schema_migration (file, sha256, package_version, package_sha256, mode, applied_by)
  values (p_file, p_sha256, p_package_version, p_package_sha256, p_mode, p_by)
$$;

/**
 * A certificate or revocation that checked out against the pinned roots.
 * Kept for good. A new certificate, once there is a clinic, is recorded in
 * its audit log: a new Wivo update key is something its owners should see
 * (decision 23). Returns whether it was new.
 */
create or replace function public.wivo_record_trust(p_kind text, p_key_id text, p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wivo_trust (kind, key_id, token) values (p_kind, p_key_id, p_token)
  on conflict (token) do nothing;
  if not found then
    return false;
  end if;
  perform public.wivo_audit(null, 'update:key', jsonb_build_object(
    'kind', case when p_kind = 'certificate' then 'key_accepted' else 'key_revoked' end, 'key_id', p_key_id));
  return true;
end;
$$;

/** Is there an unexpired list, from a key still trusted, by the database's clock? */
create or replace function public.wivo_list_fresh()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.wivo_update_check c
                  where c.result = 'accepted' and c.expires > now() and not public.wivo_key_revoked(c.key_id))
$$;

/**
 * One check of the signed list, after shared/release checkIndex. Records it,
 * with the list's content the first time its serial is seen. When the list
 * goes stale (no unexpired list from a trusted key), the audit log says so
 * and the approvers are told once; when a fresh list returns, the audit log
 * says that too (5g). Returns whether the list is now stale.
 */
create or replace function public.wivo_record_check(
  p_by uuid, p_result text, p_reason text,
  p_key_id text default null, p_serial bigint default null, p_sha256 text default null,
  p_expires timestamptz default null, p_list jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_stale boolean;
  v_new_serial boolean;
  v_stale boolean;
  v_last_expiry timestamptz;
begin
  if not exists (select 1 from public.wivo_instance) then
    raise exception 'not an instance' using errcode = '42501';
  end if;
  select c.stale into v_was_stale from public.wivo_update_check c order by c.id desc limit 1;
  v_new_serial := p_result = 'accepted' and not exists (
    select 1 from public.wivo_update_check c where c.result = 'accepted' and c.key_id = p_key_id and c.serial = p_serial);
  v_stale := not public.wivo_list_fresh()
         and not (p_result = 'accepted' and p_expires > now() and not public.wivo_key_revoked(p_key_id));

  insert into public.wivo_update_check (by_user, result, reason, key_id, serial, sha256, expires, list, stale)
  values (p_by, p_result, case when p_result = 'refused' then coalesce(p_reason, 'refused') end,
          p_key_id, p_serial, p_sha256, p_expires, case when v_new_serial then p_list end, v_stale);

  if v_stale and v_was_stale is distinct from true then
    select max(c.expires) into v_last_expiry from public.wivo_update_check c
     where c.result = 'accepted' and not public.wivo_key_revoked(c.key_id);
    perform public.wivo_audit(p_by, 'update:list', jsonb_build_object('kind', 'stale', 'expired', v_last_expiry, 'reason', p_reason));
    perform public.wivo_notify('update_stale', jsonb_build_object('expired', v_last_expiry), null);
  elsif not v_stale and v_was_stale then
    perform public.wivo_audit(p_by, 'update:list', jsonb_build_object('kind', 'fresh', 'serial', p_serial, 'expires', p_expires));
  end if;
  return v_stale;
end;
$$;

/**
 * One install attempt. Installed and failed are told to the approvers (but
 * not to the one who pressed Install); every attempt is in the audit log:
 * who (or automatic), from and to, the package hash, the result and why.
 */
create or replace function public.wivo_record_install(
  p_from text, p_to text, p_package_sha256 text, p_mode text, p_by uuid,
  p_result text, p_reason text default null, p_checks jsonb default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint;
begin
  insert into public.wivo_update_install
    (from_version, to_version, package_sha256, mode, by_user, by_name, result, reason, checks)
  values (p_from, p_to, p_package_sha256, p_mode, p_by, public.audit_person_name(p_by), p_result, p_reason, p_checks)
  returning id into v_id;

  perform public.wivo_audit(p_by, 'update:' || p_to, jsonb_strip_nulls(jsonb_build_object(
    'kind', p_result, 'from', p_from, 'to', p_to, 'sha256', p_package_sha256, 'mode', p_mode, 'reason', p_reason)));
  if p_result = 'installed' then
    perform public.wivo_notify('update_installed', jsonb_build_object('from', p_from, 'to', p_to), p_by);
  elsif p_result = 'failed' then
    perform public.wivo_notify('update_failed', jsonb_build_object('to', p_to), p_by);
  end if;
  return v_id;
end;
$$;

/** Per signing key: the highest serial accepted and that list's hash (shared/release SerialFloor). */
create or replace function public.wivo_update_floor()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key_id, jsonb_build_object('serial', serial, 'sha256', sha256)), '{}'::jsonb)
    from (select distinct on (key_id) key_id, serial, sha256
            from public.wivo_update_check where result = 'accepted'
           order by key_id, serial desc) f
$$;

-- ── 8. What approvers see ───────────────────────────────────────────────────

/**
 * Settings → Updates, and the warning when the list can't be refreshed
 * (5g). For an approver of the instance's clinic; null for anyone else, and
 * in a project that isn't an instance (production and the test copy today).
 * `stale` is judged by the database's clock, not the desktop's.
 */
create or replace function public.update_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_inst public.wivo_instance;
  v_list public.wivo_update_check;
begin
  select * into v_inst from public.wivo_instance;
  if not found or v_inst.org_id is null or not public.is_update_approver() then
    return null;
  end if;
  -- The freshest list from a key still trusted, and its content (kept with its serial's first check).
  select c.* into v_list from public.wivo_update_check c
   where c.result = 'accepted' and not public.wivo_key_revoked(c.key_id)
   order by c.expires desc, c.id desc limit 1;

  return jsonb_build_object(
    'channel', v_inst.channel,
    'installed', (select jsonb_build_object('version', u.to_version, 'at', u.at)
                    from public.wivo_update_install u where u.result = 'installed' order by u.id desc limit 1),
    'list', case when v_list.id is null then null else jsonb_build_object(
      'key_id', v_list.key_id, 'serial', v_list.serial, 'expires', v_list.expires, 'checked_at', v_list.at,
      'content', (select c.list from public.wivo_update_check c
                   where c.result = 'accepted' and c.key_id = v_list.key_id and c.serial = v_list.serial
                     and c.list is not null order by c.id limit 1)) end,
    'stale', not public.wivo_list_fresh(),
    'last_check', (select jsonb_build_object('at', c.at, 'result', c.result, 'reason', c.reason)
                     from public.wivo_update_check c order by c.id desc limit 1),
    'installs', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'at', u.at, 'from', u.from_version, 'to', u.to_version, 'mode', u.mode,
                   'by', u.by_name, 'result', u.result, 'reason', u.reason)) order by u.id desc)
                 from (select * from public.wivo_update_install order by id desc limit 20) u), '[]'::jsonb),
    'keys', coalesce((select jsonb_agg(jsonb_build_object('key_id', t.key_id, 'accepted_at', t.accepted_at) order by t.id)
                        from public.wivo_trust t where t.kind = 'certificate'), '[]'::jsonb)
  );
end;
$$;

-- ── Who may run what ────────────────────────────────────────────────────────

revoke execute on function public.wivo_append_only() from public, anon, authenticated, service_role;
revoke execute on function public.wivo_no_truncate() from public, anon, authenticated, service_role;
revoke execute on function public.wivo_instance_guard() from public, anon, authenticated, service_role;
revoke execute on function public.wivo_update_check_order() from public, anon, authenticated, service_role;
revoke execute on function public.wivo_key_revoked(text) from public, anon, authenticated, service_role;
revoke execute on function public.update_approvers() from public, anon, authenticated, service_role;
revoke execute on function public.wivo_audit(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.wivo_notify(text, jsonb, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.wivo_instance_create(text) from public, anon, authenticated, service_role;
revoke execute on function public.wivo_instance_claim(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.wivo_record_migration(text, text, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.wivo_record_trust(text, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.wivo_list_fresh() from public, anon, authenticated, service_role;
revoke execute on function public.wivo_record_check(uuid, text, text, text, bigint, text, timestamptz, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.wivo_record_install(text, text, text, text, uuid, text, text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.wivo_update_floor() from public, anon, authenticated, service_role;

revoke execute on function public.is_update_approver() from public, anon, authenticated, service_role;
revoke execute on function public.update_status() from public, anon;
grant execute on function public.update_status() to authenticated;

select public.ensure_mfa_policies();
select public.lock_anon_functions();
