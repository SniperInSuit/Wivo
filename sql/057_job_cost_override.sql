-- ============================================================================
-- Wivo — migration 057: omahinna käsitsi ülekirjutus töö kohta
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- MIKS TÖÖ KÜLJES, MITTE REEGLIS
--   „See töö oli teistsugune, tehniku osa oli 25, mitte 15." See on ühe töö
--   fakt. Kui parandus tehtaks tasureeglis, muutuks KÕIGI tööde omahind ja
--   tagantjärele ka juba välja makstud palgaread — üks erand kirjutaks ümber
--   terve ajaloo.
--
--   Ülekirjutus elab seega töö peal, nagu `extra_costs` juba elab, ja reegel
--   jääb puutumata. Palgaarvestus loeb ainult reegleid: see veerg EI muuda
--   kellegi töötasu. Ta ütleb, mis see töö laborile maksis, mitte mis kellelegi
--   välja makstakse.
--
-- MIKS KATEGOORIA, MITTE RIDA
--   Ridu on muutuv arv ja nad tekivad reeglitest — „Kroon: 3 × 18 €" kaob ära
--   niipea kui tööosa muuta. Ülekirjutus, mis on seotud kaduva reaga, kaob koos
--   sellega. Kategooriaid on neli ja nad on püsivad.
--
-- NULL ≠ 0
--   Võtme puudumine tähendab „arvuta reeglitest". `0` tähendab „see töö ei
--   maksnud siin midagi" ja on inimese otsus. Neid ei tohi segamini ajada,
--   muidu ei saa ülekirjutust kunagi tagasi võtta.

set lock_timeout = '10s';

alter table public.jobs
  add column if not exists kulu_yle jsonb not null default '{}'::jsonb;

comment on column public.jobs.kulu_yle is
  'Omahinna käsitsi ülekirjutused kategooria kaupa: tehnik, disainija, '
  'materjal, tarvikud. Võtme puudumine = arvuta reeglitest; 0 = teadlik null. '
  'EI mõjuta töötasu — palgaarvestus loeb ainult worker_rates reegleid.';

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select count(*) from public.jobs where kulu_yle <> '{}'::jsonb;
--   -> 0 (ükski töö ei ole veel üle kirjutatud)
