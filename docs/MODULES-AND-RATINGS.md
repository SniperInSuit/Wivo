# Moodulid litsentsi sees ja hinnangud arsti ja tehniku vahel

**Seis: osa 1 on EHITATUD (18.11.2026), osa 2 on plaan.**

Osa 1 on `testing`-us, avaliku võtmeta: kuni `LICENCE_PUBLIC_KEYS` on tühi, ei
kontrolli build litsentsi ja kõik moodulid on sees — täpselt nagu enne. Mis
täpselt valmis on ja kuidas seda proovida, on §1.11.

Kaks tööd ühes failis, sest nad puutuvad kokku: hinnangud on kaheksas moodul ja
boonus sõltub `payroll`-moodulist.

Kõik allpool olev on kokku lepitud — Kevini vastused ja parandused on sisse
kirjutatud, mitte lisatud eraldi nimekirjana, et ehitamise hetkel oleks **üks
tõde** ja mitte plaan pluss parandused.

---

## Konteks: mis muutus

- **Tallinna kliiniku partnerlus lõppes.** Partnersild (faas 2) on **ootel**,
  mitte tühistatud.
- **Riia läheb oma instantsile** — tehnikutöö, palk, ladu.
- **Riia start vajab:** faas 1 + litsentsi moodulid + hinnangud.

---

# Osa 1 — moodulid kliiniku kaupa allkirjastatud litsentsi kaudu

## 1.1 Kust alustame

Masinavärk on olemas ja **välja lülitatud**.

| Mis | Kus | Seis |
|---|---|---|
| Tokeni kuju `WIVO1.<payload>.<sig>`, Ed25519 | `shared/license/token.ts` | olemas |
| `LicencePayload` v1: `name`, `plan`, `seats`, `iat`, `exp` | sama | olemas |
| `GRACE_DAYS = 14` | sama | olemas |
| Avalik võti | `src/main/license.ts`, `LICENCE_PUBLIC_KEYS` — **tühi** | puudub |
| `licensingEnforced()` | sama fail | `false`, kuni võti tuleb |
| Kirjutamise värav | `usePermissions.can()` loeb `licenceCanWrite` | **olemas ja ootab võtit** |

Kontroll on **täielikult offline** ja jääb selleks: labor ei tohi seisma jääda
sellepärast, et internet kadus.

## 1.2 Token: payload v2

Kaks uut välja, ühtegi ei eemaldata:

```
v: 2
org:     <instantsi UUID>
api:     ['https://abc.supabase.co']
modules: ['jobs', 'payroll', 'stock', 'invoices', 'patients', 'stats',
          'partners', 'ratings']
```

**`api` on lubatud API aadress** (Kevin, 17.11.2026), mitte ainult `org`.
Põhjus on kaks: rakendus peab teadma, kuhu ta tohib ühenduda, **enne kui ta
ühendub**, ja Riia võib hiljem tulla oma serverisse, kus aadress ei ole
`*.supabase.co` (docs/OWN-SERVER.md). Mitu aadressi on lubatud meelega —
kolimise ajal on vana ja uus mõnda aega mõlemad elus.

Võrdlus käib **täpse päritolu järgi** (skeem, host, port); teed, järelkaldkriipsu
ja vaikeporti ei arvestata. **Metamärke ei ole:** `*.supabase.co` teeks ühest
lekkinud võtmest võtme iga meie projekti vastu, mis on just see, mida `org` ja
`api` ära hoiavad.

**Tühi `api` või selle puudumine tähendab „piirangut ei ole".** Nii käituvad
kõik v1 võtmed ja litsentsita build. Ükski kliinik ei tohi jääda oma
andmebaasist eemale sellepärast, et me lisasime vormingusse välja.

**`org` on sama UUID, mida uuenduste süsteem ja seadistustööriist juba kliiniku
instantsi kohta kasutavad.** Üks id kõikjal — litsents, uuendused, seadistus.
Nimi on inimesele, `org` masinale: ühe kliiniku litsents ei kehti teises, ka
siis kui fail kopeeritakse.

**`plan` jääb ainult sildiks.** Ükski loogika ei loe seda; moodulid otsustavad.
**`seats` jääb** nagu praegu.

**v1 tokenid jäävad kehtima** ja loetakse „kõik moodulid sees" — nad on
väljastatud enne, kui moodul mõistena olemas oli. Ühtegi olemasolevat võtit ei
pea välja vahetama. **v1 allkirjastab täpselt neid baite, mida ta alati
allkirjastas** (`WIVO1.<payload>`), nii et vana võti ei muutu kehtetuks; v2 oma
prefiksiga. Versioon payloadi sees otsustab, kumbaga kontrollitakse.

