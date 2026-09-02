-- ============================================================================
-- Wivo — migration 059: visiiditaotluste postkast
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- MIKS OMA TABEL, MITTE `visits` UUS STAATUS
--   Kolm põhjust, igaüks üksi piisav:
--
--   1. `visits_staatus_valid` on CHECK. Uus olek tähendaks migratsiooni ja
--      kõikide olekumasina harude ülevaatamist.
--   2. `visits_insert` RLS nõuab `clinic_id = my_clinic_id()`. Anonüümsel
--      külastajal seda ei ole ja ei tohi olla.
--   3. **Taotlus ei ole visiit.** Kalender näitab, mis on kokku lepitud. Kui
--      kinnitamata taotlused sinna sisse lähevad, ei saa kalendrit enam
--      usaldada, ja kalender on ainus asi, mille järgi hommikul tööd tehakse.
--
--   Kinnitamisel tekib päris `visits` rida ja `visit_id` seob need kokku.
--
-- RLS: MITTE ÜHTEGI `to anon` POLIITIKAT
--   HANDOFF.md reegel: „Public surfaces go through an edge function holding the
--   service key, never through an anon session." Vorm kirjutab siia
--   `public-booking` funktsiooni kaudu, mis hoiab teenusevõtit. Kui siia tekib
--   kunagi anonüümne poliitika, saab iga inimene internetis lugeda kõikide
--   kliinikute taotlusi — nimed ja telefoninumbrid.
--
-- GDPR — SEE ON UUS ISIKUANDMETE PIND
--   Vana Dentase-plaan lubas, et Supabase ei salvesta ühtegi isikuandmet: nimi
--   ja telefon läksid otse Dentasesse. See tabel salvestab need MEIE baasi.
--   Sellest tulenevalt:
--
--   * `sonum` on piiratud 300 tähemärgiga JA seda öeldakse vormil.
--     Vaba tekstiväli on suurim art. 9 (terviseandmete) oht: „mul on
--     diabeet ja kardan puurimist" on terviseandmed, mille me kogusime.
--   * `ip_hash`, mitte IP. Räsi kõlbab rämpsu piiramiseks; aadress ise ei ole
--     meile kunagi vajalik.
--   * Säilitustähtaeg on olemas ja jookseb ise (vt allpool). Tagasi lükatud ja
--     rämpstaotlused kustuvad 90 päeva pärast.
--
-- MDR — SEE EI OLE PATSIENDIPORTAAL
--   `project_no_patient_portal`: patsiendile ei näidata tema andmeid tagasi.
--   Vastuseks on ainult „taotlus saadud". **Ära lisa staatuse jälgimise linki.**
--   Link, mis ütleb „teie taotlus on kinnitatud / lükati tagasi", muudab selle
--   patsiendi jaoks tema ravi vaateks, ja see on täpselt see piir, mida me
--   teadlikult ei ületa.

set lock_timeout = '10s';

create table if not exists public.visit_requests (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,

  -- Sama päring kaks korda = üks rida. Võti tekib vormi AVAMISEL, mitte
  -- saatmisel: saatmisel tekitatud võti on igal vajutusel uus ja topeltklikk
  -- annab kaks taotlust.
  idempotency_key text not null,

  -- `PublicService.id` tekstina, mitte FK: avalik teenus elab
  -- `clinic_settings.public_services` jsonb sees, tal ei ole oma tabelit.
  -- Null = patsient ei valinud teenust, mis on lubatud.
  service_id  text,

  nimi        text not null,
  telefon     text not null,
  email       text,
  -- Vaba tekst, teadlikult. „Kolmapäeva hommikul" on see, mida inimene ütleb,
  -- ja kalendrilubadust me siin ei anna: aja pakub kliinik.
  eelistatud_aeg text,
  sonum       text,

  staatus     text not null default 'uus',
  -- Kinnitamisel tekkinud päris visiit. Null seni.
  visit_id    uuid references public.visits(id) on delete set null,
  -- Kes taotlusega tegeles ja millal — muidu ei tea kaks inimest, kumb helistas.
  kasitles    uuid references public.profiles(id) on delete set null,
  kasitletud_at timestamptz,

  ip_hash     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint visit_requests_status_valid check (
    staatus in ('uus', 'kinnitatud', 'lykatud', 'ramps')
  ),
  -- Serveripoolne piir, mitte ainult vormi oma: vorm on avalik ja seda saab
  -- mööda minna. 300 tähemärki on piisav visiidisooviks ja liiga vähe
  -- haiguslooks.
  constraint visit_requests_sonum_pikkus check (char_length(sonum) <= 300),
  constraint visit_requests_nimi_pikkus check (char_length(nimi) between 1 and 120),
  constraint visit_requests_telefon_pikkus check (char_length(telefon) between 3 and 40),
  constraint visit_requests_idem unique (clinic_id, idempotency_key)
);

