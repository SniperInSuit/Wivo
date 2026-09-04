-- ============================================================================
-- Wivo — migration 063: mitu kapslit see töö päriselt võttis
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- MIS OLI VALE
--   Materjali omahind on `{ small, large }` € HAMBA kohta, ja kapsli mahutavust
--   püüti väljendada nende kahe hinnavahega. See on lineaarne hind JAGAMATU
--   ühiku kohta ja eksib mõlemat pidi:
--
--     5 väikest hammast  →  5 × hind, kuigi plaadile mahtus 2 kapslit
--     2 väikest hammast  →  2 × hind, kuigi avasid terve kapsli
--
--   Kavatsus oli koodis ammu kirjas (`finance.ts`: „Midas → tooth per capsule,
--   1 large, up to 3 small"), aga lineaarne valem ei ümarda kunagi terve kapsli
--   peale üles.
--
--   Kapsel saab nüüd hinna ja mahutavuse (`clinic_settings.material_costs`), ja
--   kulu on `ceil(kohti / mahutavus) × hind`.
--
-- MIKS SEE VEERG SIIS VEEL VAJA ON
--   Mahutavus on HINNANG. Päris mahtuvus sõltub hamba suurusest, tugedest ja
--   sellest, kuidas tehnik plaadi ära paigutas — ja tehnik NÄEB plaati. Number,
--   mille inimene luges, lööb numbri, mille meie tuletasime.
--
-- NULL ≠ 0
--   Võtme puudumine tähendab „arvuta mahutavusest". `0` tähendab „see töö ei
--   avanud ühtegi kapslit" ja on inimese otsus. Neid ei tohi segamini ajada,
--   muidu ei saa parandust kunagi tagasi võtta — sama reegel, mida `kulu_yle`
--   juba järgib.
--
-- MIDA SEE EI TEE
--   Ei puuduta töötasu. Palgaarvestus loeb `worker_rates` reegleid ja mitte
--   midagi muud; see veerg ütleb, mis see töö laborile maksis.

set lock_timeout = '10s';

alter table public.jobs
  add column if not exists materjali_yhikud smallint;

alter table public.jobs
  drop constraint if exists jobs_materjali_yhikud_valid;
alter table public.jobs
  add constraint jobs_materjali_yhikud_valid
  check (materjali_yhikud is null or materjali_yhikud between 0 and 500);

comment on column public.jobs.materjali_yhikud is
  'Mitu kapslit see töö päriselt võttis. NULL = arvuta materjali mahutavusest; '
  'arv = tehniku loetud arv, mis lööb arvutatu. 0 = teadlik null. '
  'EI mõjuta töötasu.';

-- ─── Verify ─────────────────────────────────────────────────────────────────
--
-- 1. Veerg on olemas ja tühi:
-- select count(*) filter (where materjali_yhikud is not null) as kasitsi,
--        count(*) as koik
--   from public.jobs;
--   -> kasitsi = 0 (ükski töö ei ole veel käsitsi parandatud)
--
-- 2. Piirang peab kinni:
-- update public.jobs set materjali_yhikud = -1 where false;   -- ok, 0 rida
--   Päris katse (võta mõni id): peab andma vea
-- -- update public.jobs set materjali_yhikud = 9999 where id = '<id>';
--
-- 3. Pärast seda AVA Wivos Seaded → Hinnad → Materjalid → masina vaheleht ja
--    täida kapsli hind + mahutavus. Ilma nendeta ei muutu mitte midagi:
--    materjal, millel kapsli hinda ei ole, arvutatakse edasi hamba kaupa.