**Tundmatu mooduli nimi jäetakse vahele, mitte ei tee võtit kehtetuks.** Uuema
tööriistaga allkirjastatud võti, mis nimetab moodulit, millest see build pole
kuulnud, ei tohi kliinikut tema olemasolevatest moodulitest ilma jätta.

**v2 ilma `org`-i või `modules`-ita ei ole v2 võti, vaid vigane fail**, ja see
loetakse kehtetuks. Vigase faili lugemine „kõik moodulid sees" tähendaks, et
rikutud fail annab täislitsentsi.

## 1.3 Allkirjad: litsents ja uuendus on eraldatud

**Nõue: uuenduse allkiri ei tohi kunagi kehtida litsentsina ega vastupidi.**

Kaks kihti, mõlemad:

1. **Eri prefiks allkirjastatavas tekstis**, mida kontroll nõuab. Litsentsi
   allkiri katab `WIVO-LICENCE-1\n<payload>`, uuenduse oma oma prefiksiga.
   Sama baitidejada ei saa mõlemas rollis kehtida, ka siis kui sama võti
   kirjutas ta alla.
2. **Eri PIV-pesa võtmel C**, kui võtmed on seadistatud.

Prefiks on kohustuslik ja töötab ka siis, kui pesade eraldus ei õnnestu.

**Rakendus usaldab nii C kui ka D litsentsivõtit** — või juurte delegatsiooni
kaudu, nagu uuendustel. Põhjus on lihtne: **C kaotsiminek ei tohi jätta
kliinikuid ilma uue litsentsita.**

**Avalik võti läheb ainult `testing`-usse, mitte `main`-i.**

## 1.4 Testvõti, sest YubiKeyd ei ole veel seadistatud

Saabumistest on läbitud, aga `setup-key.mjs` on jooksutamata, sest Mac ei lae.

- **Testides ja `testing`-us** saab kasutada **failist testvõtit**.
- **Mitte kunagi** väljalasetes ega `main`-is. See on build'i tasemel keelatud,
  mitte kokkulepe: testvõtmega allkirjastatud token peab pakendatud
  väljalaskes olema **kehtetu**.
- **Päris allkiri tuleb YubiKeylt**, kui võtmed on seadistatud.

## 1.5 Moodulid ja tuum

**Tuum on alati sees ja ei ole moodul:** Meeskond, Seaded, Litsents,
auditilogi. Põhjus on sõltuvus, mitte eelistus — **`payroll` ja `stock`
vajavad töötajaid ka siis, kui `jobs` on väljas**.

| Moodul | Ekraanid |
|---|---|
| `jobs` | Tööd, Tabel, Sorteerimata |
| `payroll` | Töötasud |
| `stock` | Ladu |
| `invoices` | Arved, Kliendid |
| `patients` | Patsiendid, Kalender, Taotlused — **üks tükk** |
| `stats` | Statistika, Ülevaade |
| `partners` | Partnertööd |
| `ratings` | Hinnangud (osa 2) |

## 1.6 Reegel, mis on kogu asja süda

**Väljalülitatud moodul peidab, aga ei luku.**

1. **Menüüpunkt kaob**, nagu `lab` ja `clinical` lipud juba teevad.
2. **Kirjutamine keelatakse** — sama tee, mida `licenceCanWrite` juba käib.
3. **Lugemine jääb puutumata.** Mitte ühtegi RLS-reeglit ei muudeta, mitte
   ühtegi rida ei peideta. Moodul tagasi sisse → kõik on alles.

Kolmas punkt on ka põhjus, miks moodulivärav on **klientpoolne**. Serveripoolne
moodulilukk tähendaks RLS-i, mis peidab ridu, ja siis on „lülitasin mooduli
välja" ja „kaotasin andmed" ühe nupuvajutuse kaugusel. Litsents on **äriline
kokkulepe, mitte turvapiir** — päris lukk on server. **Andmekadu ei tohi kunagi
olla litsentsi tagajärg.**

## 1.7 Sõltuvused: mis katki ei tohi minna

**Mooduli väljalülitamine ei tohi katki teha teise mooduli vormi.**

