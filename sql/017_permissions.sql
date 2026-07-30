-- Wivo — migration 017: worker permissions
--
-- The owner can toggle individual permissions per worker.
-- Owner implicitly has all permissions. Patient role has a hardcoded minimal set.
-- Run in the Supabase SQL editor (Wivo closed) AFTER 016_clinic_rls.sql.

create table if not exists public.worker_permissions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  permission  text not null,
  granted     boolean not null default true,
  unique(profile_id, permission)
);

alter table public.worker_permissions enable row level security;

-- Owner can read/write all permissions in their clinic
create policy "perms_owner_all" on public.worker_permissions
  for all using (
    clinic_id = (select clinic_id from public.profiles where id = auth.uid() and role = 'owner')
  );

-- Workers can read their own permissions
create policy "perms_worker_read_own" on public.worker_permissions
  for select using (profile_id = auth.uid());

-- ── Permission keys ──────────────────────────────────────────────────────────
-- jobs.read        — can see all jobs
-- jobs.write       — can create/edit jobs
-- patients.read    — can see all patients
-- patients.write   — can edit patient health data
-- visits.read      — can see all visits
-- visits.write     — can book/manage visits
-- stats.read       — can see dashboard/statistics
-- payments.read    — can see payments/invoices
-- payments.write   — can mark payments, create invoices
-- settings.read    — can see clinic settings
-- pipeline.write   — can manage pipeline stages
