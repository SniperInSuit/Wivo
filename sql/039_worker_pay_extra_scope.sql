-- Lisateenused: tasu, mis LISANDUB tootmistasule.
--
-- Miks see vaja oli. Tehnik pakub igemetööd 9 €/hammas ja teeb selle All-on-X
-- töö juurde. Seda ei saanud kuidagi kirja panna: ühe tööosa kohta rakendub
-- täpselt üks tootmisreegel, nii et "9 €/hammas All-on-X-ile" oleks makstud
-- kaare tasu ASEMEL, mitte lisaks. Vastus on aga alati mõlemad.
--
-- Miks scope ja mitte uus kind. `kind` vastab küsimusele "kuidas arvutatakse" —
-- tunni, hamba, töö, protsendi kaupa. `applies_to` vastab küsimusele "mille
-- eest" — teostatud töö, disain, ümbertegemine. Lisateenus on vastus TEISELE
-- küsimusele, mitte esimesele: igemetasu võib olla hamba kaupa või töö kaupa,
-- ja see on labori otsus, mitte meie oma. Uue kind'ina oleks ta saanud olla
-- ainult üht moodi arvutatav — täpselt see viga, mille migratsioon 024 juba
-- kord parandas, kui 'disain' kind'ide seast välja tõsteti.
--
-- Jooksuta Supabase SQL-redaktoris, Wivo kinni.

alter table public.worker_rates drop constraint if exists worker_rates_scope_valid;
alter table public.worker_rates add constraint worker_rates_scope_valid
  check (applies_to in ('too', 'disain', 'muudatus', 'lisa'));

comment on column public.worker_rates.applies_to is
  'Mille eest makstakse: too = teostatud töö, disain = töö disain, '
  'muudatus = ümbertegemine, lisa = lisateenus mis lisandub tootmistasule';

-- worker_payout_lines.kind on teadlikult ilma piiranguta ja jääb nii: väljamakse
-- read on külmutatud koopiad ja peavad jääma loetavaks ka siis, kui reeglite
-- sõnavara hiljem muutub. Vana palgaleht ei tohi muutuda kehtetuks sellepärast,
-- et me lisasime uue tasuliigi.