-- Postkast avaneb alati „uued esimesena, kliiniku kaupa".
create index if not exists visit_requests_inbox_idx
  on public.visit_requests (clinic_id, staatus, created_at desc);

-- ─── RLS — personal ja ainult personal ──────────────────────────────────────
alter table public.visit_requests enable row level security;

drop policy if exists "visit_requests_select" on public.visit_requests;
drop policy if exists "visit_requests_insert" on public.visit_requests;
drop policy if exists "visit_requests_update" on public.visit_requests;
drop policy if exists "visit_requests_delete" on public.visit_requests;

create policy "visit_requests_select" on public.visit_requests
  for select using (clinic_id = my_clinic_id());
-- Insert'i vajab personal ainult käsitsi lisamiseks (telefonikõne kirja
-- panemiseks). Avalik vorm EI kasuta seda teed — ta käib teenusevõtmega
-- funktsiooni kaudu, mis läheb RLS-ist mööda.
create policy "visit_requests_insert" on public.visit_requests
  for insert with check (clinic_id = my_clinic_id());
create policy "visit_requests_update" on public.visit_requests
  for update using (clinic_id = my_clinic_id())
  with check (clinic_id = my_clinic_id());
create policy "visit_requests_delete" on public.visit_requests
  for delete using (clinic_id = my_clinic_id());

-- ─── Säilitustähtaeg ────────────────────────────────────────────────────────
-- Taotlus, millest ei saanud visiiti, on nimi ja telefoninumber, mida meil ei
-- ole enam mingit põhjust hoida. Kinnitatud taotlused jäävad alles: nende juurde
-- kuulub päris visiit ja need on osa sellest, mis päriselt juhtus.
create or replace function public.purge_visit_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.visit_requests
   where staatus in ('lykatud', 'ramps')
     and created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.purge_visit_requests is
  'Kustutab tagasi lükatud ja rämpstaotlused 90 päeva pärast. GDPR '
  'säilitustähtaeg: taotlus, millest visiiti ei tulnud, on nimi ja telefon, '
  'mida ei ole põhjust hoida. Kinnitatud taotlused jäävad alles.';

-- Igal ööl kell 03:20. Ei kattu arvete saatjaga (iga tunni :07).
select cron.unschedule('wivo-purge-visit-requests')
 where exists (select 1 from cron.job where jobname = 'wivo-purge-visit-requests');

select cron.schedule(
  'wivo-purge-visit-requests',
  '20 3 * * *',
  $$ select public.purge_visit_requests(); $$
);

-- ─── Verify ─────────────────────────────────────────────────────────────────
--
-- 1. Tabel ja piirangud:
-- select conname from pg_constraint
--  where conrelid = 'public.visit_requests'::regclass order by conname;
--   -> ..._idem, ..._nimi_pikkus, ..._sonum_pikkus, ..._status_valid, ...
--
-- 2. ⭐ MITTE ÜHTEGI ANONÜÜMSET POLIITIKAT — see on see, mis loeb:
-- select polname, polroles::regrole[] from pg_policy
--  where polrelid = 'public.visit_requests'::regclass;
--   -> neli rida, kõik {public} ehk autenditud sessiooni kontroll
--      my_clinic_id() kaudu. Kui kusagil seisab `anon`, on midagi valesti.
--
-- 3. Idempotentsus töötab:
-- insert into public.visit_requests (clinic_id, idempotency_key, nimi, telefon)
-- values (my_clinic_id(), 'test-1', 'Test', '5551234')
-- on conflict (clinic_id, idempotency_key) do nothing;
--   -> teist korda: INSERT 0 0
-- delete from public.visit_requests where idempotency_key = 'test-1';
--
-- 4. Koristaja on ajastatud:
-- select jobname, schedule, active from cron.job
--  where jobname = 'wivo-purge-visit-requests';
--   -> '20 3 * * *', active = true
