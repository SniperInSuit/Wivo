-- ============================================================================
-- Wivo — migration 070: organisations, partnerships, shared jobs, audit log
-- Run AFTER sql/069. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Wivo 2.0 spec, Phase 1, "Organisations and sharing" + "Creating a partnership".
--
-- ── An organisation is a `clinics` row ──────────────────────────────────────
-- docs/night-run/DECISIONS.md D9. `clinics` already is the tenant, so the
-- existing clinic IS the Tallinn organisation and no row moves. It gains the
-- columns the spec names; `profiles` (one user, one organisation) gains
-- `org_role` and `language`. The views `organization` and `org_member` show
-- them under the spec's names. New tables say `org_id`, referencing clinics.
--
-- ── Partners never read the owner's tables ──────────────────────────────────
-- Spec: "a partner reaches shared jobs ONLY through partner_job_view and RPCs,
-- never directly from the tables." Nothing in this file widens a policy on
-- jobs or patients. `job_share` says which job is shared with whom; the view
-- and RPCs in sql/071 read through it. That single access layer is what later
-- lets a relay between two separate databases slot in without touching the UI.
--
-- ── Every step of a partnership is an admin action, with MFA, and audited ───
-- Spec, "Creating a partnership", steps 1–7. A code alone grants nothing; the
-- partnership is active only after both admins AND a Wivo admin confirmed
-- (DECISIONS.md D11). Only the code's hash is stored. Wrong codes are rate
-- limited per organisation.
-- ============================================================================

-- ── Organisation columns ────────────────────────────────────────────────────

alter table public.clinics
  add column if not exists country          text not null default 'EE',
  add column if not exists default_language text not null default 'et',
  add column if not exists home_instance    text not null default 'wivo-eu-1',
  add column if not exists code_prefix      text;

do $$ begin
  alter table public.clinics add constraint clinics_default_language_valid
    check (default_language in ('en', 'et', 'ru'));
exception when duplicate_object then null; end $$;

/** A free job-code prefix for an organisation name: 3 letters, unique. */
create or replace function public.free_code_prefix(p_name text, p_except uuid default null)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_base text := upper(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z]', '', 'g'), 3));
  v_try  text;
  n      int := 1;
begin
  if length(v_base) < 2 then v_base := 'ORG'; end if;
  v_try := v_base;
  while exists (select 1 from public.clinics where code_prefix = v_try and id is distinct from p_except) loop
    n := n + 1;
    v_try := v_base || n;
  end loop;
  return v_try;
end;
$$;

do $$
declare c record;
begin
  for c in select id, name from public.clinics where code_prefix is null order by created_at loop
    update public.clinics set code_prefix = public.free_code_prefix(c.name, c.id) where id = c.id;
  end loop;
end $$;

create unique index if not exists clinics_code_prefix_key on public.clinics (code_prefix);

