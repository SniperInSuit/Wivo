-- Lisanduv tasu on LIPP, mitte "mille eest".
--
-- Migratsioon 039 tegi vea, mille see parandab. Ta lisas applies_to väärtuse
-- 'lisa' — aga see sundis valiku: kui igeme disaini reeglil on "mille eest =
-- lisateenus", siis ei saa ta enam olla disain. Igeme disain ON disain. Ainus,
-- mis teda tavalisest disainireeglist eristab, on see, et ta LISANDUB, mitte ei
-- võistle sellega.
--
-- Need on kaks eri küsimust ja nüüd on nad kahes eri veerus:
--   applies_to  — mille eest makstakse (töö, disain, ümbertegemine)
--   additive    — kas lisandub, või konkureerib teiste sama scope'i reeglitega
--
-- `label` on sama loo teine pool: rida "Lisateenus 9 €" ei ütle kellelegi
-- midagi, kui neid on nimekirjas kolm. Reeglil peab olema nimi, mis kandub
-- edasi ka palgalehe reale — "Igeme disain".
--
-- Jooksuta Supabase SQL-redaktoris, Wivo kinni.

alter table public.worker_rates
  add column if not exists additive boolean not null default false,
  add column if not exists label    text;

comment on column public.worker_rates.additive is
  'Kas see tasu lisandub tootmistasule (nt igeme disain) või konkureerib '
  'sama scope''i teiste reeglitega nagu tavaline tootmisreegel';
comment on column public.worker_rates.label is
  'Reegli nimi, nt "Igeme disain". Kandub palgalehe reale, et sarnaseid ridu '
  'saaks üksteisest eristada';

-- Reeglid, mis jõuti salvestada lühiajalise 'lisa' scope'i all, on tegelikult
-- teostatud töö eest makstavad lisatasud. Teisendus enne piirangu kitsendamist,
-- muidu jääks constraint kehtestamata ridade taha kinni.
update public.worker_rates
   set applies_to = 'too', additive = true, label = coalesce(label, 'Lisateenus')
 where applies_to = 'lisa';

alter table public.worker_rates drop constraint if exists worker_rates_scope_valid;
alter table public.worker_rates add constraint worker_rates_scope_valid
  check (applies_to in ('too', 'disain', 'muudatus'));

comment on column public.worker_rates.applies_to is
  'Mille eest makstakse: too = teostatud töö, disain = töö disain, '
  'muudatus = ümbertegemine';
