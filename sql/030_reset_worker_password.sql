-- ============================================================================
-- Wivo — migration 030: owner can set a worker's password
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- THE PROBLEM
--   A worker account is created with a password the owner types. Get it wrong,
--   and there is no way back: the account cannot be deleted from the app (that
--   needs a service_role key, which must never ship in a desktop client), it
--   cannot be recreated (the address is taken), and it cannot receive a reset
--   email (the address is synthetic and deliberately unroutable).
--
--   So the owner has to be able to set it directly. That is also simply how an
--   in-house account works: the person who hands out the login hands out a new
--   one when it is forgotten.
--
-- HOW
--   GoTrue stores a bcrypt hash in auth.users.encrypted_password, so a hash made
--   with crypt(pw, gen_salt('bf')) is one it accepts. Writing to the auth schema
--   is not a Supabase-supported interface and could in principle change with a
--   GoTrue release — this function is the one place that does it, so there is a
--   single thing to check if a future upgrade breaks logins.
--
-- WHO
--   Owner only, and only for someone in their own clinic. Deliberately NOT for
--   unlinked profiles: an orphaned account belongs to no clinic, so any owner
--   could otherwise claim it. Put the person back on the team first, then reset.
--   An owner cannot change another owner's password.
-- ============================================================================

set lock_timeout = '10s';

create extension if not exists pgcrypto with schema extensions;

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
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Parool peab olema vähemalt 6 tähemärki';
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

revoke all on function public.admin_set_worker_password(uuid, text) from public;
grant execute on function public.admin_set_worker_password(uuid, text) to authenticated;