create or replace function public.set_code_prefix()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.code_prefix is null then
    new.code_prefix := public.free_code_prefix(new.name, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists set_code_prefix on public.clinics;
create trigger set_code_prefix before insert on public.clinics
  for each row execute function public.set_code_prefix();

-- ── Member columns ──────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists org_role text,
  add column if not exists language text;

do $$ begin
  alter table public.profiles add constraint profiles_org_role_valid
    check (org_role in ('owner', 'admin', 'doctor', 'technician', 'assistant'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_language_valid
    check (language in ('en', 'et', 'ru'));
exception when duplicate_object then null; end $$;

update public.profiles
   set org_role = case role when 'owner' then 'owner' else 'technician' end
 where org_role is null and role in ('owner', 'worker') and clinic_id is not null;

/** Spec name for `my_clinic_id()`. */
create or replace function public.my_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select clinic_id from public.profiles where id = auth.uid() $$;

/** Owner or admin of their organisation — who may run partnerships. */
create or replace function public.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and clinic_id is not null
       and (role = 'owner' or org_role in ('owner', 'admin'))
  )
$$;

/** Signed in with a second factor in THIS session (Supabase: aal2). */
create or replace function public.has_mfa()
returns boolean
language sql
stable
set search_path = public
as $$ select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' $$;

/**
 * 068's guard, extended to `org_role`. Same four allowed changes; the rank an
 * owner gives (rule 4) may now be any org role, and `role` follows it so the
 * permission checks that read `role = 'owner'` stay right. Nobody changes
 * their own org_role.
 */
create or replace function public.guard_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_clin uuid;
  v_role text;
begin
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.clinic_id := null;
    new.role := 'worker';
    new.org_role := null;
    new.removed_from := null;
    return new;
  end if;

  if new.role is not distinct from old.role
     and new.org_role is not distinct from old.org_role
     and new.clinic_id is not distinct from old.clinic_id
     and new.removed_from is not distinct from old.removed_from then
    return new;
  end if;

  select clinic_id, role into v_clin, v_role from public.profiles where id = v_uid;

  -- 1. Founding a clinic.
  if new.id = v_uid and old.clinic_id is null and new.clinic_id is not null
     and exists (select 1 from public.clinics c where c.id = new.clinic_id and c.created_by = v_uid) then
    new.role := 'owner';
    new.org_role := 'owner';
    new.removed_from := null;
    return new;
  end if;

  if v_role = 'owner' and v_clin is not null and new.id <> v_uid
     and new.role is not distinct from old.role then
    -- 2. Removing.
    if old.clinic_id = v_clin and new.clinic_id is null then
      new.removed_from := v_clin;
      return new;
    end if;
    -- 3. Adding: never straight in as owner.
    if old.clinic_id is null and new.clinic_id = v_clin
       and (old.removed_from = v_clin
            or (old.removed_from is null and old.created_at > now() - interval '1 hour')) then
      new.removed_from := null;
      if new.org_role is null or new.org_role = 'owner' then
        new.org_role := 'technician';
      end if;
      return new;
    end if;
  end if;

  -- 4. Rank within the clinic, set by an owner for someone else.
  if v_role = 'owner' and new.id <> v_uid
     and old.clinic_id = v_clin and new.clinic_id is not distinct from old.clinic_id
     and old.role in ('owner', 'worker') and new.role in ('owner', 'worker')
     and new.removed_from is not distinct from old.removed_from then
    if new.org_role is distinct from old.org_role then
      new.role := case when new.org_role = 'owner' then 'owner' else 'worker' end;
    elsif new.role is distinct from old.role then
      new.org_role := case when new.role = 'owner' then 'owner' else 'technician' end;
    end if;
    return new;
  end if;

  raise exception 'Not allowed to change role or clinic of this profile'
    using errcode = '42501';
end;
$$;

-- The spec's names, with the caller's rights (RLS of clinics/profiles applies).
create or replace view public.organization with (security_invoker = true) as
  select id, name, country, default_language, home_instance, code_prefix, created_at
    from public.clinics;

create or replace view public.org_member with (security_invoker = true) as
  select clinic_id as org_id, id as user_id, coalesce(org_role, 'technician') as role, language
    from public.profiles
   where clinic_id is not null and role in ('owner', 'worker');

-- ── Audit log: append only ──────────────────────────────────────────────────

create table if not exists public.audit_log (
  id       bigint generated always as identity primary key,
  org_id   uuid not null references public.clinics(id) on delete cascade,
  user_id  uuid references auth.users(id) on delete set null,
  action   text not null,
  object   text not null,
  detail   jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);
create index if not exists audit_log_org_at_idx on public.audit_log (org_id, at desc);

do $$ begin
  alter table public.audit_log add constraint audit_log_action_valid
    check (action in ('view', 'download', 'upload', 'share', 'unshare', 'stage_move',
                      'partnership', 'export', 'question'));
exception when duplicate_object then null; end $$;

alter table public.audit_log enable row level security;

drop policy if exists "audit_log_select" on public.audit_log;
create policy "audit_log_select" on public.audit_log
  for select using (org_id = public.my_org_id() and public.is_org_admin());
-- No insert / update / delete policy: rows are written only by `audit()`,
-- from inside other SECURITY DEFINER functions.

/** Nothing a user does rewrites or removes history. */
create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' or auth.uid() is not null then
    raise exception 'audit_log is append-only' using errcode = '42501';
  end if;
  return old;  -- a DELETE with no user: an organisation being removed (cascade)
end;
$$;

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();

create or replace function public.audit(p_org uuid, p_action text, p_object text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log (org_id, user_id, action, object, detail)
  values (p_org, auth.uid(), p_action, p_object, coalesce(p_detail, '{}'::jsonb))
$$;
revoke execute on function public.audit(uuid, text, text, jsonb) from public, anon, authenticated;

-- ── Partnerships ────────────────────────────────────────────────────────────

create table if not exists public.partnership (
  id                  uuid primary key default gen_random_uuid(),
  org_a               uuid not null references public.clinics(id) on delete cascade,  -- inviter
  org_b               uuid not null references public.clinics(id) on delete cascade,  -- invitee
  share_stock         boolean not null default false,
  default_visibility  text not null default 'partial',
  roles               text[] not null default '{}',
  dpa_reference       text,
  status              text not null default 'awaiting_inviter',
  accepted_by         uuid references auth.users(id) on delete set null,
  accepted_at         timestamptz,
  confirmed_by        uuid references auth.users(id) on delete set null,
  confirmed_at        timestamptz,
  approved_at         timestamptz,
  suspended_by        uuid references auth.users(id) on delete set null,
  suspended_at        timestamptz,
  ended_by            uuid references auth.users(id) on delete set null,
  ended_at            timestamptz,
  readonly_until      timestamptz,
  created_at          timestamptz not null default now(),
  constraint partnership_two_orgs check (org_a <> org_b),
  constraint partnership_visibility_valid check (default_visibility in ('partial', 'full')),
  constraint partnership_roles_valid check (roles <@ array['design', 'surgery', 'supplier']::text[]),
  constraint partnership_status_valid check (status in
    ('awaiting_inviter', 'awaiting_platform', 'active', 'suspended', 'ended'))
);
create unique index if not exists partnership_pair_live_key on public.partnership
  (least(org_a, org_b), greatest(org_a, org_b)) where status <> 'ended';

alter table public.partnership enable row level security;
drop policy if exists "partnership_select" on public.partnership;
create policy "partnership_select" on public.partnership
  for select using (org_a = public.my_org_id() or org_b = public.my_org_id());
-- Writes only through the RPCs below.

create table if not exists public.partnership_invite (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.clinics(id) on delete cascade,
  code_hash   text not null unique,
  expires_at  timestamptz not null default now() + interval '7 days',
  used_at     timestamptz,
  used_by_org uuid references public.clinics(id) on delete set null,
  attempts    int not null default 0,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.partnership_invite enable row level security;
drop policy if exists "partnership_invite_select" on public.partnership_invite;
create policy "partnership_invite_select" on public.partnership_invite
  for select using (org_id = public.my_org_id() and public.is_org_admin());

/** Every code typed in, right or wrong — what the attempt limit counts. */
create table if not exists public.partnership_invite_attempt (
  id      bigint generated always as identity primary key,
  org_id  uuid not null references public.clinics(id) on delete cascade,
  ok      boolean not null,
  at      timestamptz not null default now()
);
alter table public.partnership_invite_attempt enable row level security;
drop policy if exists "partnership_invite_attempt_select" on public.partnership_invite_attempt;
create policy "partnership_invite_attempt_select" on public.partnership_invite_attempt
  for select using (org_id = public.my_org_id() and public.is_org_admin());

-- ── Shared jobs ─────────────────────────────────────────────────────────────

create table if not exists public.job_share (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs(id) on delete cascade,
  owner_org        uuid not null references public.clinics(id) on delete cascade,
  partner_org      uuid not null references public.clinics(id) on delete cascade,
  partnership_id   uuid not null references public.partnership(id) on delete cascade,
  case_type        text not null default 'lab_work',
  visibility       text not null default 'partial',
  role             text not null default 'design',
  assigned_stages  text[] not null default '{}',
  partner_price    numeric(10, 2),
  consent_by       uuid references auth.users(id) on delete set null,
  consent_at       timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  constraint job_share_two_orgs check (owner_org <> partner_org),
  constraint job_share_case_type_valid check (case_type in ('lab_work', 'referral')),
  constraint job_share_visibility_valid check (visibility in ('partial', 'full')),
  constraint job_share_role_valid check (role in ('design', 'surgery', 'supplier')),
  -- Spec: a referral is FULL visibility and needs "patient informed and
  -- agreed", with who marked it and when.
  constraint job_share_referral_consent check (
    case_type <> 'referral'
    or (visibility = 'full' and consent_by is not null and consent_at is not null))
);
create unique index if not exists job_share_live_key on public.job_share (job_id, partner_org) where revoked_at is null;
create index if not exists job_share_partner_idx on public.job_share (partner_org) where revoked_at is null;

alter table public.job_share enable row level security;
drop policy if exists "job_share_select" on public.job_share;
create policy "job_share_select" on public.job_share
  for select using (owner_org = public.my_org_id() or partner_org = public.my_org_id());
-- Writes only through share_job / unshare_job (sql/071).

-- ── Allowed stage moves ─────────────────────────────────────────────────────

create table if not exists public.stage_transition (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.clinics(id) on delete cascade,
  from_stage  text not null,
  to_stage    text not null,
  actor       text not null,
  constraint stage_transition_actor_valid check (actor in ('owner', 'partner')),
  constraint stage_transition_unique unique (org_id, from_stage, to_stage, actor)
);
alter table public.stage_transition enable row level security;
drop policy if exists "stage_transition_select" on public.stage_transition;
create policy "stage_transition_select" on public.stage_transition
  for select using (org_id = public.my_org_id());
drop policy if exists "stage_transition_manage" on public.stage_transition;
create policy "stage_transition_manage" on public.stage_transition
  for all using (org_id = public.my_org_id() and public.is_org_admin())
  with check (org_id = public.my_org_id() and public.is_org_admin());

-- ── Job codes (DECISIONS.md D10) ────────────────────────────────────────────

alter table public.jobs add column if not exists job_code text;

create table if not exists public.job_code_counter (
  org_id  uuid not null references public.clinics(id) on delete cascade,
  year    int not null,
  last    int not null default 0,
  primary key (org_id, year)
);
alter table public.job_code_counter enable row level security;
drop policy if exists "job_code_counter_select" on public.job_code_counter;
create policy "job_code_counter_select" on public.job_code_counter
  for select using (org_id = public.my_org_id());

create or replace function public.next_job_code(p_org uuid, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from coalesce(p_at, now()))::int;
  v_n    int;
begin
  insert into public.job_code_counter (org_id, year, last) values (p_org, v_year, 1)
  on conflict (org_id, year) do update set last = public.job_code_counter.last + 1
  returning last into v_n;
  return (select code_prefix from public.clinics where id = p_org)
         || '-' || lpad((v_year % 100)::text, 2, '0') || '-' || lpad(v_n::text, 4, '0');
end;
$$;
revoke execute on function public.next_job_code(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.set_job_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.job_code is null and new.clinic_id is not null then
    new.job_code := public.next_job_code(new.clinic_id, coalesce(new.created_at, now()));
  end if;
  return new;
end;
$$;

drop trigger if exists set_job_code on public.jobs;
create trigger set_job_code before insert on public.jobs
  for each row execute function public.set_job_code();

do $$
declare j record;
begin
  for j in select id, clinic_id, created_at from public.jobs
            where job_code is null and clinic_id is not null order by created_at, id loop
    update public.jobs set job_code = public.next_job_code(j.clinic_id, j.created_at) where id = j.id;
  end loop;
end $$;

create unique index if not exists jobs_job_code_key on public.jobs (job_code);

-- ── Partnership RPCs ────────────────────────────────────────────────────────

/** The common gate: an org admin, with MFA. */
create or replace function public.require_admin_mfa()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.my_org_id();
begin
  if v_org is null or not public.is_org_admin() then
    raise exception 'Only an organisation admin can do this' using errcode = '42501';
  end if;
  if not public.has_mfa() then
    raise exception 'Sign in with two-factor authentication first' using errcode = '42501', hint = 'mfa_required';
  end if;
  return v_org;
end;
$$;

/**
 * Step 1. A one-time code, valid 7 days, tied to the caller's organisation.
 * Returned ONCE; only its SHA-256 is stored.
 */
create or replace function public.create_partnership_invite()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org   uuid := public.require_admin_mfa();
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code  text := 'WIVO-';
  i       int;
begin
  for i in 0..7 loop
    if i = 4 then v_code := v_code || '-'; end if;
    v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  insert into public.partnership_invite (org_id, code_hash, created_by)
  values (v_org, encode(extensions.digest(v_code, 'sha256'), 'hex'), auth.uid());
  perform public.audit(v_org, 'partnership', 'invite', jsonb_build_object('step', 'invite_created'));
  return v_code;
end;
$$;

/** Wrong codes allowed per organisation per hour. */
create or replace function public.invite_attempts_left(p_org uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, 5 - count(*)::int) from public.partnership_invite_attempt
   where org_id = p_org and not ok and at > now() - interval '1 hour'
$$;

/** The live invite for a typed code, counting the attempt. Null if none. */
create or replace function public.find_invite(p_org uuid, p_code text)
returns public.partnership_invite
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v public.partnership_invite;
begin
  if public.invite_attempts_left(p_org) <= 0 then
    raise exception 'Too many wrong codes. Try again in an hour.' using errcode = '42501', hint = 'rate_limited';
  end if;
  select * into v from public.partnership_invite
   where code_hash = encode(extensions.digest(upper(btrim(p_code)), 'sha256'), 'hex')
     and used_at is null and expires_at > now() and org_id <> p_org;
  insert into public.partnership_invite_attempt (org_id, ok) values (p_org, v.id is not null);
  if v.id is not null then
    update public.partnership_invite set attempts = attempts + 1 where id = v.id;
  end if;
  return v;
end;
$$;
revoke execute on function public.find_invite(uuid, text) from public, anon, authenticated;

/** Step 3. Who is inviting: name, country, registry code. Nothing else. */
create or replace function public.preview_partnership_invite(p_code text)
returns table (org_name text, country text, reg_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.require_admin_mfa();
  v     public.partnership_invite;
begin
  v := public.find_invite(v_org, p_code);
  if v.id is null then
    return;
  end if;
  return query
    select c.name, c.country, c.reg_code, v.expires_at from public.clinics c where c.id = v.org_id;
end;
$$;

/** Step 4. The invitee accepts with its terms. Still grants nothing. */
create or replace function public.accept_partnership_invite(
  p_code text,
  p_share_stock boolean,
  p_default_visibility text,
  p_roles text[],
  p_dpa_reference text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.require_admin_mfa();
  v     public.partnership_invite;
  v_id  uuid;
begin
  if coalesce(btrim(p_dpa_reference), '') = '' then
    raise exception 'A reference to the signed data processing agreement is required' using errcode = '22023';
  end if;
  v := public.find_invite(v_org, p_code);
  if v.id is null then
    raise exception 'This code is not valid, has expired or was already used' using errcode = '22023';
  end if;
  insert into public.partnership (org_a, org_b, share_stock, default_visibility, roles, dpa_reference,
                                  status, accepted_by, accepted_at)
  values (v.org_id, v_org, coalesce(p_share_stock, false), coalesce(p_default_visibility, 'partial'),
          coalesce(p_roles, '{}'), btrim(p_dpa_reference), 'awaiting_inviter', auth.uid(), now())
  returning id into v_id;
  update public.partnership_invite set used_at = now(), used_by_org = v_org where id = v.id;
  perform public.audit(v.org_id, 'partnership', 'partnership:' || v_id, jsonb_build_object('step', 'accepted_by_partner'));
  perform public.audit(v_org, 'partnership', 'partnership:' || v_id, jsonb_build_object('step', 'accepted'));
  return v_id;
end;
$$;

/** Step 5. The inviter confirms the terms. Then Wivo approves (step 7). */
create or replace function public.confirm_partnership(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.require_admin_mfa();
  p     public.partnership;
begin
  select * into p from public.partnership where id = p_id for update;
  if p.id is null or p.org_a <> v_org or p.status <> 'awaiting_inviter' then
    raise exception 'Nothing to confirm' using errcode = '22023';
  end if;
  update public.partnership set status = 'awaiting_platform', confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_id;
  perform public.audit(p.org_a, 'partnership', 'partnership:' || p_id, jsonb_build_object('step', 'confirmed'));
  perform public.audit(p.org_b, 'partnership', 'partnership:' || p_id, jsonb_build_object('step', 'confirmed_by_partner'));
end;
$$;

/** Step 7: a Wivo admin approves. Service role / SQL editor only. */
create or replace function public.platform_approve_partnership(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare p public.partnership;
begin
  select * into p from public.partnership where id = p_id for update;
  if p.id is null or p.status <> 'awaiting_platform' then
    raise exception 'Partnership is not awaiting approval' using errcode = '22023';
  end if;
  update public.partnership set status = 'active', approved_at = now() where id = p_id;
  perform public.audit(p.org_a, 'partnership', 'partnership:' || p_id, jsonb_build_object('step', 'approved_by_wivo'));
  perform public.audit(p.org_b, 'partnership', 'partnership:' || p_id, jsonb_build_object('step', 'approved_by_wivo'));
end;
$$;
revoke execute on function public.platform_approve_partnership(uuid) from public, anon, authenticated;

/**
 * Step 6. Either side pauses, resumes or ends. After the end no new job can be
 * shared, and jobs already shared stay readable for `p_readonly_days`.
 */
create or replace function public.set_partnership_status(p_id uuid, p_status text, p_readonly_days int default 90)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.require_admin_mfa();
  p     public.partnership;
begin
  select * into p from public.partnership where id = p_id for update;
  if p.id is null or v_org not in (p.org_a, p.org_b) then
    raise exception 'Partnership not found' using errcode = '22023';
  end if;
  if p_status = 'suspended' and p.status = 'active' then
    update public.partnership set status = 'suspended', suspended_by = auth.uid(), suspended_at = now() where id = p_id;
  elsif p_status = 'active' and p.status = 'suspended' then
    update public.partnership set status = 'active', suspended_by = null, suspended_at = null where id = p_id;
  elsif p_status = 'ended' and p.status <> 'ended' then
    update public.partnership
       set status = 'ended', ended_by = auth.uid(), ended_at = now(),
           readonly_until = now() + make_interval(days => greatest(coalesce(p_readonly_days, 90), 0))
     where id = p_id;
  else
    raise exception 'Cannot change a % partnership to %', p.status, p_status using errcode = '22023';
  end if;
  perform public.audit(p.org_a, 'partnership', 'partnership:' || p_id, jsonb_build_object('step', p_status));
  perform public.audit(p.org_b, 'partnership', 'partnership:' || p_id, jsonb_build_object('step', p_status));
end;
$$;

/** The other organisation's name, for partnerships you are in. */
create or replace function public.partner_orgs()
returns table (partnership_id uuid, org_id uuid, name text, country text, status text,
               share_stock boolean, default_visibility text, roles text[], i_am_inviter boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         case when p.org_a = public.my_org_id() then p.org_b else p.org_a end,
         c.name, c.country, p.status, p.share_stock, p.default_visibility, p.roles,
         p.org_a = public.my_org_id()
    from public.partnership p
    join public.clinics c on c.id = case when p.org_a = public.my_org_id() then p.org_b else p.org_a end
   where public.my_org_id() in (p.org_a, p.org_b)
$$;
