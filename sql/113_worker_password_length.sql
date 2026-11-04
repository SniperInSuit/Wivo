-- ============================================================================
-- Wivo — migration 113: a password the owner sets is at least 10 characters
-- Run AFTER sql/112.
-- ============================================================================
--
-- admin_set_worker_password (sql/030), Team → "Set a new password" for a
-- username account, writes the hash itself, so Supabase Auth's "Minimum
-- password length" never sees it. It still took 6 characters; every other
-- way to get a password takes 10 (the invite and reset page, a new username
-- account). Now this one does too. Everything else is as in sql/030.
--
-- Passwords already set are untouched: they keep signing in.
-- Tests: sql/test/workerPassword.test.ts.
-- ============================================================================

set lock_timeout = '10s';

create or replace function public.admin_set_worker_password(p_profile uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller_clinic uuid;
  v_target_clinic uuid;
  v_target_role   text;
begin
  if length(coalesce(p_password, '')) < 10 then
    raise exception 'Parool peab olema vähemalt 10 tähemärki';
  end if;

  select clinic_id into v_caller_clinic
    from public.profiles
   where id = auth.uid() and role = 'owner';

  if v_caller_clinic is null then
    raise exception 'Ainult kliiniku omanik saab paroole määrata';
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

  if v_target_role = 'owner' and p_profile <> auth.uid() then
    raise exception 'Teise omaniku parooli ei saa muuta';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_profile;
end;
$$;

revoke all on function public.admin_set_worker_password(uuid, text) from public, anon;
grant execute on function public.admin_set_worker_password(uuid, text) to authenticated;

select public.lock_anon_functions();
