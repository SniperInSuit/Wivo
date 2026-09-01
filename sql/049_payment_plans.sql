-- ============================================================================
-- Wivo — migration 049: maksegraafik (patsient maksab ravi osade kaupa)
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- MIKS TABEL, KUI ARVED ON JUBA OLEMAS
--   Osamaksed genereeritakse ETTE, päris dokumentidena. Töölauarakenduse taga ei
--   jookse midagi, kui ta on kinni, nii et reegel, mis „käivitub järgmisel kuul",
--   ei käivituks kunagi. Viis arvet õigete kuupäevadega on olemas alates
--   loomispäevast ja ei vaja mitte ühtegi ajastajat, et eksisteerida.
--
--   Aga viis arvet ei ütle, et nad kuuluvad KOKKU. See tabel on see üks rida,
--   mis ütleb: need viis on üks kokkulepe, see oli reegel, mis nad tegi, ja nii
--   palju sellest on tasutud. Ilma selleta ei saa graafikut ei näidata, ei
--   katkestada, ega hiljem saatjal üles leida.
--
-- ARVE_PAEV ON KUNI 28, MITTE 31
--   Veebruar. Graafik, mis on „31. kuupäeval", muutuks kolm kuud hiljem vaikselt
--   28-ndaks ja järgmisel kuul jälle 31-ndaks — ajakava, mida keegi ei tellinud.
--   28 on suurim päev, mis on igas kuus olemas. Sama piir on koodis
--   (`shared/billing/instalments.ts`), siin on ta selleks, et andmebaas ei
--   sõltuks sellest, et keegi meelde jätab.
--
-- PATSIENT ON DENORMALISEERITUD
--   Täpselt nagu `invoices.patsient`: `patient_id` võib olla NULL (kustutatud
--   või sidumata kaart), aga nimi peab dokumendil alles jääma. Graafik, mille
--   nimi kaob koos patsiendikaardiga, ei ole kokkulepe vaid mõistatus.
--
-- MIDA SEE MIGRATSIOON EI LAHENDA
--   `payments_amount_positive check (amount > 0)` (sql/020) tähendab, et
--   tühistatud graafiku juba laekunud osamakseid EI SAA miinusega tagasi
--   pöörata. Tühistamine peatab tuleviku, ta ei ole tagasimakse. Kui
--   tagasimakseid on päriselt vaja, on see omaette migratsioon ja omaette
--   äriotsus — mitte midagi, mida siia vaikselt juurde kirjutada.
--
-- LISATAV ON ADDITIIVNE
--   `payment_plan_id` on `invoices` peal NULL kõigil senistel arvetel ja kõigil
--   tulevastel üksikarvetel. Ükski olemasolev päring ei muutu.

set lock_timeout = '10s';

create table if not exists public.payment_plans (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references public.clinics(id),
  patient_id          uuid references public.patients(id) on delete set null,
  patsient            text not null,
  kogusumma           numeric(12,2) not null
    constraint payment_plans_total_positive check (kogusumma > 0),
  osamakseid          smallint not null
    constraint payment_plans_count_valid check (osamakseid between 1 and 60),
  esimene_arve        date not null,
  arve_paev           smallint
    constraint payment_plans_day_valid check (arve_paev is null or arve_paev between 1 and 28),
  maksetahtaeg_paevi  smallint not null default 14
    constraint payment_plans_term_valid check (maksetahtaeg_paevi >= 0),
  staatus             text not null default 'aktiivne'
    constraint payment_plans_status_valid check (staatus in ('aktiivne','lopetatud','tuhistatud')),
  markus              text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on column public.payment_plans.arve_paev is
  'Kuupäev, millal iga osamakse arve väljastatakse. NULL = hoia esimese arve '
  'päeva. Kuni 28, et see kehtiks ka veebruaris.';
comment on column public.payment_plans.staatus is
  'aktiivne = jookseb, lopetatud = kõik tasutud, tuhistatud = tulevased arved '
  'tühistatud. Tühistamine ei ole tagasimakse — vt migratsiooni päist.';

create index if not exists payment_plans_clinic_idx
  on public.payment_plans (clinic_id, created_at desc);
create index if not exists payment_plans_patient_idx
  on public.payment_plans (patient_id);

alter table public.invoices
  add column if not exists payment_plan_id uuid references public.payment_plans(id) on delete set null,
  add column if not exists instalment_no smallint;

comment on column public.invoices.instalment_no is
  'Mitmes osamakse see arve graafikus on, 1-põhine. NULL üksikarvel.';

create index if not exists invoices_payment_plan_idx
  on public.invoices (payment_plan_id, instalment_no)
  where payment_plan_id is not null;

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Sama muster mis `customers` (sql/035): neli poliitikat, kõik kliiniku peal.
alter table public.payment_plans enable row level security;

drop policy if exists payment_plans_select on public.payment_plans;
create policy payment_plans_select on public.payment_plans
  for select using (clinic_id = public.my_clinic_id());

drop policy if exists payment_plans_insert on public.payment_plans;
create policy payment_plans_insert on public.payment_plans
  for insert with check (clinic_id = public.my_clinic_id());

drop policy if exists payment_plans_update on public.payment_plans;
create policy payment_plans_update on public.payment_plans
  for update using (clinic_id = public.my_clinic_id())
  with check (clinic_id = public.my_clinic_id());

drop policy if exists payment_plans_delete on public.payment_plans;
create policy payment_plans_delete on public.payment_plans
  for delete using (clinic_id = public.my_clinic_id());

-- ─── Realtime ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'payment_plans'
  ) then
    alter publication supabase_realtime add table public.payment_plans;
  end if;
end $$;

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_name = 'payment_plans' order by ordinal_position;
--   -> 14 rida, kogusumma numeric, arve_paev smallint nullable
--
-- select count(*) from public.invoices where payment_plan_id is not null;
--   -> 0 (ükski olemasolev arve ei kuulu graafikusse)
