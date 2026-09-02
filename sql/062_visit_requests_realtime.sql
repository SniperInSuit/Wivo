-- ============================================================================
-- Wivo — migration 062: visiiditaotlused reaalajas
-- Run this ON ITS OWN, in a separate query, AFTER 059.
-- ============================================================================
--
-- Eraldi fail samal põhjusel, mis 004 ja 008: `ALTER PUBLICATION` vajab lukku,
-- mida Supabase'i realtime-tööline hoiab, ja tööline tahab omakorda lugemislukku
-- tabelile, mida teised laused kinni hoiavad. Ühes tehingus lukustub see
-- teineteise taha (40P01). Üksi võtab ta ühe lühikese luku ja saab tehtud.
--
-- MIKS SEE POSTKASTI JAOKS LOEB
--   `useVisitRequests` on realtime-kanaliga: taotlus, mis saabub sel ajal kui
--   keegi postkasti lahti hoiab, peab ilmuma ise. Ilma selle migratsioonita on
--   see tellimus VAIKIV — ei viga, ei hoiatust, lihtsalt ei juhtu midagi, ja
--   registratuur avastab veebist tulnud taotluse alles siis, kui juhtub lehte
--   uuendama.
--
--   Ilma selleta töötab kõik muu: taotlus salvestub, ta on nimekirjas olemas,
--   ta lihtsalt ei ilmu ise kohale.

set lock_timeout = '10s';

do $$
begin
  alter publication supabase_realtime add table public.visit_requests;
exception
  when duplicate_object then null;   -- juba lisatud
  when undefined_object then null;   -- publikatsiooni ei ole selles projektis
end $$;

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'visit_requests';
--   -> üks rida
--
-- Ja päris kontroll: hoia Wivos „Taotlused" leht lahti ning lisa siit rida —
-- ta peab ilmuma ilma lehte uuendamata.
--
-- insert into public.visit_requests (clinic_id, idempotency_key, nimi, telefon)
-- values (my_clinic_id(), 'realtime-test', 'Realtime Test', '5551234');
-- delete from public.visit_requests where idempotency_key = 'realtime-test';
