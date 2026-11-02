# Wivo partnerivõrk — ehitusspekk

## Kuidas seda kasutada

See spekk on mõeldud Claude Code'ile. Loe see enne koodi kirjutamist tervikuna läbi.

1. Enne iga faasi loe olemasolev kood läbi ja kirjelda, mis on juba olemas. Poolikule alusele ei ehitata.
2. Ehita üks faas korraga. Faas on valmis, kui selle vastuvõtukriteeriumid on täidetud ja testid läbivad.
3. Iga skeemimuudatus on uus SQL-migratsioonifail. Olemasolevaid migratsioone ei muudeta ja andmeid ei kustutata ilma küsimata.
4. Iga uus tabel saab samas migratsioonis `org_id` ja RLS-i ning samas muudatuses lekketesti.
5. Kui spekk ja kood lähevad vastuollu, peatu ja küsi.
6. Lukus otsuseid allpool ei muudeta.

## Kontekst ja eesmärk

Wivo (Electron + React + TypeScript, Supabase/Postgres) haldab hambalabori ja kliiniku töövoogu: tööd, etapid ja tahvel, töötasud, rahandus, arved, patsiendid, kalender. Nüüd lisandub kahe kliiniku koostöö.

- **Töövoog:** Tallinn skaneerib (intraoraalne skann, fotod, röntgen). Riia teeb tehnikutöö ja printfailid. Tallinn prindib ja märgib töö valmis. Riia võib võtta ka patsiente vastu (suunamine).
- **Riial on oma organisatsioon:** oma kasutajad, tööd ja statistika. Tallinnaga seob neid partnerlus: jagatud tööd (täielik või osaline nähtavus) ja ühendatud ladu (Riia komisjonikaup Tallinna laos).
- **Mida see asendab:** WhatsApp ja jagatud kaustad. Failid, staatused ja teavitused on ühes kohas.
- **Hostitud mitme organisatsiooni instants.** Software-only kliendid jäävad oma Supabase'i ja partnerlust neil pole.

Kui faasid 0–4 on valmis, on see **Wivo 2.0**, turuvalmis versioon.

## Lukus otsused ja piirid

**MDR: Wivo on haldustööriist**

- Wivo ei soovita, ei järjesta ega tuleta ravi patsiendi andmete, piltide ega leidude põhjal.
- Raviplaani moodul on arsti hinnakalkulaator: arst valib hambad, materjalid ja toonid, Wivo arvutab hinnad.
- Pildivaatajad on ainult kuvamiseks. Mõõtmist ega diagnoosi jaoks mõeldud pilditöötlust ei ole.
- Partnerit ei nimetata kasutajaliideses "tootjaks". Kasuta "disainer" või "tehnik".

**Privaatsus**

- **Kliinikute vahel ei liigu isikuandmeid üle piiri** (juristi otsus, 2. november 2026). Partnerorganisatsioon näeb ainult töö andmeid, mitte kunagi seda, kes on patsient. See kehtib igas kanalis: vaated, RPC-d, failid, teavitused, e-kirjad, kommentaarid ja jagatud visiidikirjed.
- Juhtumil on kaks tüüpi: **laboritöö** ja **suunamine**. Mõlemal on partneril osaline nähtavus. Täielik nähtavus on välja lülitatud (sql/092). Suunamine nõuab endiselt märget "patsient teavitatud ja nõustus" koos sellega, kes märkis ja millal. Suunatud patsient toob oma andmed ise kaasa (patsiendi eksport).
- Partner ei näe patsiendi nime, isikukoodi, kontakte, sünnikuupäeva (ainult vanust), ravikaarti ega visiite.
- Vaba tekst, mida partner loeb (töö kirjeldus ja väljad, kommentaarid, chat, jagatud visiidikirjed), ei tohi sisaldada patsiendi ees- või perenime ega isikukoodi. Andmebaas keeldub salvestamast ja partnerile näidatakse sellised sõnad varjatuna.
- Jagatud töö failidelt eemaldatakse enne üleslaadimist kõik peidetud andmed: kogu EXIF, DICOM-i patsiendiandmed, STL-i nimi ja päis, PLY/OBJ kommentaarid. Fail nimetatakse töö koodi järgi. PDF-i, foto ja röntgeni lisamisel jagatud tööle küsitakse kinnitust (nägu, pildi sisse põletatud nimi).
- Partner ei näe kunagi patsiendihindu ega teise organisatsiooni rahandust.
- **Ladu partnerile** (Kevini otsus, 3. november 2026): partner näeb teise organisatsiooni laos ainult **oma komisjonikaupa** ja ainult siis, kui partnerluses on `share_stock` sees. Ta näeb kogust, partiid, säilivusaega, kasutatud ja alles olevat kogust kokkuvõttena. Ta ei näe kunagi teise organisatsiooni enda kaupa ega seda, millisel tööl või millise patsiendi juures kaupa kasutati. `share_stock`-i lülitab sisse ja välja kumma tahes poole omanik ning see logitakse mõlema poole auditilogisse.
- Andmed on EL-is: Supabase Iirimaal (eu-west-1), varundus Hetzneris Helsingis. Varundust käivitatakse EL-i serverist, mitte GitHub Actionsist.
- **Admin-konsool ei näe patsiendiandmeid.** Ainult äriandmed: kliinikud, kontod, moodulid, arved, failimaht, vead. Tugi pääseb kliiniku andmetesse ainult kliiniku nõusolekul, ajutiselt ja iga kord logituna.
- **Veateates ei ole vaikimisi ekraanipilti**, sest sellel on peaaegu alati patsiendi nimi.

