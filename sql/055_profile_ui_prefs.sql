-- ============================================================================
-- Wivo — migration 055: isiklikud vaateseaded profiilil
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   Statistika leht muutub paneelideks, mille igaüks ise valib. See valik kuulub
--   INIMESE juurde, mitte masina juurde: finantsjuht, kes avab rakenduse pingi
--   pealt, peab nägema finantsjuhi paneele, ja uus arvuti ei tohi neid kaotada.
--
--   `clinic_settings` on vale koht kahel põhjusel. Esiteks on see kliiniku
--   ühine seadistus, mitte inimese oma. Teiseks ei anna ClinicSettingsSync
--   töötajale sinna üldse kirjutusõigust — tehnik ei saaks oma vaadet kunagi
--   salvestada.
--
-- POLIITIKA
--   Uut ei ole vaja. `profiles_update_own` (sql/012) on `using (id = auth.uid())`
--   ilma eraldi WITH CHECK-ita, ja Postgresi RLS piirab RIDU, mitte veerge —
--   igaüks saab juba oma rida uuendada.
--
-- VAIKEVÄÄRTUS
--   '{}' — tühi objekt, nii et `ui_prefs.dashboard` loeb kui undefined ja
--   rakendus rakendab oma rollipõhise vaikeseade. Sama hoiak kui sql/037
--   `features` veerul. NOT NULL, et ükski lugeja ei peaks eristama nulli tühjast.
-- ============================================================================

set lock_timeout = '10s';

alter table public.profiles
  add column if not exists ui_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.ui_prefs is
  'Isiklikud vaateseaded: { v, dashboard: { preset, panels[] } }. Tundmatud võtmed ja tundmatud paneeli-id-d SÄILITATAKSE — uuema versiooniga kirjutatud id peab vanemast versioonist läbi käies alles jääma. Kliiniku ühine seadistus on clinic_settings.';

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select id, full_name, ui_prefs from public.profiles;
--   -> ui_prefs = {} igal real.
