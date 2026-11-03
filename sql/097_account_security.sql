-- ============================================================================
-- Wivo — migration 097: Settings → Security (authenticators, owner reset)
-- Run AFTER sql/096. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Each person's own Security settings, on the desktop and the phone:
--
-- 1. Removing one of one's own authenticators. Only in a session signed in
--    with the second factor (aal2), and only with proof given just now: a
--    current code from THAT authenticator, or the account password.
--    `authorize_mfa_removal` decides, as the person. The removal itself is
--    done by the Edge Function `account-security` (service key, GoTrue's
--    admin API); the browser never holds admin rights.
--    - The code: the app verifies it with GoTrue first (challenge + verify,
--      the normal sign-in step). GoTrue then writes it into the session: the
--      token's `amr` gets a fresh `totp` time, and the session (or the
--      challenge) names the factor. Both are checked here, from the signed
--      token and GoTrue's own tables — nothing the browser merely says.
--    - The password: checked here against GoTrue's bcrypt hash. Five wrong
--      passwords in 15 minutes and it stops answering (`mfa_attempt`).
-- 2. The last authenticator: the person is signed out everywhere (every
--    session ends, every phone stops getting pushes). At the next sign-in
--    the app makes them add one again (MfaGate, unchanged).
-- 3. An owner resets a member's two-factor sign-in: every factor goes, the
--    member is signed out everywhere. Owner only, aal2 only, a reason is
--    required, only for a member of the owner's own organisation, never for
--    another owner and never for oneself. `authorize_mfa_reset` decides, as
--    the owner; the Edge Function does it.
-- 4. Every add, remove and reset is in the organisation's audit log; the
--    person whose authenticator was removed or reset gets a bell
--    notification (and e-mail / push, as they chose).
--
-- A partner organisation can do none of this: every check is "the caller's
-- own factor" or "a member of the caller's own organisation", and the audit
-- rows and notifications stay in the organisation they are about.
--
-- Known limit: GoTrue's own API still lets an aal2 session remove its own
-- authenticator without the step-up and without these records (GoTrue has
-- no switch for that). The app never uses that path. Closing it would take a
-- trigger on auth.mfa_factors — Kevin's call (docs/night-run/RUN-4.md).
--
-- Tests: sql/test/accountSecurity.test.ts.
-- ============================================================================

-- GoTrue's tables are read, and its sessions ended, from the functions below.
-- The SQL editor's role has those rights on Supabase; if a project ever does
-- not, stop here rather than install functions that fail later.
do $$ begin
  if not (has_table_privilege('auth.mfa_factors', 'select')
          and has_table_privilege('auth.mfa_challenges', 'select')
          and has_table_privilege('auth.sessions', 'select')
          and has_table_privilege('auth.sessions', 'delete')
          and has_column_privilege('auth.users', 'encrypted_password', 'select')) then
    raise exception '097: this role cannot read auth.mfa_factors / auth.mfa_challenges / auth.users or end auth.sessions';
  end if;
end $$;

alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned',
                  'mfa_removed', 'mfa_reset'));

alter table public.audit_log drop constraint if exists audit_log_action_valid;
alter table public.audit_log add constraint audit_log_action_valid
  check (action in ('view', 'download', 'upload', 'share', 'unshare', 'stage_move',
                    'partnership', 'export', 'question', 'delete', 'restore', 'stock_override',
                    'mfa_added', 'mfa_removed', 'mfa_reset'));

-- ── Wrong passwords ─────────────────────────────────────────────────────────

create table if not exists public.mfa_attempt (
  id       bigint generated always as identity primary key,
  org_id   uuid not null references public.clinics(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  at       timestamptz not null default now()
);
create index if not exists mfa_attempt_user_at_idx on public.mfa_attempt (user_id, at desc);
alter table public.mfa_attempt enable row level security;

drop policy if exists "mfa_attempt_own" on public.mfa_attempt;
create policy "mfa_attempt_own" on public.mfa_attempt
  for select using (user_id = auth.uid() and org_id = public.my_org_id());
-- Written only by authorize_mfa_removal.

-- ── Proof given just now ────────────────────────────────────────────────────

/**
 * This session verified a code from `p_factor` in the last five minutes.
 *
 * - The token (signed by GoTrue; PostgREST checked it) says a `totp` code was
 *   verified in this session, and when.
 * - GoTrue's records say which authenticator: the session's factor, or a
 *   challenge of that factor verified in the same five minutes.
 */
create or replace function public.mfa_code_fresh(p_factor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1
             from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) a
            where a ->> 'method' = 'totp'
              and (a ->> 'timestamp') ~ '^\d{1,12}$'
              and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - 300)
     and (exists (select 1 from auth.sessions s
                   where s.id = public.as_uuid(auth.jwt() ->> 'session_id')
                     and s.user_id = auth.uid() and s.factor_id = p_factor)
          or exists (select 1 from auth.mfa_challenges c
                      where c.factor_id = p_factor and c.verified_at >= now() - interval '5 minutes'))
