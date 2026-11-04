-- ============================================================================
-- Wivo — migration 112: the Team page shows who has an authenticator
-- Run AFTER sql/111. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- team_accounts() (sql/100, 111) gains one yes/no column, has_authenticator:
-- whether the member has a verified authenticator. Nothing else about the
-- factors leaves the database: not how many, which kind, their names or when
-- they were added. Still only the owner, with the second factor, about their
-- own clinic.
--
-- "Verified" on the Team page needs nothing new: an e-mail account whose
-- invite is not pending (has_email and not invite_pending).
--
-- The return type changes, so the function is dropped and made again, in the
-- same run. An older app reads the same rows and ignores the new column; the
-- Edge Function team-account does the same, so it needs no deploy.
-- Tests: sql/test/accounts.test.ts.
-- ============================================================================

drop function if exists public.team_accounts();

create function public.team_accounts()
returns table (id uuid, login text, has_email boolean, invite_pending boolean, has_authenticator boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_mfa() then
    raise exception 'Sign in with your second factor first' using errcode = '42501', hint = 'mfa_required';
  end if;
  if public.my_clinic_id() is null or public.my_role() <> 'owner' then
    raise exception 'Only the clinic''s owner can see this' using errcode = '42501';
  end if;
  return query
    select p.id,
           case
             when lower(split_part(u.email, '@', 2)) = 'nomail.wivodent.com'
               then regexp_replace(split_part(lower(u.email), '@', 1), '\.([a-z0-9]+)$', '@\1')
             when public.is_standin_email(u.email) then split_part(lower(u.email), '@', 1)
             else u.email::text
           end,
           not public.is_standin_email(u.email),
           u.email_confirmed_at is null and not public.is_standin_email(u.email),
           exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.clinic_id = public.my_clinic_id()
       and p.role in ('owner', 'worker');
end;
$$;
revoke execute on function public.team_accounts() from public, anon;
grant execute on function public.team_accounts() to authenticated;

select public.lock_anon_functions();
