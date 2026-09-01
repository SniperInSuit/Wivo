-- ============================================================================
-- Wivo — migration 054: neto- või brutopalk, ja iga inimese maksuprofiil
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   Töötasud luges iga tasureegli summa BRUTOks ja lisas sellele tööandja
--   maksud. Enamik väikesi tööandjaid lepib kokku selle summa, mis inimese
--   kontole jõuab — netos. Netot brutona lugedes jääb kogu töötaja poolt
--   kinnipeetav maksukiil kulust välja:
--
--     1600 € neto (Eesti 2026) = 1923.08 € bruto = 2573.08 € tööandja kulu
--     1600 € "brutona"                            = 2140.80 € tööandja kulu
--
--   Vahe on 432.28 € kuus ÜHE inimese pealt, ja see läks otse kasuminumbrisse
--   Statistika lehel. Enesekindel vale arv, mille pealt planeeritakse.
--
--   tasu_arvestus = 'bruto' vaikimisi: see on see, mida senised numbrid juba
--   eeldasid. Midagi ei muutu enne, kui keegi märgib inimese netopalgaliseks.
--
--   kogumispension_protsent ja maksuvaba_tulu on NULL-lubatud meelega. NULL =
--   "kasuta kliiniku vaikeväärtust", 0 = "see inimene on II sambast väljas" /
--   "maksuvaba tulu kasutatakse teise tööandja juures". Need kaks ei tohi
--   kogemata sama palgalehte anda.
-- ============================================================================

set lock_timeout = '10s';

alter table public.profiles
  add column if not exists tasu_arvestus text not null default 'bruto',
  add column if not exists kogumispension_protsent numeric(4,2),
  add column if not exists maksuvaba_tulu numeric(8,2);

alter table public.profiles drop constraint if exists profiles_tasu_arvestus_valid;
alter table public.profiles add constraint profiles_tasu_arvestus_valid
  check (tasu_arvestus in ('bruto', 'neto'));

-- II sammas on 0, 2, 4 või 6 protsenti. Piir on lai meelega: määrasid on
-- muudetud varemgi ja seadusemuudatus ei tohi rakendust katki teha.
alter table public.profiles drop constraint if exists profiles_kogumispension_valid;
alter table public.profiles add constraint profiles_kogumispension_valid
  check (kogumispension_protsent is null
         or (kogumispension_protsent >= 0 and kogumispension_protsent <= 20));

alter table public.profiles drop constraint if exists profiles_maksuvaba_tulu_valid;
alter table public.profiles add constraint profiles_maksuvaba_tulu_valid
  check (maksuvaba_tulu is null
         or (maksuvaba_tulu >= 0 and maksuvaba_tulu <= 10000));

comment on column public.profiles.tasu_arvestus is
  'bruto = tasureeglite summad on brutopalk; neto = summad on kättesaadav palk, millest arvutatakse bruto ja tööandja kulu tagurpidi';
comment on column public.profiles.kogumispension_protsent is
  'II samba määr %. NULL = kliiniku vaikeväärtus, 0 = ei ole II sambas. Mõjutab netost brutosse arvutamist.';
comment on column public.profiles.maksuvaba_tulu is
  'Maksuvaba tulu € kuus. NULL = kliiniku vaikeväärtus, 0 = ei rakendata (nt teine tööandja).';