**Tehnilised reeglid**

- Rakenduses on ainult anon-võti. Service-role võti on ainult Edge Function'ites.
- Iga õigus jõustatakse andmebaasis (RLS või RPC), mitte ainult kasutajaliideses. See kehtib ka tasuliste moodulite kohta.
- Migratsioonid on SQL-failid.
- Faile ei kustutata päriselt: pehme kustutamine ja versioonid.

**Keel**

- Arenduskeel on inglise: kood, andmebaas, kasutajaliidese tekstid ja kõik uued funktsioonid. Inglise on lähtekeel.
- Kõik kasutajaliidese tekstid käivad i18n-võtmete kaudu. Teksti otse koodi ei kirjutata.
- Eesti ja vene keel on tõlked, mida täiendatakse hiljem. Kui tõlge puudub, näidatakse inglise teksti.
- Keel on kasutaja seade. Organisatsioonil on vaikekeel. Riia: põhikeel inglise, teisesed vene ja eesti.
- Keel ja riigipõhised reeglid on eraldi. Ingliskeelne kasutajaliides ei muuda Eesti arvete ja KM-i nõudeid.

**Sisselogimine**

- Kahefaktoriline sisselogimine käib autentimisrakendusega (TOTP): Google Authenticator, Microsoft Authenticator või paroolihaldur. SMS-i ei kasutata.
- "Sign in with Google" ei ole kahefaktoriline sisselogimine ega asenda seda.
- Adminkontodel on riistvaravõti.

**Äri**

- Seadistustasu 900 € kliiniku kohta. Põhilitsents 50 € konto kohta kuus. Moodulid lisatasuga, hinnad seadistatavad, mitte koodis.

## Arhitektuur ja infra

Kõik hostitud organisatsioonid on ühes Supabase'i projektis ja RLS hoiab need lahus.

| Osa | Lahendus | Märkus |
| --- | --- | --- |
| Andmebaas, auth, failid, reaalaeg, serveriloogika | Supabase Pro, Iirimaa (eu-west-1), olemasolev projekt. Praegused andmed saavad Tallinna organisatsiooniks | Failid Storage'is, üleslaadimine TUS-iga |
| Testkeskkond | Eraldi Supabase'i projekt | Migratsioonid ja lekketestid enne tootmist |
| Failide varukoopia | Hetzner Object Storage, Helsingi | Versioonimine ja objektilukk |
| Varunduse käivitaja | Väike Hetzner Cloud VM | Öine `rclone sync` failidele ja `pg_dump` andmebaasile |
| Kolmas koopia | Kaks krüpteeritud välist ketast | Kord kvartalis, kettad vahetuvad, üks hoitakse väljaspool kontorit. Taastamise test kettalt |
| E-post | Resend, kutsutakse Edge Function'ist | Kirjas ainult töö kood ja link, mitte patsiendiandmed |
| Vigade jälgimine | Sentry | Vead püütakse automaatselt, patsiendiandmed filtreeritakse enne saatmist välja |
| Klient arvutis | Electron (Tallinn ja Riia) | Kaustajälgija skanneri ekspordikaustale |
| Klient telefonis | PWA Cloudflare Pages'is (Faas 1b) | Samad React-komponendid: minu tööd, kaamera, chat |
| Admin-konsool | Väike veebileht Cloudflare'is + Edge Functions | Eraldi sisselogimine riistvaravõtmega, ainult koondandmed |

## Andmemudel

Uued tabelid seotakse olemasoleva tööde tabeliga (`jobs`). Kõigil on `org_id`, välja arvatud seal, kus organisatsiooni määrab seos. Täpsed nimed ja tüübid sobita olemasoleva skeemiga.

**Organisatsioon ja partnerlus**

| Tabel | Põhiveerud | Märkus |
| --- | --- | --- |
| `organization` | id, name, country, default\_language, created\_at | Olemasolevad andmed migreeritakse Tallinna organisatsiooni alla |
| `org_member` | org\_id, user\_id, role (owner, admin, doctor, technician, assistant), language | Üks kasutaja kuulub ühte organisatsiooni |
| `partnership` | id, org\_a, org\_b, share\_stock, default\_visibility, status | Kahe organisatsiooni vaheline seos |
| `job_share` | job\_id, owner\_org, partner\_org, case\_type (lab\_work, referral), visibility (partial, full), role (design, surgery, supplier), assigned\_stages, consent\_by, consent\_at | Tekib automaatselt, kui partnerile määratakse etapp |
| `stage_transition` | from\_stage, to\_stage, actor (owner, partner) | Lubatud liikumised etappide vahel |

Organisatsiooni id on globaalselt unikaalne UUID ja organisatsioonil on väli `home_instance`. Nii töötavad partnerlused ja jagatud tööd hiljem ka eri instantside vahel ilma id-sid ümber tegemata.

**Failid, suhtlus ja logi**

| Tabel | Põhiveerud | Märkus |
| --- | --- | --- |
| `job_file` | id, job\_id, org\_id, type (scan, photo, xray, print, design, other), version, is\_active, sha256, size, storage\_path, uploaded\_by, uploaded\_at, deleted\_at | Fail `org/job/file-id`, failinimi asendatakse töö koodiga |
| `job_comment` | id, job\_id, author, body, file\_id, is\_question, resolved\_at | Ehitatakse olemasoleva chat-funktsiooni peale (Faas 0) |
| `notification` | id, user\_id, job\_id, kind, read\_at | Kanalid kasutaja seadetes |
| `audit_log` | id, org\_id, user\_id, action (view, download, share, stage\_move), object, at | Ainult lisamine, mitte muutmine |

