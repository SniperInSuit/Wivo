-- ============================================================================
-- Wivo — migration 053: turundusnõusolek patsiendil
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- MIKS NÕUSOLEK ON OSA EKSPORDIST, MITTE HILISEM MURE
--   Patsient andis oma e-posti ja telefoni RAVI jaoks. Sama nimekirja
--   kasutamine turunduseks on eraldi töötlemise eesmärk ja vajab eraldi alust.
--   Eesti elektroonilise side seadus § 103 lubab olemasolevale kliendile oma
--   sarnaste teenuste kohta kirjutada — aga ainult siis, kui talle anti
--   loobumise võimalus ja antakse igas kirjas uuesti.
--
--   Ilma selle veeruta oleks „ekspordi kõik kontaktid" nupp nimekiri, mida ei
--   tohi kasutada, ja mille kasutamist ei saaks keegi tagantjärele tõestada ega
--   ümber lükata. Veerg tehakse enne nuppu, mitte pärast.
--
-- MIKS KOLM OLEKUT, MITTE BOOLEAN
--   `kysimata` ei ole sama mis `ei`. Iga tänane patsient on `kysimata`, sest
--   keegi ei ole neilt küsinud — see on aus lähtekoht. `ei` on inimese otsus ja
--   see peab olema eristatav "me ei ole jõudnud küsida" seisust, muidu kaob
--   loobumine esimese andmete puhastuse käigus ära.
--
--   Vaikeväärtus on `kysimata`, mitte `jah`. Vaikimisi nõusolek ei ole nõusolek.
--
-- MIKS KUUPÄEV
--   Nõusolek ilma ajata ei ole tõendatav. Kui keegi kunagi küsib „millal ta
--   nõustus", peab olema vastus.
--
-- MIS SIIA EI TULE
--   Ravikaardi andmed ei jõua turunduse eksporti kunagi — see on GDPR art. 9
--   eriliigiline andmestik. Ekspordi veerud on koodis nimekirjana
--   (`PATIENT_MARKETING_COLUMNS`), mitte `select *`, täpselt samal põhjusel,
--   miks avalik `/services` päring nimetab veerud ükshaaval.

set lock_timeout = '10s';

alter table public.patients
  add column if not exists turundusnousolek text not null default 'kysimata'
    constraint patients_marketing_consent_valid
    check (turundusnousolek in ('jah', 'ei', 'kysimata')),
  add column if not exists nousoleku_aeg timestamptz;

comment on column public.patients.turundusnousolek is
  'Kas patsiendile tohib turundussisu saata. kysimata = ei ole küsitud, mis ei '
  'ole sama mis ei. Vaikimisi nõusolek ei ole nõusolek.';
comment on column public.patients.nousoleku_aeg is
  'Millal nõusolek anti või tagasi võeti. Nõusolek ilma ajata ei ole tõendatav.';

-- Turundusnimekirja päring on alati „kes tohib" — ehk ta ei vaata kunagi neid,
-- kes ei tohi. Osaline indeks teenib täpselt seda ja ei kasva ülejäänutega.
create index if not exists patients_marketing_ok_idx
  on public.patients (clinic_id)
  where turundusnousolek = 'jah';

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select turundusnousolek, count(*) from public.patients group by 1;
--   -> kõik 'kysimata' (ükski olemasolev patsient ei ole nõusolekut andnud)
