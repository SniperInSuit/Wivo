-- ============================================================================
-- Wivo — migration 120: a fresh second-factor code, and who may approve an update
-- Run AFTER sql/119. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- docs/ARCHITECTURE-INSTANCES.md 5b, docs/AGREEMENTS.md §2, the lawyer's L5.
-- Some actions ask for an authenticator code AT THAT MOMENT, even in a
-- session that already has the second factor: approving an update now,
-- signing an agreement or a treatment plan later. The database decides
-- whether the code is fresh, from the token GoTrue signed, so no client can
-- claim it.
--
-- 1. fresh_second_factor(max_age_seconds): the session has the second factor
--    (has_mfa(): aal2, and the session still exists), and its token records
--    an authenticator code entered at most that many seconds ago, by the
--    database's clock. GoTrue writes each method used in the session, with
--    its time, into the token's `amr` claim:
--      [{"method": "totp", "timestamp": 1762680000}, {"method": "password", ...}]
--    Entering a code again (supabase.auth.mfa.challenge + verify) refreshes
--    it. The age may be 30 seconds to 15 minutes, so no caller can ask for
--    "fresh within a day"; a time more than 30 seconds ahead is refused.
--
-- 2. update_approval(): for `wivo-update`, called with the person's own
--    token before an install. Their id, whether they approve updates for
--    the instance's clinic (sql/119), and whether their code is under 5
--    minutes old (5b). Null without the second factor.
--
-- Nothing changes for anyone today: nothing calls either yet.
-- Tests: sql/test/freshSecondFactor.test.ts.
-- ============================================================================

set lock_timeout = '10s';

create or replace function public.fresh_second_factor(p_max_age_seconds integer)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(p_max_age_seconds between 30 and 900, false)
     and public.has_mfa()
     and exists (
       select 1
         from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array'
                                        then auth.jwt() -> 'amr' else '[]'::jsonb end) e
        where e ->> 'method' = 'totp'
          -- CASE, not AND: only it guarantees the type is checked before the cast.
          and case when jsonb_typeof(e -> 'timestamp') = 'number'
                   then to_timestamp((e ->> 'timestamp')::double precision)
                          between now() - make_interval(secs => p_max_age_seconds)
                              and now() + interval '30 seconds'
                   else false end)
$$;

create or replace function public.update_approval()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.has_mfa() then jsonb_build_object(
    'user_id',  auth.uid(),
    'approver', public.is_update_approver(),
    'fresh',    public.fresh_second_factor(300)) end
$$;

revoke execute on function public.fresh_second_factor(integer) from public, anon;
grant execute on function public.fresh_second_factor(integer) to authenticated;
revoke execute on function public.update_approval() from public, anon;
grant execute on function public.update_approval() to authenticated;

select public.lock_anon_functions();
