-- ============================================================================
-- Wivo — migration 056: cron'i teenusevõtme parandus
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- MIS OLI KATKI
--   `sql/052` pani Vaulti kohatäite `<SERVICE_ROLE_KEY>` asemel päris võtme
--   ainult siis, kui keegi selle käsitsi asendas. Kui ei asendanud, läks Vaulti
--   see string ise ja iga tunnine cron sai vastuseks:
--
--     401 {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}
--
--   Cron ise töötas täiuslikult — 04:07, 05:07, 06:07 … igal tunnil täpselt.
--   Ainult vastus oli 401 ja `cron.job_run_details` ütles ikkagi „succeeded",
--   sest `net.http_post` on asünkroonne ja cron näeb ainult järjekorda panekut.
--
-- MIKS SEE FAIL KEELDUB, KUI VÕTI ON ASENDAMATA
--   Sest eelmine kord ei keeldunud. Vaikne 401 iga tund läbi öö on halvem kui
--   vigane SQL, mille redaktor kohe punaseks värvib. Iga võti algab `eyJ` —
--   see on base64 `{"` algusest — ja kõik muu on kindlasti viga.

set lock_timeout = '10s';

do $$
declare
  -- ⚠ ASENDA SEE PÄRIS VÕTMEGA.
  --   Dashboard → Project Settings → API Keys → service_role → Reveal
  v_key text := '<SERVICE_ROLE_KEY>';
  v_id  uuid;
begin
  -- Keeldu valjult, mitte vaikselt. Iga JWT algab 'eyJ'.
  if v_key !~ '^eyJ' then
    raise exception
      'Võti on asendamata või vale kujuga. Iga teenusevõti algab "eyJ". '
      'Praegune algus: %', left(v_key, 12);
  end if;

  select id into v_id from vault.secrets where name = 'wivo_service_role_key';
  if v_id is null then
    perform vault.create_secret(v_key, 'wivo_service_role_key');
  else
    perform vault.update_secret(v_id, v_key);
  end if;
end $$;

-- ─── Verify ─────────────────────────────────────────────────────────────────
--
-- 1. Võti on nüüd JWT:
-- select name, left(decrypted_secret, 3) as algus, length(decrypted_secret) as pikkus
--   from vault.decrypted_secrets where name = 'wivo_service_role_key';
--   -> algus = 'eyJ', pikkus paarsada märki
--
-- 2. Ära oota tundi — käivita cron käsitsi kohe:
-- select net.http_post(
--   url     := 'https://wrtucsfmpbwekugzzzxw.functions.supabase.co/send-invoices',
--   headers := jsonb_build_object(
--     'Content-Type', 'application/json',
--     'Authorization', 'Bearer ' || (
--       select decrypted_secret from vault.decrypted_secrets
--        where name = 'wivo_service_role_key')),
--   body    := '{}'::jsonb
-- );
--
-- 3. Paar sekundit hiljem — SEE on see, mis loeb:
-- select status_code, left(content, 200), created
--   from net._http_response order by created desc limit 3;
--   -> 200 ja {"ok":true,…}
--
-- 4. Ja Wivos: Seaded → E-post → „Ajastatud saatja käis viimati: just praegu"
