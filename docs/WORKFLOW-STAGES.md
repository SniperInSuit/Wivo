# Plaan 3 — töövoo mallid, etapid ja rollid

**Seis: OK ehitamiseks (Kevin, 19.11.2026), nelja parandusega.** Parandused on
sees: telefon (13. peatükk), vastutaja „töö tellija" (2.6a), liigutamise
reegel (5) ja palk palgaliikide kaupa (10). 8. peatüki küsimused on vastatud
vaikeväärtustega, mida Riia saab hiljem seadetes muuta.
**Uuendatud Riia kolme sisendi järgi (töövoog, mallid, kasutajad ja tarkvara).**

Riia samm 1 (docs/ROADMAP.md). Migratsioonid **122** (skeem) ja **123**
(liigutamine, teavitused, nähtavus, `files.write`), ainult `testing`;
hinnangud nihkusid **124**-ks.

Riia sisend muutis plaani kuju, mitte ainult mahtu: **üks etappide nimekiri
kliiniku kohta ei kanna välja.** Põhjus allpool, 1. peatükk.

---

# 0. Mis praegu olemas on

## 0.1 Töö ja etapid

`jobs.status` on **etapi võti**, mitte enum (sql/000). Etapid kuuluvad
kliinikule: `clinic_settings.pipeline_stages` (jsonb, sql/019), Seaded → Töö
etapid. Kliinik lisab, nimetab ümber ja järjestab etappe ilma migratsioonita.

## 0.2 Teostaja ja disainija — siin on see üks inimene

| Väli | Kust | Mitu |
|---|---|---|
| `jobs.assigned_to` | sql/022 | **üks** |
| `jobs.designed_by` | sql/022 | **üks** |
| töö osa oma disainija (`work_items`, sql/032) | — | üks osa kohta |
| paranduse oma teostaja ja disainija (`revisions`) | sql/087 | üks paranduse kohta |

Mudel ei ole nii kitsas, kui demos paistis: töö osal on juba oma disainija ja
parandusel oma teostaja, mõlemal tagasilangusega töö omale (`lib/earnings.ts`,
`designPayItemsOf`). Muster "oma inimene, muidu töö oma" on olemas ja seda
tasub korrata, mitte leiutada.

## 0.3 Teavitused

`notification` (sql/075) oli **partneri** oma. **sql/095 lisas kliiniku enda
omad, ja see on ainult `testing`-us:** `stage_reached` (töö jõudis etappi,
teavitatakse teostajat ja disainijaid, etapi kaupa `notifyTechnician` /
`notifyDesigner` järgi) ja `assigned`. Kanalid inimese kaupa:
`profiles.notify_email`, `profiles.notify_push`; kell näitab alati kõike.

`main` on 000–091, `testing` 000–121. **Riia ei saa joosta main-i koodiga** —
seal ei teavitata kliiniku oma tehnikut üldse.

## 0.4 Failid — suures osas juba olemas

sql/072 + sql/073, mõlemas harus:

1. `register_job_file` kontrollib õigused, annab versiooni ja tee;
2. klient laeb **täpselt sellele teele, katkestuse järel jätkatavalt (TUS)**;
3. `confirm_job_file` märgib valmis.

Storage'i INSERT-poliitika võtab vastu ainult tee, mille sama kasutaja
registreeris ja mida pole veel laetud: mujale ei kirjuta, üle ei kirjuta.
Allalaadimine käib `request_file_download` kaudu — lühiajaline link **ja
auditirida**; grant'ita linki ei ole. Kustutamist ei ole, on pehme kustutus ja
versioonid. Kopp `job-files` on 500 MB peal.

Eelvaade (073) tehakse **laadija enda masinas** ja pannakse faili kõrvale:
praegu STL → PNG ja fotode pisipildid.

Failitüübid täna: `scan`, `photo`, `xray`, `print`, `design`, `other`.

## 0.5 Telefon

`src/renderer/src/mobile/`: töö vaatamine, `PhoneCamera`, testingus lisaks
`PhoneVersionGuard` ja `PushTurnOnNotice`. Mida telefon selle plaaniga saab,
on 13. peatükis.

## 0.6 Palk

`lib/earnings.ts` teeb read `assigned_to`-st (tükitöö) ja osa kaupa
disainijast. Palk on **tööpõhine**.

---

# 1. Riia töövood — ja miks üks nimekiri ei kanna välja

## 1.1 Juhtum A: kroon laboris

1. **Skaneering või jäljend** (arst): digitaalne skaneering või tavajäljend.
2. **Failide vastuvõtt**: kliiniku IT laeb digifailid või kipsmudelite info
   vahetuskohast töö juurde.
3. **Fotogramm-meetria, valikuline**: ainult kui töö on digitaalne **ja**
   implantaate on üle ühe.
4. **Disain** (digitehnik).
5. **Printimine või freesimine** (sama digitehnik).
6. **Käsitsi viimistlus** (teine tehnik).
7. **Valmis ja üleandmine.**

## 1.2 Juhtum B: kroon kabinetis

Arst skannib suu, **disainib krooni ise ja freesib selle** (CEREC), siis teeb
käsitsi tehnik viimistluse. Sama kliinik, sama etapikogu, **teine järjekord ja
teised vastutajad** — ja etapi vastutaja on siin **arst**, mitte tehnik.

## 1.3 Mis veel tuleb

Protseduure lisandub järk-järgult: nt skaneering + fotod + **KT** →
**kirurgilise juhiku** tootmine. Mõnel protseduuril on **vahamudel (wax-up)
kohustuslik**.

## 1.4 Järeldus

