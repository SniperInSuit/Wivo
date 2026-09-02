-- ============================================================================
-- Wivo — migration 058: väljamakse rida mäletab, MIS rida ta oli
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- MIS OLI KATKI — TOPELT MAKSMINE
--   Üks töö võib anda mitu palgarida: tootmine, disain, mudel, iga lisatasu
--   reegel eraldi, ja muudatuse pealt needsamad uuesti. Igal neist on oma võti:
--
--     job:<töö>            design:<töö>          mudel:<töö>
--     extra:<reegel>:<töö> rev:<töö>:<muudatus>  revdesign:<töö>:<muudatus>
--     revmudel:<töö>:<muudatus>                  extra:<reegel>:<töö>:<muudatus>
--
--   Väljamakse salvestas reast ainult `job_id`, `revision_id` ja `kind`, ja
--   `paidKeysFrom` proovis võtme neist TAGASI ARVUTADA. Seda ei saa: kümnest
--   võtmekujust taastus neli. Kõik ülejäänud — disain, mudel, iga lisatasu —
--   said tagasi võtme `job:<töö>`.
--
--   Tagajärg: kinnitatud väljamakse EI KATNUD neid ridu. Järgmisel vaatamisel
--   olid nad jälle „arvestamata" nimekirjas ja järgmine kinnitamine oleks nad
--   TEIST KORDA välja maksnud.
--
--   Nähtud päris andmetel 02.09.2026: 42-realine kinnitatud väljamakse, ja
--   kohe pärast kinnitamist seisis samas kohas 7 „Hamba Disain" rida, 135 €,
--   mis olid juba selle 42 sees.
--
-- MIKS VEERG, MITTE TARGEM ARVUTUS
--   Sest võtit ei saa reast tuletada — lisatasu rea silt on kasutaja enda
--   kirjutatud tekst ja võib olla ükskõik mis. Rida peab ise ütlema, kes ta on.
--   Sama põhjus, miks arve rida kopeerib kirjelduse ja hinna töölt: dokument,
--   mis on välja antud, ei tohi sõltuda sellest, et keegi oskaks ta hiljem
--   uuesti kokku panna.
--
-- VANAD READ
--   Jäävad tühjaks. Kood tuletab neile võtme kirjelduse järgi (`Disain: `,
--   `Mudel · `, `Muudatus #…`) ja lisatasu sildi järgi tasureeglitest — see on
--   ainus, mis vanas reas alles on. Uued read seda ei vaja.
--
--   Tuletus on ettevaatlik ühtepidi: kui rida ei tunta ära, jääb ta `job:`
--   kujule nagu seni. See tähendab, et üks vana topeltrida võib veel korra läbi
--   lipsata — aga mitte ükski juba makstud rida ei kao ekraanilt ära, mis oleks
--   vastupidine viga: keegi jääks palgast ilma.

set lock_timeout = '10s';

alter table public.worker_payout_lines
  add column if not exists line_key text;

comment on column public.worker_payout_lines.line_key is
  'Palgarea identiteet: job:<töö> | design:<töö> | mudel:<töö> | '
  'extra:<reegel>:<töö> | rev:<töö>:<muudatus> | revdesign:… | revmudel:… | '
  'hours:<tund> | salary:<periood>. Selle järgi teab arvestus, mis on juba '
  'makstud. NULL = enne 058 tehtud rida, võti tuletatakse kirjelduse järgi.';

-- Otsitakse alati ühe töötaja väljamaksete kaupa, seega päring käib
-- payout_id pealt ja siis võtme pealt.
create index if not exists worker_payout_lines_key_idx
  on public.worker_payout_lines (payout_id, line_key);

-- ─── Verify ─────────────────────────────────────────────────────────────────
--
-- 1. Veerg on olemas ja vanad read on tühjad:
-- select count(*) filter (where line_key is null)  as vanad,
--        count(*) filter (where line_key is not null) as uued
--   from public.worker_payout_lines;
--
-- 2. Pärast järgmise väljamakse kinnitamist peab „uued" kasvama:
-- select line_key, description from public.worker_payout_lines
--  where line_key is not null order by id desc limit 20;
--   -> 'job:…', 'design:…', 'extra:…:…' jne
--
-- 3. Kontroll, kas mõni rida on juba kaks korda makstud (vana viga):
-- select l.job_id, l.description, count(*), sum(l.amount)
--   from public.worker_payout_lines l
--   join public.worker_payouts p on p.id = l.payout_id
--  group by l.job_id, l.description
-- having count(*) > 1
--  order by sum(l.amount) desc;
--   -> Ridu võib olla õiguspäraselt (kaks eri kuud, kaks eri töötajat).
--      Vaata neid, kus SAMA töötaja sama kuu sees on sama rida kaks korda.
