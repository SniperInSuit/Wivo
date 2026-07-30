-- ============================================================================
-- Wivo — migration 031: delete a worker account for good
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   Removing someone from the clinic unlinks their profile but leaves the
--   account behind, because the app has no service_role key to destroy it with.
--   A mistyped account created twice by accident then sits there forever,
--   holding its username hostage.
--
-- WHAT IT REFUSES TO DO
--   It will not delete anyone who has left a trace. profiles.id cascades from
--   auth.users, and jobs.assigned_to is ON DELETE SET NULL — so deleting a
--   technician who has done work would silently strip their name off every job
--   they ever touched and leave payouts pointing at nobody. Payroll history that
--   cannot say who was paid is worse than a stale account.
--
--   So: jobs, hours, payouts or rates attached → refused, with a message saying
--   which. Remove them from the clinic instead; that revokes access and keeps
--   the record intact.
--
-- WHO
--   Owner only, target must be in the same clinic. Same rule as the password
--   reset: put someone back on the team before acting on them, so an orphaned
--   account can never be claimed by whichever clinic asks first.
-- ============================================================================

set lock_timeout = '10s';

create or replace function public.admin_delete_worker(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_clinic uuid;
  v_target_clinic uuid;
  v_target_role   text;
  v_jobs          int;
  v_hours         int;
  v_payouts       int;
begin
  select clinic_id into v_caller_clinic
    from public.profiles
   where id = auth.uid() and role = 'owner';

  if v_caller_clinic is null then
    raise exception 'Ainult kliiniku omanik saab kontot kustutada';
  end if;

  if p_profile = auth.uid() then
    raise exception 'Iseennast ei saa kustutada';
  end if;

  select clinic_id, role into v_target_clinic, v_target_role
    from public.profiles
   where id = p_profile;

  if v_target_role is null then
    raise exception 'Kasutajat ei leitud';
  end if;

  if v_target_clinic is distinct from v_caller_clinic then
    raise exception 'See kasutaja ei kuulu sinu kliinikusse. Lisa ta enne meeskonda tagasi.';
  end if;

  if v_target_role = 'owner' then
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

  -- Nothing depends on them. Rates carry no history of their own once there are
  -- no payouts, so they go with the account.
  delete from public.worker_rates       where profile_id = p_profile;
  delete from public.worker_permissions where profile_id = p_profile;

  -- profiles.id references auth.users(id) on delete cascade, so this removes
  -- the profile too, and frees the username.
  delete from auth.users where id = p_profile;
end;
$$;

revoke all on function public.admin_delete_worker(uuid) from public;
grant execute on function public.admin_delete_worker(uuid) to authenticated;