Kaks juhtumit ühes kliinikus, erineva järjekorra ja erinevate vastutajatega,
pluss protseduurid, mis lisanduvad ilma meie release'ita. Seega:

**Etapid on kliiniku etapikogu. Töövoog on mall. Töö luuakse mallist.**

---

# 2. Mudel

## 2.1 Etapikogu

Kliiniku etapid jäävad sinna, kus nad on (`clinic_settings.pipeline_stages`):
nt Skaneering, Vastuvõtt, Fotogramm-meetria, Disain, Freesimine, Printimine,
Viimistlus, Valmis. Üks nimekiri kliiniku kohta, mida mallid kasutavad.

## 2.2 Mall = protseduur

Mall on nimi + järjestatud etapid, igaühel oma vaikevastutajad, oma ülesande
tekst ja oma valikulisus. Nt „Kroon, labor", „Kroon, kabinetis",
„Implantaatsild", „Kirurgiline juhik".

**Kliinik loob ja muudab malle ise seadetes. Uus protseduur ei vaja meie
release'i** — see on sama lubadus, mis etappidel juba on.

## 2.3 Skeem (migratsioon 122)

```sql
workflow_template (
  id, org_id, name, is_default boolean, archived_at, created_at, updated_at,
  unique (org_id, name)
)

workflow_template_stage (
  id, org_id, template_id, stage_key,
  position    int not null,
  task        text,            -- ülesande tekst vaikimisi
  optional    boolean,         -- lülitiga valitav töö loomisel
  only_if     text,            -- SULETUD reeglinimi, vt 2.5
  default_on  boolean,         -- lülitiga etapi linnuke töö loomisel, vt 2.5
  orderer     boolean,         -- vastutaja on töö tellija, vt 2.6a
  pay_role    text,            -- palgaliik (RateScope): 'too' | 'disain' | 'mudel' | 'muudatus' | null
  unique (template_id, position)
)
-- iga palgaliik on mallis täpselt ühel etapil (vt 10):
unique index on workflow_template_stage (template_id, pay_role) where pay_role is not null

workflow_template_stage_person (template_stage_id, profile_id, org_id,
  primary key (template_stage_id, profile_id))

clinic_stage_default (org_id, stage_key, profile_id,     -- tagavara: „Printimine on alati Jānis"
  primary key (org_id, stage_key, profile_id))

job_stage (
  id, org_id, job_id, stage_key,
  position int not null, task text,
  skipped_at timestamptz,              -- vahele jäetud: teavitust ei saa keegi
  started_at timestamptz, started_by uuid,
  done_at    timestamptz, done_by    uuid,
  unique (job_id, stage_key)
)

job_stage_person (job_stage_id, profile_id, org_id, added_by, added_at,
  primary key (job_stage_id, profile_id))

alter table public.jobs
  add column template_id uuid references public.workflow_template(id),
  add column ordered_by  uuid default auth.uid(),  -- töö tellija, vt 2.6a
  add column impression_type   text,     -- 'digital' | 'conventional'
  add column implant_count     int,
  add column production_method text,     -- 'print' | 'mill'
  add column printed_model     boolean;
```

Igal uuel tabelil `org_id` ja RLS samas migratsioonis, RLS leak-test,
`select public.ensure_mfa_policies();` lõpus (CLAUDE.md).

**Vaikevastutajad kopeeritakse, ei viidata.** Töö loomisel kirjutatakse malli
inimesed `job_stage_person`-i ridadeks (etapil, kus malli oma ei ole, võetakse
`clinic_stage_default`). Malli hilisem muutmine **ei tohi** muuta seda, kes
tegi eelmise kuu töö — palk loeb neidsamu ridu.

## 2.4 Töö luuakse mallist, töö juures saab muuta

Töö loomisel: mall → etapid, järjekord, vastutajad, ülesanded. Töö juures saab
etappe **lisada, vahele jätta ja vastutajaid muuta**. Vahele jäetud etapp saab
`skipped_at` ja **ei saada teavitust kellelegi**.

## 2.5 Valikulisus: lüliti või reegel

Kaks teed, mõlemad mallis:

- **Lüliti** (`optional = true`): töö loomisel linnuke („vahamudel",
  „kvaliteedikontroll"). `default_on` ütleb, kas linnuke on vaikimisi peal.
  Lülitita etapp (`optional = false`, ilma `only_if`-ita) on alati sees: nii
  teeb mall etapi **kohustuslikuks**.

**Vaikeväärtused (Kevin, 19.11; Riia muudab hiljem seadetes):**
- **Kvaliteedikontroll:** lülitiga etapp, vaikimisi väljas.
- **Vahamudel:** lülitiga etapp; mallis saab selle kohustuslikuks teha.
- **Reegel** (`only_if`): **suletud nimekiri**, mida hinnatakse töö väljadest:

| `only_if` | Etapp tuleb sisse, kui |
|---|---|
| `digital` | `impression_type = 'digital'` |
| `conventional` | `impression_type = 'conventional'` |
| `implants_gt_1` | `implant_count > 1` |
| `print` | `production_method = 'print'` |
| `mill` | `production_method = 'mill'` |
| `printed_model` | `printed_model = true` |

Fotogramm-meetria on siis `digital` **ja** `implants_gt_1` — kaks reeglit ühel
etapil, mõlemad peavad kehtima.

**Suletud nimekiri, mitte vaba avaldis.** Vaba reeglikeel jsonb-is on asi,
mida ei saa testida ega veateatesse panna, ja mille esimene kirjaviga ilmub
välja alles kuu aega hiljem palgal. Uus reegel on üks rida koodis ja üks
test — ja seda vajab nii harva, et see ei lõhu lubadust „uus protseduur ilma
release'ita": **protseduur** on mall, **reegel** on tüüpjuhtum.

## 2.6 Vastutaja võib olla mis tahes roll

`job_stage_person.profile_id` on profiil, mitte „tehnik". Arst, tehnik, IT —
vahet ei ole. Juhtum B eeldab seda.

## 2.6a Vastutaja „töö tellija"

Malli etapi vastutaja võib olla **„arst, kes töö lõi"** (`orderer = true`),
mitte nimeline inimene. Töö loomisel kirjutatakse `jobs.ordered_by` (looja,
vaikimisi `auth.uid()`) selle etapi `job_stage_person` reaks, nagu iga teine
vaikevastutaja (kopeeritakse, ei viidata, 2.3).

**Tellija omad vaikimisi** (Kevin, 19.11):
- Skaneering;
- Fotogramm-meetria;
- kabinetis tehtud töö mallis („Kroon, kabinetis") Disain ja Freesimine.

Vanal tööl on `ordered_by` tühi. Seal ei kirjutata midagi ja kehtib 3. ja 5.
peatüki tagavara.

## 2.7 Olemasolev kliinik ei lähe katki

Praegusest `pipeline_stages` nimekirjast tehakse migratsioonis **vaikemall**
(`is_default = true`). Iga olemasolev töö kuulub sellesse: `job_stage` read
tehakse olemasolevast `status`-est ja `assigned_to` / `designed_by`-st, nii et
vana töö näeb välja nagu enne ja maksab nagu enne.

## 2.8 Palk ja statistika käivad **etapi** järgi

`pay_role` istub `workflow_template_stage` peal, aga **loeb etapi võtme
kaupa**: Disain tähendab igas mallis sama palgarolli ja samasse
statistikalahtrisse. Mall on ainult see, mis etapid ühe protseduuri jaoks
kokku paneb — ta ei ole palgaühik ega statistikaühik.

---

# 3. Teavitused

Allikas, järjekorras:

1. selle etapi `job_stage_person`;
2. kui tühi → töö `assigned_to` / disainijad, **nagu praegu**;
3. kui ka see tühi → **kliiniku omanik**.

Välja jäävad alati:

- **liigutaja ise**;
- **inimene, kes oli juba eelmise etapi vastutaja.** Üks inimene vastutab
  mitme järjestikuse etapi eest (juhtum A, disain + printimine) — tema ei saa
  teavitust iseendalt endale;
- **vahele jäetud etapi** vastutajad (`skipped_at`);
- keegi väljaspool töö kliinikut.

Teavitus kannab töö koodi ja etapi võtme. **Patsienti mitte**, nagu praegu.

## 3.1 Kes saab mida (Kevin, 19.11)

| Sündmus | Kellele | Kell | E-kiri | Push |
|---|---|---|---|---|
| **Töö jõudis etappi** („sinu kord") | selle etapi vastutajad (ahel ülal) | jah | jah* | jah* |
| **Töö jõudis etappi**, teised osalised | töö teiste etappide vastutajad, kes on sisse lülitanud „Saada mulle e-kiri iga etapi kohta tööde puhul, kus olen osaline" | jah | jah | ei |
| **Uus töö** („Uus töö, sina oled etapis X") | kõik selle töö etappide vastutajad, töö loomisel | jah | **ei** | **ei** |

\* inimese enda `notify_email` / `notify_push` järgi, nagu praegu (sql/095).

- **Uus valik inimese enda seadetes:** `profiles.notify_every_stage`
  (boolean, **vaikimisi väljas**): „Saada mulle e-kiri iga etapi kohta tööde
  puhul, kus olen osaline". Ainult e-kiri, mitte push.
- **„Uus töö"** läheb ainult kellukesse. Üks teade inimese kohta, ka siis, kui
  ta on mitmes etapis; teade nimetab tema esimese etapi. Looja ise seda ei saa.
- Väljajätmise reeglid ülal (liigutaja ise, vahele jäetud etapp, eelmise etapi
  sama inimene „sinu kord" puhul) kehtivad kõigile ridadele.
- Ükski teade ei kanna patsienti.

## 3.2 Osaline näeb tööd algusest peale

**Iga etapi vastutaja näeb tööd oma tööde nimekirjas kohe töö loomisest**,
mitte alles siis, kui on tema kord. Tööl on näha:
- etapid järjekorras, igaühel vastutajad;
- **kes praegu teeb** (praegune etapp, „alustasin" märkija ja aeg);
- **mis on tehtud** (`done_at`, `done_by`), mis on vahele jäetud;
- **mis on järgmine** ja **mitu etappi on tema korrani**.

**Õigused — kontrollitud, mitte eeldatud.** `TECHNICIAN_PRESET` on
`jobs.write`, `stock.read`, `stock.write`: **`jobs.read`-i ei ole.** Tehnik
näeb tööd ainult `jobs_select` teise haru kaudu,
`job_is_mine(assigned_to, designed_by, work_items)` (sql/089). Etapi
vastutajat see ei tunne. **Seega:**
- **`jobs.read` ei muutu**, ei õigusena ega eelseadetes;
- **`jobs_select` saab juurde haru „olen selle töö mõne etapi vastutaja"**
  (`job_stage_person`, `security definer` abifunktsioon, et RLS ei läheks
  ringi). Sama haru loeb ka `job_stage` / `job_stage_person`;
- see on **sama ulatus, mis tehnikul täna oma tööga on**: ta näeb töö
  patsiendi nime nagu praegu oma töö puhul (7.1). Rohkem mitte;
- leak-test: teise kliiniku etapi vastutaja ei näe; etapist eemaldatud
  inimene ei näe enam.

**Hinnangute koht:** töö etappide vaates jääb iga etapi rea juurde koht
hinnangule (docs/MODULES-AND-RATINGS.md osa 2, migratsioon 124). Praegu ei
ehitata midagi peale koha: komponent võtab etapi rea kaupa valikulise
lisasisu.

---

# 4. „Alustasin" ja „tehtud"

Nupp töö juures ja telefonis: `job_stage.started_at` / `started_by`, esimene
märkija jääb peale, kogu käik auditilogis. `done_at` täitub etapist välja
liikumisel. Tahvli kaardil on näha, kes alustas ja millal — see on vastus
küsimusele „kes millega praegu tegeleb". Tehnikute „märgivad, mida tegid" on
täpselt see.

---

# 5. Kes tohib liigutada

| Kes | Tohib |
|---|---|
| **Praeguse** etapi vastutaja | jah |
| **Siht**etapi vastutaja | jah |
| Kliiniku **omanik** | jah |
| Keegi muu, ka `jobs.write`-iga | **ei** |

**Sihtetapi vastutaja tohib tööd tõmmata ainult eelmisest etapist** — sellest,
mis on töö etappide järjekorras vahetult enne sihtetappi, vahele jäetud
etappe (`skipped_at`) arvestamata. Vahele jäetud etapist ega kaugemalt mitte.

**Tööl, mille `job_stage_person` on tühi** (vanad tööd, vaikemall ilma
vastutajateta), **kehtib tänane reegel:** `jobs.write` ja
`stage_move_allowed` (sql/078), nagu enne. Uus reegel hakkab kehtima alles
siis, kui tööl on vähemalt üks etapi vastutaja.

Kontroll andmebaasis (`can_move_stage(job_id, target)`, `guard_stage_change`
kutsub seda), mitte nupu peitmises. Iga liigutus auditilogisse (olemas:
`audit_log`, action `stage_move`, sql/070).

See reegel annab IT-le tasuta selle, mida Riia küsis: **IT on vastuvõtu etapi
vastutaja ja saab seetõttu tööd vastuvõtust edasi liigutada — ja mitte kuhugi
mujalt.**

---

# 6. Failid

## 6.1 Mida vastu võetakse

**Kõik** — STL, PLY, CEREC eksport (**nii üks fail kui ka kaust; kaust
ZIP-iks**, nagu 6.2), exocadi projekt ZIP-ina, fotod, DICOM.
Wivo ei kontrolli laiendit, vaid salvestab, mis antakse. Tüübid
`job_file.type` saavad juurde **`ct`** ja **`project`** (migratsioon 122).

**Eelvaade ainult STL ja PLY.** PLY on 073 eelvaatetegijale lisamine, mitte
uus masinavärk. Kõik muu saab tüübiikooni — eelvaade, mida ei ole, peab välja
nägema nagu otsus, mitte nagu katkine pilt.

## 6.2 KT ja kaustad: üks ZIP seeria kohta

DICOM-i seeria on sadu faile kaustas. Kaks teed:

- **iga fail oma `job_file` reana**: sadu ridu ja sadu TUS-üleslaadimisi ühe
  KT kohta — sadu kohti, kus kliiniku ühendus võib katkeda;
- **üks ZIP seeria kohta** ← **soovitus**.

Põhjus ei ole mugavus: KT-seeria on kasutatav ainult tervikuna, üks pehme
kustutus ja üks versioon on seeria kohta õige ühik, ja `job_file` read jäävad
loetavaks. Rida kannab faili arvu ja seeria nime.

Kuidas: kasutaja valib kausta (`webkitdirectory`, töölaual Electroni
kaustavalik), ZIP tehakse **voona Web Workeris** (mitte mällu — 2 GB seeria
tapaks rendereri), sha256 arvutatakse samas voos, siis tavaline
register → TUS → confirm. Katkestuse järel jätkab TUS sealt, kus pooleli jäi.

**Fotod jäävad eraldi failideks** — neid vaadatakse ükshaaval.

## 6.3 Supabase'i piirid

- Globaalne failipiirang on Pro-plaanil seatav kuni **500 GB**.
- Jätkatav (TUS/S3) üleslaadimine on dokumenteeritud kuni **50 GB**.
- TUS-i soovitatakse kõigele, mis võib ületada **6 MB**.
- Meie kopp `job-files` on praegu **500 MB** peal. STL-i täiskaar on 20–80 MB,
  KT-seeria ZIP-ina sageli 100–600 MB, nii et **see number tuleb tõsta** —
  see on kopa seade, mitte migratsioon.

Numbrid kinnitada Riia projekti plaanilt enne starti: Supabase'i enda
dokumendid on 50 GB ja 500 GB osas omavahel vastuolus.

## 6.5 Kui palju ruumi see võtab, ja mis plaan selleks vaja on

**Lühidalt: Pro-plaan on kohustuslik, mitte valik** — ja põhjus ei ole
gigabaidid, vaid see, et tasuta plaanil on faili ülempiir 50 MB ja kogu ruum
1 GB. Üks KT-seeria ületab mõlemad. Ilma Pro-plaanita ei ole failivoogu olemas.

### Mis ühe töö juurde tuleb

Eeldused, mitte mõõtmised — Riia enda numbrid asendavad need:

| Mis | Suurus | Mitme töö juures |
|---|---|---|
| Suuskaneering (STL/PLY, ülemine + alumine + hammustus) | ~60 MB | iga digitaalne töö |
| exocadi projekt ZIP-ina | ~100 MB | iga disainitud töö |
| Prinditud või freesitud väljund (STL) | ~20 MB | iga tootmisse läinud töö |
| Fotod (4–8 tk) | ~18 MB | ~pooled → ~9 MB keskmiselt |
| KT-seeria ZIP-ina | 150–600 MB, arvesta 300 | ainult juhik/implantaat, ~15% → ~45 MB keskmiselt |

**Keskmine töö ≈ 230 MB.** See on suurusjärk, mille peal otsustada; ±50% ei
muuda järeldust.

### Mis sellest kuus ja aastas tuleb

| Töid kuus | Kuus | Aastas | 100 GB kvoot saab täis |
|---|---|---|---|
| 60 | ~14 GB | ~165 GB | ~7. kuul |
| 120 | ~28 GB | ~330 GB | ~4. kuul |
| 200 | ~46 GB | ~550 GB | ~3. kuul |

**Salvestusruum ise on odav.** Pro sisaldab 100 GB ja üle selle on ~0,0213
USD/GB kuus, nii et 120 tööd kuus tähendab aasta pärast ~5 USD kuus lisaks ja
kolme aasta pärast (~1 TB) ~19 USD kuus. See ei ole otsustav number.

**Otsustav number on väljuv liiklus (egress).** Pro sisaldab ~250 GB kuus
(üks allikas ütleb 500 — kinnitada hinnakirjast). Iga kord, kui tehnik või
arst faili alla laeb, on see egress: 230 MB töö kohta, 2–3 allalaadimist →
~0,5–0,7 GB töö kohta → 120 tööd kuus on ~60–85 GB. Mahub ära, aga **mitte
kaugel piirist**, ja eelvaated ning korduvad allalaadimised söövad seda
kiiresti. Egressi ületamise hinda ma hinnakirjast ei kinnitanud — **see tuleb
enne starti üle vaadata**, sest see, mitte GB-d, on koht, kus arve hüppab.

Andmebaasi ketas (Pro: 8 GB, üle selle 0,125 USD/GB kuus) ei ole mure: failid
on hoidlas, mitte andmebaasis, ja read on väikesed.

### Mis sellest järeldub plaani jaoks

1. **Kopa `job-files` piir tuleb tõsta** 500 MB-lt (§6.3). Pro-plaanil on
   globaalne piir seatav kuni 500 GB; meie vajadus on ~1 GB faili kohta.
2. **Säilitus: hoitakse kõike, midagi ei kustutata** (Kevin, 19.11). Ruum
   kasvab seega igavesti, umbes 28 GB kuus 120 töö juures. Salvestus on
   odav (aasta pärast ~5 USD kuus lisaks); jälgida tuleb egressi. Säilitusreeglit
   selles plaanis ei ehitata.
3. **Hinnakiri kinnitada Riia projekti pealt enne starti.** Pro on 25 USD
   kuus (allikad vaidlevad, kas projekti või organisatsiooni kohta) — ja see
   läheb **Riia enda kontole**, nagu kokku lepitud (docs/ROADMAP.md).

## 6.4 Integratsioon tuleb hiljem

3Shape Communicate, Medit Link, DS Core, exocad — **mitte nüüd**. **Vahetuskoht
on käsitsi üleslaadimine** (Kevin, 19.11). Plaan ehitatakse nii, et vahetuskoht on hiljem
**üks uus laadimistee samasse `register → upload → confirm` ahelasse**, mitte
uus failimudel.

---

# 7. Rollid: Riia 10 kohta olemasolevate õiguste vastu

Õigused on `shared/permissions.ts` ja docs/PERMISSIONS.md.

| Riia roll | Mitu | Olemasolevatest õigustest | Puudub |
|---|---|---|---|
| **Arst** (loob tellimusi) | 3 | `jobs.write` + `jobs.read`, **patsiendikaart ja patsiendi lisamine** (`patients.read` + `patients.write`) | — |
| **Tehnik** (märgib, mida tegi) | 3 | `TECHNICIAN_PRESET`: `jobs.write`, `stock.read`, `stock.write` | — (etapimärked tulevad siit plaanist) |
| **Raamatupidaja** (näeb, mis tehtud) | 1 | `payroll.manage`: Töötasud ja eksport | — (7.2 ei ehitata) |
| **Sekretär** (näeb töid koos patsiendiga) | 1 | `jobs.read`, **kalendrit mitte** | — |
| **Juhataja** (näeb ladu) | 1 | `stock.read` | — |
| **IT** (laeb faile) | 0–1 | — | **failiõigus ilma `jobs.write`-ita** |

Litsentsi `seats` = **10 koos IT-ga** (Kevin, 19.11).

## 7.1 Mida ma kontrollisin, mitte eeldasin

- **docs/PERMISSIONS.md:** „Anyone who sees a job sees its patient's name
  (`jobs.patsient`) and patient link, without `patients.read`." **Rolli
  „näeb töid, aga ei näe patsienti" ei ole olemas.**
- **Töötasud ei näita patsiendi nime** — `PayrollView.tsx`-is ei ole
  `patsient` kordagi. Raamatupidaja saab seega `payroll.manage`-iga tööpõhise
  palga ja tehtud tööd **ilma nimedeta juba täna**.
- **Ladu näitab patsiendi nime ainult töö otsinguväljal**
  (`StockItemPanel.tsx`), ja see nimekiri tuleb inimese **enda loetavatest
  töödest**. Juhataja, kellel on ainult `stock.read`, ei näe sealt ühtegi
  nime. **Tingimus: juhatajale ei anta `jobs.read`.**
- **Statistika rühmitab patsiendi nime järgi** (`useDashboardStats.ts`) ja
  arvutab inimese enda loetavatest töödest — seega `stats.read` ilma
  `jobs.read`-ita ei näita võõraid patsiente, aga ei näita ka suurt midagi.

## 7.2 Puuduv 1: töid ilma patsiendi nimeta

Vaja raamatupidajale (ja hiljem juhatajale, kui ta tahab töid näha).

**Otsus (Kevin, 19.11): ei ehitata.** Raamatupidaja saab
`payroll.manage` ja töötab Töötasude pealt + raamatupidaja ekspordist, kus
nimesid juba ei ole (`auditedCsvExport`, sql/106). See on **null uut koodi** ja
katab sõnastatud vajaduse („näeb töökoode, tehtud tööd ja palka").

Kui Riia tahab, et raamatupidaja näeks ka Tööde lehte, siis:

- uus õigus `patients.identity`, mis **antakse vaikimisi kõigile, kellel ta
  täna sisuliselt on**, nii et ükski olemasolev kliinik ei muutu;
- ilma selleta loeb inimene töid **vaate või RPC kaudu**, kus `patsient` on
  kinni ja patsiendilink puudub;
- **jõustamine andmebaasis, mitte UI-s.** UI-s peitmine ei ole kaitse: sama
  rida tuleb `select`-iga ikka välja.

See puudutab iga tööde lugemist rakenduses ja on **selle plaani suurim üksik
tükk**. Seepärast on ta eraldi, mitte sammu 1 sees.

Partneri „ei näe patsienti" (sql/092) **ei ole siin otse kasutatav**: see on
eraldi lugemistee (`partner_jobs`) organisatsioonide vahel. Ta on hea eeskuju
(väljuva teksti redigeerimine), mitte valmis lüliti.

## 7.3 Puuduv 2: IT failiõigus

IT peab saama **faile juurde laadida** ja töö **vastuvõtust edasi liigutada**,
mitte kõike muud.

- **Liigutamine on juba lahendatud** 5. peatükis: IT on vastuvõtu etapi
  vastutaja.
- **Failid vajavad uut õigust `files.write`**: `register_job_file` /
  `confirm_job_file` nõuavad täna töö kirjutamisõigust. `files.write` lubab
  lisada faile töö juurde, mille etapi vastutaja sa oled — **mitte muuta
  tööd, mitte näha hinda, mitte kustutada.**
- Kas IT näeb patsiendi nime? Ta näeb tööd, mille juurde ta faile laeb, nii et
  **täna jah**. Kui ei tohi, sõltub see 7.2-st.

## 7.4 Demokliinik

Demos peavad olema **kõik kuus rolli** oma kontoga, et Riiale saaks iga vaadet
näidata: 3 arsti, 3 tehnikut, raamatupidaja, sekretär, juhataja, IT. See läheb
demo seemnesse (`sql/demo/seed.sql`).

---

# 8. Avatud küsimused — vastatud vaikeväärtustega

**Kevin, 19.11:** iga küsimus on vastatud vaikeväärtusega, mida Riia saab
hiljem seadetes muuta. Algsed küsimused jäävad alla, et oleks näha, mida
vastus katab.

| # | Vaikeväärtus |
|---|---|
| 1 | Fotogramm-meetria: **töö tellija** (2.6a) |
| 2 | Kvaliteedikontroll: **lülitiga etapp, vaikimisi väljas** |
| 3 | Vahamudel: **lülitiga etapp, mallis saab kohustuslikuks teha** |
| 4 | Raamatupidaja: **Töötasud ja eksport. 7.2 ei ehitata** |
| 5 | Sekretär: **`jobs.read`, kalendrit mitte** |
| 6 | Arstid: **patsiendikaart ja patsiendi lisamine** |
| 7 | Vahetuskoht: **käsitsi üleslaadimine** |
| 8 | CEREC eksport: **nii üks fail kui ka kaust (kaust ZIP-iks)** |
| 9 | Litsentsi kohti: **10 koos IT-ga** |
| 10 | Failide säilitus: **hoitakse kõike, midagi ei kustutata** |

Algsed küsimused:

1. **Kes teeb fotogramm-meetria?** Tõenäoliselt arst tooli juures — aga see
   määrab, kelle vaikevastutus etapil on.
2. **Kas enne üleandmist on kvaliteedikontroll või proovimine arstiga, ja kas
   see on eraldi etapp?** Kui jah, kas lülitiga või alati?
3. **Vahamudel (wax-up): millistes mallides on ta kohustuslik** ja millistes
   lülitiga?
4. **Kas raamatupidaja peab nägema Tööde lehte**, või piisab Töötasudest ja
   ekspordist? See üks vastus otsustab, kas 7.2 ehitatakse.
5. **Kas sekretär vajab kalendrit (`visits.read`)** kohe, või ainult töid?
6. **Kas arstid vajavad patsiendikaarti (`patients.read`)**, või piisab töö
   patsiendinimest?
7. **Milline vahetuskoht tuleb esimesena** — 3Shape Communicate, Medit Link
   või valvatav kaust?
8. **CEREC eksport: üks fail või kaust?** Sellest sõltub, kas `project` on ZIP
   nagu exocadi oma.
9. **Mitu kohta litsentsis päriselt** — 10 koos IT-ga või 10 ilma?
10. **Kui kaua faile hoitakse?** Toorskaneering ja exocadi projekt on see, mis
    ruumi kasvatab (§6.5). Kas need võivad N kuud pärast üleandmist arhiivi
    või kustutamisele minna, ja mis on N? Valmistoode ja fotod jäävad igal
    juhul. Ilma vastuseta kasvab ruum igavesti — see ei ole kallis, aga see on
    otsus, mida keegi peab tegema teadlikult.

---

# 9. Mida see plaan ei tee

- Ei tee palka etapipõhiseks. Palk jääb **tööpõhiseks**; etapp ütleb ainult,
  **kes** rea saab.
- Ei puuduta partnersilda (faas 2, ootel).
- Ei ehita ühtegi integratsiooni (DS Core, exocad, 3Shape, Medit).
- Ei anna Wivole õigust soovitada ega järjestada ravi (CLAUDE.md).
- Ei vii patsienti teavitusse, etapi ülesande teksti ega ühtegi eksporti,
  kus teda täna ei ole.

---

# 10. Mõju palgale

**`pay_role` on olemasolev palgaliik** (`RateScope`, `lib/earnings.ts`):
`too` (tükitöö), `disain`, `mudel`, `muudatus`. Mitte ainult „tehnik" ja
„disainija".

- **Iga palgaliik on mallis täpselt ühel etapil.** Seda valideeritakse
  salvestamisel: andmebaasis unikaalne indeks `(template_id, pay_role)`, ja
  seadete vorm ütleb enne salvestamist, millisel etapil see palgaliik juba on.
  Etapp ilma palgaliigita on lubatud (nt Vastuvõtt).
- **Palgarea saaja on selle etapi vastutajad**, kus palgaliik mallis on.
- **Võrdselt jagatakse ainult sama etapi inimeste vahel.** Kaks inimest
  Disaini etapil jagavad disaini summa pooleks; tükitöö etapi inimesed ei
  saa sellest midagi. Osakaalud on hilisem töö.
- **`muudatus`:** parandusel on oma teostaja (sql/087). Kui see on täidetud,
  saab tema; kui ei ole, siis `muudatus`-etapi vastutajad.

**Olemasolevad tööd ei muutu.** Kus `job_stage_person` on tühi, loeb
`earnings.ts` `assigned_to` ja osa disainija pealt täpselt nagu praegu. Ühtegi
vana rida ümber ei arvutata, ühtegi kinnitatud väljamakset ei puudutata.

See on plaani riskantseim osa: `earnings.ts` on suur ja tema testid on see,
mis hoiab palga õigena. Jagamine kirjutatakse **puhta funktsioonina**
`shared/` alla oma testidega, enne kui `earnings.ts` teda kutsub.

---

# 11. Mida saab kohe ja mis ootab faasi 1

**Kohe**, testkoopia vastu: kogu 2.–6. peatükk, 7.3 (`files.write`) ja 10.
Skeem, mallide seadistus, teavitused, failid, telefon ja palgajagamine on
ehitatavad ja testitavad seal, kus kõik muu.

**Ootab faasi 1** (Riia oma projekt): ainult sisselülitamine — Riia andmed,
Riia litsents ja moodul `jobs` tema sees.

**Eraldi otsus, mitte sammu 1 sees:** 7.2 (töid ilma patsiendi nimeta).

**Ehitatud, `testing`-us (19.11.2026) — 1. osa, skeem ja reeglid, ilma UI-ta:**
- **sql/122:** mallid, malli etapid ja inimesed, kliiniku vaikevastutajad,
  töö oma etapid ja inimesed; `jobs.template_id`, `ordered_by` (looja,
  muutmatu), reeglite väljad; failitüübid `ct` ja `project`.
- **Tagasitäide:** igale kliinikule vaikemall tema etappidest (või
  rakenduse sisseehitatud nimekirjast), igale tööle `job_stage` read.
  **`job_stage_person` ridu ei kirjutata ja `jobs` ridu ei puudutata**
  (`template_id` tühi = vaikemall): vana töö liigub ja maksab nagu enne.
- **Otsustatud ehitamisel:** `only_if` on nimekiri (`text[]`), sest
  fotogramm-meetria vajab kahte reeglit korraga; etapp on kas lülitiga või
  reegliga, mitte mõlemat; `default_on` ainult lülitiga etapil.
- **`shared/workflow/`:** reeglid, töö mallist, mallide valideerimine,
  liigutamise reegel (§5), võrdne jagamine sentides.

**Ehitatud, `testing`-us (19.11.2026) — 2. osa, andmebaas (sql/123), ilma UI-ta:**
- **Töö mallist:** iga uus töö saab oma etapid ja inimesed loomise hetkel
  (päästik, ka vanema buildi otse-insert: vaikemall, lülitid vaikimisi).
  `create_job(töö, lülitid)` on sama insert lülititega; staatuseta töö saab
  oma esimese etapi. SQL-i plaan = `materialiseTemplate`, test võrdleb.
- **Vaikemall** tehakse kliinikuga ja järgib Seaded → Töö etapid salvestust
  (lisab, eemaldab, järjestab; alles jääva etapi inimesed, ülesanne ja
  palgaliik jäävad).
- **§5:** `can_move_stage(töö, siht)`; `guard_stage_change` ja
  `move_job_stage` küsivad sama reeglit. Etapi vastutaja liigutab
  `move_job_stage` kaudu ilma `jobs.write`-ita (IT vastuvõtust). Kliiniku
  enda üleminekureeglid (`stage_transition`) kehtivad peale.
- **§4:** edasi liikudes märgitakse lahkutud etapp tehtuks; tagasi liikudes
  saab sihtetapp tehtu-märke maha. `start_job_stage(töö)` = „alustasin"
  praegusel etapil, esimene jääb, iga vajutus auditis (`stage_start`).
- **§2.4:** `add_job_stage`, `set_job_stage_skipped`, `set_job_stage_people`
  (auditis `stage_edit`).
- **§3/3.1:** „sinu kord" ahel etapp → töö omad → omanik; uued liigid
  `stage_progress` (kell + e-kiri, `notify_every_stage`) ja `stage_assigned`
  (ainult kell). `set_notify_every_stage`.
- **§3.2:** `jobs_select` ja `can_read_own_job` uus haru: mõne (mitte
  vahelejäetud) etapi vastutaja.
- **§7.3:** `files.write` — lisab faile tööle, mille etapil oled; uut
  versiooni, kustutamist ega töö muutmist mitte.
- **Otsustatud ehitamisel (Kevin, vaata üle):**
  - etappe töö juures muudab omanik, admin, `pipeline.write` või töö tellinud
    arst `jobs.write`-iga, **mitte `jobs.write` üksi** (enda etapile panek
    annaks liigutamise ja palga);
  - vahelejäetud etapi inimene ei näe tööd ega lisa faile;
  - `stage_progress` e-kiri järgib ainult `notify_every_stage`-i;
  - kes sai uue töö puhul `assigned` (teostaja/disainija), ei saa lisaks
    `stage_assigned`-i;
  - „alustasin" ainult töö praegusel etapil;
  - parandused (sql/087) liiguvad ja teavitavad nagu enne;
  - partneri tagastatud töö puhul ei saa omanik „sinu kord" teadet lisaks
    `stage_handover`-ile.
- **Teadaolev, muutmata:** kes tööd näeb, näeb ka hinda (docs/PERMISSIONS.md,
  „money on jobs"). Etapi vastutaja näeb seda nagu tehnik oma tööl;
  `files.write` ei lisa midagi.
- **Järgmisena:** palk §10 (2b), UI (2c), telefon (3).

---

# 12. Testid, mis peavad olema

- RLS leak-test igale uuele tabelile: teine kliinik ei näe midagi.
- `can_move_stage`: praeguse etapi vastutaja jah, sihtetapi vastutaja jah,
  omanik jah, võõras `jobs.write`-iga **ei**.
- Reeglid (`only_if`): fotogramm-meetria tuleb sisse ainult digitaalse ja
  >1 implantaadi puhul; `conventional` jätab ta välja.
- Teavituse ahel: etapi vastutajad → töö omad → omanik; **liigutaja ise ei**;
  **eelmise etapi sama inimene ei**; vahele jäetud etapp ei.
- Vaikevastutaja **kopeerimine**: malli hilisem muutmine ei muuda juba
  määratud töid.
- Vaikemall: iga migratsioonieelne töö on pärast loetav ja maksab sendi pealt
  sama.
- Palk: tühja `job_stage_person`-iga töö maksab sama nagu enne; mitme
  inimesega etapp jagab võrdselt.
- `files.write`: lubab faili lisada oma etapi tööle, ei luba tööd muuta ega
  hinda näha.
- Liigutamine: sihtetapi vastutaja tõmbab eelmisest etapist **jah**, vahele
  jäetud etapist ja kaugemalt **ei**; tühja `job_stage_person`-iga töö
  liigub tänase reegli järgi.
- Tellija: `orderer`-etapp saab töö looja; vanal tööl (`ordered_by` tühi) ei
  kirjutata midagi.
- Palgaliik: teine sama palgaliigiga etapp samas mallis **ei salvestu**;
  jagamine ainult sama etapi inimeste vahel.
- Telefon: töö mallist, etapi liigutamine, „alustasin", fotod ja failid
  läbivad samad andmebaasi kontrollid kui töölaual.
- Teavitused 3.1: „sinu kord" e-kiri ja push ainult etapi vastutajale;
  `notify_every_stage` väljas → teised osalised e-kirja ei saa, sees → saavad
  e-kirja, mitte pushi; „uus töö" ainult kellukesse, igale vastutajale üks,
  loojale mitte.
- Nähtavus 3.2: tehnik ilma `jobs.read`-ita näeb tööd, kus ta on hilisema
  etapi vastutaja, enne oma korda; eemaldatuna enam mitte; teine kliinik
  mitte.

---

# 13. Telefon

Telefon (`src/renderer/src/mobile/`, app.wivodent.com) on koht, kus tööd
tehakse tooli ja laua juures. **Kõik telefonis käib samade andmebaasi
kontrollide kaudu kui töölaual** — telefon ei saa midagi, mida RLS ja
`can_move_stage` ei luba.

**Telefonis saab:**
- **töö lisada mallist:** mall, lülitiga etapid (vaikimisi linnukesed
  `default_on` järgi), reeglite väljad (jäljend digitaalne/tavaline,
  implantaatide arv, print/freesimine, prinditud mudel). Vaikevastutajad
  tulevad mallist, nagu töölaual;
- **etappi liigutada:** järgmisse etappi või tagasi, 5. peatüki reegli järgi.
  Nupp on ainult inimesel, keda reegel lubab; andmebaas kontrollib ikka;
- **märkida „alustasin"** oma etapil (4. peatükk);
- **lisada fotosid** (`PhoneCamera`) **ja faile** (üks või mitu faili korraga,
  sama `register → TUS → confirm` ahel, katkestuse järel jätkatav).

**Ainult töölaual:**
- **KT ja muu kausta üleslaadimine** (6.2): kaust → ZIP voona Web Workeris.
  Telefoni brauseris ei ole usaldusväärset kaustavalikut ja sadade failide
  ZIP-imine telefonis ei ole see, mida keegi seal teha tahab. Ka CEREC-i
  kaust (6.1) on seega töölaua oma; üks CEREC-i fail läheb telefonist.
- **Mallide ja etapikogu muutmine** seadetes, vaikevastutajad
  (`clinic_stage_default`) ja palgaliigid etappidel.
- **Töö juures etappide lisamine, vahelejätmine ja vastutajate muutmine**
  (2.4). Telefon näitab neid, aga ei muuda.
- **STL/PLY eelvaate tegemine:** eelvaade tehakse laadija masinas (sql/073).
  Telefonist laetud STL saab tüübiikooni.
- Palk, eksport ja statistika, nagu praegu.
