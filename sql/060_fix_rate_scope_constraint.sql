-- ============================================================================
-- Wivo — migration 060: mudeli tasureeglit ei saanud salvestada
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- VIGA
--   new row for relation "worker_rates" violates check constraint
--   "worker_rates_applies_valid"
--
--   „Mille eest: Mudel" reeglit ei saanud üldse luua. Rakendus oskab mudelit
--   arvestada alates 1.48-st, palgamootor maksab selle välja ja omahinna tabel
--   näitab seda — aga reegel ei jõudnud kunagi andmebaasi.
--
-- MIS TÄPSELT KATKI ON — VALE NIMI
--   Piirang loodi `sql/024` nimega **`worker_rates_applies_valid`**
--   ('too', 'disain') ja `sql/026` laiendas seda sama nime all
--   ('too', 'disain', 'muudatus').
--
--   `sql/048` lisas scope'i 'mudel' — aga kirjutas:
--
--     drop constraint if exists worker_rates_scope_valid;   ← seda ei ole olemas
--     add  constraint worker_rates_scope_valid check (... 'mudel');
--
--   `if exists` tähendas, et vale nimega drop ei kurtnud, vaid ei teinud MITTE
--   MIDAGI. Tabelile jäi kaks piirangut korraga:
--
--     worker_rates_applies_valid  →  too | disain | muudatus
--     worker_rates_scope_valid    →  too | disain | muudatus | mudel
--
--   Rida peab rahuldama MÕLEMAD. 'mudel' läbib teise ja kukub esimese peal
--   läbi, iga kord, vaikselt kuni salvestusnupuni.
--
--   `drop ... if exists` on õige tööriist korduva jooksutamise jaoks ja ta on
--   ka see, mis selle vea vaikseks tegi. Nime kirjaviga ja `if exists` koos ei
--   anna ühtegi märki.
--
-- LAHENDUS
--   Üks piirang, üks nimi. Vana nimi jääb kanooniliseks, sest tema on see, mis
--   päriselt tabelil on ja mille nime veateade ütleb.

set lock_timeout = '10s';

-- Mõlemad maha, kumb iganes neist olemas on.
alter table public.worker_rates drop constraint if exists worker_rates_applies_valid;
alter table public.worker_rates drop constraint if exists worker_rates_scope_valid;

alter table public.worker_rates add constraint worker_rates_applies_valid
  check (applies_to in ('too', 'disain', 'muudatus', 'mudel'));

comment on column public.worker_rates.applies_to is
  'Mille eest makstakse: too = teostatud töö, disain = töö disain, '
  'muudatus = ümbertegemine, mudel = tööle lisatud mudel. '
  'Piirang on worker_rates_applies_valid — ÜKS piirang, mitte kaks (vt 060).';

-- ─── Verify ─────────────────────────────────────────────────────────────────
--
-- 1. ⭐ TÄPSELT ÜKS piirang, ja see lubab nelja väärtust:
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'public.worker_rates'::regclass
--    and contype = 'c'
--    and pg_get_constraintdef(oid) like '%applies_to%';
--   -> üks rida: worker_rates_applies_valid,
--      CHECK (applies_to = ANY (ARRAY['too','disain','muudatus','mudel']))
--
--   Kaks rida siin tähendab, et viga on tagasi.
--
-- 2. Salvestamine töötab (asenda oma profiili id-ga):
-- insert into public.worker_rates (profile_id, kind, applies_to, amount)
-- values ((select id from public.profiles limit 1), 'too', 'mudel', 10)
-- returning id, applies_to;
--   -> üks rida. Kustuta pärast:
-- delete from public.worker_rates where applies_to = 'mudel' and amount = 10;
--
-- 3. Ja siis Wivos: Töötasud → tehnik → Lisa reegel
--    Liik „Töö tasu (fikseeritud)", Summa 10, Mille eest **Mudel**,
--    töötüüp valimata. Reeglil peab tekkima merevaigukollane silt
--    „mudeli eest" — see on see, mis eristab teda töötüübi piirangust.
