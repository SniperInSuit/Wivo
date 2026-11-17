# Oma server (Riia) — plaan

**Seis: plaan, 18.11.2026. Ehitamine ootab seda, et server oleks olemas.**

Riia tahab ühte füüsilist serverit, mille peal on kõik: Wivo, nende veebileht,
broneering ja hiljem maksed. **Me alustame pilvest, nende enda kontol, ja
kolime hiljem.** See järjekord on otsus, mitte viivitus: kolimine on majutuse
muutus, ja seda koos iganädalase tootemuutusega korraga siluda tähendaks kahte
tundmatut ühe ajal.

Mis selle plaani sees kokku lepitud ei ole, on **kuupäev**. Server on ostmata.

---

## 1. Riia IT sisend (18.11.2026)

**Praegune server:** 17 aastat vana, 4 GB RAM, HDD, 6 VM-i. **Nad ostavad uue.**
Kuni uus on valmis, on Riia **pilves oma kontol**.

**Uus server:** Windows Server + Hyper-V. Wivo tuleb **Linuxi VM-i** (Ubuntu
Server + Docker, isehostitud Supabase).

**Võrk:** püsiv IP, MikroTiku tulemüür, kahe asukoha vahel VPN. Arstid
kasutavad praegu RDP-d ja VPN-i. Alamdomeen nt `wivo.dentiks.lv`.

