-- ============================================================================
-- Wivo — migration 050: arve saatmise seis
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- MIKS SEE ON OLEMAS ENNE SAATJAT
--   Maksegraafik loob viis arvet ette, õigete kuupäevadega. Nende väljasaatmine
--   on ainus osa, mis päriselt vajab serverit — ja server vajab omakorda üht
--   asja, mida praegu kuskil ei ole: kohta, kus seisab, KAS see arve on juba
--   välja läinud.
--
--   Ilma `sent_at`-ita ei saa ükski ajastatud töö olla ohutu. Ta jookseks
--   uuesti, leiaks samad arved ja saadaks patsiendile teise koopia. Cron
--   käivitub kaks korda sagedamini, kui keegi arvab.
--
-- MIKS MITTE KASUTADA `status = 'saadetud'`
--   Sest see on inimese otsus, mitte masina oma. Keegi märgib arve saadetuks ka
--   siis, kui ta selle käsitsi PDF-ina ära saatis või postiga välja viis.
--   `sent_at` ütleb kitsalt: SEE SÜSTEEM saatis selle kirja, siis. Kaks eri
--   fakti, kaks eri veergu — muidu ei saa kunagi teada, kumb juhtus.
--
-- MIKS `send_error` TEKSTINA
--   Kui saatmine kukub läbi, on ainus kasulik asi see, mida SMTP-server ütles:
--   "mailbox full", "relay denied", "user unknown". Lipp „ei õnnestunud" ei
--   aita kedagi. Tekst tühjendatakse iga õnnestunud saatmisega, nii et seal on
--   alati ainult kehtiv viimane viga.
--
-- MIS JÄÄB LAHENDAMATA
--   Põrked. SMTP võtab kirja vastu ja alles hiljem selgub, et aadressi ei ole —
--   see teade tuleb saatja postkasti, mitte siia. Jagatud majutuse SMTP-l
--   webhooke ei ole. Selle veeru sisu tähendab „server võttis vastu", mitte
--   „inimene sai kätte", ja seda vahet ei tohi UI-s ära kaotada.
--
-- ADDITIIVNE
--   Mõlemad veerud on NULL kõigil senistel arvetel. Ükski olemasolev päring ei
--   muutu, ja NULL `sent_at` tähendab täpselt seda, mis ta on: see süsteem ei
--   ole seda arvet saatnud.

set lock_timeout = '10s';

alter table public.invoices
  add column if not exists sent_at    timestamptz,
  add column if not exists send_error text;

comment on column public.invoices.sent_at is
  'Millal SEE SÜSTEEM arve e-postiga välja saatis. NULL = ei ole saatnud. '
  'Eraldi status = ''saadetud'' väärtusest, mis on inimese märge.';
comment on column public.invoices.send_error is
  'Viimase ebaõnnestunud saatmise serveripoolne teade. Tühjendatakse '
  'õnnestumisel.';

-- Osaline indeks: ajastatud saatja päring on alati „mis on välja saatmata",
-- ehk ta ei vaata kunagi neid ridu, mis on juba läinud. Täisindeks kasvaks
-- iga saadetud arvega ja ei teeniks ühtegi päringut.
create index if not exists invoices_unsent_idx
  on public.invoices (issue_date)
  where sent_at is null;

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select column_name, data_type from information_schema.columns
--  where table_name = 'invoices' and column_name in ('sent_at','send_error');
--   -> 2 rida: timestamp with time zone, text
--
-- select count(*) from public.invoices where sent_at is not null;
--   -> 0 (ükski arve ei ole selle süsteemi kaudu saadetud)
