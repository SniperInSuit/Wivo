# Demokliinik: samm-sammult Windowsis

See on sinu käsiraamat, Kevin. **Üks käsk korraga**, PowerShellis, repo
kaustast (`C:\Users\fullg\Documents\GitHub\Workly`). Iga samm ütleb, mida sa
pärast nägema peaksid.

Mida demo sisaldab: `sql/demo/seed.sql` päis. Mis ta tegi ja miks: NEXT.md.

> **Parool ei lähe kunagi käsureale.** Ei teenusevõti, ei andmebaasi parool, ei
> demokontode parool. PowerShelli ajalugu on fail kettal
> (`ConsoleHost_history.txt`), mida mitte keegi kunagi ei tühjenda. Iga samm
> allpool küsib parooli eraldi ja varjatult.

---

## 0. Mida sul juba on

| Mis | Kus | Kontrolli |
|---|---|---|
| psql 18.7 | `C:\Program Files\PostgreSQL\18\bin\psql.exe` | `& "C:\Program Files\PostgreSQL\18\bin\psql.exe" --version` |
| Node | PATH-is | `node --version` |

psql **ei ole PATH-is**, seepärast on ta allpool iga kord täispikkuses. Ära
pane teda PATH-i selle pärast — üks demo ei ole põhjus masina keskkonda muuta.

---

## 1. Uus Supabase'i projekt

Dashboardis (supabase.com), **Kevini enda kontol**:

| Väli | Väärtus |
|---|---|
| Name | `wivo-demo` |
| Organization | sinu oma |
| Region | **Central EU (Frankfurt)** `eu-central-1` |
| Database password | **genereeri** ja pane paroolihaldurisse |
| Plan | **Pro** |

**Miks EL:** demos on väljamõeldud andmed, aga demo saab hiljem olema see,
mille peal päris kliinik asja proovib, ja siis on asukoht juba paigas. Riia on
Lätis; Frankfurt on lähim EL-i piirkond.

**Miks Pro ja mitte tasuta:** tasuta plaanil on faili ülempiir 50 MB ja kogu
ruum 1 GB. Üks KT-seeria ületab mõlemad (docs/WORKFLOW-STAGES.md §6.5). Demo
ilma failideta ei näita seda, mille pärast Riia Wivot tahab.

Projekt on valmis ~2 minutiga. Pane kirja:

- **Project ref** (URL-is: `supabase.com/dashboard/project/<REF>`)
- **Project URL**: `https://<REF>.supabase.co`
- **anon key** ja **service_role key**: Project Settings → API

---

## 2. Baseline: kõik migratsioonid korraga

122 migratsiooni SQL-redaktorisse kleepida ei ole mõtet — fail on üle 600 KB ja
redaktor kukub ära või jookseb pool asja läbi. Tee fail ja lase psql-il
jooksutada.

**2.1. Tee fail.** Skript küsib **demoprojekti** teenusevõtit ja loeb selle
varjatult (ei keskkonnamuutujast, ei argumendist):

```powershell
node scripts/fresh-schema.mjs > fresh.sql
```

Küsimus tuleb STDERR-i, SQL läheb faili. Oota: `fresh.sql` ~600–700 KB.

> Skript **keeldub tootmise võtmest** (kontrollib `ref`-i) ja keeldub võtmest,
> mille roll ei ole `service_role`. Kui ta keeldub, loe mida ta ütles — ta ei
> eksi selles.

**2.2. Võta ühendusstring.** Dashboard → **Connect** → **Session pooler**.
Kopeeri string ja **kustuta sealt parool ära**, nii et jääb kuju:

```
postgresql://postgres.<REF>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

Parooli asemel on seal nüüd mitte midagi — `-W` küsib selle eraldi.

> Kasuta **Session poolerit** (port 5432), mitte Transaction poolerit (6543):
> skeemi ehitamine tahab seanssi, mitte üksikuid tehinguid. Otseühendus
> (`db.<REF>.supabase.co`) on uutel projektidel ainult IPv6 peal, nii et
> pooler on see, mis töötab igalt võrgult.

**2.3. Jooksuta.** `-W` küsib andmebaasi parooli varjatult, `-v ON_ERROR_STOP=1`
peatab esimese vea peal, mitte ei jookse 121 faili edasi:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" "postgresql://postgres.<REF>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" -W -v ON_ERROR_STOP=1 -f fresh.sql
```

