-- ============================================================================
-- Wivo — migration 052: arvete saatja ajastus (pg_cron)
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- MIKS IGA TUND, MITTE KORD PÄEVAS
--   Arve tehakse õhtul, kontor läheb kinni, ja hommikuni ootamine tähendab, et
--   patsient saab kirja pool päeva hiljem kui vaja. Tund on piisavalt tihe, et
--   õhtune arve läheb sama õhtu jooksul välja, ja piisavalt hõre, et jagatud
--   majutuse SMTP ei näe seda pealetungina.
--
--   Tihedam ei anna midagi juurde: arve väljastuskuupäev on päeva täpsusega,
--   nii et 30 minutit ei jõua kuhugi kiiremini kui 60.
--
-- MIKS SEE ON OHUTU KORDUVALT JOOKSUTADA
--   `invoices.sent_at` (sql/050). Saadetud arve kaob järjekorrast ja teine
--   käivitus ei leia teda enam. See on tõestatud päris andmetega, mitte ainult
--   testiga: kaks järjestikust käivitust andsid `sent: 1` ja `sent: 0`.
--
--   Lisaks on `sendGuard`-il päevalimiit, mis loeb viimase 24 tunni saadetud
--   kirju — ehk isegi kui midagi läheks väga valesti, on ülempiir olemas.
--
-- TEENUSEVÕTI LÄHEB VAULTI, MITTE SIIA FAILI
--   `send-invoices` on deploy'tud ILMA `--no-verify-jwt`-ta, sest ta saadab
--   kirju kliiniku põhiaadressilt. Cron vajab seega võtit. Vault krüpteerib
--   selle; `cron.job` tabelis seisab ainult viide, mitte võti ise.
--
--   ⚠ ASENDA ALLPOOL <SERVICE_ROLE_KEY> oma võtmega ENNE jooksutamist.
--   Leiad: Dashboard → Project Settings → API → service_role.
--   Ära jäta seda faili võtmega gitti.
--
-- TEADAOLEV PIIR
--   pg_cron ei takista sama töö kattuvaid käivitusi. Tunnise intervalli ja
--   sekundites lõppeva funktsiooni juures on see praktikas võimatu, aga kui
--   funktsioon kunagi kinni jookseks, võiks kaks käivitust sama arve korraga
--   valida. `sent_at` sulgeb akna kohe pärast serveri kinnitust, nii et aken on
--   üks `await` — mitte null, aga nii väike kui ilma nõudeta saab.

create extension if not exists pg_cron  with schema extensions;
create extension if not exists pg_net   with schema extensions;

-- Võti Vaulti. Korduval jooksutamisel uuendab olemasolevat, ei tekita teist.
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'wivo_service_role_key';
  if v_id is null then
    perform vault.create_secret('<SERVICE_ROLE_KEY>', 'wivo_service_role_key');
  else
    perform vault.update_secret(v_id, '<SERVICE_ROLE_KEY>');
  end if;
end $$;

-- Vana ajastus maha enne uue panekut, et korduv jooksutamine ei tekitaks kahte.
select cron.unschedule('wivo-send-invoices')
 where exists (select 1 from cron.job where jobname = 'wivo-send-invoices');

select cron.schedule(
  'wivo-send-invoices',
  '7 * * * *',   -- iga tunni 7. minutil: täistund on iga maailma cron'i tipptund
  $$
  select net.http_post(
    url     := 'https://wrtucsfmpbwekugzzzxw.functions.supabase.co/send-invoices',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
         where name = 'wivo_service_role_key'
      )
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- ─── Verify ─────────────────────────────────────────────────────────────────
--
-- ⚠ `cron.job_run_details.status = 'succeeded'` EI TÄHENDA, et kiri läks välja.
--   `net.http_post` on ASÜNKROONNE: ta paneb päringu järjekorda ja tagastab
--   kohe id. Cron näeb, et SQL-lause õnnestus, ja ütleb „succeeded" ka siis,
--   kui funktsioon vastas 401-ga. Päris vastus on `net._http_response` tabelis.
--
--   See eksitas 02.09.2026: cron näitas rohelist ja ükski arve ei liikunud.
--
-- 1. Kas töö on olemas ja aktiivne:
-- select jobname, schedule, active from cron.job where jobname = 'wivo-send-invoices';
--   -> 1 rida, '7 * * * *', active = true
--
-- 2. Kas cron jooksis:
-- select status, return_message, start_time from cron.job_run_details
--  where jobid = (select jobid from cron.job where jobname = 'wivo-send-invoices')
--  order by start_time desc limit 5;
--
-- 3. ⭐ MIDA FUNKTSIOON PÄRISELT VASTAS — see on see, mis loeb:
-- select id, status_code, left(content, 300) as vastus, error_msg, created
--   from net._http_response order by created desc limit 10;
--
--   200 + {"ok":true,...}  -> töötab
--   401                    -> võti on vale. Kõige tõenäolisem põhjus:
--                             <SERVICE_ROLE_KEY> jäi allpool asendamata ja
--                             Vaulti läks see string ise. Kontrolli:
--     select name, left(decrypted_secret, 12) || '…' from vault.decrypted_secrets
--      where name = 'wivo_service_role_key';
--       -> peab algama 'eyJ' (JWT), mitte '<SERVICE'
--   404                    -> funktsioon ei ole deploy'tud
--   NULL rida üldse puudub -> pg_net ei jooksnud; kontrolli, kas laiendus on sees
--
-- VÄLJA LÜLITAMINE, kui midagi on valesti:
-- update cron.job set active = false where jobname = 'wivo-send-invoices';
--   Seadetes „Automaatne saatmine" välja lülitamine peatab saatmise samuti —
--   cron käivitub, funktsioon vaatab poliitikat ja ei saada midagi.
