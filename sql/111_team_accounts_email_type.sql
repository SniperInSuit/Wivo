-- ============================================================================
-- Wivo — migration 111: team_accounts() works on Supabase
-- Run AFTER sql/110. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- sql/100's team_accounts() has failed on every real project since it was
-- added: "structure of query does not match function result type". Its
-- RETURN QUERY hands back auth.users.email as the login, and on Supabase that
-- column is varchar(255), not the text the function promises; PL/pgSQL does
-- not convert. The test database declared it text, so no test saw it
-- (sql/test/supabaseShim.sql now has GoTrue's types).
--
-- What it broke:
--   - Team → Add staff member by e-mail: team-account made the account and
--     used the invite, could not confirm the new account was in the clinic,
--     answered 409 "This address already has a Wivo account" and sent no
--     e-mail. Asking again re-invited the same unconfirmed account and
--     failed the same way.
--   - Team: no login, no "invite waiting" and no "Send again" for anyone (the
--     app read the failure as "no information").
--   - team-account's "resend": refused.
--
-- The same function, with the address cast to text. Nothing else changes.
-- Tests: sql/test/accounts.test.ts.
-- ============================================================================

create or replace function public.team_accounts()
returns table (id uuid, login text, has_email boolean, invite_pending boolean)
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
           u.email_confirmed_at is null and not public.is_standin_email(u.email)
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.clinic_id = public.my_clinic_id()
       and p.role in ('owner', 'worker');
end;
$$;
revoke execute on function public.team_accounts() from public, anon;
grant execute on function public.team_accounts() to authenticated;

select public.lock_anon_functions();