| Olukord | Mis juhtub |
|---|---|
| **`patients` väljas, töö vorm vajab patsienti** | Töö vorm jääb tööle. Patsiendiväli muutub **vabatekstiks** (`jobs.patsient` on juba denormaliseeritud ja kannab nime), patsiendikaardi link kaob. Olemasolevate tööde patsiendinimed on endiselt näha. |
| **`jobs` väljas, `payroll` sees** | Töötasud töötavad. Tunnipõhine ja kuutasu arvestatakse; tükitöö ridu lihtsalt ei teki, sest töid ei sisestata. Vanad read ja väljamaksed on loetavad. |
| **`jobs` väljas, `stock` sees** | Ladu töötab. Kulu **ei seota töödega**, vaid kantakse maha ilma viiteta. Varasemad tööga seotud kulud jäävad alles ja loetavaks. |
| **`invoices` väljas** | Töö vorm jääb tööle, arve loomise nupp kaob. Hinnaväljad jäävad — hind on töö omadus, mitte arve oma. |
| **`stats` väljas** | **Avaleht on Tööd.** Kui ka `jobs` on väljas, siis **Kalender**; kui seegi, siis **Seaded**. Avaleht on alati esimene sisselülitatud moodul selles järjekorras: `jobs` → `patients` → `invoices` → `payroll` → `stock` → Seaded. |
| **`payroll` väljas, `ratings` sees** | Hinnangud töötavad, **boonust ei arvutata**. |
| **`ratings` sees, `jobs` väljas** | Ei ole lubatud: `ratings` **vajab `jobs`-moodulit**, sest hinnang käib töö kohta. Väljastamise tööriist keeldub sellest kombinatsioonist. |

## 1.8 Väljastamise tööriist

`scripts/make-license.mjs` laiendus, mitte uus skript — ta oskab juba Ed25519
allkirja ja tokeni kuju.

```
node scripts/make-license.mjs sign \
  --org <instantsi UUID> --name "Riia kliinik" \
  --modules jobs,payroll,stock,ratings --months 12
```

- Allkiri **YubiKey C pealt**, PIN-i ja puudutusega; privaatvõti ei lahku
  võtmelt. `scripts/yubikey/keys.mjs` teeb juba seda tüüpi tööd.
- `--test-key <fail>` ainult arenduseks, ja ta **keeldub**, kui käib
  väljalaskebuild'i vastu.
- `--renew <vana token>` loeb vana payloadi, **hoiab `org`-i ja moodulid**, ja
  nihutab ainult `exp`-i — nii ei jää uuendamisel moodul kogemata välja.
- Tööriist **keeldub** vastuolulisest komplektist (nt `ratings` ilma `jobs`-ita).

## 1.9 Kuidas uuendatud litsents kliinikuni jõuab

**Praegu ainult kleepimine.** Seaded → Litsents, `installLicence` on olemas.
Võti on tekst, mahub e-kirja ja sõnumisse.

**Tõmbamine tuleb hiljem ja siis sama kanali kaudu nagu uuendused**, mitte
eraldi URL-ina.

## 1.10 Kui litsents aegub

1. **Viimased 30 päeva enne `exp`-i:** teade. Midagi ei muutu.
2. **`exp` möödas, 14 päeva armuaega:** kõik töötab, hoiatus tõsisem.
3. **Pärast armuaega: kirjutuskaitse.** Lugemine, otsimine ja **eksport jäävad
   alles** — see on ka GDPR-i nõue, mitte viisakus.
4. **Andmeid ei kustutata ega peideta kunagi.**

**Hoiatust näevad ainult omanik ja need, kellel on litsentsi õigus.** Teised
näevad alles kirjutuskaitset, kui see tuleb — tehnik ei pea teadma, et arve on
maksmata, ta peab teadma, miks nupp ei tööta.

## 1.11 Mis on ehitatud (18.11.2026)

Kõik allpool on `testing`-us ja **magab**, kuni `LICENCE_PUBLIC_KEYS` on tühi.

