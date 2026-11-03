-- ============================================================================
-- Wivo — migration 100: usernames per clinic; accounts made on the server
-- Run AFTER sql/099. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- docs/ACCOUNTS.md. Accounts are now made by the Edge Function `team-account`
-- (an owner, with the second factor): a real e-mail gets an invite link, a
-- person without one gets a stand-in `<username>.<clinic code>@nomail.wivodent.com`.
--
-- 1. USERNAMES PER CLINIC. sql/029 made a username unique across the whole
--    project, and its stand-in `<username>@example.com` was too: two clinics
--    could not both have a "tehnik", and the second one was told the name
--    existed somewhere. Now a name is unique within its clinic; the stand-in
--    carries the clinic's code, so it is unique in auth.users as well.
--    Accounts made before keep their example.com address and plain login.
--
-- 2. A STAND-IN ONLY WITH THE CLINIC'S INVITE. A new account on the stand-in
--    domain is refused unless it carries a valid invite of the clinic whose
--    code is in the address, and the address is exactly <its username>.<that
--    code>. So nobody can take another clinic's "tehnik" through the public
--    sign-up while it is still on (§5), and a mistake in the function cannot
--    put a person in the wrong clinic.
--
-- 3. THE PERSON'S LANGUAGE, from the invite, onto their profile.
--
-- 4. A REAL E-MAIL REPLACES THE STAND-IN (docs/ACCOUNTS.md §4.4): the username
--    is cleared, because from then on that person signs in with the e-mail.
--
-- 5. `team_accounts()`: for the owner's Team page, how each member signs in
--    and whether an invite is still waiting. It reads auth.users, so it is a
--    function that answers only the owner, with the second factor, about their
--    own clinic.
--
-- No new table. Tests: sql/test/accounts.test.ts.
-- ============================================================================

comment on column public.clinics.code_prefix is
  'Job-code prefix, unique. Also part of every stand-in login of this clinic '
  '(<username>.<code>@nomail.wivodent.com, sql/100): changing it in the SQL editor '
  'also needs  update auth.users set email = replace(email, ''.<old>@'', ''.<new>@'') '
  'where email like ''%.<old>@nomail.wivodent.com''  or those logins stop working.';

-- ── 1. Usernames per clinic ─────────────────────────────────────────────────

drop index if exists public.profiles_username_key;
create unique index if not exists profiles_clinic_username_key
  on public.profiles (clinic_id, lower(username))
  where username is not null;

-- ── 2 & 3. The signup trigger ───────────────────────────────────────────────

/**
 * 086's trigger with per-clinic usernames, the stand-in rule and the language.
 * A valid, unused, unexpired invite token puts the new person into that clinic
 * as a technician in the same transaction. Without a token, unchanged — except
 * that a stand-in address is refused.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  user_role  text;
  v_token    text := new.raw_user_meta_data ->> 'invite_token';
  v_invite   public.worker_invite;
  v_username text := nullif(lower(btrim(new.raw_user_meta_data ->> 'username')), '');
  v_language text := nullif(new.raw_user_meta_data ->> 'language', '');
  v_code     text;
  v_standin  boolean := lower(split_part(coalesce(new.email, ''), '@', 2)) = 'nomail.wivodent.com';
begin
  if (select count(*) from public.profiles) = 0 then
    user_role := 'owner';
  else
    user_role := 'worker';
  end if;
  if v_language not in ('en', 'et', 'ru') then v_language := null; end if;

  if v_token is not null then
    update public.worker_invite
       set used_at = now(), used_by = new.id
     where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       and used_at is null and expires_at > now()
    returning * into v_invite;
  end if;

  if v_standin then
    select lower(code_prefix) into v_code from public.clinics where id = v_invite.clinic_id;
    if v_invite.id is null or v_code is null or v_username is null
       or lower(new.email) <> v_username || '.' || v_code || '@nomail.wivodent.com' then
      raise exception 'A login without e-mail is made by the clinic''s owner in Wivo'
        using errcode = '42501', hint = 'standin_needs_invite';
    end if;
  end if;

  if v_invite.id is not null then
    insert into public.profiles (id, full_name, role, clinic_id, org_role, username, language)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', ''),
      'worker',
      v_invite.clinic_id,
      'technician',
      -- A taken username is left empty rather than failing the whole signup
      -- (the old app checks and says so). A stand-in's is never taken: its
      -- address, unique in auth.users, carries it.
      case when v_username is not null
                and not exists (select 1 from public.profiles
                                 where clinic_id = v_invite.clinic_id and lower(username) = v_username)
           then v_username end,
      v_language
    );
  else
    insert into public.profiles (id, full_name, role, language)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), user_role, v_language);
  end if;
  return new;
end;
$$;

-- ── 4. A real e-mail replaces the stand-in ──────────────────────────────────

create or replace function public.on_auth_email_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_standin_email(old.email) and new.email is not null and not public.is_standin_email(new.email) then
    update public.profiles set username = null, updated_at = now() where id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.on_auth_email_changed() from public, anon, authenticated;

drop trigger if exists on_auth_email_changed on auth.users;
create trigger on_auth_email_changed
  after update of email on auth.users
  for each row execute function public.on_auth_email_changed();

-- ── 5. How each member signs in ─────────────────────────────────────────────

/**
 * For the owner's Team page: per member of the caller's clinic, the login a
 * person types (`tehnik@tal`, an old `tehnik`, or the address) and whether an
 * e-mail invite is still waiting to be accepted. Owner only, second factor
 * only, own clinic only.
 */
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
             else u.email
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
