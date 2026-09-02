# Mis edasi

**Seis: v1.61.0 · 02.09.2026 · haru `main`**

See fail kirjutatakse iga töö lõpus üle. Siin on alati see, mida ma viimases
vestluses ütlesin — et uus arvuti või uus vestlus ei alustaks nullist.

`HANDOFF.md` on arendaja püsireeglid ("ära kunagi tee X"). See fail on
hetkeseis: mis on tehtud, mis ootab sind, mis on blokeeritud.

---

## 🔴 Esimene asi uues masinas

```bash
npm ci
npm test        # 514 rohelist, 0 punast
npm run build
```

`.env` **ei ole gitis**. Uues masinas tuleb see käsitsi teha:
`VITE_SUPABASE_URL` ja `VITE_SUPABASE_ANON_KEY`. Projekt on
`wrtucsfmpbwekugzzzxw`.

Supabase CLI vajab uues masinas `supabase login` (brauseripõhine). Projekt on
juba lingitud selle repo kaudu; saladused elavad Supabase'is, mitte failides.

---

## 🔴 Jooksutamata migratsioonid — kaks

Supabase SQL editoris, **Wivo kinni**:

### 1. `sql/056_fix_cron_key.sql` — sellest sõltub kogu automaatne saatmine

**Cron on katki ja on olnud katki algusest peale.** Sinu enda SQL näitas seda:
iga tunni 7. minutil `401 UNAUTHORIZED_INVALID_JWT_FORMAT`, tund tunni järel läbi
öö. pg_cron ja pg_net töötavad täiuslikult; **Vaultis ei ole võtit, seal on
sõna `<SERVICE_ROLE_KEY>`** — `sql/052` kohatäide jäi asendamata ja miski ei
öelnud seda välja.

Sellepärast tuli 02.09 kiri alles siis, kui **mina käivitasin funktsiooni
käsitsi**. Sinu sisselogimine ei olnud põhjus.

**Mida teha:** ava `sql/056`, asenda real 28 `<SERVICE_ROLE_KEY>` päris võtmega
(Dashboard → Project Settings → API Keys → service_role → Reveal), jooksuta.
Fail **keeldub valjult**, kui võti on asendamata — iga võti algab `eyJ`.
Verify-plokis on käsk, millega saad cron'i kohe käsitsi käivitada, ilma tundi
ootamata, ja päring `net._http_response` pihta, mis on **ainus koht, kus on
kirjas, mida funktsioon päriselt vastas**.

⚠ `cron.job_run_details` ütleb „succeeded" ka 401 puhul. Ära vaata sealt.

### 2. `sql/057_job_cost_override.sql` — kulude käsitsi muutmine

`jobs.kulu_yle jsonb`. Ilma selleta töötab uus kulude tabel edasi, aga pliiatsi
vajutamine annab konsooli vea ja muudatus ei salvestu.

*(049–055 on jooksutatud.)*

---

## ✅ Mis selles vestluses valmis sai (v1.61.0)

Kõik neli asja, mis sa palusid:

1. **Kulude tabel on nüüd nähtav ka väljaspool „Muuda"** — töö lugemisvaates,
   sama komponent, sama arvutus. `payroll.manage` õiguse taga, sest read on
   inimeste tasumäärad.
2. **Mudel on kulude listis** — see kood oli juba olemas ja on nüüd testiga
   kaetud. **Kui sa mudelit ikka ei näe: sinu 10 € reegel ei ole „Mudel"
   ulatusega.** Töötasud → reegli juures on neli ulatust (Töö / Disain /
   Muudatus / **Mudel**) — see peab olema Mudel, mitte Töö.
3. **Kulusid saab käsitsi muuta** — pliiats iga kategooria taga, „reegel" nupp
   võtab tagasi. Palka see ei puuduta.