| Mis | Kus |
|---|---|
| v2 payload, `org` / `api` / `modules`, v1 jääb kehtima | `shared/license/token.ts` |
| Allkirja eraldus: `WIVO-LICENCE-1\n…` ainult v2-l | sama, `signingInput(payloadB64, v)` |
| Mooduli komplekti kontroll (`ratings` vajab `jobs`-i) | sama, `moduleSetProblem` |
| Aadressi võrdlus päritolu järgi | sama, `normaliseOrigin`, `licenceAllowsApi` |
| Kaks võtit (C ja D) ja failist testvõti | `src/main/license.ts` |
| Mooduli värav õigustes ja menüüs | `shared/permissions.ts` (`PERMISSION_MODULE`, `PLACE_MODULE`) |
| Avaleht, kui `stats` on väljas | sama, `HOME_ORDER`, `homePlace` |
| Aadressi keeld enne ühendumist | `src/renderer/src/lib/testCopy.ts` + `lib/licensedApi.ts` |
| Punane bänner, kui litsents ei luba aadressi | `components/TestCopyBanner.tsx` |
| Litsentsi leht näitab organisatsiooni, aadressi ja mooduleid | `components/Settings/LicenseSection.tsx` |
| Väljastamise tööriist: `sign`, `renew`, `verify` | `scripts/make-license.mjs` |

**Testid:** `shared/license/token.test.ts` (62), `shared/permissions.test.ts`
(32), `scripts/makeLicense.test.ts` (21, allkirjastab tööriistaga ja kontrollib
rakenduse mooduliga — koopia ei saa vaikselt lahku minna),
`src/renderer/src/lib/testCopy.test.ts` (aadressi keeld).

### Kuidas seda ise proovida

**Alates 19.11.2026 on `testing`-us C ja D litsentsivõtmed sees**, nii et
litsentsi kontrollitakse. Ilma litsentsita on rakendus ainult lugemiseks.
Arenduses (`npm run dev`, `npm run dev:test`) on vaja testvõtit ja
sellega allkirjastatud litsentsi, nagu allpool. Päris litsentsi saab
allkirjastada alles siis, kui `make-license.mjs` oskab YubiKey C-ga
allkirjastada.

```
node scripts/make-license.mjs keygen --out license-test-private.pem
# kirjuta välja trükitud hex ühe reana faili, nt license-test-public.hex
node scripts/make-license.mjs sign   --org <instantsi UUID> --name "Riia kliinik"   --api https://<projekt>.supabase.co   --modules jobs,payroll,stock --months 12 --key license-test-private.pem
```

Siis käivita rakendus nii, et `WIVO_LICENCE_TEST_KEY` osutab avaliku võtme
failile, ja kleebi token Seaded → Litsents.

**Testvõti ei tööta pakendatud väljalaskes.** See ei ole kokkulepe, vaid
`app.isPackaged` kontroll `src/main/license.ts`-is: release ei loe failist
võtmeid üldse, nii et siin allkirjastatud token on seal kehtetu.

**Mõlemad failid on gitignore'is** ja neid ei panda `main`-i.

### Mida see teadlikult ei tee

- **Serveripoolset moodulilukku ei ole**, ja see on §1.6 otsus, mitte
  tegemata töö. Litsents on äriline kokkulepe; päris lukk on RLS, mis käib
  rolli ja õiguse järgi.
- **Telefonis ei ole litsentsifaili** — veebirakendusel ei ole main-protsessi.
  Telefoni menüü käib õiguste järgi, nagu seni. Sama põhjus: moodul on
  kokkulepe, mitte turvapiir.
- **`seats` ei ole jõustatud.** Ta on payloadis ja nähtav, nagu enne.
- **Litsentsi tõmbamist ei ole** (§1.9): kleepimine, nagu kokku lepitud.
- **YubiKey allkirjastamine on tegemata**, sest võtmed on seadistamata.
  Tööriist allkirjastab failiga ja **ütleb seda iga kord välja**.

---

# Osa 2 — hinnangud arsti ja tehniku vahel

Moodul `ratings`. **Vajab `jobs`-moodulit.** Boonus vajab `payroll`-i.

## 2.1 Mis see on

Töö kohta kaks eraldi hinnangut, **0–5 poole sammu kaupa** (4,5 lubatud),
kuvatud **hammastena**, valikulise kommentaariga:

- **arst hindab tehniku tööd**
- **tehnik hindab arsti juhtumit**

Need on eri asjad ega tasakaalusta teineteist.

## 2.2 Kes tohib hinnata

Minu esimene reegel — „hindaja ei tohi olla teostaja ega disainija" — oli
**vastuoluline**: tehniku hinnangu annabki just töö teostaja. Õige reegel:

| `role` | Kes annab |
|---|---|
| `doctor` | **ainult töö tellinud arst** |
| `technician` | **ainult töö teostaja või disainija** |

Lisaks:

- **Hindaja ei ole kunagi hinnatav.**
- **Keegi väljastpoolt tööd ei hinda, ka omanik mitte.**
- **Kontroll on RLS-is**, mitte vormis.

## 2.3 Hinnatav külmutatakse

