# Mis edasi

**Seis: v1.97.0 · 27.10.2026 · haru `main`**

See fail kirjutatakse iga töö lõpus üle. Siin on alati see, mida ma viimases
vestluses ütlesin — et uus arvuti või uus vestlus ei alustaks nullist.

`HANDOFF.md` on arendaja püsireeglid ("ära kunagi tee X"). See fail on
hetkeseis: mis on tehtud, mis ootab sind, mis on blokeeritud.

---

## 🔴 Esimene asi uues masinas

```bash
npm ci
npm test        # 804 rohelist, 0 punast
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

## ✅ 3D hambakaart on olemas (Faas 1a)

Lüliti **2D / 3D** on hambakaardi kohal igal neljal kutsumiskohal, sealhulgas
uue töö wizardis. 2D jääb **vaikimisi** — 14 hamba valimine on seal kiirem.

| Mis | Kus |
|---|---|
| Mudel | `resources/teeth.glb` — 33 objekti (`tooth_11`…`tooth_48` + `gingiva`) |
| Päritolu | `resources/teeth.glb.SOURCE.md` — ostetud TurboSquidist, Standard License |
| Teisendaja | `scripts/teeth-to-glb.mjs` — OBJ+TGA → GLB, **ilma uue sõltuvuseta** |
| 3D vaade | `src/renderer/src/components/teeth/Odontogram3D.tsx` |
| Puhas loogika | `odontogram3dCore.ts` (15 testi) · `toothInteraction.ts` (13 testi) |
| Lüliti ja langusteed | `ToothPicker.tsx` |

### Otsused, mille juurde ei pea tagasi tulema

- **Patsiendi skanne ei pane.** MDR. 3D on idealiseeritud kaart, mitte diagnoos
- **Mudel tuleb IPC kaudu, mitte `fetch`-iga.** Renderer laetakse `loadFile`-iga,
  ehk päritolu on `file://`, ja Chromium keeldub seal `fetch`-ist. `GLTFLoader`
  kasutab fetch'i — töötaks arenduses ja kukuks igas paigalduses. Seetõttu
  `ipcMain.handle('wivo:teeth-model')` → `GLTFLoader.parse()`
- **`three` on `React.lazy` taga.** ~650 KB JS-i ei parsita nende jaoks, kes 3D-d
  ei ava
- **Renderdab nõudmisel, mitte `requestAnimationFrame` silmuses.** Seepärast on
  OrbitControls'i damping väljas — sujuv hääbumine nõuaks pidevat silmust, ja
  paneel lahti terve päev tähendaks üht tuuma tööl
- **Hambalt alustatud lohistamine märgib, tühjalt kohalt pöörab.** Otsus
  langetatakse `pointerdown`-i kiirest (`decideGesture`), nii et märkimine ja
  pööramine ei võitle kunagi
- **Klikireeglid elavad `toothInteraction.ts`-is ja neid loevad MÕLEMAD vaated.**
  Need reeglid otsustavad raha — kaks lahku läinud koopiat ei paistaks katkise
  kaardina, vaid seletamatu palgana
- **WebGL puudu või mudel puudu → vaikne langus 2D peale, eelistust EI
  salvestata.** Eelistuse ülekirjutamine masina nimel tähendaks, et sama arvuti
  pärast draiveriuuendust ei paku 3D-d enam kunagi

### 🟡 3D — mis veel ootab

- **Faas 1b:** lohistades mitme hamba märkimine 3D-s, implantaadid, disainija
  hambad, peegeldus
- **Faas 1c:** varjud, teemareaktiivsus, eestikeelne tekstiülevaatus
- **Pakendatud NSIS-paigaldusest testimata.** `npm run dev` **ei suuda** ülalkirjeldatud
  `file://` klassi vigu näidata — see on ainus värav, mis seda püüab
- Nähtav ige lõikeserv küljelt vaadates; tekstuurid 512 px peale annaks 4,0 MB →
  ~1,7 MB. Mõlemad on kosmeetika, kummalgi pole kiiret

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

