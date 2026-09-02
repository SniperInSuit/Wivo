-- ============================================================================
-- Wivo — migration 048: kiirtöö kordaja töötaja kohta + mudeli tasu
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- KAKS AUKU PALGAARVESTUSES
--
-- 1. KIIRTÖÖ ei jõudnud kunagi töötasuni. `settings.kiirtooKordaja` korrutab
--    KLIENDI hinda — quoteJob paneb ülekursi `job.hind` sisse ja sinna see jäi.
--    Palgamootor ei vaadanud `job.kiirtoo` välja üldse, nii et kiirtöö eest
--    maksti tehnikule sama, mis tavatöö eest. Palgalehel oli 15.00 ja pidi
--    olema 30.00.
--
--    Miks TÖÖTAJA kohta ja mitte üks number kliiniku peale: kliiniku kordaja on
--    HIND, mida labor kliendilt küsib. Kui palju sellest ülekursist jõuab
--    tegijani, on labori ja iga inimese vaheline kokkulepe — mõni saab poole,
--    mõni sama kordaja, mõni ei saa midagi. Üks väli mõlema jaoks tähendaks, et
--    kliendi hinna tõstmine tõstab vaikselt kõigi palka.
--
--    NULL = 1× ehk ülekurssi ei maksta. See on tänane käitumine, nii et
--    migratsioon ei muuda ühegi juba tehtud töö tasu. Kordaja tuleb inimese
--    Töötasud lehel teadlikult sisse panna.
--
-- 2. MUDEL oli sama lugu teistpidi: `settings.mudeliHind` läheb kliendi arvele,
--    aga mudeli printimine ja viimistlemine on tehniku tehtud töö, mille eest
--    ei olnud kuskil võimalik tasu määrata.
--
--    Uus scope 'mudel' `worker_rates.applies_to` all, mitte uus lipp. Scope'id
--    ei võistle omavahel (vt 040) — nii lisandub mudeli tasu tootmistasule,
--    täpselt nagu disaini oma, ja täpselt ühte mudelireeglit saab tüübi järgi
--    valida nagu iga teist tootmisreeglit.
--
-- Mõlemad muudatused on ADDITIIVSED: enne neid kirjutatud read käituvad täpselt
-- nagu enne, sest kordaja on NULL ja ühelgi reeglil ei ole scope 'mudel'.

alter table public.profiles
  add column if not exists kiirtoo_kordaja numeric(5,2);

comment on column public.profiles.kiirtoo_kordaja is
  'Palju selle inimese tükitasu kiirtööl korrutatakse. NULL või 1 = ülekurssi '
  'ei maksta. Eraldi kliiniku hinnakordajast (settings.kiirtooKordaja), mis '
  'puudutab kliendi hinda, mitte palka.';

-- ⚠ SIIN OLI VIGA, PARANDATUD sql/060-s.
--   Siin seisis `drop constraint if exists worker_rates_scope_valid`, aga
--   piirangu päris nimi on `worker_rates_applies_valid` (sql/024, sql/026).
--   Vale nimi + `if exists` = drop ei teinud midagi ega kurtnud, ja tabelile
--   jäi kaks piirangut: vana lubas kolme väärtust, uus nelja. Rida peab
--   rahuldama mõlemad, nii et 'mudel' ei salvestunud kunagi.
alter table public.worker_rates drop constraint if exists worker_rates_applies_valid;
alter table public.worker_rates drop constraint if exists worker_rates_scope_valid;
alter table public.worker_rates add constraint worker_rates_applies_valid
  check (applies_to in ('too', 'disain', 'muudatus', 'mudel'));

comment on column public.worker_rates.applies_to is
  'Mille eest makstakse: too = teostatud töö, disain = töö disain, '
  'muudatus = ümbertegemine, mudel = tööle lisatud mudel';
