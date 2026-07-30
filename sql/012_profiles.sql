-- Wivo — migration 012: user profiles linked to Supabase Auth
--
-- Run this AFTER enabling Authentication in your Supabase dashboard
-- (Settings → Authentication → enable Email provider).
-- Run in the Supabase SQL editor (Wivo closed).

-- Profiles table — one row per authenticated user
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  role        text not null default 'worker'
                check (role in ('owner', 'worker', 'patient')),
  clinic_id   uuid,            -- NULL until Phase 2 adds the clinics table
  patient_id  uuid,            -- links patient-role users to their patient record
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS: users can read all profiles in their clinic (needed for author names),
-- but can only update their own row.
alter table public.profiles enable row level security;

create policy "profiles_read" on public.profiles
  for select using (auth.uid() is not null);

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

-- Auto-create a profile row when a new user signs up.
-- The first user ever gets 'owner' role; subsequent users get 'worker'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  user_role text;
begin
  -- If no profiles exist yet, the first user is the owner
  if (select count(*) from public.profiles) = 0 then
    user_role := 'owner';
  else
    user_role := 'worker';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    user_role
  );
  return new;
end;
$$;

-- Trigger on auth.users insert
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
