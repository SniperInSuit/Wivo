# Veebibroneering — seadistus ja testimine

Kliiniku kodulehele tuleb vorm, kust patsient valib teenuse, arvutab hinna,
näeb **päris vabu aegu** ja broneerib. Taotlus maandub Wivos „Taotlused" lehel.

See fail on mõeldud järjest läbi tegemiseks. Käsud on **PowerShellile** (Windows) —
`&&`, `\` reamurdmine ja `openssl` seal ei tööta.

---

## 0. Kolm kohta, kuhu asjad lähevad

Enne kui midagi teed: iga samm käib ühte kolmest kohast ja neid ei tohi segamini
ajada.

| Koht | Mis sinna läheb | Kuidas ära tunda |
|---|---|---|
| **PowerShell** repo kaustas | `supabase …`, `npx …`, `node …` | Algab käsu nimega |
| **Supabase veebis → SQL Editor** | `sql/*.sql` failide **sisu** | Algab `alter table`, `create table`, `select` |
| **Wivo rakendus** | slug, tööajad, teenuse kestus, lülitid | Klikitav |

`supabase secrets set` ja `supabase functions deploy` on **CLI käsud** — nad
lähevad PowerShelli, mitte SQL editorisse. Nad saadavad asjad ise pilve.

Repo kaust: `C:\Users\fullg\Documents\GitHub\Workly`

---

## 1. Migratsioonid

**Wivos: Seaded → Andmebaas.** See leht küsib andmebaasilt otse, mis on tehtud ja
mis mitte. Punased read ütlevad, millise faili sisu Supabase SQL editorisse
kleepida.

Veebibroneering vajab neid:

| Fail | Mis | Märkus |
|---|---|---|
| `sql/047_public_services.sql` | Patsiendi hinnakiri | Ilma selleta jääb hinnakiri ainult ühte arvutisse |
| `sql/059_visit_requests.sql` | Taotluste tabel | |
| `sql/061_visit_request_payment.sql` | Visiiditasu, valitud aeg, kalkulaatori valik | Ohutu korduvalt jooksutada |
| `sql/062_visit_requests_realtime.sql` | Taotlus ilmub postkasti **ise** | **Jooksuta eraldi päringuna** |

Pärast iga veeru lisamist, eraldi päringuna:

```sql
notify pgrst, 'reload schema';
```

PostgREST hoiab skeemi vahemälus. Ilma selleta jääb „veergu ei leitud" viga
ekraanile ka pärast õiget migratsiooni — see on koht, kus „jooksutasin ju ära"
kõige sagedamini tõeks osutub ja ikka ei tööta.

`sql/062` peab olema **omaette päring**: `ALTER PUBLICATION` vajab lukku, mida
realtime-tööline hoiab, ja ühes tehingus teistega lukustuvad nad teineteise taha.

---

## 2. Wivo seaded

### 2.1 Kliiniku tunnus

**Seaded → Kliinik → Veebilehe tunnus** → `fullgevity` → **Salvesta**

See ei ole URL ega alaleht. See on kliiniku nimi API päringus:

```
GET …/public-booking/services?clinic=fullgevity
```

Ilma selleta vastab funktsioon 404-ga. Tühjaks jättes avalikku broneerimist ei
ole — see ongi opt-in.

### 2.2 Teenus

**Seaded → Patsiendi hinnakiri** → ava teenus:

- **Nimi patsiendile** — patsiendi sõnavara, mitte labori oma
- **Hind alates / kuni**
- **Visiidi kestus (min)** — nii pikk aeg pannakse kalendrist kinni.
  **Ilma selleta ei paku veeb sellele teenusele aegu**
- **Silmaikoon** real → avalikuks

Raviplaan on vabatahtlik — seda on vaja ainult mitmest visiidist koosneva ravi
näitamiseks. Ühe visiidi teenusel ei ole.

**Kalkulaator** (vabatahtlik): „Luba hamba kaupa arvutamine" → hamba hind,
kogusehinnad, lisavalikud. Siis saab patsient hambakaardilt hambaid valida ja
näeb hinda kohe.

### 2.3 Tööajad

**Sealsamas all: Veebibroneeringu ajad.**

- Tööajad päevade kaupa. **Päev ilma kellaaegadeta on KINNI** — see on tahtlik,
  et unustatud laupäev ei tähendaks kunagi lukus ust
- Pausid (lõuna), suletud kuupäevad
- **Aja samm** — mis minutitel ajad algavad
- **Kohti korraga** — toole või arste
- **Ette / Kuni** — kui vara ja kui kaugele saab broneerida. Välja all seisab
  kuupäev, et number oleks kontrollitav
- **Koormus** — „suur töö" alates N minutist, kuni M päevas. Päev, mille veeb
  saab täita nelja suure tööga, on päev, mida ei jõua ära teha
- **Kinnita broneeringud automaatselt** — vaikimisi väljas. Sees: aeg läheb kohe
  kalendrisse. Väljas: taotlus ootab „Taotlused" lehel

### 2.4 Valmiduse paneel

Sama lehe ülaosas. Kõik need vead näevad veebist ühesugused välja („vabu aegu ei
ole") ja igal on eri põhjus. Paneel ütleb, milline. **Tee ta roheliseks enne, kui
edasi lähed.**

---

## 3. Deploy

PowerShellis, repo kaustas:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pepper = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''

supabase secrets set PUBLIC_BOOKING_ORIGINS="http://localhost:3000,https://www.fullgevitydental.ee,https://fullgevitydental.ee" IP_HASH_PEPPER="$pepper"
```

Kõik ühel real — reamurdmist ei ole.

- **`www` ja ilma on brauseri jaoks kaks eri päritolu.** Kui leht töötab mõlemat
  pidi, peavad mõlemad nimekirjas olema
- `localhost:3000` on proovilehe jaoks. Võta enne päris kasutust välja
- `IP_HASH_PEPPER` takistab IP räsi tagasi arvutamist. `Get-Random` siin ei
  kõlba — peab olema krüptograafiliselt juhuslik
- **Iga `secrets set` kirjutab nimekirja üle.** Kõik võtmed korraga, mitte ükshaaval

Siis:

```powershell
supabase functions deploy public-booking --no-verify-jwt
```

`--no-verify-jwt` on siin õige: alternatiiv on panna anon-võti avalikku lehte.

> ⚠ `send-invoices` deploy'takse **ILMA** selle liputa — ta saadab kirju kliiniku
> aadressilt ja peab jääma autenditud pinnaks.

**Serveripoolne muudatus vajab alati uut deploy'd.** Kui midagi käitub vanamoodi,
on see esimene asi, mida kontrollida.

---

## 4. Testimine

```powershell
cd web/embed; npx serve .
```

Ava **`http://localhost:3000/test.html`**.

Ava päris pordilt, **mitte `file://` pealt** — `file://` saadab `Origin: null`,
mille allowlist õigustatult tagasi lükkab, ja siis paistab katki asi, mis töötab.

Lehel on kaks välja. Kirjuta tunnus (`fullgevity`), vajuta **„Laadi vorm"**.
Jääb brauseri mällu. Töötab ka aadressirealt: `test.html?clinic=fullgevity`

### Mida läbi käia

| Tegevus | Ootus |
|---|---|
| Leht avaneb | Samm 1 „Mida on vaja?" |
| Valid teenuse | Hambakaart (kui hamba kaupa hinnastatud) |
| Valid hambad | Hind kohe, „hinnanguline" kõrval |
| Edasi | **Kuukalender** — vabad päevad täpsemad, kinni päevad kahvatud |
| Valid päeva | Kellaajad paremal |
| Täidad kontakti, saadad | Wivos „Taotlused" **punane loendur** ja rida ilmub ise |
| Vajutad „Broneeri" | Visiidi vorm, aeg juba täidetud |
| Salvestad | Visiit kalendris, taotlus „Kinnitatud" |
| Küsid uuesti sama aega | Seda aega enam ei pakuta |
| Saadad kaks korda järjest | Wivos **üks** rida |
| Sõnum üle 300 tähemärgi | Väli ise ei lase |
| Kuues taotlus tunnis | `RATE_LIMITED` |

### Kui midagi ei tööta

**Ava brauseri konsool (F12).** Vidin ütleb seal alati, mis viga — ja localhostis
ka lehel punase kastiga.

| Sümptom | Põhjus |
|---|---|
| Vorm algab „Sinu kontaktist" | Teenuseid ei tulnud. Konsool ütleb, miks |
| „Kliinikut ei leitud" | Tunnus on vale või Wivos salvestamata |
| Aegu ei tule | Teenusel puudub kestus, või tööajad määramata |
| Taotlus ei ilmu ise | `sql/062` jooksutamata |
| CORS viga konsoolis | Aadress ei ole `PUBLIC_BOOKING_ORIGINS` nimekirjas |
| Vana käitumine | Funktsioon deploy'mata pärast muudatust |

---

## 5. Kodulehele

Alles siis, kui punkt 4 töötab.

```powershell
cd c:\Users\fullg\Documents\GitHub\Workly
node web/embed/build-embed.mjs --clinic fullgevity --title "Broneeri aeg" > paste-me.html
```

Ava `paste-me.html`, **vali kõik → kopeeri**, kleebi Frameri **Embed**
komponenti. Sees on nii vorm kui seadistus — muuta ei ole midagi vaja.

Kui saad `.js` faili üles laadida, on parem `--src`, sest siis ei pea vidina
uuenedes uuesti kleepima:

```powershell
node web/embed/build-embed.mjs --clinic fullgevity --src "https://www.fullgevitydental.ee/wivo-booking.js" > paste-me.html
```

### Kujundus

CSS-muutujatega, faili puutumata:

```css
.wv {
  --wv-accent: #0AB6C4;
  --wv-radius: 12px;
  --wv-ink: #1b2733;
  --wv-line: #e3e8ef;
}
```

Kirjatüüp päritakse lehelt — vidin ei too kaasa ühtegi välist fonti ega teeki.

---

## 6. Visiiditasu (Montonio) — kui konto on verified

Vabatahtlik. Ilma võtmeteta jäetakse tasu vaikselt vahele ja taotlus tuleb ikka
kohale, nii et kogu voog on testitav enne, kui raha mängu tuleb.

```powershell
supabase secrets set MONTONIO_ACCESS_KEY="..." MONTONIO_SECRET_KEY="..." MONTONIO_ENV="sandbox"
```

`MONTONIO_ENV` on **sandbox kõik muu peale täpselt `live`**. Tahtlik: kirjaviga
selles reas ei tohi hakata päris raha liigutama.

Summa andmebaasi (SQL editoris):

```sql
update public.clinic_settings
   set broneering = coalesce(broneering,'{}'::jsonb)
       || jsonb_build_object('visiiditasu', 20, 'valuuta', 'EUR',
                             'tagasiUrl', 'https://www.fullgevitydental.ee/')
 where clinic_id = my_clinic_id();
```

**Summa loetakse siit, mitte brauserist.** Avalik vorm, mis saaks ise hinna
nimetada, on vorm, kus kõik maksavad ühe sendi.

### Enne `live`

1. Sandbox'is läbi üks makse → Wivos peab tekkima silt **Tasutud 20.00 €**
2. Vormi saatmine kaks korda → **üks** taotlus ja **üks** makselink
3. Ava `…/public-booking/return?order-token=jama` käsitsi → peab ütlema „ei
   õnnestunud kinnitada", **mitte** märkima tasutuks
4. Alles siis `MONTONIO_ENV="live"` ja päris võtmed

Tagasimakseid süsteem ei tee — need käivad Montonio partnerisüsteemis käsitsi.

---

## 7. Mida see süsteem teadlikult ei tee

- **Ei näita patsiendile tema ravi.** Vastuseks on „taotlus saadud" või valitud
  aeg tagasi — ei id-d, ei staatuse linki. Patsiendile tema enda ravi vaate
  näitamine on MDR-i piir, mida see toode ei ületa
- **Ei diagnoosi.** Kalkulaator hinnastab seda, mida patsient valis. Miski ei
  ütle, et hammas *vajab* krooni
- **Ei anna siduvat pakkumist.** Iga hinna kõrval seisab, et täpne hind selgub
  vastuvõtul
- **Ei tee tagasimakseid**
- **Ei suhtle Dentasega.** Veeb näeb ainult Wivo kalendrit

## Andmekaitse

Salvestatakse nimi, telefon, e-post (kui antud), soovitud aeg, sõnum ja IP räsi.
Tagasi lükatud ja rämpstaotlused **kustuvad ise 90 päeva pärast**.

Sõnumiväli on 300 tähemärki ja ütleb, et terviseandmeid sinna kirjutada ei ole
vaja — piir on ka serveris, sest vorm on avalik kood ja sellest saab mööda.

**Lisa kliiniku privaatsusteatesse rida selle vormi kohta.** Wivo ei tee seda
sinu eest ja see on kliiniku kui vastutava töötleja kohustus.