Lõpus peab tulema `NOTIFY` ja mitte ühtegi `ERROR`-it. `NOTICE`-id on normaalsed
(`skipping`, `already exists`).

**2.4. Kustuta fail.** Ta sisaldab teenusevõtit:

```powershell
Remove-Item fresh.sql
```

**2.5. Kontrolli, et skeem on õige.** Dashboard → SQL Editor, kleebi
`sql/checks/schema_check.sql` ja jooksuta. **Null rida = korras.** See fail on
ainus, mille SQL-redaktorisse kleepimine on mõttekas: ta on üks `select` ja ta
ei muuda midagi.

---

## 3. Demomärgis ja seed

**3.1. Ütle andmebaasile, et ta on demo.** Üks rida, SQL-redaktoris, meelega
käsitsi — ilma selleta keelduvad nii seed kui reset:

```sql
create table if not exists public.wivo_demo (one boolean primary key default true);
insert into public.wivo_demo values (true) on conflict do nothing;
```

**3.2. Tee seed-fail.** Skript küsib demokontode parooli varjatult:

```powershell
node scripts/demo-seed.mjs > demo-seed.sql
```

Pane see parool paroolihaldurisse — seda läheb vaja igal demokontol. Vähemalt
12 tähemärki, ilma `'` ja `\` märkideta.

**3.3. Jooksuta:**

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" "postgresql://postgres.<REF>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" -W -v ON_ERROR_STOP=1 -f demo-seed.sql
```

Lõpus tuleb tabel: `clinic 1`, `people 8`, `permissions 22`, `customers 2`,
`patients 3`, `jobs 5`, `stock items 3`, `pay rates 2`.

**3.4. Kustuta fail.** Ta sisaldab parooli:

```powershell
Remove-Item demo-seed.sql
```

**3.5. Tõsta kopa failipiir.** Dashboard → Storage → `job-files` → Settings →
file size limit **500 MB → 1 GB**. Vaikeväärtus on liiga väike: STL-i täiskaar
on 20–80 MB, aga KT-seeria ZIP-ina 150–600 MB
(docs/WORKFLOW-STAGES.md §6.5). See on kopa seade, mitte migratsioon.

---

## 4. Kaheksa kontot: mida nendega teha

Kõik kaheksa on olemas ja kõigil on sama parool (samm 3.2). **Igaüks peab
esimesel sisselogimisel lisama teise teguri** — ilma selleta ei näe ta mitte
midagi (sql/098). See ei ole tüütus, mida demos vältida: **see on üks asi,
mida Riiale näidata**, sest see on põhjus, miks Wivo on tõsine süsteem ja mitte
Exceli fail.

Praktiliselt: üks autentimisrakendus, kaheksa kirjet, nimeta nad
`Wivo demo – omanik`, `Wivo demo – arst` jne. See on ~10 minutit tööd **üks
kord**, mitte iga demo eel (reset ei kustuta sinu autentimisrakenduse kirjeid
— aga ta kustutab kontod, vt samm 6, nii et teise teguri kirjed tuleb pärast
resetti uuesti teha).

### Mida demoks päriselt vaja on

| Konto | Vaja? | Mida temaga näidata |
|---|---|---|
| `owner@demo.wivodent.com` | **jah** | kõik: seaded, meeskond, litsents, etapid, hinnad |
| `tech.digital@demo.wivodent.com` | **jah** | tehniku vaade: oma tööd, etapi liigutamine, oma palk |
| `accountant@demo.wivodent.com` | **jah** | **see on demo kõige tugevam hetk**: raamatupidaja näeb töid ja palka, aga **mitte ühtegi patsiendi nime** |
| `manager@demo.wivodent.com` | **jah** | ladu ilma patsientideta |
| `doctor@demo.wivodent.com` | soovitavalt | arst tellib töö, näeb patsiendikaarti |
| `secretary@demo.wivodent.com` | ainult kui küsitakse | tööd koos patsiendiga, kalender |
| `tech.manual@demo.wivodent.com` | ei | sama vaade mis digitehnikul |
| `it@demo.wivodent.com` | ei | failide laadimine; sama vaade kui tehnikul, kitsamate õigustega |

