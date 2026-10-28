-- ============================================================================
-- Wivo — migration 066: vestlused reaalajas
-- Run this ON ITS OWN, in a separate query, AFTER 065.
-- ============================================================================
--
-- Eraldi fail samal põhjusel, mis 004, 008 ja 062: `ALTER PUBLICATION` vajab
-- lukku, mida Supabase'i realtime-tööline hoiab, ja tööline tahab omakorda
-- lugemislukku tabelile, mida teised laused kinni hoiavad. Ühes tehingus
-- lukustub see teineteise taha (40P01).
--
-- MIKS SEE VESTLUSE JAOKS LOEB
--   Vestlus ilma reaalajata ei ole vestlus. Ilma selle migratsioonita on
--   tellimus VAIKIV — sõnum salvestub, ta on olemas, ta lihtsalt ei ilmu
--   teise inimese ekraanile enne, kui too lehe uuesti avab. Ja kaks inimest,
--   kes kumbki ei tea, et teine juba vastas, kirjutavad üksteisest mööda.
set lock_timeout = '10s';

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;   -- juba lisatud
  when undefined_object then null;   -- publikatsiooni ei ole selles projektis
end $$;