**Telefonid peavad ligi pääsema ka väljastpoolt kliinikut:** ainult port 443,
pöördproksi ja TLS (Let's Encrypt).

**Varukoopiad:** krüpteeritud koopia väljaspool kliinikut on **kohustuslik** —
UPS-i ja varunduse olukord on praegu teadmata.

---

## 2. VM-i spetsifikatsioon — see osa on Iljale

Üks VM, ainult Wivo jaoks. Numbrid tulevad docs/WORKFLOW-STAGES.md §6.5
mahuarvutusest (keskmine töö ~230 MB faile) ja sellest, et Postgres ja
failihoidla jooksevad samas masinas.

| Ressurss | Miks nii | Soovitus |
|---|---|---|
| **vCPU** | Postgres + ~8 konteinerit (API, auth, storage, realtime, värav) | **4 vCPU**, miinimum 2 |
| **RAM** | Postgres `shared_buffers` ~4 GB + konteinerid ~3 GB + varu | **16 GB**, miinimum 8 |
| **Süsteemiketas** | OS, Docker, konteineripildid, logid | **100 GB SSD** |
| **Andmebaasiketas** | eraldi ketas, et failid ei täidaks andmebaasi alt ära | **100 GB NVMe SSD** |
| **Failiketas** (`job-files`) | aasta 1 ~330 GB (120 tööd kuus), 3 aastat ~1 TB | **1 TB NVMe SSD**, kasvatatav |
| **Varundusmaht** | üks täiskoopia + 14 päeva juurdekasvu | **≥ 1,5 TB**, väljaspool seda serverit |

**Kolm asja, mis Hyper-V juures päriselt loevad:**

1. **NVMe SSD, mitte HDD.** Praegune masin on HDD peal. Postgres kirjutab
   sünkroonselt (`fsync`) ja HDD peal tähendab see 5–15 ms iga kinnitatud
   tehingu kohta — Wivo ei jookse kokku, ta muutub aeglaseks kohtades, mida
   keegi ei oska siduda kettaga.
2. **Fikseeritud VHDX, mitte dünaamiline**, vähemalt andmebaasi ja failide
   kettale. Dünaamiline kasvab kirjutamise ajal ja see kasv langeb kokku
   `fsync`-iga.
3. **Dynamic Memory VÄLJA** selle VM-i pealt. Postgres arvutab oma vahemälu
   käivitamisel olemasolevast mälust; ballooning võtab seda pärast ära ja
   tulemus on OOM koha peal, mida ei oska keegi oodata.

**UPS on nõue, mitte soovitus.** Postgres + ootamatu voolukatkestus +
puhverdav kettakontroller ilma patareita = rikutud andmebaas, mitte kaotatud
minut. Kui UPS-i olukord on teadmata, siis see on esimene asi, mis selgeks
tuleb teha — enne kolimist, mitte pärast.

---

## 3. Isehostitud Supabase: mis jookseb ja mis jääb välja

Ubuntu Server LTS + Docker Compose, Supabase'i enda `docker` komplekti pealt.

| Konteiner | Vaja? | Miks |
|---|---|---|
| `postgres` | **jah** | kogu Wivo |
| `postgrest` (REST) | **jah** | rakenduse päringud |
| `gotrue` (auth) | **jah** | sisselogimine, MFA |
| `storage-api` | **jah** | `job-files` |
| `realtime` | **jah** | teated ja vestlus tulevad reaalajas |
| `kong` (värav) | **jah** | üks sissepääs, üks koht päiseid lubada |
| `edge-runtime` | **jah** | **teenusevõti elab ainult Edge Functionides** (CLAUDE.md) |
| `postgres-meta` | jah | Studio vajab |
| `studio` | jah, **aga ainult seesmiselt** | halduskasutajaliides |
| `imgproxy` | **ei** | pildi teisendusi Wivo ei kasuta, eelvaated tehakse laadija masinas (sql/073) |
| `analytics` / `vector` | **ei alguses** | Logflare on raske; logid lähevad Dockeri omadesse |
| `supavisor` (pooler) | **ei** | üks rakendus, ühenduste arv on väike; Postgres otse |

**Studio ei tohi olla 443 taga avalikult.** Ta seotakse `127.0.0.1` külge ja
teda kasutatakse VPN-ist või SSH-tunnelist. Avalik Studio on administraatori
kasutajaliides internetis — sellel ei ole põhjendust.

### Võtmed

Pilves annab võtmed Supabase. Isehostitult teed sa need ise: üks **JWT
secret**, ja selle peal allkirjastatud **anon** ja **service_role** võti.

- Rakendusse läheb **ainult anon-võti** (CLAUDE.md), nagu praegu.
- **service_role jääb Edge Functionide keskkonda** ja mitte kuhugi mujale.
- JWT secret läheb paroolihaldurisse ja serveri `.env`-i, mille õigused on
  `600` ja mille omanik ei ole veebilehe kasutaja.
- **Uus anon-võti ja uus URL tähendavad uut litsentsi** (`--api`), vt §7.

---

## 4. Uuendused ilma Management API-ta

Täna käib migratsioon Kevini käe läbi Supabase SQL-redaktoris
(docs/MIGRATIONS.md). Isehostitud serveris seda redaktorit ei ole (Studio
oma on VPN-i taga, ja ta ei ole koht, kuhu 600 KB SQL-i kleepida).

**Mis asemele tuleb — sama asi, mis demos juba töötab:**

| Mis | Kuidas |
|---|---|
| **Skeem** | `psql -f` VPN-i kaudu, `ON_ERROR_STOP=1`, nagu docs/DEMO-SETUP.md §2 |
| **Edge Functions** | failid kaustas, mille `edge-runtime` külge haagib: kopeeri + taaskäivita konteiner. **Mitte `supabase functions deploy`** — see käib Management API kaudu, mida siin ei ole |
| **Konteinerite versioonid** | `docker compose pull && docker compose up -d`, üks teenus korraga, ja **enne seda varukoopia** |
| **Miinimumversioon** (`app_min_version`, docs/MIN-VERSION.md) | tabeli rida, läheb migratsiooniga kaasa nagu praegu |
| **Töölauarakenduse uuendus** | **ei muutu.** Ta tuleb GitHubi väljalaskest, mitte andmebaasist — isehostimine ei puutu seda |

**Mis selle juures päriselt muutub:** täna on andmebaasi uuendamine „Kevin
avab brauseri". Pärast kolimist on see „Kevin avab VPN-i ja jooksutab psql-i".
See on sama töö, aga ta nõuab ligipääsu, mis peab olema olemas ka siis, kui
Kevin on teises riigis. **Enne kolimist peab olema otsustatud, kellel on see
ligipääs ja kuidas** — see on ainus koht selles plaanis, kus tehniline valik
sõltub kokkuleppest, mitte seadistusest.

---

## 5. Varukoopiad

Ilma nendeta ei kolita. Kaks eri asja, mõlemad:

| Mis | Kuidas | Kui tihti | Kuhu |
|---|---|---|---|
| **Andmebaas** | `pg_dump -Fc` (kohalik), WAL-arhiiv kui PITR-i tahetakse | dump **iga 6 h**, hoiame 14 päeva | kohalik ketas + väline |
| **Failid** (`job-files`) | `restic` või `rclone` juurdekasvuga | **iga öö** | väline |
| **Konfiguratsioon** | `.env`, compose-failid, Kongi seaded, proksi seaded | iga muutuse järel | paroolihaldur + väline |

- **Krüpteerimine enne väljasaatmist**, mitte sihtkohas: `restic` (krüpteerib
  ise) või `age`. Võti **ei ela samas serveris** — muidu krüpteerib
  lunavaraga koos ka varukoopia.
- **Väline sihtkoht EL-is**, nt Hetzner Storage Box või Backblaze B2 (eu).
  Patsiendiandmed ei lahku EL-ist.
- **Taastamise proov iga kvartal**, teise masina peale, ja kirja saamise aeg.
  **Varukoopia, mida pole kordagi tagasi loetud, ei ole varukoopia** — see on
  selle peatüki ainus rida, mis päriselt loeb.
- Säilitus: 14 päeva juurdekasvu + üks kuukoopia 12 kuud. Rohkem ei ole mõtet,
  sest vanem andmebaas ei ole enam kasutatav skeemi tõttu.

---

## 6. HTTPS, mida telefonid vastu võtavad

**Soovitus: pöördproksi (Caddy) + Let's Encrypt, ainult port 443.**

Caddy, mitte nginx, ühel põhjusel: ta hoiab sertifikaati ise korras ja
uuendamine ei ole cron, mille katkimineku avastad 90 päeva pärast.

**Üks lõks, mis tuleb kohe otsustada:** Let's Encrypti **HTTP-01** väljakutse
vajab **porti 80** avatuna maailmale. Riia tahab ainult 443. Seega:

- **DNS-01 väljakutse** (Caddy räägib nende DNS-pakkujaga API kaudu) — **ainult
  443 jääb kehtima**, aga vajab DNS-pakkuja tokenit; **või**
- ava 80 ainult ACME jaoks ja suuna kõik HTTP → HTTPS. Lihtsam, aga see on üks
  port rohkem, kui kokku lepiti.

See valik sõltub sellest, kes nende DNS-i haldab — **küsimus Iljale**.

### Alternatiiv: ainult VPN, ilma avalikust pordist

| | Ainult 443 + TLS | Ainult VPN |
|---|---|---|
| **Telefon kliiniku väliselt** | töötab | töötab ainult siis, kui VPN on püsti |
| **Seadistus telefonis** | puudub | WireGuardi profiil igasse telefoni, ja keegi peab neid haldama |
| **Rünnakupind** | üks port, üks proksi, TLS | praktiliselt null |
| **Push-teated** | töötavad | **teade tuleb kohale, aga avamine nõuab VPN-i** — kasutaja kogemus on „teade tuli, äpp ei lae" |
| **Töölauaäpp kliinikus** | töötab | töötab |
| **Kui VPN katkeb** | ei puutu | kõik telefonid on maas korraga |
| **Riia enda praktika** | — | arstid juba kasutavad VPN-i ja RDP-d, nii et oskus on olemas |

**Soovitus: 443 + TLS, ja VPN sellele lisaks halduseks** (Studio, psql, SSH).
Põhjus on push: teade, mille avamine ei tööta, on halvem kui teate puudumine,
ja etapiteated on sammu 1 süda.

---

## 7. Wivo lahus veebilehest

**Oma VM, oma Postgres, oma konteinerid.** See ei ole mugavus:

- Veebilehe pluginad on kood, mida keegi meist üle ei vaata. WordPressi
  plugin, mis pääseb Wivo andmebaasi, on patsiendiandmete leke ühe
  automaatuuenduse kaugusel.
- **MikroTikus: veebilehe VM ei tohi jõuda Wivo VM-i Postgresi porti.**
  Lubatud suund on ainult väljast → Wivo proksi (443) ja haldusvõrk → Wivo
  (VPN).
- Üks Postgres kahele asjale on üks taastamine kahele asjale: veebilehe
  andmebaasi taastamine ei tohi puutuda Wivo oma.
- Maksed (hiljem) **ei ela Wivo VM-is** ega veebilehe VM-is, vaid
  teenusepakkuja juures — Wivo ei hoia kunagi raha (docs/VISION.md, lukus).

---

## 8. Kolimine pilvest serverisse

Eesmärk: **lühike seisak ja tagasitee olemas**. Failid on suur osa (sadu GB),
andmebaas väike (GB-d) — seepärast liiguvad nad eri ajal.

| # | Samm | Seisak |
|---|---|---|
| 1 | Server püsti, Supabase töötab, skeem jooksutatud (`psql -f`), tühi andmebaas | ei |
| 2 | **Failid esimest korda üle** (`rclone`, pilve S3 → serveri hoidla). Tunnid kuni päevad | ei |
| 3 | Litsents, mis lubab **mõlemat aadressi** (`--api <pilv>,<server>`) | ei |
| 4 | Proov: teine arvuti serveri aadressi peal, sisselogimine, töö, fail | ei |
| 5 | **Külmutamine.** Teade kliinikule: 1 h, ära salvesta | **algab** |
| 6 | `pg_dump -Fc` pilvest → `pg_restore` serverisse | ~10–20 min |
| 7 | **Failide vahe üle** (`rclone` juurdekasvuga, teine kord on kiire) | ~10 min |
| 8 | DNS `wivo.dentiks.lv` → server; rakenduste `.env`/seadistus serveri peale | ~5 min |
| 9 | Proov: sisselogimine, uus töö, failide avamine, telefon väljastpoolt | ~15 min |
| 10 | Lahti | **lõpeb**, kokku ~1 h |

**Tagasitee, ja see on nõue:**

- Pilveprojekt jääb **puutumata ja töös** (mitte kustutatud, mitte pausile)
  **vähemalt 7 päeva**. Tagasipöördumine on siis DNS + seadistus tagasi, ja
  kaotsi läheb see, mis nende 7 päeva jooksul serverisse kirjutati — seepärast
  ongi otsustamise aken lühike.
- **Litsents nimetab mõlemat aadressi juba enne kolimist**, nii et
  tagasipöördumine ei nõua uut litsentsifaili. Just selleks võtab `api` mitu
  aadressi (docs/MODULES-AND-RATINGS.md §1.2).
- Pärast 7 puhast päeva: pilveprojektist viimane dump arhiivi ja alles siis
  kustutada.

**Mis kolimise juures vaikselt katki läheb, kui ei mõelda:**

1. **Sisselogimised.** `auth.users` tuleb dumbiga kaasa, aga **MFA kirjed
   samuti** — kontrolli, et keegi ei pea autentimisrakendust uuesti
   seadistama. Kui peab, siis tea seda enne, mitte demo ajal.
2. **`sql/052` ajastatud arvete saatja** on pilves tootmise URL-i peale
   kirjutatud. Serveris on URL teine — `cron.unschedule` ja uuesti ajastada.
3. **Failide teed** `job_file.storage_path` sees peavad jääma samaks, muidu
   ükski vana fail ei avane. `rclone` hoiab teed; kontrolli ühe vana tööga.
4. **Edge Functionide keskkond** (service_role, VAPID, SMTP) tuleb käsitsi üle
   — neid dump ei kanna.
5. **Anon-võti muutub**, seega iga masin vajab uut seadistust. Töölauaäpp loeb
   seda build'ist: **see tähendab uut väljalaset või seadistusfaili**, ja see
   on asi, mis tuleb lahendada enne kolimist, mitte kolimise õhtul.

---

## 9. Mis on juba otsustatud ja see plaan ei vaidle vastu

- **Üks kliinik = üks andmebaas** (faas 1,
  docs/ARCHITECTURE-INSTANCES.md). Oma server muudab ainult seda, kelle masinal
  see andmebaas on.
- **Litsents kannab lubatud API aadressi** (docs/MODULES-AND-RATINGS.md §1.2).
  See ongi põhjus, miks ta sinna läks: `wivo.dentiks.lv` ei ole
  `*.supabase.co`.
- **Rakendus kasutab ainult anon-võtit**; service_role jääb Edge Functionide
  sisse. Isehostimine ei ole põhjus seda lõdvendada.
- **Patsiendiandmed ei lahku EL-ist** — see kehtib ka varukoopiate sihtkohale.

## 10. Avatud küsimused

1. **Kes haldab `dentiks.lv` DNS-i?** Sellest sõltub, kas Let's Encrypt saab
   DNS-01 (ainult 443) või on vaja porti 80 (§6).
2. **Mis on UPS-i olukord?** Ilma vastuseta ei saa kolimise kuupäeva kokku
   leppida (§2).
3. **Kellel on pärast kolimist psql-ligipääs** ja kuidas ta selle saab, kui
   Kevin ei ole Lätis (§4).
4. **Kas serveris on varundus juba olemas** (Veeam vms), mille külge Wivo VM-i
   haakida, või ehitame varunduse Wivo VM-i sisse (§5)?
5. **Mitu tööd kuus Riia päriselt teeb?** Failiketta suurus tuleb sellest
   numbrist (§2, docs/WORKFLOW-STAGES.md §6.5).