**Ladu**

| Tabel | Põhiveerud | Märkus |
| --- | --- | --- |
| `stock_item` | id, owner\_org, location\_org, category (implant, abutment, bone, other), manufacturer, system, size, lot, expiry\_date (kohustuslik), consignment\_due, qty, min\_qty | Komisjonikaup: owner\_org ≠ location\_org |
| `stock_movement` | id, item\_id, kind (in, use, reserve, release, return, buy, adjust), qty, job\_id, by, at, reason | Laoseis tuleneb liikumistest |
| `inventory_schedule` | org\_id, interval, next\_due | Seadistab organisatsioon |
| `inventory_count` + read | id, org\_id, started\_at, finished\_at, by; item\_id, expected, counted, diff\_reason | Erinevus ainult põhjusega |

**Moodulid ja raviplaan**

| Tabel | Põhiveerud | Märkus |
| --- | --- | --- |
| `module_price` | module, scope (org, seat), price | Hinnad andmebaasis, mitte koodis |
| `org_module` | org\_id, module, active\_from, active\_to | Statistika, ladu, lisafailimaht |
| `seat_module` | user\_id, module, active\_from, active\_to | Raviplaani kalkulaator |
| `treatment_package` | id, patient\_id, created\_by, status (draft, presented, chosen, booked), total | Üks patsient, mitu paketti |
| `treatment_package_line` | package\_id, tooth (FDI), procedure, material, shade, stock\_category, price | Hind hinnakirjast, käsitsi muudetav |
| `booking` | package\_id, fee, paid\_at, appointment\_id | Makse käivitab broneeringu ja tellimuse |

**Ravikaart**

| Tabel | Põhiveerud | Märkus |
| --- | --- | --- |
| `visit_note` | id, org\_id, patient\_id, visit\_id, author, general\_text, created\_at, signed\_at | Visiidi üldine sisu. Pärast allkirjastamist ainult täiendused |
| `visit_tooth_entry` | id, note\_id, tooth (FDI), surface (M, O, D, B, L), procedure, text | Mis sellel hambal tehti. Hamba ajajoone alus |
| `visit_note_amendment` | id, note\_id, entry\_id, author, body, reason, created\_at | Parandused, algne jääb alles. `entry_id` tühi, kui parandus puudutab üldist sisu |
| `visit_note_share` | entry\_id, job\_id | Kirje, mida partner näeb töö juures |
| `job_file.teeth` | hammaste loend failil | Röntgen ja fotod hamba ajajoonele |
| `patient_component` | id, patient\_id, site (FDI), type (implant, abutment, bone\_graft, sinus\_lift), stock\_item\_id, manufacturer, system, size, lot, placed\_at, placed\_by, external | Tekib laost kasutamisel automaatselt või käsitsi |
| `prosthesis` | id, patient\_id, type (crown, bridge, full\_arch, denture), sites, component\_ids, material, job\_id | Üle mitme asukoha, seotud implantaatidega |
| `tooth_state_event` | id, patient\_id, site, layer (crown, root), state, source (entry, job, stock), created\_at | Kaardi seis on viimane sündmus |

**Platvorm (ainult admin-konsool)**

| Tabel | Põhiveerud | Märkus |
| --- | --- | --- |
| `platform_admin` | user\_id, role, mfa\_required | Eraldi tavalistest kasutajatest |
| `license` | id, org\_id, key\_id, issued\_at, expires\_at, revoked\_at | Software-only kliendid, olemasolev Ed25519 süsteem |
| `platform_invoice` + read | id, org\_id, period, seats, modules, storage\_gb, setup\_fee, total, vat\_mode, status, paid\_at | Genereeritakse `org_member`-ist, `org_module`-ist ja failimahust |
| `bug_report` | id, org\_id, user\_id, app\_version, screen, message, recent\_errors, screenshot\_path, status, created\_at | Ekraanipilt ainult siis, kui kasutaja selle ise lisab |
| `usage_daily` | org\_id, date, active\_users, module\_events, storage\_gb, app\_version | Ainult loendurid, mitte patsiendiread |
| `admin_audit_log` | id, admin\_id, action, target\_org, at, reason | Iga admin-tegevus |

Kliinikute äpp neid tabeleid ei näe. RLS keelab ligipääsu kõigile peale admin-konsooli Edge Function'ite.

## Õigused ja nähtavus

Riia näeb oma organisatsioonis kõike oma. Tallinna andmetest näeb Riia ainult jagatud töid ja, kui `share_stock` on sees, oma komisjonikaupa Tallinna laos, ning vastupidi.

