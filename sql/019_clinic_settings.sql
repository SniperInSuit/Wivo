-- Wivo — migration 019: clinic settings (work types, materials, machines,
-- pipeline stages, pricing and calendar config)
--
-- Until now every one of these lived in the browser's localStorage, which meant
-- they were per-MACHINE, not per-clinic: two workstations in the same clinic
-- could hold different prices for the same work type and nothing reconciled
-- them. That is tolerable for a colour preference and not tolerable for a price
-- list, which is about to become the basis of invoices (Phase 4).
--
-- One row per clinic. Split into several jsonb columns rather than a single
-- blob so that two people editing different sections at the same time do not
-- clobber each other — an update touches only the column it owns.
-- Run in the Supabase SQL editor (Wivo closed).

create table if not exists public.clinic_settings (
  clinic_id       uuid primary key references public.clinics(id) on delete cascade,

  -- Töö tüübid: [{ nimi, hex, hind?, match? }] — name, calendar colour and the
  -- per-job price, in list order (order is match order: Implantkroon > Kroon)
  work_types      jsonb not null default '[]'::jsonb,

  -- Materjalid: ["Crown HT", …] and their per-tooth prices
  -- { "Crown HT": { "small": 15, "large": 15 }, … }
  materials       jsonb not null default '[]'::jsonb,
  material_prices jsonb not null default '{}'::jsonb,

  -- Masinad: ["Pro2", "Midas", …]
  machines        jsonb not null default '[]'::jsonb,

  -- Töö etapid: [{ key, label, hex }] in pipeline order
  pipeline_stages jsonb not null default '[]'::jsonb,

  -- Hinnastamine: { designFee, hambaHind, muudatusHambaHind, kiirtooKordaja,
  --                 defaultMachine }
  pricing         jsonb not null default '{}'::jsonb,

  -- Kalender: { ajajoonAlgus, ajajoonLopp, nadalAlgus, nadalLopp, ajaSamm,
  --             visiidiKestus }
  calendar        jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.clinic_settings enable row level security;

-- Read: any member of the clinic. The app additionally hides the settings UI
-- from workers without settings.read, but reading a price list is not a
-- disclosure risk the way patient data is — and the job form needs these
-- values (material buttons, work-type colours) for every user regardless.
create policy "clinic_settings_select" on public.clinic_settings
  for select using (clinic_id = my_clinic_id());

-- Insert: any member, so the first person to open the app after this migration
-- seeds the row from their local configuration. Bounded to their own clinic.
create policy "clinic_settings_insert" on public.clinic_settings
  for insert with check (clinic_id = my_clinic_id());

-- Update: owner only. These are shared business settings — a worker changing a
-- price would silently change what every other workstation quotes. Finer-
-- grained cases (pipeline.write) are handled in the app, which calls this with
-- the owner's session only.
create policy "clinic_settings_update_owner" on public.clinic_settings
  for update using (
    clinic_id in (
      select clinic_id from public.profiles where id = auth.uid() and role = 'owner'
    )
  );

-- Keep updated_at honest — the app shows "viimati muudetud" and would otherwise
-- be reporting whatever the client happened to send.
create or replace function public.touch_clinic_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clinic_settings_touch on public.clinic_settings;
create trigger clinic_settings_touch
  before update on public.clinic_settings
  for each row execute function public.touch_clinic_settings();

-- Realtime: a price changed on the owner's machine should reach the other
-- workstations without a restart. Same pattern as visits (008).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'clinic_settings'
  ) then
    alter publication supabase_realtime add table public.clinic_settings;
  end if;
end $$;