$$;
revoke execute on function public.mfa_code_fresh(uuid) from public, anon, authenticated;

/** The caller's own password, against GoTrue's hash. False when there is none (a Google account). */
create or replace function public.mfa_password_ok(p_password text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_hash text;
begin
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  if v_hash is null or v_hash !~ '^\$2[aby]\$' or p_password is null or p_password = '' then
    return false;
  end if;
  return extensions.crypt(p_password, v_hash) = v_hash;
exception when others then
  return false;  -- a hash pgcrypto cannot read is not a match
end;
$$;
revoke execute on function public.mfa_password_ok(text) from public, anon, authenticated;

/** Signed in, in an organisation, with the second factor in this session. */
create or replace function public.require_own_mfa()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.my_org_id();
begin
  if auth.uid() is null or v_org is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_mfa() then
    raise exception 'Sign in with your second factor first' using errcode = '42501', hint = 'mfa_required';
  end if;
  return v_org;
end;
$$;
revoke execute on function public.require_own_mfa() from public, anon, authenticated;

-- ── 1. Removing one's own authenticator ─────────────────────────────────────

/**
 * May the caller remove their own authenticator `p_factor` now?
 *
 * Proof: a code from that authenticator verified in this session just now,
 * else `p_password`. A refusal that should count (a wrong password) is
 * RETURNED, not raised, so the attempt is kept:
 *   { ok: false, error: 'proof_required' | 'wrong_password' | 'too_many_attempts' }
 *   { ok: true, user_id, org_id, factor_id, name, how: 'code' | 'password', last }
 * `last`: no other verified authenticator is left.
 */
create or replace function public.authorize_mfa_removal(p_factor uuid, p_password text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.require_own_mfa();
  v_uid  uuid := auth.uid();
  v_name text;
  v_how  text;
begin
  select coalesce(f.friendly_name, '') into v_name
    from auth.mfa_factors f
   where f.id = p_factor and f.user_id = v_uid and f.status = 'verified';
  if not found then
    -- Someone else's factor looks exactly like one that does not exist.
    raise exception 'No such authenticator on your account' using errcode = '42501';
  end if;

  if public.mfa_code_fresh(p_factor) then
    v_how := 'code';
  elsif p_password is null or p_password = '' then
    return jsonb_build_object('ok', false, 'error', 'proof_required');
  elsif (select count(*) from public.mfa_attempt where user_id = v_uid and at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  elsif public.mfa_password_ok(p_password) then
    v_how := 'password';
  else
    insert into public.mfa_attempt (org_id, user_id) values (v_org, v_uid);
    return jsonb_build_object('ok', false, 'error', 'wrong_password');
  end if;

  return jsonb_build_object(
    'ok', true, 'user_id', v_uid, 'org_id', v_org, 'factor_id', p_factor, 'name', v_name, 'how', v_how,
    'last', not exists (select 1 from auth.mfa_factors
                         where user_id = v_uid and status = 'verified' and id <> p_factor));
end;
$$;
revoke execute on function public.authorize_mfa_removal(uuid, text) from public, anon;

-- ── 3. The owner's reset ────────────────────────────────────────────────────

/**
 * May the caller reset `p_user`'s two-factor sign-in?
 * { ok: true, actor_id, user_id, org_id, name, factor_ids, reason } — every factor, verified or not.
 */
create or replace function public.authorize_mfa_reset(p_user uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.require_own_mfa();
  v_reason  text := btrim(coalesce(p_reason, ''));
  t         record;
  v_factors uuid[];
begin
  if not exists (select 1 from public.profiles
                  where id = auth.uid() and clinic_id = v_org and (role = 'owner' or org_role = 'owner')) then
    raise exception 'Only the owner can reset two-factor sign-in' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Give a reason (3 to 500 characters)' using errcode = '22023';
  end if;
  if p_user = auth.uid() then
    raise exception 'Not for yourself: use Settings → Security' using errcode = '42501';
  end if;
  select p.id, coalesce(p.full_name, '') as name, (p.role = 'owner' or p.org_role = 'owner') as is_owner into t
    from public.profiles p
   where p.id = p_user and p.clinic_id = v_org and p.role in ('owner', 'worker');
  if not found then
    raise exception 'Not a member of your organisation' using errcode = '42501';
  end if;
  if t.is_owner then
    raise exception 'Another owner''s two-factor sign-in cannot be reset' using errcode = '42501';
  end if;
  select coalesce(array_agg(id order by created_at), '{}') into v_factors from auth.mfa_factors where user_id = p_user;
  if cardinality(v_factors) = 0 then
    raise exception 'They have no authenticator: Wivo asks them to add one at their next sign-in'
      using errcode = '22023', hint = 'nothing_to_reset';
  end if;
  return jsonb_build_object('ok', true, 'actor_id', auth.uid(), 'user_id', p_user, 'org_id', v_org, 'name', t.name,
                            'factor_ids', to_jsonb(v_factors), 'reason', v_reason);
end;
$$;
revoke execute on function public.authorize_mfa_reset(uuid, text) from public, anon;

-- ── After the Edge Function removed the factors ─────────────────────────────

/**
 * The record, the notification and — when asked — the sign-out everywhere.
 * Service key only: the Edge Function calls it after GoTrue removed the
 * factors, with what `authorize_*` returned.
 */
create or replace function public.complete_mfa_change(
  p_kind text, p_org uuid, p_actor uuid, p_target uuid, p_detail jsonb, p_sign_out boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_name text;
  v_actor_name  text;
  v_detail      jsonb := coalesce(p_detail, '{}'::jsonb);
begin
  if p_kind not in ('mfa_removed', 'mfa_reset') then
    raise exception 'Unknown change %', p_kind using errcode = '22023';
  end if;
  select coalesce(full_name, '') into v_target_name from public.profiles where id = p_target and clinic_id = p_org;
  if not found then
    raise exception 'Not a member of that organisation' using errcode = '42501';
  end if;
  select coalesce(full_name, '') into v_actor_name from public.profiles where id = p_actor and clinic_id = p_org;
  if not found then
    raise exception 'The actor is not a member of that organisation' using errcode = '42501';
  end if;

  insert into public.audit_log (org_id, user_id, action, object, detail)
  values (p_org, p_actor, p_kind, 'user:' || p_target,
          v_detail || jsonb_build_object('target_name', v_target_name, 'signed_out', coalesce(p_sign_out, false)));

  insert into public.notification (org_id, user_id, kind, detail)
  values (p_org, p_target, p_kind, jsonb_strip_nulls(jsonb_build_object(
            'by', case when p_actor <> p_target then v_actor_name end,
            'reason', v_detail ->> 'reason',
            'name', v_detail ->> 'name',
            'signed_out', coalesce(p_sign_out, false))));

  if coalesce(p_sign_out, false) then
    -- Every session (their refresh tokens go with them); a token already
    -- handed out runs out within the hour. Phones stop getting pushes.
    delete from auth.sessions where user_id = p_target;
    delete from public.push_subscription where user_id = p_target;
  end if;
end;
$$;
revoke execute on function public.complete_mfa_change(text, uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated;

-- ── Adding: the audit row ───────────────────────────────────────────────────

/**
 * Logs each of the caller's verified authenticators that is not logged yet.
 * The app calls it after adding one; it reads GoTrue's own list, so it can
 * only ever record what really exists, and each factor only once.
 */
create or replace function public.record_mfa_factors()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  n     int;
begin
  if auth.uid() is null or v_org is null then
    return 0;
  end if;
  insert into public.audit_log (org_id, user_id, action, object, detail)
  select v_org, auth.uid(), 'mfa_added', 'user:' || auth.uid(),
         jsonb_build_object('factor_id', f.id, 'name', coalesce(f.friendly_name, ''), 'created_at', f.created_at)
    from auth.mfa_factors f
   where f.user_id = auth.uid() and f.status = 'verified'
     and not exists (select 1 from public.audit_log a
                      where a.org_id = v_org and a.action = 'mfa_added' and a.detail ->> 'factor_id' = f.id::text)
   order by f.created_at;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.record_mfa_factors() from public, anon;