- **RLS igal tabelil.** Kasutaja näeb oma organisatsiooni ridu. Partneri jagatud tööd tulevad ainult vaate `partner_job_view` kaudu.
- **`partner_job_view`.** Tuletab vanuse, soo ja FDI hambakaardi. Identiteedivälju ei ole üldse, ka suunamisel (täielik nähtavus on välja lülitatud, sql/092). Patsiendihindu ei ole kummalgi juhul, partneri enda hind (disainitasu) on nähtav.
- **Otsing.** Läbib sama vaate. Partner otsib töö koodi järgi.
- **Etapid.** Liigutamine käib ainult RPC `move_job_stage` kaudu, mis kontrollib `stage_transition`-it ja partneri määratud etappe. Teisi etappe näeb partner lugemiseks.
- **Töö väljad.** Partner ei muuda neid. Muudatus käib "Küsimuse" kaudu.
- **Failid.** Storage'i RLS samade reeglitega. Partner laeb üles ainult tüüpe print ja design. Kustutada ei saa, ainult laadida üles uue versiooni. Allalaadimine käib RPC kaudu, mis loob lühiajalise lingi ja auditirea.
- **Muudatused.** Revision pärib jagamise originaaltöölt.
- **Moodulid.** Funktsioon `has_module(org, module)` või `has_seat_module(user, module)` RLS-is ja RPC-des. Puuduva mooduli korral annab ka otse API kutse vea.

**Üks ligipääsukiht.** Partner pääseb jagatud töödele alati ainult `partner_job_view` ja RPC-de kaudu, mitte otse tabelitest. Nii saab hiljem lisada kahe eraldi andmebaasi vahelise vahendusinstantsi ilma kasutajaliidest ümber kirjutamata.

## Faas 0: eelkontroll

Enne uut koodi tee kindlaks, et alus on terve.

- [ ] **Chat-funktsioon.** Inventeeri olemasolev kood (tabelid, UI, reaalaeg) ja kirjelda, mis töötab ja mis on pooleli. Lõpeta see või eemalda. Faas 1 kommentaarid ja küsimused ehitatakse selle peale.
- [ ] **Migratsioonid.** Värske andmebaas ehitub testkeskkonnas migratsioonidest nullist, ilma käsitsi sammudeta.
- [ ] **RLS-i audit.** Igal tabelil on RLS ja Security Advisor ei näita vigu.
- [ ] **Viis põhikaitset:** võrgupiirangud ja SSL, juhtpaneeli MFA, kasutajate MFA ja lekkinud paroolide kaitse, service-role võtit äpis pole.
- [ ] **i18n vundament.** Inglise on lähtekeel. Olemasolevad eestikeelsed tekstid viiakse i18n-võtmetesse eesti tõlkeks ja neile lisatakse inglise tekst. Enne seda uusi funktsioone ei ehitata, et keeled ei läheks segamini.

* [ ] **Taastamise test praeguste andmetega.** Viimane andmebaasi varukoopia ja failid taastatakse testkeskkonda. Kontrolli, et äpp töötab ning ridade ja failide arvud klapivad. Nii on teada, kas praegused varukoopiad üldse töötavad.

**Vastuvõtt:** kirjalik raport (mis on olemas ja mis puudu), puhas migratsioon testkeskkonnas, Security Advisor ilma vigadeta. Kasutajaliides töötab inglise ja eesti keeles ning koodis pole ühtegi otse kirjutatud kasutajaliidese teksti.

## Faas 1: partnerlus, failid, teavitused

Pärast seda faasi saab koostöö päriselt alata.

**Organisatsioonid ja jagamine**

- [ ] `organization`, `org_member`, `partnership`, `job_share`. Olemasolevad andmed lähevad Tallinna organisatsiooni alla.
- [ ] "Lisa uus töö" vormis: etapi määramine partnerile (nt "Disain: Riia") loob `job_share`-i. Juhtumi tüüp (laboritöö või suunamine), suunamisel nõusoleku märge.
- [ ] `partner_job_view`, otsing ja menüü piirang jagatud töödel.
- [ ] `move_job_stage` + `stage_transition`. Partner liigutab oma etapi edasi, olemasolev "›" nupp kaardil on üleandmine.
- [ ] "Küsimus" lipuna kaardil, mitte uue veeruna.

**Partnerluse loomine**

Kutse kood üksi ei anna ligipääsu millelegi. Partnerlus tekib alles siis, kui mõlema kliiniku admin on kinnitanud.

1. Kliinik A admin (MFA-ga sisse logitud) loob Seaded → Partnerlused all kutse: ühekordne kood, kehtib 7 päeva, seotud kliinikuga A. Andmebaasis hoitakse ainult koodi räsi.
2. Kood edastatakse väljaspool Wivot, näiteks telefoniga või e-kirjaga.
3. Kliinik B admin sisestab koodi oma Wivos ja näeb, kes kutsub: kliiniku nimi, riik, registrikood. Valesti sisestatud koodide arv on piiratud.
4. B valib tingimused: kas ladu jagatakse, vaikimisi nähtavus, rollid (disain, kirurgia, tarnija), viide allkirjastatud andmetöötluslepingule.
5. A kinnitab tingimused ja partnerlus muutub aktiivseks. Andmeid ei liigu enne, kui konkreetne töö jagatakse.
6. Kumbki pool saab partnerluse peatada või lõpetada. Pärast lõpetamist uusi töid jagada ei saa ja varem jagatud tööd jäävad partnerile kokkulepitud ajaks ainult lugemiseks.
7. Iga samm läheb auditilogisse. Esialgu kinnitab uue partnerluse ka Wivo admin.

Uus tabel: `partnership_invite` (id, org\_id, code\_hash, expires\_at, used\_at, attempts, created\_by).

**Failid**

- [ ] `job_file`, privaatne bucket, TUS-üleslaadimine taustajärjekorras, SHA-256, versioonid, pehme kustutamine.
- [ ] Eelvaated: STL-ist PNG, fotodest pisipilt.
- [ ] Üleslaadimisel kliendi poolel: DICOM-i päise puhastus, fotodelt EXIF-i GPS-i eemaldamine, failinimi asendub töö koodiga.
- [ ] Kaustajälgija Electronis: skanneri ekspordikaust → "Sorteerimata" → töö külge.

