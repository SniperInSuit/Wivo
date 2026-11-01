-- ============================================================================
-- Wivo — migration 086: adding a worker with an invite token
-- Run AFTER sql/085. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Until now "Add worker" signed the account up and then LINKED it with a second
-- update, which needed the owner to see a clinic-less profile — the window
-- that two reviews narrowed (083, 085) but could not close: any owner on the
-- project could see, and race to link, a signup in those minutes.
--
-- Now the owner's app first asks for a one-time token (10 minutes, only its
-- hash stored), signs the new account up with the token in its metadata, and
-- the signup trigger puts the person straight into the owner's clinic, as a
-- technician, in the same transaction that creates them. Nothing has to see a
-- clinic-less profile; nothing can be raced.
--
-- The window in profiles_read stays for app builds released before this one.
-- Once every computer runs the new build, remove it (MORNING.md has the SQL).
-- ============================================================================

create table if not exists public.worker_invite (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  token_hash  text not null unique,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes',
  used_at     timestamptz,
  used_by     uuid references auth.users(id) on delete set null
);
alter table public.worker_invite enable row level security;
drop policy if exists "worker_invite_select" on public.worker_invite;
create policy "worker_invite_select" on public.worker_invite
  for select using (clinic_id = public.my_clinic_id() and public.my_role() = 'owner');
-- Written only by create_worker_invite and the signup trigger.

/** A one-time token for the account the owner is about to create. */
create or replace function public.create_worker_invite()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clinic uuid := public.my_clinic_id();
  v_token  text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if v_clinic is null or public.my_role() <> 'owner' then
    raise exception 'Only a clinic owner can add workers' using errcode = '42501';
  end if;
  insert into public.worker_invite (clinic_id, token_hash, created_by)
  values (v_clinic, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid());
  return v_token;
end;
$$;

/**
 * 012's signup trigger, plus the invite: a valid, unused, unexpired token in
 * the new user's metadata makes them a technician of that clinic at once,
 * with the username asked for when it is free. Without a token, unchanged.
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
begin
  if (select count(*) from public.profiles) = 0 then
    user_role := 'owner';
  else
    user_role := 'worker';
  end if;

  if v_token is not null then
    update public.worker_invite
       set used_at = now(), used_by = new.id
     where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       and used_at is null and expires_at > now()
    returning * into v_invite;
  end if;

  if v_invite.id is not null then
    insert into public.profiles (id, full_name, role, clinic_id, org_role, username)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', ''),
      'worker',
      v_invite.clinic_id,
      'technician',
      -- A taken username is left empty rather than failing the whole signup;
      -- the app checks and says so.
      case when v_username is not null
                and not exists (select 1 from public.profiles where lower(username) = v_username)
           then v_username end
    );
  else
    insert into public.profiles (id, full_name, role)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), user_role);
  end if;
  return new;
end;
$$;
