-- ============================================================================
-- Wivo — migration 051: e-posti saatmise õigused
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- MIS SIIA EI TULE: PAROOL
--   `clinic_settings` on loetav IGALE kliiniku liikmele (sql/019 poliitika
--   `clinic_settings_select`). SMTP parool siia panduna oleks nähtav igale
--   tehnikule, kes rakenduse lahti teeb — ja see on kliiniku PÕHIPOSTKASTI
--   parool, mitte mõne rakenduse oma.
--
--   Parool elab ainult `supabase secrets` sees, kust ainult edge-funktsioon
--   selle jooksutamise ajal kätte saab. Siin on ainult see, mida tohib näha:
--   server, port, saatja aadress, ja MIDA TOHIB TEHA.
--
--   `connected` ei ole seetõttu tõestus, vaid inimese märge: „ma panin
--   saladused paika". Rakendus ei saa ega tohigi seda kontrollida.
--
-- MIKS ÕIGUSED ÜLDSE
--   Sest antakse põhipostkast. Ainus võimekus, mida SMTP annab, on kirja
--   väljundkasti panemine — lugeda, kustutada ega liigutada ei saa midagi,
--   sest IMAP seadeid ei anta kuskil. Aga saatmine ise on piisav, et
--   majutaja aadressi kiirusepiiranguga või musta nimekirja panna, ja siis
--   seisab kliiniku tavaline post koos sellega.
--
--   Seepärast on iga lipp vaikimisi VÄLJAS ja iga luba eraldi. Uus kirjaliik
--   hiljem tähendab uut lippu, mitte olemasoleva laiendamist.
--
-- MIKS `test_aadress`
--   Et esimest nädalat saaks vaadata, ilma et ükski patsient kirja saaks.
--   Sama kood, sama renderdus, sama limiit — üks aadress. Seatuna võidab ta
--   päris saaja üle ALATI, ka siis kui arvel on aadress olemas.
--
-- ADDITIIVNE
--   Uus veerg vaikeväärtusega. Ükski olemasolev päring ei muutu ja vaikeseis
--   ei saada mitte midagi.

set lock_timeout = '10s';

alter table public.clinic_settings
  add column if not exists email jsonb not null default jsonb_build_object(
    'connected',       false,
    'host',            '',
    'port',            465,
    'saatjaAadress',   '',
    'saatjaNimi',      '',
    'saatmineLubatud', false,
    'lubaArved',       false,
    'paevaLimiit',     20,
    'testAadress',     null
  );

comment on column public.clinic_settings.email is
  'E-posti saatmise seaded ja ÕIGUSED. Parooli siin EI OLE ega tohi olla — '
  'clinic_settings on loetav igale kliiniku liikmele. Parool elab ainult '
  'supabase secrets sees.';

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select email from public.clinic_settings;
--   -> saatmineLubatud = false, lubaArved = false, paevaLimiit = 20
--
-- select email ? 'parool' or email ? 'password' or email ? 'pass'
--   from public.clinic_settings;
--   -> false igal real. Kui mitte, on midagi väga valesti.