Tabelis on **`ratee_id`**. Kui tööl on nii teostaja kui disainija, läheb arsti
hinnang **mõlemale — üks rida kummagi kohta**.

**Hinnatav külmutatakse hindamise hetkel**, et töö hilisem ümbermääramine ei
viiks hinnangut teisele inimesele.

`unique (job_id, rater_id, ratee_id)`.

## 2.4 Millal ja kui kaua

| | |
|---|---|
| **Arst saab hinnata** | alates üleandmisest (`delivered_at`) |
| **Tehnik saab hinnata** | alates valmis-etapist |
| **Muuta saab** | kuni **selle kuu väljamakse kinnitamiseni** |
| **Pärast seda** | ei saa muuta ega kustutada |

**Hinnang kuulub kuusse, millal see anti (`rated_at`)**, mitte töö kuusse. Nii
ei jää hiline hinnang lukus kuu taha kinni ega muuda juba makstud kuud.

## 2.5 Nähtavus: avatud, aga pimedana

**Kumbki pool näeb teise hinnangut sellele tööle alles siis, kui on ise selle
töö hinnanud, või kui kuu väljamakse on kinnitatud.**

**Omanik näeb kõike.**

Peitmine nime taha ei annaks midagi — töö juures on niikuinii näha, kes tellis.
Pimedus kaitseb seda, mis päriselt loeb: **hinnang antakse enne, kui on näha,
mida teine andis.**

## 2.6 Keskmised ja boonus

- **Hindamata ei ole 0.** Hindamata töö **ei lähe keskmisesse**; 0 on päris
  hinne, mille keegi andis.
- **Keskmised Statistikas** inimese ja töö liigi kaupa.
- **Boonusreeglid on rolli kaupa**, sest arsti boonus ei pruugi Wivo palgast
  tulla.
- **Igal reeglil on miinimum:** mitu hinnangut peab kuus olema, et boonust
  üldse arvestataks. Muidu teeb üks viis keskmiseks viie.
- **Töötasud pakub rea, omanik kinnitab** — nagu iga muu palgarida.
- **Boonus arvutatakse ainult kinnitatud hinnangutest ja külmutatakse
  väljamakse reale**, nagu kõik `worker_payout_lines`-is. Muidu muudab üks
  hiline hinnang juba makstud kuud.

## 2.7 Eksport ja privaatsus

- **Kommentaarid ei lähe ühtegi eksporti.**
- Raamatupidajale läheb **ainult boonusrea summa oma koodiga**.
- Ekspordis **ainult töökoodid**, mitte patsient.
- Kõik auditilogis, sh muutmine ja kustutamine, sest hinnang mõjutab raha.

## 2.8 Tehniline kuju

Üks migratsioon (**123**), tabel `job_ratings`:

```
org_id, job_id, rater_id, ratee_id,
role      ('doctor' | 'technician'),
score     0–5, pool sammu: check (score * 2 = floor(score * 2))
comment   null lubatud,
rated_at, created_at, updated_at
unique (job_id, rater_id, ratee_id)
```

CLAUDE.md nõuded samas migratsioonis: `org_id` ja RLS, **RLS leak-test**,
`select public.ensure_mfa_policies();`, ja boonusfunktsioonile
`select public.lock_anon_functions();`. Skeemikontroll genereeritakse uuesti.

Boonusreeglid `clinic_settings` alla, nagu muud seadistused.

Puhas loogika **`shared/ratings/`**-isse: poole sammu valideerimine, keskmise
arvutus (hindamata välja), boonusreegli hindamine koos miinimumiga. Need
otsustavad raha ja on testitavad ilma andmebaasita.

---

## Järjekord

1. ~~CSV päised~~ — **tehtud**, `4c5b89e`
2. **Osa 1:** litsentsi moodulid
3. **Osa 2:** hinnangud
4. Faas 2 (partnersild) — **ootel**

**Osa 1 on kinnitatud ja ehitamisel** (Kevin, 2026-11-17), koos lisandusega, et
litsents kannab lubatud API aadressi, mitte ainult organisatsiooni. Osa 2 ootab
sammu 1 lõppu (docs/ROADMAP.md), sest hinnatav tuleb etapile määratud inimesest.

**Migratsiooninumbrid on kinnitatud:** **122** töövoole
(docs/WORKFLOW-STAGES.md), **123** hinnangutele. Litsentsi moodulid ei vaja
migratsiooni — litsents on allkirjastatud fail, mitte andmebaasi rida.