* [ ] Patsiendi eksport: nupp "Ekspordi patsiendile" teeb PDF-i (patsient, tööd, raviplaanid) ja ZIP-i tema failidest. Allalaadimine logitakse.

**Suhtlus ja teavitused**

- [ ] Kommentaarid ja küsimused töö juures chat-funktsiooni peal, fotod lõimes muudatusettepanekuteks.
- [ ] Teavitused: reaalajas märgid, e-kiri Resendi kaudu (ainult kood ja link). Saadetakse üleandmisel teisele poolele, kanalid valib kasutaja.
- [ ] Auditilogi.

**Muu**

- [ ] Keeled: inglise põhikeel, vene tõlge Riia jaoks, eesti tõlge olemasolevast.
- [ ] Tehniku töötasu suurelt töö juures (olemasolevast reeglimootorist).
- [ ] MFA kõigile kasutajatele.

**Veateated**

- [ ] Nupp "Teata veast": saadab kaasa versiooni, organisatsiooni, ekraani nime, kirjelduse ja viimased vead. Ekraanipilt ainult siis, kui kasutaja selle ise lisab.
- [ ] Teade salvestub `bug_report` tabelisse ja Kevin saab e-kirja.
- [ ] Sentry Electronis: vead püütakse automaatselt, patsiendiandmed filtreeritakse enne saatmist välja.

**Vastuvõtt**

- Riia testkasutaja ei saa API kaudu kätte ühtegi Tallinna rida ega faili, mida pole jagatud. Seda kontrollib automaatne test.
- Osalise nähtavuse vastuses pole nime, isikukoodi, sünnikuupäeva ega hindu.
- Partner ei saa lukus etappi liigutada ka otse RPC kutsega.
- 200 MB skann jätkab üleslaadimist pärast võrgukatkestust.
- Uus jagatud töö tekitab Riias märgi ja e-kirja vähem kui minutiga.
- Veateade jõuab `bug_report` tabelisse ja Kevini postkasti. Ekraanipilti pole, kui kasutaja seda ise ei lisanud.

## Faas 1b: telefon (PWA)

Lihtne telefonivaade neile, kes ei istu arvuti taga: pilt või sõnum töö külge mõne sekundiga. See ei ole täis-Wivo.