4. **Võlglaste aruanne** — kolm paneeli Statistikas („Võlgu kokku", „Kes on
   võlgu", „Võla vanus") ja Tabeli lehel kaks uut filtrit („Maksed",
   „Võlglane"), summad menüüs kirjas.

Boonus: kolm ammust punast testi parandatud, repo on üleni roheline.

---

## ✅ E-post — testaadressi peal, nagu sa ütlesid

Arved lähevad `treialbusiness@gmail.com` peale, **mitte patsientidele**. Kolm
päris kirja saadetud, PDF-manusega. Idempotentsus tõestatud päris andmetega:
kaks järjestikust käivitust andsid `sent: 1` ja `sent: 0`.

**Pärast `sql/056` jooksutamist hakkab see käima ise, iga tunni 7. minutil.**

⚠ **Testaadressi eemaldamine Seadetes hakkab saatma päris patsientidele juba
järgmisel täistunnil** — mitte siis, kui sa midagi vajutad. Enne kontrolli:
patsientidel on e-post täidetud, kirja tekst on sinu sõnadega, ja kiri ei lähe
rämpsu (see selgub alles Gmailist väljapoole saates).

Väljalülitamine kahes kohas: Seaded → E-post → „Automaatne saatmine" välja, või
`update cron.job set active = false where jobname = 'wivo-send-invoices'`.

Seaded → E-post näitab „Ajastatud saatja käis viimati…" — see on südamelöök ja
ainus koht, kust näeb, kas kutsuja üldse jõuab kohale.

---

## ✅ Varem valmis

| Versioon | Mis |
|---|---|
| 1.61.0 | Omahind lugemisvaates + käsitsi ülekirjutus (`sql/057`); võlglaste aruanne |
| 1.60.1 | Cron ütles „succeeded" ja ükski arve ei liikunud; saatja südamelöök |
| 1.60.0 | **23 uut paneeli** — võlgnevuse vanus, ühikumajandus, tarne, kliendid |
| 1.57–1.59 | **Minu vaade** — kohandatav Statistika, paneelid ruutudes, `sql/055` |
| 1.54.0 | **Neto/bruto palk** + isiklik maksuprofiil, `sql/054` |
| 1.53.0 | Turunduskontaktide eksport + nõusolek, `sql/053` |
| 1.47–1.52 | **Arvete e-post**: `invoiceDoc`, `sendGuard`, `mailTemplate`, PDF, ajastus |
| 1.46.x | Kogusehinnad — mitu krooni, teine hambahind |
| 1.44–1.45 | Maksegraafik (`sql/049`); osamaksed jätsid töö 1/5 makstuks |
| 1.41–1.43 | Rahapoole lepitamine: muudatuste kulu, arvemaksed, palgaread |

**Tõestatud tee peal:** `supabase functions deploy` pakib kaasa `shared/`
impordi, mis väljub funktsiooni kaustast. Genereeritud koopia varuplaani ei ole
vaja.

---

## 🟡 Teadaolevad võlad

- **`periodMetrics` „käive" liidab muudatuste hinnad juurde.** Ülejäänud
  rahapool ütleb, et muudatuse kulu on labori oma ega lähe kliendi arvele.
  Otsustamata, kas käive peab järgnema.
- **Põrkeid ei näe.** Jagatud majutuse SMTP-l ei ole webhooke: `sent_at`
  tähendab „server võttis vastu", mitte „inimene sai kätte".
- **`sql/044` 1. samm on jooksutamata.**
- **Nõustajas on Kiirtöö ja Mudel teineteist välistavad**, töö lehel mitte.
- **Omahinna ülekirjutus ei kajastu Statistika kuluridades.** `calculateFinance`
  arvutab kulud oma teed; `kulu_yle` mõjutab praegu ainult töö enda tabelit.
  Kui tahad, et üle kirjutatud kulu läheks ka kasumiaruandesse, on see järgmine
  samm — teadlik valik, mitte unustus.

---

## 📍 Kus asjad on

| Mis | Kus |
|---|---|
| Maksegraafiku + postkasti plaan | `~/.claude/plans/aga-kui-klient-maksab-spicy-hippo.md` |
| Vana Dentase broneerimisplaan | `~/.claude/plans/i-have-idea-i-glowing-mccarthy.md` |
| Onboarding'u audit | `docs/onboarding-audit.md` |
| Finantsnäitajate sõnastik | `docs/finance-metrics.md` |
| Edge-funktsiooni deploy | `supabase/functions/README.md` |
| Arendaja püsireeglid | `HANDOFF.md` |

*(Plaanifailid on `~/.claude/plans/` all, MITTE gitis — uues masinas neid ei ole.)*

---

## Järgmine samm — kolm valikut

### 1. Raamatupidamise pakett *(kõrgeim äriline väärtus)*

Ainus konkreetne maksevalmiduse andmepunkt su märkmetes: tehnik ütles
**39 / 100 / 170 € kuus, tingimusel et raamatupidamise dokumendid tulevad
automaatselt**. See tingimus on täitmata.

Mõte ei ole raamatupidamine ise — see on Meriti territoorium ja päris vastutus.
Mõte on **„raamatupidajale valmis pakett"**: lukustatud periood, müügireskontro,
käibemaksu kokkuvõte määrade kaupa, laekumised, kulupool. Andmed on olemas,
puudub ainult koondamine ja eksport.

### 2. Müügiblokeerijad *(enne kui Wivot kellelegi müüa)*

- **Litsentsivõtit ei saa väljastada** — `LICENCE_PUBLIC_KEY` on tühi, praegused
  build'id **ei kontrolli litsentsi üldse**. „Labor+" ja „Labor" on
  funktsionaalselt identsed, uuendusel ei ole midagi müüa.
- **Värskest andmebaasist ei saa Wivot püsti panna** — ükski migratsioon ei loo
  `jobs` tabelit. Teine kliinik ei saa alustada. Vt `docs/onboarding-audit.md`.

### 3. Broneerimissüsteem *(see, mida sa tahad teha)*

Plaan `aga-kui-klient-maksab-spicy-hippo.md`, faasid B1–B4. **Miski ei blokeeri
enam** — deploy on tõestatud ja `_shared/{cors,ratelimit,respond,settings}.ts`
on juba kirjutatud.

- **B1** `sql/058_visit_requests.sql` *(053–057 on võetud)* — eraldi tabel,
  mitte `visits` uus staatus. Põhjused plaanis.
- **B2** `POST /request` olemasolevas `public-booking` funktsioonis.
- **B3** taotluste postkast Wivos, „Kinnita" avab olemasoleva `VisitForm`-i.
- **B4** widget kliiniku lehel.

**GDPR hoiatus:** Wivo-native postkast salvestab patsiendi nime ja telefoni
**meie baasi**, mida vana Dentase-plaan teadlikult vältis. Vaja
säilitustähtaega (pg_cron kustutab tagasilükatud read), privaatsusteadet ja
300-tähemärgist piiri vabal tekstiväljal.

### Väiksemad, välja öeldud aga tegemata

- Töö lehele **„Maksegraafik"** nupp, mis avab arve vormi selle töö ja
  patsiendiga täidetuna. Praegu tuleb Arvete alla minna ja patsient uuesti üles
  otsida — sa läksid seda ise töö lehelt otsima.
- `periodMetrics` „käive" ja muudatuste hinnad — vt võlgade nimekirja.
