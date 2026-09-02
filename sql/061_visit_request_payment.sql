-- ============================================================================
-- Wivo — migration 061: visiiditasu taotluse küljes (Montonio)
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- MIKS TASU ÜLDSE
--   Omaniku sõnastuses: „et mitte raisata kellegi aega ja ainult kindlad
--   inimesed tulevad". Tasu ei ole tuluallikas — ta on filter, ja kui töö läheb
--   suuremaks, arvestatakse ta ravi hinna sisse.
--
--   Sellepärast on tema vaikeväärtus 0 ja tasu on VÕIMALUS, mitte nõue.
--   Kliinik, kes tasu ei taha, ei pea midagi tegema.
--
-- MIKS SUMMA EI TULE KUNAGI BRAUSERIST
--   `makse_summa` kirjutatakse serveris `clinic_settings.broneering` pealt.
--   Vidin on avalik kood: kui summa tuleks temalt, saaks iga inimene maksta
--   1 sendi ja saada sama broneeringu. See on see viga, mille pärast makse-
--   integratsioone üldse valesti tehakse, ja seda ei tee siin ükski rida.
--
-- MIKS `montonio_uuid` ON UNIKAALNE
--   Webhook võib tulla mitu korda — see on normaalne ja dokumenteeritud. Rida
--   leitakse selle veeru järgi ja märgitakse makstuks ainult siis, kui ta veel
--   ei ole. Ilma unikaalsuseta ei ole „see makse" mõiste üldse defineeritud.
--
-- MIS EI OLE MAKSE TÕEND
--   Brauseri tagasitulek `returnUrl`-ile EI OLE tõend: aadressirea saab keegi
--   ise kirjutada. Tõend on allkirjastatud `order-token`, mille signatuuri
--   kontrollitakse salajase võtmega. Mõlemad teed lõpevad siin, aga kumbki ei
--   märgi midagi makstuks enne signatuuri kontrolli.

set lock_timeout = '10s';

alter table public.visit_requests
  add column if not exists makse_staatus text not null default 'vaba',
  add column if not exists makse_summa   numeric(10,2),
  add column if not exists montonio_uuid text,
  add column if not exists makstud_at    timestamptz;

-- Mida patsient kalkulaatoris valis, ja mis summa talle NÄIDATI.
--
-- Summa salvestatakse nagu arve rida salvestab hinna: dokument, mis on inimesele
-- näidatud, ei tohi hiljem muutuda sellepärast, et hinnakiri muutus. Valik
-- (hambad FDI numbritena) käib kaasa, sest summa, mille taga ei ole hambaid, ei
-- ole kellegi poolt kontrollitav.
--
-- Mõlemad arvutatakse SERVERIS. Brauser saadab ainult valiku.
alter table public.visit_requests
  add column if not exists valik    jsonb,
  add column if not exists hinnang  numeric(10,2);

comment on column public.visit_requests.valik is
  'Kalkulaatori valik: [{serviceId, hambad:[FDI], lisad:[id]}]. Mida patsient '
  'valis, mitte mida ta vajab — diagnoosi see ei sisalda.';
comment on column public.visit_requests.hinnang is
  'Summa, mida patsiendile veebis NÄIDATI. Ei ole siduv pakkumine; salvestatud, '
  'et hilisem hinnamuutus ei muudaks seda, mida inimene nägi.';

-- Millist aega patsient veebist valis.
--
-- Eraldi `visits` reast, sest see EI OLE veel visiit: kalendrisse jõuab ta siis,
-- kui keegi kinnitab. Aga vaba aja arvutus peab teda arvestama, muidu pakuvad
-- kaks järjestikust külastajat sama kella ja registratuur avastab selle hiljem.
alter table public.visit_requests
  add column if not exists soovitud_algus  timestamptz,
  add column if not exists soovitud_kestus smallint;

comment on column public.visit_requests.soovitud_algus is
  'Veebist valitud aeg. Hoiab kohta kinni kuni kinnitamise või tagasilükkamiseni '
  '— aga ei ole visiit enne, kui keegi selle üle vaatab.';

alter table public.visit_requests
  drop constraint if exists visit_requests_makse_valid;
alter table public.visit_requests
  add constraint visit_requests_makse_valid check (
    makse_staatus in ('vaba', 'ootel', 'makstud', 'ebaonnestus', 'tuhistatud')
  );

comment on column public.visit_requests.makse_staatus is
  'vaba = tasu ei nõutud (nt registratuuri käsitsi lisatud taotlus); '
  'ootel = makselink loodud, raha ei ole; makstud = allkirjastatud token '
  'kinnitas; ebaonnestus / tuhistatud = Montonio ütles nii.';

comment on column public.visit_requests.makse_summa is
  'Mis summa küsiti. Kirjutatakse SERVERIS clinic_settings.broneering pealt, '
  'mitte kunagi brauseri saadetud väärtusest.';

-- Webhook leiab rea selle järgi. Unikaalne, sest webhook võib korduda ja
-- „see makse" peab olema üheselt määratud.
create unique index if not exists visit_requests_montonio_uuid_idx
  on public.visit_requests (montonio_uuid)
  where montonio_uuid is not null;

-- ─── Broneerimise seaded ────────────────────────────────────────────────────
-- Eraldi veerg, mitte public_services sisse: see on kliiniku-ülene seade, mitte
-- ühe teenuse oma. Ja avalik funktsioon pärib teda OMA nimelise päringuga, nii
-- et `clinic_settings`-i kitsas veeruvalik jääb alles (vt _shared/settings.ts).
alter table public.clinic_settings
  add column if not exists broneering jsonb not null default '{}'::jsonb;

comment on column public.clinic_settings.broneering is
  'Veebibroneeringu seaded: { visiiditasu: number (0 = tasu ei küsita), '
  'valuuta: "EUR", tagasiUrl: string }. Summa loetakse SIIT, mitte kliendilt.';

-- ─── Verify ─────────────────────────────────────────────────────────────────
--
-- 0. See fail on ohutu KORDUVALT jooksutada (`add column if not exists`).
--    Kui jooksutasid ta enne kalkulaatori osa lisandumist, jooksuta uuesti.
--
-- 1. Veerud ja piirang:
-- select column_name, data_type, column_default from information_schema.columns
--  where table_schema='public' and table_name='visit_requests'
--    and column_name in ('makse_staatus','makse_summa','montonio_uuid','makstud_at');
--   -> neli rida, makse_staatus default 'vaba'
--
-- 2. Vaikimisi ei küsi keegi raha:
-- select coalesce(broneering->>'visiiditasu','0') from public.clinic_settings;
--   -> '0' (või puudub) — tasu tuleb teadlikult sisse panna
--
-- 3. Tasu sisse (asenda summa):
-- update public.clinic_settings
--    set broneering = coalesce(broneering,'{}'::jsonb)
--        || jsonb_build_object('visiiditasu', 20, 'valuuta', 'EUR',
--                              'tagasiUrl', 'https://www.fullgevitydental.ee/')
--  where clinic_id = my_clinic_id();
--
-- 4. Unikaalsus töötab:
-- select indexdef from pg_indexes where indexname = 'visit_requests_montonio_uuid_idx';