- [ ] PWA samast React-koodibaasist, majutus Cloudflare Pages'is. Sama Supabase'i sisselogimine ja MFA.
- [ ] Avaleht: minu tööd (määratud või aktiivsed) ja otsing koodi järgi.
- [ ] Töö vaade: põhiinfo, failid, chat.
- [ ] Kaamera: pildista otse töö külge. Pilt läbib sama GPS-i eemaldamise ja failinime asenduse ning ei salvestu telefoni galeriisse.
- [ ] Chat: sama töö lõim mis arvutis, sõnum, foto ja küsimuse märge.
- [ ] Push-teavitused (iPhone'is pärast avaekraanile lisamist), e-kiri varuks.
- [ ] Lühem sessioon telefonis ja kaugväljalogimine kadunud telefoni puhul.

* Telefonis ei ole: tahvlit, ladu, rahandust, arveid ega admin-funktsioone.

**Vastuvõtt**

- Telefonis tehtud pilt jõuab töö külge ja teise poole teavitusse vähem kui minutiga.
- Pilti ei jää telefoni galeriisse (kontrolli iPhone'is ja vähemalt kahe Androidi kaameraäpiga).
- Partner näeb telefonis sama piiratud vaadet mis arvutis, sest kehtib sama RLS.

## Faas 2: ladu ja inventuur

Laoseis tuleneb alati liikumistest, mitte käsitsi muudetavast arvust.

- [ ] `stock_item` ja `stock_movement`. Kategooriad: implantaat, abutment, luumaterjal, muu.
- [ ] Käsitsi lisamisel on säilivusaeg ja partii kohustuslikud.
- [ ] **Komisjon:** kui omanik ja asukoht erinevad, on komisjoni tähtaeg vaikimisi 3 kuud. Kuu enne tähtaega muutub kaup punaseks. Tegevused: kasuta, tagasta, osta välja.
- [ ] Kasutus töö juures vähendab laoseisu ja seob partii töö (ja seeläbi patsiendiga).
- [ ] Kui `share_stock` on sees, näeb partner oma komisjonikaupa teise organisatsiooni laos: kogus, partii, säilivusaeg, kasutatud ja alles, ainult kokkuvõttena. Teise organisatsiooni enda kaupa ta ei näe, ka siis mitte, kui `share_stock` on sees. Kui `share_stock` on väljas, ei näe ta midagi. (Lukus otsus, vt „Privaatsus“.)
- [ ] Miinimumkoguse hoiatus.
- [ ] **Inventuur:** organisatsioon seadistab sageduse. Tähtaja saabudes on ülevaatel suur punane riba. Loendusvaade näitab oodatud ja loendatud kogust, erinevus salvestub koos põhjusega, ajalugu jääb alles.

**Vastuvõtt**

- Kaupa ilma säilivusajata ei saa salvestada.
- Komisjonikaup on kuu enne tähtaega punane.
- Inventuuri erinevus muudab laoseisu ainult koos põhjusega.
- Kui `share_stock` on sees, näeb Riia Tallinna laos olevat Riia kaupa, aga mitte kunagi Tallinna oma kaupa ega seda, millisel tööl Riia kaupa kasutati. Kui `share_stock` on väljas, ei näe Riia Tallinna laost midagi.

## Faas 3: moodulid, arveldus ja admin-konsool

Iga moodul on lüliti, mida jõustab andmebaas, mitte ainult peidetud nupp.

- [ ] `module_price`, `org_module`, `seat_module`, `has_module()`, `has_seat_module()`.
- [ ] Moodulid:
  - põhilitsents (konto kohta),
  - statistika (organisatsiooni kohta),
  - ladu (organisatsiooni kohta),
  - lisafailimaht (organisatsiooni kohta, 100 GB hinna sees),
  - raviplaani kalkulaator (konto kohta).
- [ ] Kuuarve: kontod × põhilitsents + moodulid + failimaht üle limiidi. Seadistustasu 900 € kord. EL-i ettevõttele pöördmaksustamine.
- [ ] Partneri kuukoond: valminud jagatud tööd × kokkulepitud hind. Hiljem lisanduvad boonuse ja korrektsiooni read.

**Admin-konsool**

- [ ] Eraldi veebileht ja eraldi sisselogimine riistvaravõtmega MFA-ga. Leht räägib ainult Edge Function'itega, mis tagastavad koondandmeid.
- [ ] Kliinikud: kontode arv, aktiivsed moodulid, failimaht, viimane tegevus, Wivo versioon.
- [ ] Moodulite sisse- ja väljalülitamine kliiniku või konto kaupa. Muutus jõuab järgmise kuu arvele.
- [ ] Automaatsed kuuarved: iga kliiniku jaoks seadistatakse saatmise päev ja saajad. Arve read ja hinnad tulevad automaatselt kontodest, moodulitest ja failimahust, PDF läheb e-kirjaga välja. Esimestel kuudel tekib arve mustandina kinnitamiseks, seejärel saadetakse automaatselt. Makse staatus ja seadistustasu.
- [ ] Litsentsid: software-only klientide võtmete väljastamine, pikendamine ja tühistamine.
- [ ] Veateated ja Sentry vead ühes nimekirjas, staatusega (uus, töös, parandatud).
- [ ] Kasutus: moodulite loendurid `usage_daily` põhjal.
- [ ] Iga admin-tegevus läheb `admin_audit_log`-i.
- [ ] Toe ligipääs kliiniku andmetesse ainult kliiniku nõusolekul, ajaliselt piiratud ja logitud. Vaikimisi seda ei ole.

**Organisatsiooni eksport ja lahkumine**

Kliinik peab saama oma andmed igal ajal kaasa võtta, näiteks oma Supabase'i. Volitatud töötlejana on see GDPR-i järgi niikuinii kohustus.

- [ ] Eksport admin-konsoolist: ühe organisatsiooni kõik read (`org_id` järgi) ja failid (`org/` prefiks) ühes pakis koos manifestiga (ridade arvud, failide räsid). Pakk imporditakse puhtasse sama versiooniga Wivo instantsi.
- [ ] Ringtest kord kvartalis: eksport → import tühja testkeskkonda → arvude ja räside võrdlus.
- [ ] Jagatud tööd kuuluvad omanikorganisatsioonile. Lahkuja võtab kaasa oma tööd. Teise poole töödest jääb talle ainult see, mida partnerlusleping lubab.
- [ ] Pärast kinnitatud ülekannet kustutatakse andmed tootmisest kokkulepitud aja jooksul.
- [ ] Kustutusregister: organisatsioon, kuupäev, mis kustutati. Varukoopiast taastamisel rakendatakse register uuesti enne, kui taastatud andmed tootmisse lähevad.

* [ ] **Esimene ringtest Tallinna päris andmetega** kohe, kui eksport on valmis. Päris andmed leiavad äärejuhud, mida testandmed ei leia. Testkeskkonnal on siis samad ligipääsupiirangud mis tootmisel ja see puhastatakse pärast testi.

Varukoopiaid ei muudeta. Lahkunud kliiniku andmed aeguvad neist säilitusaja järgi, mis on kirjas andmetöötluslepingus:

| Koopia | Säilitusaeg |
| --- | --- |
| Supabase'i päevased varukoopiad | 7 päeva |
| Hetzneri versioonid ja objektilukk | 90 päeva |
| Välised kettad | 4 viimast kvartalit |

Lahkunud kliiniku andmed kaovad viimasest koopiast hiljemalt 12 kuuga ja seni ei taastata neid kunagi tootmisse.

**Vastuvõtt**

- Puuduva mooduli korral annab ka otse API kutse vea.
- Arve summa vastab kontode, moodulite ja failimahu arvule.
- Hinna muutmine `module_price`-is muudab järgmise kuu arvet ilma koodimuudatuseta.
- Admin-konsooli ükski vastus ei sisalda patsiendivälja. Seda kontrollib automaatne test.
- Tavakasutaja ei pääse platvormi tabelitele ligi ka otse API kaudu.

## Faas 4: ravikaart, raviplaani kalkulaator ja broneerimistasu

**Ravikaart hammaste kaupa**

Eesmärk: hamba 26 kogu ajalugu avaneb ühe klõpsuga, ilma kogu ravilugu läbi kerimata.

- [ ] Visiidi märge koosneb kahest osast. **Hammaste kirjed:** iga kirje on üks hammas (valitakse FDI-kaardilt või kirjutades `#26`), valikuliselt pind (M, O, D, B, L) ja protseduur, ning tekst selle kohta, mis sellel hambal tehti. **Visiidi üldine sisu:** vaba tekst kogu visiidi kohta.
- [ ] Hamba ajalugu: patsiendi profiilil hamba valimine näitab kohe ainult selle hamba kirjeid ajajoonel, uusim üleval. Juures on selle hamba tööd, röntgenid ja fotod, kasutatud implantaadid ja abutmendid partiiga ning raviplaanid.
- [ ] Iga kirje juures "Ava kogu visiit", mis näitab terve visiidi kõiki hammaste kirjeid ja üldist sisu.
- [ ] Otsing ja filtrid: hamba, pinna, protseduuri, arsti ja kuupäeva järgi.
- [ ] Kiirsisestus: salvestatud laused ja eelmise visiidi märke kopeerimine.
- [ ] Allkirjastatud märget ei muudeta. Parandus lisatakse täiendusena koos põhjuse ja autoriga ning algne jääb nähtavaks.
- [ ] Partner ei näe ravikaarti. Arst saab üksiku kirje tööga jagada ("Jaga tööga") ja partner näeb siis ainult seda kirjet.

**Hambakaart kihtidena**

- [ ] Igal hamba asukohal on kaks kihti. **Kroon:** terve, täidis, kroon, sillalüli, puudub. **Juur:** terve, juureravitud, puudub, implantaat.
- [ ] Implantaat, abutment ja luu (siirik, siinuse tõstmine) märgitakse asukohale komponendina: tootja, süsteem, mõõt, partii, kuupäev, kes paigaldas.
- [ ] Automaatne: kui laost kasutatakse töö või visiidi juures hambaga implantaati, abutmenti või luumaterjali, tekib komponent sellele asukohale ise ja kaardil on kohe implantaat.
- [ ] Mujal tehtud tööd lisatakse käsitsi märkega "tehtud mujal", detailid valikulised.
- [ ] Sild ja täiskaar (nt All-on-4) seotakse oma implantaatidega, sest implantaadid ei ole alati samadel kohtadel kui proteesi hambad.
- [ ] Kaardi seis tuleneb ajaloost: iga muutus on sündmus, nii et hamba ajajoonel on näha ka, millal juur asendus implantaadiga.

* Ajajoon ainult kuvab andmeid. Kokkuvõtteid ega soovitusi ei genereerita (MDR-i piir).

**Vastuvõtt (ravikaart)**

- Hamba kogu ajalugu avaneb ühe klõpsuga.
- Allkirjastatud märke muutmise katse loob täienduse, mitte ei kirjuta üle.
- Partneri API vastuses pole ühtegi ravikaardi märget peale tööga jagatute.

**Raviplaani kalkulaator ja broneerimistasu**

Arst koostab vastuvõtul paketid, patsient valib, makstud broneerimistasu lukustab kõik ülejäänu.

- [ ] `treatment_package` ja read: hammas (FDI), protseduur, materjal, toon, laokategooria, hind. Ühele patsiendile mitu paketti.
- [ ] Hind tuleb hinnakirjast, arst saab seda käsitsi muuta. Kogusumma arvutatakse jooksvalt.
- [ ] Esitlusvaade patsiendile: paketid kõrvuti, ekraanil ja PDF-ina.
- [ ] Patsient valib paketi → `booking`, broneerimistasu vaikimisi 500 € (seadistatav).
- [ ] Makse märgitakse saadud → aeg kalendris kinnitub, paketi implantaadid broneeritakse laost (`reserve`), materjal läheb tellimisele.
- [ ] Broneeritud kaupa ei saa igapäevatöös kasutada.
- [ ] **MDR-i piir:** ainult hinnaloogika. Kliinilisi reegleid ega soovitusi ei ole.

**Andmed tulevase arendusmootori jaoks**

- [ ] Iga valitud paketi juures struktureeritud otsuse põhjus ühe valikuna: patsiendi eelarve, kliiniline põhjus, patsiendi eelistus, esteetika, muu. Vaba teksti ei kasutata.
- [ ] Tulemus seotakse tööga: ümbertegemine koos põhjusega (olemas), tüsistus, järelkontroll.
- [ ] Patsiendi nõusoleku väli "andmeid tohib kasutada tarkvara arendamiseks anonümiseeritult", koos kuupäeva ja märkijaga. Vaikimisi väljas.
- [ ] Andmeid arenduseks ei kasutata enne, kui õiguslik alus ja kliinikutega leping on paigas.

* Mootor, mis ise ravi soovitab, on meditsiiniseade. See tuleb eraldi tootena, mitte Wivo osana.

**Vastuvõtt**

- Maksmata pakett ei broneeri laost midagi.
- Makstud broneering lukustab kauba ja kinnitab aja.
- Broneeringu tühistamine vabastab kauba (`release`) ja logib põhjuse.

## Sounds

The sound system exists (`src/renderer/src/lib/sound.ts`, files in
`src/renderer/public/sounds/`, settings per device in Seaded → Interface). A
sound never carries information on its own: each one accompanies a badge, a
notification or a visible change. Call `playSound(name)` where the visible
event happens.

| Sound | Event | Phase |
|---|---|---|
| `notify-new-work` | A job shared with us, or files added to a shared job by the other side (a print file ready, a photo from the phone) — **wired** (notifications `job_shared`, `files_added`, sql/090) | 1, 1b (done) |
| `notify-handoff` | A stage handed over to our side — **wired** (notification `stage_handover`) | 1 (done) |
| `notify-stock-warning` | Stock under its minimum, or consignment goods turning red a month before they are due | 2 |
| `notify-booking-confirmed` | A booking fee is marked paid and the appointment is confirmed | 4 |
| `ui-tab`, `ui-tick` | Registered and wired (tabs; sliders and number steppers); play once their recordings exist | — |
| `ui-move` | Recording exists; not yet wired (a card moved with the ‹ › buttons) | — |

The phone app (1b) reuses the same service and files.

## Hiljem

Neid ei ehitata enne, kui faasid 0–4 on valmis.

- **Hinnangud ja boonused.** Arst ja tehnik hindavad teineteist töö kaupa. Oma töötajatel läheb boonus töötasu reeglimootorisse, partnerile hinnakorrektsioonina kuukoondi. Mahaarvamine ainult objektiivsel alusel (ümbertegemised põhjuste kaupa) ja lepingu järgi. Hindamisaken sulgub enne töötasude külmutamist.
- **Ladu automaatselt.** Täiendamine kasutuse statistika järgi, arve kasutamisel.
- **Statistika moodul.** Organisatsiooni oma statistika ja jagatud tööde ühisvaade: maht, läbimisajad, ümbertegemised, materjalikulu.
- **Telefoni lisad.** QR-kood töölehel, mis avab töö telefonis otse, ja "Sorteerimata" postkast.
- **Vaatajad.** 3D (STL/PLY) ja 2D röntgen, ainult kuvamiseks.
- **Skanneri pilve integratsioon**, kui skanner on teada.
- **Itaalia keel**, kui kõik muu on valmis.
- **Raviplaani AI-mootor.** Eraldi toode MDR-i sertifitseerimise teel, mitte Wivo osa. Wivo kogub selleks struktureeritud andmeid (Faas 4).
- **Patsiendiportaal.** Alles koos pentestiga. Patsient näeb oma profiili ja annab nõusoleku andmete jagamiseks. Vajab tugevat isikutuvastust (Smart-ID, Mobiil-ID, ID-kaart).
- **Kliinikupõhised krüptovõtmed failidele.** Võtme kustutamine muudab lahkunud kliiniku failid loetamatuks kõigis koopiates korraga.
- **Vahendusinstants** (partnerivõrgu keskus) kliinikutele eri instantsides. Keskus hoiab ainult partnerluste registrit ja jagatud töid (partnerile nähtavad väljad + failid). Iga instants ühendub sellega allkirjastatud päringutega oma võtmepaariga. Keskuse API on versioneeritud, sest instantsid võivad olla eri Wivo versioonidel. Asub EL-is ja on mõlema kliiniku volitatud töötleja.

## Testimine

Lekketest on väljalaske tingimus: kui see kukub läbi, väljalaset ei tehta.

- **RLS-i lekketestid.** Testkeskkonnas on kaks testorganisatsiooni. Iga tabeli ja bucketi kohta kontrollitakse, et org B kasutaja ei saa org A ridu lugeda ega muuta. Testid jooksevad iga migratsiooni järel.
- **API enesekontroll.** Riia testkasutaja tokeniga tehakse otse PostgREST-i ja Storage'i kutsed Tallinna andmete pihta. Kõik peavad tagastama tühja vastuse või vea.
- **Admin-piir.** Test kontrollib, et admin-konsooli Edge Function'id ei tagasta ühtegi patsiendivälja ja et tavakasutaja token ei pääse platvormi tabelitele.
- **Varundus.** Öine sünk ja kord kvartalis taastamise test testkeskkonda (andmebaas + failid, failide räside võrdlus).
- **Faaside vastuvõtt.** Iga faasi kriteeriumid on selle faasi all.

## Avatud küsimused

Need vastab Kevin, mitte Claude Code. Kuni vastust pole, kasuta sulgudes olevat vaikevalikut.

- [ ] Milline intraoraalne skanner ja mis ekspordiformaat? (Kaustajälgija toetab STL, PLY ja OBJ faile.)
- [ ] Kui palju kasutajaid ja milliste rollidega on Riias? (5: arst, koordinaator, 3 tehnikut.)
- [ ] Kas vene tõlge peab olema valmis Riia käivitusel? (Käivitus inglise keeles, vene tõlge esimese kuu jooksul.)
- [ ] Broneerimistasu tagastamise tingimused. (Juristi otsus. Seni tühistamine vabastab kauba ja tasu märgitakse käsitsi.)
- [ ] Mida peab statistika moodul Riia jaoks sisaldama?
- [ ] Lao ja lisafailimahu hinnad. (Ladu 50 €, lisafailimaht 10 € 100 GB kohta.)

* [ ] Kas Riia jääb ühisesse hostitud instantsi või soovib oma Supabase'i projekti? (Ühine instants, eraldatus RLS-iga.)
* [ ] Mis on õiguslik alus raviplaani andmete kasutamiseks arenduses ja kuidas see kliinikutega lepingusse läheb? (Kuni vastuseni andmeid arenduseks ei kasutata.)

- [ ] Kas Wivo asendab kliinikus Dentase või täiendab seda? Kui asendab, tuleb enne ravikaardi ehitamist selgeks teha tervise infosüsteemi (TIS) andmete saatmise kohustus ja ravidokumentide säilitusajad. (Seni täiendab.)