**Neli esimest katavad kogu loo.** Kui aega on vähe, lisa teine tegur ainult
nendele neljale ja ülejäänutele siis, kui Riia tahab täpselt seda rolli näha.

> Kui kellelgi neljast on teine tegur lisamata ja sa logid temaga demo ajal
> sisse, näeb Riia tühja ekraani ja sinu selgitust. Tee see valmis enne, mitte
> demo ajal.

---

## 5. Rakendus demoprojekti külge

Litsents peab **nimetama demoprojekti aadressi**, muidu rakendus keeldub
ühendumast enne, kui ta midagi saadab (`lib/testCopy.ts`,
docs/MODULES-AND-RATINGS.md §1.2). Kolm käsku.

**5.1. Testvõtmepaar** (üks kord, mitte iga demo eel):

```powershell
node scripts/make-license.mjs keygen --out license-test-private.pem
```

Ta trükib avaliku võtme hexina. Pane see ühe reana faili:

```powershell
'<see 64 tähemärki>' | Set-Content -NoNewline license-test-public.hex
```

Mõlemad failid on `.gitignore`-is (`license-*.pem`, `license-*.hex`).

**5.2. Litsents demoprojektile.** `--org` on suvaline UUID — täna ei võrdle
seda keegi kliiniku reaga (vt „Mis ei tööta veel", punkt 3), aga ta peab olema
UUID kujuga. `--api` on demoprojekti aadress ja **see on see, mis loeb**:

```powershell
node scripts/make-license.mjs sign --org d0000000-0000-4000-8000-000000000001 --name "Baltic Smile Demo" --api https://<REF>.supabase.co --modules jobs,payroll,stock,stats,patients --months 12 --key license-test-private.pem
```

Ta trükib tokeni ja hoiatab, et allkiri tuli failist, mitte YubiKeylt. See on
õige hoiatus — vt allpool.

**Mooduleid vali teadlikult.** See ongi demo mõte: `--modules jobs,payroll,stock`
näitab, mida Riia esimese sammuna saab, ja `invoices` väljajätmine näitab, et
arved **ei ole** veel sees. Kogu nimekiri: `jobs, payroll, stock, invoices,
patients, stats, partners, ratings` (`ratings` vajab `jobs`-i; tööriist keeldub
vastuolulisest komplektist).

**5.3. Suuna rakendus demoprojekti peale.** `.env` repo juurkaustas:

```
VITE_SUPABASE_URL=https://<REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<demoprojekti anon key>
```

> `.env`-is oli siiani **tootmise** URL, ja just see sõi 16.11 õhtu ära.
> Nüüd keeldub rakendus tootmisest igas režiimis peale `production`-i, nii et
> see rida on ohutu — aga vaata ikka üle, mis sa sinna kirjutad.

Siis käivita nii, et testvõti on nähtav:

```powershell
$env:WIVO_LICENCE_TEST_KEY = "C:\Users\fullg\Documents\GitHub\Workly\license-test-public.hex"; npm run dev
```

Wivo avaneb. **Seaded → Litsents**, kleebi token, Install. Pead nägema:
organisatsiooni, lubatud aadressi, ja „Sisse lülitatud: Tööd, Töötasud, Ladu…"
— täpselt need moodulid, mille sa `--modules`-iga andsid. Menüüs ei ole
Arveid.

**Kontroll, et värav päriselt töötab:** väljasta teine litsents vale
aadressiga (`--api https://wrong.supabase.co`), kleebi see sisse → Litsentsi
leht ütleb „See võti on teise serveri jaoks". Käivita uuesti → punane
LITSENTS-bänner ja ükski päring ei lahku masinast. Siis kleebi õige tagasi.
**Näita seda Riiale** — see on vastus küsimusele „kas me saame hiljem oma
serverisse".

---

## 6. Reset enne iga esitlust

Demo läheb sassi: keegi kustutas töö, muutis hinda, lisas kuus tühja
patsienti. Üks käsk:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" "postgresql://postgres.<REF>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" -W -v ON_ERROR_STOP=1 -f sql/demo/reset.sql
```

Siis **samm 3.2–3.4 uuesti** (uus seed-fail ja jooksutamine).

**Mida reset teeb ja ei tee:**

- Kustutab kogu demokliiniku **koos kontodega**. Teise teguri kirjed sinu
  autentimisrakenduses jäävad alles, aga nad ei kehti enam millegi kohta —
  **kustuta need ja lisa uued** (samm 4). See on resetti juures ainus tüütu
  osa, ja see on põhjus, miks reset ei ole iga demo eel kohustuslik: tee ta
  siis, kui demo on päriselt sassis.
- Ei puutu skeemi, demomärgist ega `job-files` kopa sisu. **Failid jäävad
  hoidlasse** — kui demos on segavaid faile, kustuta need Storage'ist käsitsi.
- **Keeldub tervikuna**, kui andmebaasis on võõras kliinik või võõras
  kasutaja. Ta ei kustuta „osa ära".

> Arvesta ~5 minutit resetile + ~10 minutit teise teguri uuesti lisamisele.
> Kui demo on kahe tunni pärast, tee see nüüd, mitte siis.

---

## 7. Mis ei tööta enne, kui YubiKeyd on seadistatud

Kolm asja, ja kõik kolm on teadlikud piirid, mitte vead.

**1. Pakendatud build ei võta testvõtit vastu.** `src/main/license.ts` keeldub
failist loetud võtmest, kui `app.isPackaged` on tõene. Seega:

| Mida demoda | Millega |
|---|---|
| Moodulid, aadressivärav, litsentsi leht | **`npm run dev`** testvõtmega (samm 5) |
| Pakendatud .exe, päris paigaldus | **litsentsikontrollita** — `LICENCE_PUBLIC_KEYS` on tühi, nii et kõik moodulid on sees ja aadressi ei kontrollita |

Need kaks ei ole korraga võimalik enne, kui `setup-key.mjs` on jooksnud ja
võtmed C ja D on `LICENCE_PUBLIC_KEYS`-is. **Kui Riia demo käib pakendatud
buildiga, siis mooduleid selle peal näidata ei saa** — näita neid dev-buildist
samal masinal.

**2. Päris kliendilitsentsi ei saa välja anda.** Tööriist allkirjastab failiga
ja hoiatab sellest iga kord. Fail-privaatvõti ei ole see, millega
müügilitsentse teha: ta on kettal, teda saab kopeerida ja tema kaotsiminekut ei
näe keegi. Päris allkiri tuleb YubiKey C pealt, PIN-i ja puudutusega.

**3. Litsents on seotud aadressiga, mitte veel kliinikuga.** `org` on tokeni
sees ja nähtav, aga **mitte keegi ei võrdle seda kliiniku reaga** — `api` on
see, mis täna päriselt väravat hoiab. Ühe kliiniku litsents töötab teises, kui
mõlemad on sama aadressi peal. Faasis 1 (üks kliinik = üks andmebaas) on see
väike auk, sest aadress ongi kliinik; kui kaks kliinikut satuvad kunagi ühe
aadressi taha, tuleb `org` ka päriselt kontrollida.

---

## Kokkuvõte: mis on üks kord ja mis iga demo eel

| | Üks kord | Iga demo eel |
|---|---|---|
| Projekt, baseline, märgis, kopa piir | ✓ | |
| Testvõtmepaar ja litsents | ✓ | |
| `.env` demoprojekti peale | ✓ | |
| Seed | ✓ | ainult pärast resetti |
| Teine tegur kontodele | ✓ | ainult pärast resetti |
| Reset | | ainult kui demo on sassis |
