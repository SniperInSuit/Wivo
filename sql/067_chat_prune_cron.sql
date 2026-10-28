-- ============================================================================
-- Wivo — migration 067: vestluste säilitustähtaja cron
-- Run AFTER 065. Valikuline, aga ilma selleta ei kustu midagi ise.
-- ============================================================================
--
-- `chat_prune()` kustutab sõnumid, mis on kliiniku säilitustähtajast vanemad.
-- Vaikimisi 24 kuud; number on Seaded → Vestlused all ja käib kliiniku kaupa.
--
-- MIKS SEE ON OMA FAIL
--   pg_cron ei ole igas Supabase'i projektis sees, ja laiend, mida ei ole,
--   teeb kogu migratsiooni katki. Siin kukub ainult see fail, ja kõik muu
--   vestluse juures töötab — lihtsalt keegi peab `select chat_prune();` ise
--   aeg-ajalt käivitama.
--
--   Öösel kell 3:17, mitte täistunnil: täistund on iga maailma cron'i tipptund.
select cron.unschedule('wivo-chat-prune')
 where exists (select 1 from cron.job where jobname = 'wivo-chat-prune');

select cron.schedule('wivo-chat-prune', '17 3 * * *', $$ select public.chat_prune(); $$);
