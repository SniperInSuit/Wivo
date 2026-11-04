-- ============================================================================
-- Wivo — migration 110: "Delete account permanently" removes the sign-in
-- account with the profile, or nothing; with the second factor; on record
-- Run AFTER sql/109. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- sql/031's admin_delete_worker deletes the sign-in account (auth.users) and
-- lets the profile go with it (profiles.id references auth.users on delete
-- cascade). Three things it did not do:
--
-- 1. MAKE SURE BOTH ARE GONE. It trusted the cascade and did not count. On a
--    database whose foreign key a restore left out (sql/107), the sign-in
--    account goes and the profile stays; with no sign-in account behind the
--    profile, nothing at all is deleted. Both answered "done". Now the
--    sign-in account and the profile are gone together, or the call fails and
--    nothing changes. Then the address and the username are free: an invite
--    to the same address (team-account) makes a new account in the clinic.
--
-- 2. ASK FOR THE SECOND FACTOR ITSELF. The pre-request check (sql/098, 104)
--    refuses an aal1 session before any call, but it is a setting of the
--    `authenticator` role, which a restored copy may lack. Like sql/097's
--    owner actions, the function asks too (require_own_mfa).
--
-- 3. LEAVE A RECORD: an audit entry 'account_deleted' (object user:<id>, the
--    person's name in the detail), in the same transaction as the deletion:
--    one never happens without the other.
--
-- Unchanged: owner only, own clinic only, never oneself or an owner, and
-- refused for anyone with jobs, hours or payouts (their history must stay;
-- remove them from the team instead). Tests: sql/test/deleteAccount.test.ts.
-- ============================================================================

set lock_timeout = '10s';

alter table public.audit_log drop constraint if exists audit_log_action_valid;
alter table public.audit_log add constraint audit_log_action_valid
  check (action in ('view', 'download', 'upload', 'share', 'unshare', 'stage_move',
                    'partnership', 'export', 'question', 'delete', 'restore', 'stock_override',
                    'mfa_added', 'mfa_removed', 'mfa_reset', 'account_deleted'));

create or replace function public.admin_delete_worker(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.require_own_mfa();
  v_clinic  uuid;
  v_role    text;
  v_name    text;
  v_jobs    int;
  v_hours   int;
  v_payouts int;
  v_gone    int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and clinic_id = v_org and role = 'owner') then
    raise exception 'Ainult kliiniku omanik saab kontot kustutada';
  end if;

  if p_profile = auth.uid() then
    raise exception 'Iseennast ei saa kustutada';
  end if;

  select clinic_id, role, coalesce(full_name, '') into v_clinic, v_role, v_name
    from public.profiles
   where id = p_profile;

  if v_role is null then
    raise exception 'Kasutajat ei leitud';
  end if;

  if v_clinic is distinct from v_org then
    raise exception 'See kasutaja ei kuulu sinu kliinikusse. Lisa ta enne meeskonda tagasi.';
  end if;

  if v_role = 'owner' then
    raise exception 'Omaniku kontot ei saa kustutada';
  end if;

  select count(*) into v_jobs from public.jobs
   where assigned_to = p_profile or designed_by = p_profile;
  select count(*) into v_hours from public.work_hours where profile_id = p_profile;
  select count(*) into v_payouts from public.worker_payouts where profile_id = p_profile;

  if v_jobs > 0 or v_hours > 0 or v_payouts > 0 then
    raise exception
      'Kontot ei saa kustutada: seotud on % tööd, % tunnikirjet ja % väljamakset. Eemalda ta meeskonnast — ajalugu peab alles jääma.',
      v_jobs, v_hours, v_payouts;
  end if;

  perform public.audit(v_org, 'account_deleted', 'user:' || p_profile, jsonb_build_object('target_name', v_name));

  -- Nothing depends on them. Rates carry no history of their own once there are
  -- no payouts, so they go with the account.
  delete from public.worker_rates       where profile_id = p_profile;
  delete from public.worker_permissions where profile_id = p_profile;

  -- The sign-in account, and with it the profile: both, or neither.
  delete from auth.users where id = p_profile;
  get diagnostics v_gone = row_count;
  if v_gone <> 1 or exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'The sign-in account and the profile could not both be deleted; nothing was changed'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.admin_delete_worker(uuid) from public, anon;
grant execute on function public.admin_delete_worker(uuid) to authenticated;

select public.lock_anon_functions();