1. **`sql/063`.** Jooksuta `sql/063_job_material_units.sql`, siis eraldi
   `notify pgrst, 'reload schema';`. Seadetes ei ole midagi teha — kapsli hind
   ON juba materjali tükihind (Midas 21 €). Töö vormi tekib masina alla väli
   **„Kapsleid"**: sisesta arv, kulu on `arv × 21 €`. Tühjaks jättes arvestatakse
   endiselt hammaste järgi.
   ⚠ Varasemad tööd jäävad hammaste järgi seni, kuni keegi kapslite arvu
   sisestab — need ei muutu tagantjärele iseenesest
2. **Montonio konto verifitseerimine.** Kuni selleni `MONTONIO_ENV="sandbox"`.
   Ilma võtmeteta jäetakse tasu vahele ja taotlus tuleb ikka kohale
3. **Vidin Frameri lehele** — `build-embed.mjs`, siis kleepida Embed komponenti
4. **Kontrolli, kas 2D ja 3D näitavad sama hammast samal pool.** Ava töö, märgi
   2D-s üks **ülemine parem** hammas (nt 16), lülita 3D peale. Mudel on
   peegelsümmeetriline, ehk „õige" ja „peegeldatud" näevad 3D-s täpselt
   ühesugused välja — absoluutset tõde seal ei ole. Ainus, mis loeb, on et 3D
   ütleks sama, mis 2D. **Kui on peegelpildis:** keera
   `PLUS_X_IS_PATIENT_LEFT` `scripts/teeth-to-glb.mjs`-is ümber ja genereeri
   `resources/teeth.glb` uuesti
5. **`git push`** — 6 commiti ootab

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
- **Kapslite arv käib ühe töö kohta.** Plaadi jagamine mitme töö vahel
  (`print_id`) on teadlikult tegemata: kui üks plaat kandis kahe töö hambaid,
  tuleb arv ise nende vahel ära jagada. Vt plaani „Faas 2"
- **`visits.clinic_id` võib olla NULL** (sql/015 lisas ta nii). Aegade arvutus
  loeb need hõivatuks — halvimal juhul jääb tund pakkumata, mis on ohutum suund

---

## 📍 Kus asjad on

| Mis | Kus |
|---|---|
| **Veebibroneeringu juhend** | `docs/veebibroneering.md` |
| Vidina paigaldus | `web/embed/README.md` |
| **v2.0 ulatus ja hinnang** | **`docs/v2.md`** |
| 3D hambakaardi täisplaan | `~/.claude/plans/aga-kui-klient-maksab-spicy-hippo.md` |
| Onboarding'u audit | `docs/onboarding-audit.md` |
| Finantsnäitajate sõnastik | `docs/finance-metrics.md` |
| Edge-funktsiooni deploy | `supabase/functions/README.md` |
| Arendaja püsireeglid | `HANDOFF.md` |

---

## 🚀 v2.0 — suur uuendus

**Kogu ulatus ja tehniline hinnang: [`docs/v2.md`](docs/v2.md).**

Omaniku sõnastatud: 3D hambakaart · selgem „Lisa töö" funnel · spidomeetri-tüüpi
seadistatavad statistikanäidikud · teema, kus kasutaja määrab iga värvi ·
**suhtlus ja grupivestlused**, kus töid saab märgendada ja arutada (praegu käib
see WhatsAppis, eraldi igaühega).

Soovitatav järjekord ja **kaks eeldust, mida ei tohi vahele jätta**, on selles
failis. Lühidalt: **RLS ei jõusta praegu õigusi** ja vestlusega kasvab see päris
probleemiks.

**3D hambakaart on Faas 1a-ni tehtud** — vt ülalpool. Mudelit enam ei oodata.
Järgmised 3D sammud (1b, 1c) on kosmeetika ja mugavus, mitte blokeerijad.

---

## Järgmine samm — kolm valikut *(v2.0 eelsed, endiselt lahtised)*

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
