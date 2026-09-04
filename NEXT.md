# Mis edasi

**Seis: v1.79.0 · 04.09.2026 · haru `main`**

See fail kirjutatakse iga töö lõpus üle. Siin on alati see, mida ma viimases
vestluses ütlesin — et uus arvuti või uus vestlus ei alustaks nullist.

`HANDOFF.md` on arendaja püsireeglid ("ära kunagi tee X"). See fail on
hetkeseis: mis on tehtud, mis ootab sind, mis on blokeeritud.

---

## 🔴 Esimene asi uues masinas

```bash
npm ci
npm test        # 631 rohelist, 0 punast
npm run build
```

`.env` **ei ole gitis**. Uues masinas tuleb see käsitsi teha:
`VITE_SUPABASE_URL` ja `VITE_SUPABASE_ANON_KEY`. Projekt on
`wrtucsfmpbwekugzzzxw`.

Windowsis: PowerShell 5.1 ei toeta `&&`, reamurdmist `\` ega `openssl`. Kõik
käsud on PowerShelli kujul `docs/veebibroneering.md`-s.

---

## ✅ Migratsioonide seis on nüüd rakenduses

**Seaded → Andmebaas.** Küsib andmebaasilt otse, mis on jooksutatud ja mis
mitte, ning ütleb, millise faili sisu SQL editorisse kleepida. Ei ole vaja enam
mälu järgi arvata — see leht tekkis pärast neljandat korda, kui jooksutamata
migratsioon avastati ühe ekraani kaupa.

⚠ Pärast veeru lisamist jooksuta **eraldi päringuna**
`notify pgrst, 'reload schema';` — PostgREST hoiab skeemi vahemälus. See on koht,
kus „jooksutasin ju ära" kõige sagedamini tõeks osutub ja ikka ei tööta.

---

## ✅ Veebibroneering töötab otsast otsani

**Juhend: [`docs/veebibroneering.md`](docs/veebibroneering.md)** — seadistus,
deploy, testimine, veatabel. Kõik käsud PowerShelli kujul.

Voog: patsient valib teenuse → arvutab hinna hambakaardil → näeb **päris vabu
aegu** Wivo päevikust → broneerib → taotlus maandub „Taotlused" lehel (punane
loendur) → keegi vajutab „Broneeri" → visiit kalendris.

Tõestatud päris andmetega 02.09: veebist tulnud taotlus jõudis Wivosse ja sai
visiidiks.

| Osa | Kus |
|---|---|
| Vaba aja arvutus | `shared/portal/slots.ts` — 20 testi, **ajavööndita** |
| Ajavööndi teisendus | `supabase/functions/_shared/slotData.ts` — AINUS koht |
| Hinnakalkulaator | `shared/portal/publicCalculator.ts` — 21 testi |
| Makse reeglid | `shared/portal/montonioClaims.ts` — 14 testi, krüptota |
| Allkirjad ja HTTP | `supabase/functions/_shared/montonio.ts` — ainus, mis võtit puudutab |
| Vidin | `web/embed/wivo-booking.js` — sõltuvusteta, ehitusetapita |
| Vidina generaator | `node web/embed/build-embed.mjs --clinic <slug>` |

### Otsused, mis on tehtud ja mille juurde ei pea tagasi tulema

- **Taotluste süsteem jääb.** Automaatne kinnitamine on Seadetes lüliti taga ja
  vaikimisi väljas. Põhjus (sinu ja sekretäri oma): nii saab spämmida, ja
  inimene, kes on juba maksnud, ei taha kuulda, et ta broneering lükati tagasi
- **Puuduv seade sulgeb päeviku, ei ava kunagi.** Nädalapäev ilma kellaaegadeta
  on KINNI
- **Vidin ei arvuta ega valideeri midagi.** Hinnad tulevad serverist vormindatud
  tekstina; valideerimisest teeb ta ainult tühja välja kontrolli
- **Kalender ei täida ennast** — visiit tekib siis, kui keegi kinnitab

---

## 🟡 Ootab sind

1. **`sql/063` + kapslihind.** Jooksuta `sql/063_job_material_units.sql`, siis
   eraldi `notify pgrst, 'reload schema';`. Seejärel Seaded → Hinnad →
   Materjalid → Midas → **„+ Kapslihind"**: hind `21`, mahutavus `3`, molaar `3`.
   ⚠ Enne sisselülitamist vaata Statistika → Rahandus „Materjal ja tarvikud"
   number üles — see **muutub tagantjärele kõikidel varasematel töödel**, sest
   materjalikulu arvutatakse iga kord praegustest seadetest, mitte ei salvestata
   töö küljes. See on parandus, aga ta peab olema teadlik
2. **Montonio konto verifitseerimine.** Kuni selleni `MONTONIO_ENV="sandbox"`.
   Ilma võtmeteta jäetakse tasu vahele ja taotlus tuleb ikka kohale
3. **Vidin Frameri lehele** — `build-embed.mjs`, siis kleepida Embed komponenti
4. **`git push`**

---

## 🟡 Teadaolevad võlad

- **`periodMetrics` „käive" liidab muudatuste hinnad juurde.** Ülejäänud
  rahapool ütleb, et muudatuse kulu on labori oma ega lähe kliendi arvele
- **Omahinna ülekirjutus (`kulu_yle`) ei kajastu Statistika kuluridades.**
  `calculateFinance` arvutab kulud oma teed. Teadlik valik, mitte unustus
- **`jobPeriodDate` langeb ilma valmimiskuupäevata tähtajale ja siis saabumise
  kuupäevale.** Palga jaoks vale; ekraan hoiatab (v1.62.1), arvutust ei
  muudetud, sest see liigutaks raha juba kinnitatud väljamaksetes
- **Põrkeid ei näe.** `sent_at` tähendab „server võttis vastu"
- **`sql/044` 1. samm on jooksutamata**
- **Kapsli mahutavus on hinnang.** Tegelik mahtumine sõltub hamba suurusest,
  tugedest ja sellest, kuidas plaat pakiti. Sellepärast on tehniku käsitsi arv
  arvutatud arvust eespool — ja ainult üle ühe töö. Plaadi jagamine mitme töö
  vahel (`print_id`) on teadlikult tegemata: vt plaani „Faas 2"
- **`visits.clinic_id` võib olla NULL** (sql/015 lisas ta nii). Aegade arvutus
  loeb need hõivatuks — halvimal juhul jääb tund pakkumata, mis on ohutum suund

---

## 📍 Kus asjad on

| Mis | Kus |
|---|---|
| **Veebibroneeringu juhend** | `docs/veebibroneering.md` |
| Vidina paigaldus | `web/embed/README.md` |
| Maksegraafiku + postkasti plaan | `~/.claude/plans/aga-kui-klient-maksab-spicy-hippo.md` |
| Onboarding'u audit | `docs/onboarding-audit.md` |
| Finantsnäitajate sõnastik | `docs/finance-metrics.md` |
| Edge-funktsiooni deploy | `supabase/functions/README.md` |
| Arendaja püsireeglid | `HANDOFF.md` |

---

## Järgmine samm — kolm valikut

### 1. Raamatupidamise pakett *(kõrgeim äriline väärtus)*

Ainus konkreetne maksevalmiduse andmepunkt: tehnik ütles **39 / 100 / 170 € kuus,
tingimusel et raamatupidamise dokumendid tulevad automaatselt**. Tingimus on
täitmata.

Mõte ei ole raamatupidamine ise — see on Meriti territoorium. Mõte on
**„raamatupidajale valmis pakett"**: lukustatud periood, müügireskontro,
käibemaksu kokkuvõte määrade kaupa, laekumised, kulupool. Andmed on olemas,
puudub koondamine ja eksport.

### 2. Müügiblokeerijad *(enne kui Wivot kellelegi müüa)*

- **Litsentsivõtit ei saa väljastada** — `LICENCE_PUBLIC_KEY` on tühi, praegused
  build'id **ei kontrolli litsentsi üldse**. „Labor+" ja „Labor" on
  funktsionaalselt identsed
- **Värskest andmebaasist ei saa Wivot püsti panna** — ükski migratsioon ei loo
  `jobs` tabelit. Vt `docs/onboarding-audit.md`

### 3. Kalendri kolimine Dentasest Wivosse

Testimine algab järgmine kuu. Veebibroneering loeb juba **ainult Wivo
kalendrit**, nii et kolimise järel on see ahel terve. Enne seda elavad kaks
kalendrit kõrvuti — teadlik hind selle eest, et mitte oodata Dentase API taga.

### Väiksemad, välja öeldud aga tegemata

- Töö lehele **„Maksegraafik"** nupp, mis avab arve vormi selle töö ja
  patsiendiga täidetuna
- Automaatne kinnituskiri patsiendile. E-posti taristu on olemas, aga MDR-i
  tõttu ei tohi kiri sisaldada ravi kohta midagi peale aja
