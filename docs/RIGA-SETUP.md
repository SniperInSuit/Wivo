# Riia seadistus: samm-sammult Macis

See on sinu käsiraamat, Kevin. **Üks käsk korraga**, Maci Terminalis, repo
kaustast (`~/dev/Workly`), haru `testing`. Iga samm ütleb, mida pärast nägema
peaksid. Kui midagi läheb teisiti, **peatu seal** ja küsi; ära paranda
käsitsi edasi.

Taust: `RIGA-GO-LIVE.md` („Monday 23.11.2026") ja `docs/RIGA-TEMPORARY.md`
(installer ja Cloudflare). Sarnane juhend demole: `docs/DEMO-SETUP.md`.

> **Parool ega võti ei lähe kunagi käsureale.** zsh-i ajalugu
> (`~/.zsh_history`) on fail kettal. Iga samm allpool küsib parooli varjatult
> või paned võtme otse dashboardi.

> **Claude ei ühendu Riia projektiga kunagi** (CLAUDE.md). Kõik allpool teed
> sina, oma masinas ja dashboardis.

---

## 0. Enne alustamist

**0.1. Migratsioon 125 testkoopias.** Kõik proovitakse enne testkoopias
(CLAUDE.md). Testkoopia SQL Editoris, järjekorras:

1. kogu `sql/125_mail_quota.sql` sisu, Run;
2. eraldi päring: `notify pgrst, 'reload schema';`
3. `sql/checks/schema_check.sql` ja `sql/checks/trigger_check.sql` → null rida.

Uut baseline'i Riiale ei tee enne, kui need on testkoopias läbi.

**0.2. Tööriistad.** Kontrolli, et need on olemas; puuduva paigalda
(Homebrew):

| Mis | Kontroll | Puudub? |
|---|---|---|
| git, Node 22 | `node --version` | `brew install node@22` |
| psql | `/opt/homebrew/opt/libpq/bin/psql --version` | `brew install libpq` |
| Supabase CLI | `supabase --version` | `brew install supabase/tap/supabase` |
| ykman (YubiKey) | `ykman --version` | `brew install ykman` |

psql jääb täispika teega, PATH-i teda ei panda.

**0.3. Kood.** Puhas `testing`, sama mis GitHubis:

```sh
git switch testing
```

```sh
git pull
```

```sh
git status --short
```

Viimane ei trüki midagi.

**0.4. Paroolihaldurisse tuleb kirja** (iga samm ütleb, millal): Riia
andmebaasi parool, Riia ref, anon/publishable key, kaks Resendi võtit,
VAPID-i paar, omaniku parool.

---

## 1. Supabase'i projekt (Stockholm, Pro)

Dashboard (supabase.com) → **Riia organisatsioon** → **New project**:

| Väli | Väärtus |
|---|---|
| Organization | Riia oma (mitte sinu isiklik) |
| Name | `wivo-riga` |
| Region | **North EU (Stockholm)** `eu-north-1` |
| Database password | **Generate**, kohe paroolihaldurisse |
| Plan / Compute | Pro, vaikimisi suurus |

Projekt on valmis ~2 minutiga. Pane kirja:

- **Project ref** (URL-is: `supabase.com/dashboard/project/<REF>`);
- **Project URL**: `https://<REF>.supabase.co`;
- **anon / publishable key**: Project Settings → API Keys.

**Kontrolli kohe, et legacy `service_role` võti on olemas:** Project Settings
→ API Keys → **Legacy API keys** → `service_role` (algab `eyJ`). Seda on vaja
sammus 2 (Vault, cron). **Kui seda vahekaarti ei ole, peatu ja anna teada:**
baseline (sql/052, sql/056) keeldub ilma selleta.

**Spend cap** (Organization → Billing): jäta sisse. Pro sisaldab 100 GB
Storage'it; üle selle ütleb Supabase ette, mitte arvel.

---

## 2. Baseline psql-iga

Kõik migratsioonid sql/000 … sql/125 ühe failina. Skript lisab Vaulti
**Riia** teenusevõtme ja võtab maha arvete croni, mis on sql/052-s tootmise
aadressiga (Riia arveid ei saada).

**2.1. Tee fail** kodukausta, ainult sinule loetav. Skript küsib
`service_role` võtit varjatult (keeldub tootmise võtmest):

```sh
umask 077; node scripts/fresh-schema.mjs > ~/riga-baseline.sql
```

Oota: `~/riga-baseline.sql` on ~700 KB (`ls -lh ~/riga-baseline.sql`).

**2.2. Ühendusstring.** Dashboard → **Connect** → **Session pooler** (port
5432). Kopeeri string ja **kustuta sealt `:[YOUR-PASSWORD]`**, nii et jääb:

```
postgresql://postgres.<REF>@aws-0-eu-north-1.pooler.supabase.com:5432/postgres
```

(Host on see, mida Connect näitab; `aws-0` võib olla `aws-1`.) Mitte
Transaction pooler (6543), mitte otseühendus (ainult IPv6).

**2.3. Jooksuta.** `-W` küsib andmebaasi parooli varjatult,
`ON_ERROR_STOP=1` peatab esimese vea peal:

```sh
/opt/homebrew/opt/libpq/bin/psql "postgresql://postgres.<REF>@aws-0-eu-north-1.pooler.supabase.com:5432/postgres" -W -v ON_ERROR_STOP=1 -f ~/riga-baseline.sql
```

Lõpus `NOTIFY` ja mitte ühtegi `ERROR`-it. `NOTICE`-id (`skipping`,
`already exists`) on normaalsed. **Kui tuleb `ERROR`:** kopeeri viimased 30
rida ja faili nimi, mille juures see juhtus (`-- ═══ 0xx_…` rida üleval), ja
peatu. Ära jooksuta faili uuesti ega paranda midagi käsitsi.

**2.4. Kustuta fail** (sees on teenusevõti):

```sh
rm ~/riga-baseline.sql
```

**2.5. Kontrolli skeemi.** Dashboard → SQL Editor, kleebi
`sql/checks/schema_check.sql`, Run → **null rida**. Siis sama
`sql/checks/trigger_check.sql`-iga → **null rida**.

---

## 3. Vault: funktsioonide aadress (teavituste cron)

sql/077 kutsub iga minut `send-notifications`-it, kui Vaultis on selle
projekti funktsioonide aadress. SQL Editoris:

```sql
select vault.create_secret('https://<REF>.functions.supabase.co', 'wivo_functions_url');
```

Kontroll (kaks rida: `wivo_functions_url`, `wivo_service_role_key`):

```sql
select name from vault.secrets order by name;
```

Cron kutsub funktsiooni, mis tuleb alles sammus 8. Seni vastab ta 404-ga; see
on normaalne.

---

## 4. Kopa piir (suured failid)

KT-seeria ZIP-ina on 150–600 MB, STL-i täiskaar 20–80 MB. Kaks seadet, selles
järjekorras (kopa piir ei saa olla suurem kui üldine):

1. **Project Settings → Storage → Upload file size limit:** `1 GB`.
2. **Storage → `job-files` → Edit bucket → Restrict file upload size:**
   `1 GB`. Ära muuda „Public bucket" lülitit (peab olema väljas).

---

## 5. Authi põhiseaded

Dashboard → **Authentication**:

1. **URL Configuration**
   - Site URL: `https://wivo-riga.pages.dev`
   - Redirect URLs: lisa `https://wivo-riga.pages.dev/auth/confirm`
2. **Sign In / Providers → Email**
   - Confirm email: sees. Secure email change: sees.
   - Email OTP Expiration: `86400` (24 h: kutse ja parooli link).
   - Minimum password length: `10`.
3. **Sign In / Providers → „Allow new users to sign up": VÄLJA.** Kontod
   teeb omanik Wivos (team-account), see töötab ka nii
   (docs/ACCOUNTS.md §5).
4. **Multi-Factor → TOTP:** sees (vaikimisi). Ilma teise tegurita ei näe
   keegi midagi (sql/098).

---

## 6. Resend: domeen `wivo.dentiks.lv` ja DNS Iljale

**6.1. Domeen.** resend.com, **Riia konto** → **Domains → Add Domain** →
`wivo.dentiks.lv`, region **EU (Ireland)** `eu-west-1`.

**6.2. Kirjed Iljale.** Resend näitab kirjeid; **DKIM-i väärtus on ainult
selle konto oma**, nii et kopeeri see Resendist täpselt. Saada Iljale see
tabel (nimed `dentiks.lv` tsooni sees):

| Tüüp | Nimi | Väärtus |
|---|---|---|
| TXT | `resend._domainkey.wivo` | DKIM, Resendist (`p=MIGf…`) |
| MX | `send.wivo` | `feedback-smtp.eu-west-1.amazonses.com`, prioriteet `10` |
| TXT | `send.wivo` | `v=spf1 include:amazonses.com ~all` |
| TXT | `_dmarc.wivo` | `v=DMARC1; p=none;` |

Iljale lisaks:
- `dentiks.lv` enda MX, SPF ja muud kirjed **jäävad puutumata**; alamdomeen
  ei vaja neist ühtegi.
- Kui teenusepakkuja tahab täisnime: `resend._domainkey.wivo.dentiks.lv`
  jne.
- `wivo.dentiks.lv`-ile endale A/CNAME kirjet ei ole vaja.

**6.3. Kinnita.** Kui Ilja ütleb, et kirjed on sees: Resend → **Verify DNS
Records**, oota, kuni kõik on **Verified** (minutid kuni paar tundi).
Kontroll Terminalis (trükib `v=spf1 include:amazonses.com ~all`):

```sh
dig +short TXT send.wivo.dentiks.lv
```

**6.4. Kaks võtit.** Resend → **API Keys → Create API Key**, mõlemad
**Sending access**, domeen ainult `wivo.dentiks.lv`:

- `riga-auth-smtp`: Supabase Authi SMTP (samm 7);
- `riga-functions`: Edge Functions (samm 8).

Iga võti näidatakse üks kord: kleebi kohe sinna, kus teda kasutatakse (ja
paroolihaldurisse).

**Päevapiir:** tasuta plaan on 100 kirja päevas (3000 kuus), Authi kirjad
kaasa arvatud. Kui piir täitub: funktsiooni logis hoiatus, logirida tabelis
`mail_quota_hit` ning omanikule kella- ja telefoniteavitus „Tänane e-kirjade
piir on täis" (sql/125). Teavituste e-kirjad proovitakse uuesti iga minut
ööpäeva jooksul; kutse ja parooli link tuleb järgmisel päeval uuesti saata.

---

## 7. Supabase Authi SMTP Resendi kaudu

**7.1.** Authentication → **Emails → SMTP Settings → Enable Custom SMTP**:

| Väli | Väärtus |
|---|---|
| Sender email | `no-reply@wivo.dentiks.lv` |
| Sender name | `Wivo` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | `riga-auth-smtp` võti |

Save.

**7.2.** Authentication → **Rate Limits**: e-mails per hour `30`.

**7.3.** Authentication → **Emails → Templates**. Kleebi teema ja sisu
failidest (teema on faili esimeses kommentaaris; sisu ilma selle
kommentaarita):

- `docs/auth-email-templates/reset-password.html` → **Reset password**
- `docs/auth-email-templates/invite.html` → **Invite user**
- `docs/auth-email-templates/change-email.html` → **Change email address**

**7.4. Proovi.** Authentication → Users → **Invite user** oma aadressiga. Kiri
tuleb `no-reply@wivo.dentiks.lv`-ilt; Resend → **Emails** näitab
*Delivered*. Siis kustuta see kasutaja (Users → … → Delete user).

---

## 8. Edge Functions

**8.1. Logi CLI sisse** (avab brauseri; token läheb macOS-i võtmehoidjasse,
mitte faili):

```sh
supabase login
```

**8.2. Neli funktsiooni.** Iga käsk eraldi. **Ära kunagi jooksuta
`supabase link`-i** (CLAUDE.md); iga käsk saab `--project-ref`-i.

```sh
supabase functions deploy send-notifications --project-ref <REF> --no-verify-jwt --use-api
```

```sh
supabase functions deploy team-account --project-ref <REF> --no-verify-jwt --use-api
```

```sh
supabase functions deploy account-security --project-ref <REF> --no-verify-jwt --use-api
```

```sh
supabase functions deploy file-link --project-ref <REF> --use-api
```

Igaüks lõpeb `Deployed Functions on project <REF>`. (`file-link` jääb
gateway JWT-kontrolliga, nagu testkoopias.) `send-invoices`, `public-booking`
ja `wivo-update` Riiale ei lähe: arveid ja veebibroneeringut Riia ei kasuta,
uuendused tulevad installeriga.

Kui CLI ütleb, et `--use-api` on tundmatu: `brew upgrade supabase` ja uuesti.

**8.3. VAPID-i paar** telefoni pushi jaoks:

```sh
node scripts/vapid-keys.mjs
```

Trükib kaks rida. Mõlemad paroolihaldurisse. `VAPID_PUBLIC_KEY` läheb ka
Cloudflare'i (samm 10), `VAPID_PRIVATE_KEY` **ainult** funktsiooni saladusse.

**8.4. Saladused.** Dashboard → **Edge Functions → Secrets → Add new
secret**, ükshaaval:

| Nimi | Väärtus |
|---|---|
| `RESEND_API_KEY` | `riga-functions` võti |
| `NOTIFY_FROM` | `Wivo <no-reply@wivo.dentiks.lv>` |
| `APP_LINK` | `https://wivo-riga.pages.dev/job/{id}` |
| `VAPID_PUBLIC_KEY` | 8.3 esimene rida (ilma `VAPID_PUBLIC_KEY=`-ita) |
| `VAPID_PRIVATE_KEY` | 8.3 teine rida |
| `VAPID_SUBJECT` | `mailto:` + sinu aadress |
| `BUG_REPORT_TO` | sinu aadress (vearaportid) |

**`EMAIL_ALLOW_ONLY` Riiale EI pane** (see on ainult testkoopia oma).

**8.5. Kontrolli croni.** Oota 2 minutit. SQL Editoris:

```sql
select status_code, left(content::text, 120) as answer, created
  from net._http_response order by created desc limit 3;
```

`200` ja vastus `{"ok":true,…}`. `401` = Vaulti võti ei klapi (peatu ja
küsi), `404` = funktsioon pole üleval.

---

## 9. Installer ja haru `riga`

**9.1. `riga.env`** repo kaustas (git ignoreerib), täpselt kaks rida:

```
VITE_SUPABASE_URL=https://<REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
```

**9.2. Paketid:**

```sh
npm ci
```

**9.3. Ehita:**

```sh
npm run dist:riga
```

~5 minutit. Lõpus: installeri tee, commit, Riia ref, **SHA-256** ja käsk haru
`riga` liigutamiseks. Kirjuta SHA-256 üles. Kui ta keeldub („Refused: …"),
loe rida: iga rida ütleb, mida teha.

> **Macis ei ole Windowsi installerit veel lõpuni proovitud.** Kui
> electron-builder ütleb midagi `wine`-i kohta, ehita Windowsi masinas
> (`docs/RIGA-TEMPORARY.md`, osa A, samad käsud PowerShellis) ja jätka siit.

**9.4. Telefon samast versioonist.** Cloudflare'i `wivo-riga` ehitab haru
`riga`. Kopeeri käsk, mille `dist:riga` lõpus trükkis (sama commit mis
installeril):

```sh
git push origin <installeri täispikk commit>:refs/heads/riga
```

Esimene kord teeb haru. Edaspidi **iga uue installeriga** sama käsk uue
commitiga. Ta pole kunagi `--force`: git keeldub, kui commit ei ole `riga`
praegusest eespool, nii et `riga` järgib alati `testing`-ut. Kui `dist:riga`
ütles „First push testing", pushi enne `testing`.

---

## 10. Cloudflare `wivo-riga`

Nagu `docs/RIGA-TEMPORARY.md` osa B. Kaks asja, mida seal kergesti vahele jätta:

- **Production branch: `riga`** (mitte `testing`).
- **Environment variables (Production), kolm:**
  - `VITE_SUPABASE_URL` = Riia Project URL
  - `VITE_SUPABASE_ANON_KEY` = Riia anon / publishable key
  - `VITE_VAPID_PUBLIC_KEY` = 8.3 avalik võti (ilma selleta ei saa telefon
    pushi sisse lülitada)

Build command `npm run mobile:build`, output `dist-mobile`, `NODE_VERSION`
`22`. **Preview branches: None.** Kontroll: ava
`https://wivo-riga.pages.dev`, Network-vaates lähevad päringud ainult
`<REF>.supabase.co`-sse.

---

## 11. Omanik ja kliinik

**11.1. Omaniku konto.** Supabase → Authentication → Users → **Add user →
Create new user**: Riia omaniku e-post, ajutine parool (≥ 10 märki,
paroolihaldurisse), **Auto Confirm User: sees**. Kirja ei saadeta.

**11.2. Esimene sisselogimine Windowsis** (omaniku arvuti või sinu Windows):
paigalda installer (kontrolli enne `Get-FileHash .\Wivo-Riga-Setup-<versioon>.exe`
= SHA-256), ava Wivo, logi omanikuna sisse. Wivo nõuab kohe **teist tegurit**:
omanik skannib QR-i oma telefoni autentimisrakendusega. Siis **„Set up your
clinic"**: nimi, aadress, registrikood, „Create clinic and start".

Litsentsita on menüü peaaegu tühi; see on õige, litsents tuleb järgmisena.

**11.3. Kliiniku ID.** Supabase SQL Editoris:

```sql
select id, name from public.clinics;
```

Üks rida. `id` on litsentsi `--org`.

---

## 12. Litsents YubiKey C-ga

YubiKey C Maci külge. Üks käsk (PIN ja puudutus):

```sh
node scripts/make-license.mjs sign --org <kliiniku id> --api https://<REF>.supabase.co --name "<kliiniku nimi>" --modules jobs,payroll,stock --seats 10 --months 12
```

Enne trükkimist trükib ta nime, `10 kasutajat`, aadressi ja moodulid, ning
kontrollib allkirja C avaliku võtmega. Siis tuleb `WIVO1.…` token. Kontrolli
veel kord eraldi:

```sh
node scripts/make-license.mjs verify <token> --public 2238a030d6895e917a01e56228a2dc65e2e5a3e9b4a12fc16b66784edf48f5ca
```

`OK · v2 · <nimi> · kuni <kuupäev>`. (See on YubiKey C avalik võti,
`src/main/license.ts`.)

Omaniku Wivos: **Settings → Licence**, kleebi token, Install. Licence-leht
näitab Riia aadressi ja kolme moodulit. Punane bänner = vale aadress: peatu.

(`--seats` on tokenis, aga Wivo ei jõusta seda veel; 10 on kokkulepe.)

---

## 13. Kümme kontot ja rollid

Omaniku Wivos: **Team → Add staff member**. Kaks viisi:

- **E-postiga:** kutse läheb Resendi kaudu (läheb 100 päevapiiri sisse; 10
  kutset on probleemita). Inimene määrab lingist parooli.
- **Kasutajanimega** (`nimi@KOOD`), ilma e-postita: omanik annab parooli
  ise üle. Parooli taastamine käib siis omaniku kaudu.

Iga konto juures **Apply role** (eelseade), siis vajadusel õigused käsitsi.
Eelseaded: tehnik, arst, raamatupidaja, sekretär, juhataja, IT.
**Juhataja, raamatupidaja ja IT ei näe patsiendi nime** (neil pole
`jobs.read`-i ega `patients.read`-i); ära lisa neid käsitsi.

Täida Riiaga (omanik on 1. rida):

| # | Nimi | E-post või kasutajanimi | Eelseade | Etapid |
|---|---|---|---|---|
| 1 | | | omanik | |
| 2 | | | arst | Skaneering; kabinetis Disain, Freesimine |
| 3 | | | arst | |
| 4 | | | tehnik (digi) | Disain, Printimine/Freesimine |
| 5 | | | tehnik (käsitsi) | Viimistlus |
| 6 | | | tehnik | |
| 7 | | | IT | Vastuvõtt |
| 8 | | | juhataja | |
| 9 | | | raamatupidaja | |
| 10 | | | sekretär | |

Iga inimene lisab esimesel sisselogimisel teise teguri (sql/098). Ilma selleta
näeb ta tühja ekraani: ütle seda neile ette.

---

## 14. Riia etapid ja kaks malli

Omaniku Wivos: **Settings → Job stages**.

**14.1. Etapikogu** (lehe alumine osa, „Workflow"). Pane täpselt need, selles
järjekorras; vaikimisi etapid, mida pole, eemalda. Riia kasutab ingliskeelset
Wivot, seega nimed inglise keeles (või nii, nagu Riia tahab; nimi on vaba
tekst):

| # | Nimi (EN) | ET |
|---|---|---|
| 1 | Scanning | Skaneering |
| 2 | Intake | Vastuvõtt |
| 3 | Photogrammetry | Fotogramm-meetria |
| 4 | Design | Disain |
| 5 | Printing / Milling | Printimine/Freesimine |
| 6 | Finishing | Viimistlus |
| 7 | Done | Valmis |

Viimane etapp on alati „valmis". Vaikemall (`default`) järgib seda nimekirja
ise: kõik etapid järjest.

**14.2. Mall „Crown, lab"** (Kroon labor). **Workflow templates → New
template**:

| Etapp | Lüliti / reegel | Vastutaja | Palk |
|---|---|---|---|
| Scanning | — | ☑ „The doctor who orders the job does it" | No pay |
| Intake | — | IT (rida 7) | No pay |
| Photogrammetry | **Only when: digital scan + more than one implant** | ☑ tellija arst | No pay |
| Design | — | digitehnik (rida 4) | **Design** |
| Printing / Milling | — | digitehnik (rida 4) | No pay |
| Finishing | — | käsitsi tehnik (rida 5) | **Piecework** |
| Done | — | — | No pay |

Save template. Kui vorm ütleb vea (punane rida), loe see; nt üks palgaliik
saab olla ainult ühel etapil.

**14.3. Mall „Crown, in clinic"** (Kroon kabinetis): arst skannib, disainib
ja freesib, tehnik viimistleb.

| Etapp | Vastutaja | Palk |
|---|---|---|
| Scanning | ☑ tellija arst | No pay |
| Design | ☑ tellija arst | No pay |
| Printing / Milling | ☑ tellija arst | No pay |
| Finishing | käsitsi tehnik (rida 5) | **Piecework** |
| Done | — | No pay |

Intake ja Photogrammetry seda malli ei kasuta.

**Palgaliigid on minu ettepanek** (Design disainijale, Piecework
viimistlejale; arst kabinetis palka ei saa). **Kinnita Riiaga enne
esimest palgakuud**; malli muutmine hiljem ei muuda juba tehtud tööde palka.

**14.4. Tagavara** („Who a stage falls back to"): Printing / Milling →
digitehnik, Finishing → käsitsi tehnik. Kasutatakse, kui mall kedagi ei
nimeta (nt vaikemall).

---

## 15. Kontrollnimekiri: enne, kui Riia kasutama hakkab

Kõik peab olema ☑. Iga rida on üks proov päris projektis.

**Andmebaas ja ühendus**
- [ ] `schema_check.sql` ja `trigger_check.sql` → null rida (2.5)
- [ ] `net._http_response`: `send-notifications` vastab `200` (8.5)
- [ ] Installeri SHA-256 klapib; Settings → Licence näitab Riia aadressi ja
      Jobs, Payroll, Stock; punast bännerit ei ole
- [ ] Telefonis `wivo-riga.pages.dev`: päringud ainult `<REF>.supabase.co`-sse
- [ ] `riga` haru commit = installeri commit (Cloudflare → Deployments
      näitab sama lühikest commiti)

**Kontod**
- [ ] Kõik 10 kontot logivad sisse, igaühel teine tegur
- [ ] Raamatupidaja ja juhataja: tööde ja palga vaates **ühtegi patsiendi
      nime** ei ole
- [ ] Sign-up on väljas (5.3)

**E-post**
- [ ] Kutse jõuab kohale `no-reply@wivo.dentiks.lv`-ilt (Resend → Emails:
      *Delivered*)
- [ ] „Forgot password?" töölaual → kiri tuleb, link avab
      `wivo-riga.pages.dev/auth/confirm` ja uus parool töötab
- [ ] Teavituse e-kiri: tehnikul on „E-mail me the same notifications"
      sees, töö liigub tema etapile → kiri tuleb minuti jooksul

**Töövoog**
- [ ] Uus töö mallist „Crown, lab", digitaalne, **kaks implantaati** →
      Photogrammetry on etappide hulgas; ühe implantaadiga → ei ole
- [ ] Uus töö mallist „Crown, in clinic" arsti kontolt → Scanning, Design,
      Printing / Milling on arsti peal
- [ ] Tehnik näeb „I started" ja „Next stage" ainult oma etapil; liigutab
      töö edasi, järgmise etapi inimene saab kellateavituse
- [ ] KT-fail (ZIP, ~300 MB) laeb üles ja alla (kopa piir, samm 4)
- [ ] Palgaleht: proovitöö Design ja Finishing read on õigetel inimestel
- [ ] Proovitööd kustutatud enne starti

**Telefon ja omanik**
- [ ] Omaniku telefonis Wivo avakuvale lisatud, Settings → **Notifications on
      this phone** sees. Proov: proovitöö Design-etapile pannakse omanik,
      tehnik liigutab töö Design-ile → omaniku telefon saab pushi. (Sama tee
      kaudu jõuab omanikuni päevapiiri teade.)
- [ ] Omanik teab: „Tänane e-kirjade piir on täis" kellas tähendab, et
      kutsed ja parooli lingid tuleb järgmisel päeval uuesti saata

**Pärast starti, mitte enne** (RIGA-GO-LIVE.md): täielik turvaülevaatus
7.12-ni, osa B (litsents kannab ühendust), vene keel.
