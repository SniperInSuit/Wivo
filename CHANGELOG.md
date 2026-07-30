# Changelog

## [1.7.1] — 2026-07-30
**Käivita järjekorras:** `sql/012_profiles.sql`, `sql/013_auth_rls.sql`, `sql/014_clinics.sql`, `sql/015_add_clinic_id.sql`, `sql/016_clinic_rls.sql` (Wivo kinni enne).

**Autentimine — rakendus nõuab nüüd sisselogimist**
- E-posti + parooli põhine registreerimine ja sisselogimine
- Esimene kasutaja saab automaatselt `owner` rolli, järgnevad `worker`
- Profiili nimi salvestatakse andmebaasi (mitte enam localStorage)
- Märkuste autorid tulevad nüüd autenditud profiilist
- Väljalogimine TopBar-ist (LogOut nupp)
- Parooli silma ikoon registreerimisel
- Seadete leht näitab profiili nime, e-posti ja rolli

**Kliiniku seadistus — omaniku esimene sisselogimine avab häälestusviisardi**
- Kliiniku nimi, aadress, linn, postiindeks
- Telefon, e-post
- Registrikood, KMKR number
- Pank ja IBAN
- Kõik olemasolevad tööd, patsiendid ja visiidid seotakse automaatselt kliiniku külge

**Andmete isoleerimine — iga kliinik näeb ainult oma andmeid**
- `clinic_id` lisatud tööde, patsientide ja visiitide tabelitele
- RLS poliitikad filtreerivad kõik päringud `clinic_id` järgi
- `my_clinic_id()` abifunktsioon Postgresis
- Kõik loomispäringud lisavad automaatselt `clinic_id`

---

## [1.7.0] — 2026-07-30
**Käivita:** `sql/012_profiles.sql`, `sql/013_auth_rls.sql` (Wivo kinni enne).

Autentimise alus. Rakendus nõuab sisselogimist; anonüümne ligipääs ei tööta enam.

---

## [1.6.30] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Muudatuste põhjused**
- Iga muudatus (revision) saab nüüd `reason` välja — 9 valmis valikut: Vale disain, Vale värv, Vale materjal, Vale hammas, Halb passivus, Purunemine, Patsiendi soov, Arsti soov, Muu
- Põhjuse valik muudatuse vormis (roosad nupud)
- Põhjuse badge kokkusurutud muudatuse real
- **Statistika**: "Muudatuste põhjused" kaart koos tulpdiagrammiga

---

## [1.6.29] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Muudatuste määr töötüübi järgi** — uus statistika kaart
- Horisontaalsed progressi ribad: roheline (<25%), kollane (25-50%), punane (>50%)
- Protsent ja suhtarv (nt 2/8)

---

## [1.6.28] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Top patsiendid — kaks värvi**
- Violetne = originaal hambad, roosa = muudatuste hambad
- Tooltip näitab jagunemist

---

## [1.6.27] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Hambad töötüübi järgi — kaks värvi**
- Tsüaan = originaal hambad, roosa = muudatuste hambad (stacked bars)
- Töötüübi nimed kasutavad nüüd `workTypeLabel()` (mitte enam `too.split(' ')[0]`)
- Tooltip näitab originaal vs muudatuste arvu

---

## [1.6.26] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Käive töö liigi järgi — originaal + muudatused**
- Näitab nüüd `8× + 2m` (8 originaaltööd + 2 muudatust)

---

## [1.6.25] — 2026-07-30
Andmebaasi muudatusi ei ole.

- Eemaldatud duplikaat "Uus töö" nupp ülevaatest (TopBar-il on juba üks)

---

## [1.6.24] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Nädalavaade — fikseeritud kellaajad + vahed nädalate vahel**
- Kellaajad jäävad vasakule kohale horisontaalselt kerides
- 6px vahe nädalate vahel

---

## [1.6.23] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Nädalavaade — sujuv kerimine ilma hüpeteta**
- Eemaldatud CSS snap mis põhjustas hüppamist
- `onWeekChange` debounce (150ms) et vältida tagasiside tsüklit

---

## [1.6.22] — 2026-07-30
Andmebaasi muudatusi ei ole.

- Nädalavaate libistaja feedback-tsükli parandus

---

## [1.6.21] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Nädalavaade — libistaja tagasi**
- Horisontaalne libistaja mis sünkroniseerib kerimisega

---

## [1.6.20] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Nädalavaade — pidev horisontaalne kerimine**
- 27 nädalat (±13) renderdatakse kõrvuti
- Keritav peidetud scrollbar-iga
- Noolenupud ja "Jooksev nädal" animeerivad sujuvalt

---

## [1.6.19] — 2026-07-30
Andmebaasi muudatusi ei ole.

- Eemaldatud välimine scrollbar kuuvaates — legend on alati nähtav

---

## [1.6.18] — 2026-07-30
Andmebaasi muudatusi ei ole.

- Nädalavaate libistaja 364 sammu (päeva kaupa, mitte nädala kaupa)

---

## [1.6.17] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Kuukalender — pidev kerimine**
- Kuuvaade renderdab nüüd ±3 kuud keritava ribana (mitte üks kuu korraga)
- Kuude nimed ilmuvad inline päistena
- Automaatne kerimine tänaseni laadimisel
- Vertikaalne libistaja eemaldatud (kerimine piisab)

---

## [1.6.16] — 2026-07-30
Andmebaasi muudatusi ei ole.

- Kuuvaate vertikaalne libistaja — nüüd nädala kaupa (mitte kuu kaupa)

---

## [1.6.15] — 2026-07-30
Andmebaasi muudatusi ei ole.

- Kuuvaate libistaja sujuvam (600 positsiooni)

---

## [1.6.14] — 2026-07-30
Andmebaasi muudatusi ei ole.

- Kuuvaate libistaja vertikaalseks (paremal küljel), 360px pikk

---

## [1.6.13] — 2026-07-30
Andmebaasi muudatusi ei ole.

- Kuuvaate alla libistaja ±3 kuud

---

## [1.6.12] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Nädalavaade — libistaja + drag-select kestus + kuupäev**
- Horisontaalne libistaja nädala vahetamiseks (±26 nädalat)
- Ajavahemiku lohistamine annab õige kestuse visiidi vormile
- Päeva numbri järel kuunumber (nt 30.07)

---

## [1.6.11] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Nädalavaade — lohistades visiidi loomine**
- Klõpsa ja lohista ajavahemiku valimiseks
- Tsüaan overlay näitab valitud vahemikku ajatemplidega
- Hiire vabastamisel avaneb visiidi vorm eeltäidetud alguse ja kestusega

---

## [1.6.10] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Visiitide ajajoon — uuendatud**
- Visiitide kaardid vasakule joondatud (mitte keskele) — vasakserv = algusaeg
- Hilinenud visiidid (5+ min pärast algust, saabumata) kuvatakse punaselt märkega "hilines"

---

## [1.6.9] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Visiitide ajajoon — uus disain**
- Tunnimärgid punktide ja katkendjoontega
- Visiidi algus- ja lõpupunktid rööpal
- Praegune aeg vertikaalne joon kogu kõrguses
- Ühendusjooned rööpast kaartideni

---

## [1.6.8] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Projekti ümbernimetamine: Workly → Wivo**
- Nimi, ikoon ja branding muudetud kõikjal
- Uus logo `src/renderer/src/assets/Wivo Logo.png`
- Sidebar kasutab päris logo pilti
- `package.json`: nimi `wivo`, appId `com.wivo.dental`, productName `Wivo`
- Electron build icon `build/icon.png`
- localStorage võtmed uuendatud

---

## [1.6.7] — 2026-07-30
Andmebaasi muudatusi ei ole.

- Versiooninumber parandatud (vahepealsed muudatused polnud versioonitud)

---

## [1.6.6] — 2026-07-30
Andmebaasi muudatusi ei ole.

- Tabel: vahelduvad read `#f0f4f6` (mitte läbipaistev)

---

## [1.6.5] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Töö detailvaade — navy taust**
- Lugemisvaate keritav ala nüüd `bg-nav-bg`
- Kõik kaardid (TÖÖ ANDMED, TOOTMISE ANDMED jne) `bg-bg-card`
- Ajajoon liigutatud keritava ala sisse ümardatud kaardina
- Jalus navy taustaga
- Variandi vahetaja valge/läbipaistev navy-l

---

## [1.6.4] — 2026-07-30
**Käivita:** `sql/011_job_disain_id.sql`

- Disain ID väli tööle (Print ID kõrval)

---

## [1.6.3] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Navy Cloud teema uuendused**
- TopBar ja kalendri päis navy taustaga, valge tekst
- Kalendri päis täislaiuses (sidebar paremal pool allpool)
- Ajajoon ühendatud parempaneeli ülaservaga
- Taust staatiline (sama värv kui navigatsioonibaar)
- Legend ja nupud valge tekstiga

---

## [1.6.2] — 2026-07-30
Andmebaasi muudatusi ei ole.

- Eemaldatud duplikaat "Muuda" nupp töö detailvaate jalast
- Tähtaeg näitab nüüd kellaaega (mitte enam kärbitult)

---

## [1.6.1] — 2026-07-30
**Käivita:** `sql/010_job_kirjeldus.sql`

- Kirjeldus (description) väli originaaltööle (muudatustel oli juba)
- CSV import toetab kirjelduse veergu

---

## [1.6.0] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Statistika — kolm uut plokki andmete kohta, mida seni ei mõõdetud**
- **Visiidid**: visiite kokku, **ei tulnud %**, keskmine visiidi kestus, tühistatud. Ei-tulnud protsent arvutatakse ainult nendest visiitidest, mida oodati — tühistatud on nimetajast välja jäetud, sest tühistatud aeg oli teada, ilmumata jäetud aeg läks raisku
- **Visiidid nädalapäeva järgi** (tulpdiagramm) — millal on päriselt kiire
- **Visiitide seis** ribadena: planeeritud / saabunud / toimunud / ei tulnud / tühistatud
- **Kust töö tuleb**: top suunavad arstid käibe järgi. Arst tuleb patsiendi kaardilt, sest seal seda hoitakse — see näitab, kes sulle päriselt tööd saadab
- **Käive töö liigi järgi** koos keskmise hinnaga liigi kohta. Kasutab sama liigitust, mida kalender — mitte enam `too` välja esimest sõna
- **Patsiendid**: patsiente kokku, uusi perioodil, korduvad patsiendid ja korduvuse protsent

**Seaded — üheksa uut valikut, mis kõik olid varem koodis kinni**
- **Kalender**: nädalavaate algus- ja lõputund (oli 09–18 fikseeritud), ajajoone algus- ja lõputund (oli 07–19), lohistamise samm (oli 15 min), visiidi vaikimisi kestus (oli 30 min)
- **Hinnad → Automaatarvutus**: vaikimisi hind hamba kohta (oli 15 €), muudatuse hind hamba kohta (oli 8 €), kiirtöö kordaja (oli ×2)
- Need ei olnud seadistatavad, mis tähendas, et rakendus eeldas ühe kindla labori tööpäeva ja hinnakirja

## [1.5.1] — 2026-07-30
Andmebaasi muudatusi ei ole.

- **Nädalavaate ruudustikul on nüüd üleval ja all ruumi** (16 px / 20 px). Varem olid 09:00 ja 18:00 sildid ruudustiku täpsel serval ja lõikusid pooleks, ning 09:00 visiit istus vastu päisejoont
- Kogu paigutus — sildid, tunnijooned, visiitide plokid, kellaajajoon ja lohistamise eelvaade — arvutatakse ühest funktsioonist, nii et nihe kehtib kõigile korraga ja miski ei jää teistest maha
- **Klõpsu ja lohistamise kellaaeg arvutatakse ikka ruudustiku enda piires**, mitte polsterduse sees: ülemisse serva klõps annab 09:00, mitte 08:45
- **Pikk visiit lõpeb 18:00 juures**, mitte ei ulatu alumisse polsterdusse

## [1.5.0] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Nädalavaade visiitidele**
- Kalendri **Visiidid** vaates on nüüd lüliti **Kuu / Nädal**. Kuu on nagu varem; nädal on uus
- **Nädalavaade on vertikaalne ajaruudustik** 09:00–18:00, seitse päevaveergu kõrvuti. Visiit on plokk, mille kõrgus vastab kestusele — nii on kohe näha, kes tuleb kelle järel ja kui tihe päev on
- **Lohistamine muudab aega ja päeva**: võta visiit ja vii teise kellaaega või teise päeva. Kukkumiskoht näitab kellaaega ette, aeg klapsub 15 minuti sammu. Kestus jääb samaks
- **Topeltklõps tühjal alal** lisab visiidi sellele kellaajale
- **Kattuvad visiidid jagavad veeru laiust** — kaks 09:00 saabujat seisavad kõrvuti, mitte üksteise peal
- Punane joon näitab praegust kellaaega tänase päeva veerus
- Nädalate vahel liikumine noolte või „Jooksev nädal" nupuga — mugav, kui on vaja mõni visiit ümber tõsta
- Legend vahetub koos vaatega: nädalavaates näitab see visiidi seise, mitte tootmisetappe, sest tootmine ei ole seal ekraanil

**Miks lüliti on ainult Visiidid vaates:** Kombineeritud vaates on juba horisontaalne ajajoon, mis vastab samale küsimusele tänase päeva kohta. Sama asja kaks korda samal lehel ei aita

## [1.4.2] — 2026-07-30
Andmebaasi muudatusi ei ole.

- **Patsiendi profiilil on nüüd VISIIDID paneel** — kogu selle patsiendi visiitide ajalugu, uuemad ees: kuupäev, kellaaeg, suunav arst, kestus, märkus ja staatus
- **Järgmine planeeritud visiit on eraldi esile tõstetud** paneeli ülaosas — see on ainus rida, mida on vaja enne kui ülejäänud ajalugu lugema hakkad
- **„N× ei tulnud kohale"** hoiatus, kui patsiendil on ilmumata jätmisi — see on muster, mida tasub näha enne järgmise aja kokkuleppimist
- Visiidi klõps avab sama paremalt libiseva vormi, mida kalender kasutab — üks vorm, üks koht kus valideerimine elab
- **„Lisa visiit" profiililt täidab patsiendi ette ära** (koos suunava arstiga tema kaardilt), nii et profiililt loodud visiit ei saa jääda sidumata ega sattuda vale inimese alla
- Visiidid leitakse `patient_id` järgi või nime järgi neil, mis on kirja pandud enne sidumist — sama vaste, mida tööde ajalugu juba kasutab
- Kui `sql/007_visits.sql` pole käivitatud, näitab paneel seda, mitte tühja kohta

## [1.4.1] — 2026-07-30
Andmebaasi muudatusi ei ole.

- **„Lisa visiit" avaneb nüüd paremalt libiseva paneelina**, mitte keskele hüppava aknana. Keskele tsentreeritud aken jooksis väiksema akna korral ekraanilt välja; nüüd on see sama käitumine nagu töödel
- **Patsiendi profiili saab avada visiidi ja töö juurest**:
  - visiidi paneelis nupp „Ava patsiendi profiil" patsiendivälja all
  - kalendri paremas paneelis väike nool visiidi patsiendi nime kõrval
  - töö kaardil (vaatamisrežiimis) „Ava profiil" patsiendi all
- Profiili avamine sulgeb enne avatud paneelid — need on ekraani külge kinnitatud ja kataksid muidu just avatud lehe
- Töö puhul, mis on imporditud ja millel `patient_id` puudub, leitakse patsient nime järgi — sama vaste, mille alusel tema tööde ajalugu juba koostatakse
- Kui visiit või töö ei ole ühegi patsiendikaardiga seotud, siis nuppu ei kuvata, vaid seisab selgitus „Vali nimekirjast patsient, et profiili avada" — sidumata nimel ei ole profiili, mida avada

## [1.4.0] — 2026-07-30
**Käivita `sql/009_visit_status.sql`** Supabase SQL-redaktoris (Wivo kinni). Olemasolevad visiidid jäävad puutumata — kõik kolm senist staatust kehtivad edasi.

**Visiidil on nüüd viis staatust ja üheklõpsu nupud**
- Uued staatused: **Saabunud** (patsient on kohal praegu) ja **Ei tulnud** (ei ilmunud)
- **„Ei tulnud" ja „Tühistatud" on teadlikult eraldi.** Mõlemad tähendavad „ei toimunud", aga ilmumata jätmise korral seisab valmis töö endiselt pingil ja ootab kedagi, tühistamise korral on pink vaba. Ainult üks neist nõuab sinult järgmist sammu
- **Kontekstuaalsed nupud** paremas paneelis, mitte viit nuppu korraga: planeeritud → *Saabus · Ei tulnud · Tühista*; saabunud → *Üle antud · Tühista*; lõpetatud olekust → *Taasta*
- Iga staatus on värviga: planeeritud hall, saabunud türkiissinine, toimunud roheline, **ei tulnud kollane** (mitte punane — see ei ole tühistamine, vaid lahtine asi), tühistatud punane
- Staatus on nähtav kolmes kohas: paneeli kaardil sildina, kuu ruudustikus rea vasakul serval, ajajoonel täpi värvina ja hover-kaardil
- **Saabunud visiit loeb ajajoonel alati „praeguseks"**, sõltumata kellaajast — kui inimene on kohal, siis ta on kohal
- Päeva kokkuvõte näitab nüüd ka „Saabunud / üle antud" ja „Ei tulnud" arvu
- Nupuvajutuse viga kuvatakse paneelis, mitte ei kao vaikselt ära

**Miks mitte rohkem staatusi:** „Kinnitatud" jäeti välja, sest see on registratuuri mõiste — üksi töötav tehnik ei uuenda seda kunagi. „Ümber tõstetud" jäeti välja, sest kuupäeva muutmine ütleb seda juba ise.

## [1.3.2] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Parandus: etapi värvi muutmine ei jõudnud kõikjale.** Alates 1.1.7-st sai etapi värvi muuta, aga neli kohta joonistasid endiselt vanast Tailwindi klassist, mis jäi külmunud vana värvi peale:
- **Tahvli veeru pealkirjariba** (see, mille sa üles leidsid — täpp muutus, riba mitte)
- Tabeli etapifiltri nupud
- Tabeli hulgimuutmise etapinupud
- Muudatuse vormi staatusenupud

Kõik neli joonistavad nüüd etapi hex-värvist. Muudetud värv rakendub kohe kogu rakenduses.

**Ennetus**: `PipelineStage` tüübis on `color`, `bg` ja `border` nüüd selgelt märgitud pärandväljadeks koos põhjendusega, miks neist joonistamine katki läheb. Need on alles ainult selleks, et enne 1.1.7 salvestatud töövoog localStorage'is edasi loeks — ainus tõene värv on `hex`

## [1.3.1] — 2026-07-30
Andmebaasi muudatusi ei ole.

- **Kalendri töökaardil on nüüd kaks eraldi värvikanalit**: vasak serv näitab **etappi** (kui kaugel töö on), pehme täidis näitab **töö liiki** (mis tööd see on). Varem kandsid mõlemad etapi värvi, mistõttu valmis kuu oli ühtlane roheline sein ja Krooni ei olnud Sildade seast võimalik eristada
- **Töö liik on nüüd kaardi esimene rida** ja patsient teine — nii leiab konkreetse töö kiiremini üles
- Töö liigi värvid: Kroon, Implantkroon, Sild, Viniir, Laminaat, Inlay, Onlay, Täidis, Proteez, All-on-X, Kaitse/splint, Retainer, IBT, Kirurgiline, Muu. Tuvastamine käib `too` välja sisu järgi, sest see on vabatekst — „Allon4 ülemine" ja „Abutmendile kroon" lähevad õigesse rühma
- **Legend on nüüd kahel real** ja ütleb, mida kumbki kanal tähendab: „Serv = etapp" ja „Täidis = töö". Liikide real on ainult need liigid, mis sellel kuul päriselt esinevad
- **Tähtaja ületamine muudab ainult serva punaseks**, täidis jääb töö liigi omaks — nii ei kaota hilinenud töö oma liigi märgistust
- Parema paneeli töö real on nüüd sama liigivärvi täpp, nii et paneel ja ruudustik on omavahel loetavad

## [1.3.0] — 2026-07-30
Kalendri ümberkujundus ja **uus olem: visiidid**.

**Enne kasutamist käivita Supabase SQL-redaktoris (Wivo kinni), kaks eraldi päringut:**
1. `sql/007_visits.sql` — tabel `visits` koos RLS-poliitikaga
2. `sql/008_visits_realtime.sql` — reaalajas sünkroniseerimine (vabatahtlik)

Ilma 007-ta töötab kalender edasi, aga visiitide osa näitab veateadet ja „Lisa visiit" ei salvesta.

**Visiidid — uus olem**
- Visiit on patsiendi saabumine: algusaeg, kestus minutites, suunav arst, märkus ja staatus (planeeritud / toimunud / tühistatud)
- Seni sai kalender näidata ainult tööde tähtaegu — visiiti ei olnud kuskil, nii et „Visiidid" ei olnud filtreeritav, loendatav ega lisatav
- Visiit ei kuulu tööde külge: mõlemad on seotud **patsiendi kaudu**, nii et tühistatud visiit ei puuduta kunagi tootmisandmeid
- Patsiendi valimisel täidetakse suunav arst tema kaardilt, aga jääb visiidi kaupa muudetavaks

**Kalender**
- **Vaate lüliti**: Tööd · Visiidid · Kombineeritud (vaikimisi kombineeritud)
- **Visiitide ajajoon** kuu vaate kohal: horisontaalne rööbas 07:00–19:00, hõljuvad kaardid, liikuv türkiissinine kellaajajoon. Hover näitab patsienti, kestust ja linki töödele
- **Kuu ruudustik**: igal päeval visiitide ja tööde loendur; visiidid alati üleval, tootmine allpool, katkendjoon vahel
- **Tööd on värvitud etapi järgi**, mitte töö tüübi järgi — ja etapi värvid tulevad sinu enda töövoost (Seaded → Töö etapid), nii et brief'i värvikaart on asendatud sinu omaga
- **Parem detailipaneel** (320 px): valitud päeva visiidid (kellaaeg, arst, patsient, kestus, „Vaata töödele"), tööd (etapp, tähtaeg, masin), päeva kokkuvõte ja nupud „Lisa visiit" / „Lisa töö". Päeva valimata olekus sõbralik tühiolek
- **Päeva klõps** uuendab paremat paneeli, modaali ei ava. **Topeltklõps** tööl avab töö, visiidil visiidi
- **Tühjad päevad**: „0 visiiti · 0 tööd", hoveril „+ Lisa visiit" ja „+ Lisa töö"
- **Legend** all: etapid sinu värvidega, punane „Tähtaeg möödas", hall „Visiit"

## [1.2.0] — 2026-07-30
Ülevaate (dashboard) täielik ümberkujundus. Andmebaasi muudatusi ei ole.

**Päeva ajajoon — uus keskne element**
- Horisontaalne päevavaade 07:00–19:00 ühel rööpal, vertikaalset kalendrit ega tunniridu ei ole
- Iga ajahetk on rööpa küljes hõljuv kaart: kellaaeg, suunav arst, tööde arv. Kaardid vahelduvad kahes reas, nii et lähestikku olevad ajad ei kattu
- **Praegune kellaaeg** on türkiissinine vertikaaljoon koos kellaaja sildiga; rööbas on kulunud osa ulatuses värvitud. Uueneb iga minut, nii et joon liigub päeva jooksul päriselt edasi
- Kaardi seisund: valmis → hall, järgmine tulemas → türkiissinine äär, tähtaja ületanud → punane toon
- Hover näitab patsientide nimed, tööd ja etapid; klõps avab töö
- Nooltega saab liikuda eelmisele/järgmisele päevale

**KPI-rida**: Tööd kokku, Tähtaeg täna, Hambaid toodetud, Arveldamata — kahel esimesel ja kolmandal nädalane muutus (võrdlus eelmise nädalaga)

**Kolm kaarti**: Tööde seis (sõõrdiagramm etappide kaupa, etapi enda värvidega), Täna tähtsad tööd, Viimased tegevused

**Alumine olekuriba**: masinad pooleliolevate tööde kaupa, materjalide arv hinnakirjas, tootmises olevate tööde arv, tänased tähtajad ja versioon

**Külgriba**
- Külgriba saab nüüd laiendada (sildid ikoonide kõrval) või minimeerida (ikoon peal, silt all) — nupp „Minimeeri" all servas, valik salvestub
- Ülaribale lisandus tehniku nimi ja initsiaalid Seadetest

**Teema**
- Navy Cloud kasutab nüüd täpselt brief'i värve: **#16284B → #0F1D3A**, gradient tumeneb paremale alla

## [1.1.7] — 2026-07-30
Andmebaasi muudatusi ei ole.

- **Töövoo etapi värvi saab nüüd muuta**, mitte ainult nime: Seaded → Töö etapid, klõpsa etapi ees olevat värvitäppi. 18 valmisvärvi pluss „Oma värv" vabaks valikuks
- Uus värv rakendub kohe kõikjal: staatuse siltidel, töö kaardi staatusevalikul, tootmise ajajoonel, tahvli veergudel ja patsiendi tööde ajaloo ridade värvilisel serval
- Valik salvestub localStorage'i koos ülejäänud töövooga

**Tehniline**
- Staatuse silt joonistatakse nüüd etapi hex-värvist (taust ~12% toon, tekst sama värv), mitte Tailwindi klassipaarist — kasutaja valitud värv ei saa kunagi olla Tailwindi klass, nii et klassidele tuginemine oli see, mis vabalt valitavat värvi takistas

## [1.1.6] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Seaded on nüüd omaette leht**
- Seaded avaneb külgriba nupust täisleheks, mitte enam paremalt sisse libisevaks paneeliks
- Lehel on vasakul jaotiste menüü (Üldine: Profiil, Kasutajaliides · Töö ja tootmine: Töö etapid, Masinad, Hinnad) ja paremal kaardid kahes veerus
- Menüüs on ainult päriselt olemasolevad jaotised — tühja lingi taha ei ole midagi pandud

**Kaks uut teemat**
- **Navy Cloud** — tume mereväesinine gradient, mis tumeneb paremale alla, ja heledad „pilvised" kastid selle peal
- **Cloudy Navy** — vastupidine: hele pilvine gradient taustal, tumedad mereväesinised kastid
- **Hele** jääb vaikimisi teemaks. Vali Seaded → Kasutajaliides, eelvaade näitab tausta ja kasti kohe
- Valik salvestub localStorage'i ja rakendub enne esimest joonistamist, nii et käivitamisel ei vilgu vale teema

**Tehniline**
- Kõik värvitokenid on nüüd CSS-muutujad RGB-kanalitena, nii et olemasolevad läbipaistvuse klassid (`border-ink-faint/15`, `bg-accent/10`) töötavad teemat vahetades edasi
- Külgribal on oma värvitokenid (`nav`, `nav-bg`), sest Navy Cloudis on riba tume, aga kaardid heledad — sama token ei saa mõlemat teenindada

## [1.1.5] — 2026-07-30
Andmebaasi muudatusi ei ole — uusi migratsioone ei ole vaja.

- **Tööde märkused peegelduvad patsiendi Märkuste kastis**, koos töö sildiga (nt `NK-2026-01`). Sildile klõpsates avaneb see töö ja märkus tõstetakse esile ning keritakse vaatesse
- Loend on ühtne ajajoon: patsiendi enda märkused ja tööde märkused segamini, uuemad ees
- **Peegeldus käib lugemise teel, mitte kopeerimise teel**: märkus jääb töö juurde ja seda loetakse sealt. Nii ei saa kaks koopiat lahku minna
- Patsiendilehel saab kustutada ainult patsiendi enda märkusi — töö märkust muudetakse ja kustutatakse töö kaardil, kus see asub. Sellest on ka väike selgitus kasti all

## [1.1.4] — 2026-07-30
Kaks parandust. **Käivita `sql/006_patient_tmj.sql`** (Wivo kinni enne) — ilma selleta ei salvestu ravikaart.

**Ravikaart ei salvestunud**
- Puudus veerg `patients.lougaliiges`. Väli „Lõualiiges" eraldati „Hambumusest" versioonis 1.1.1 ja veerg lisati faili `sql/003`, mis oli juba käivitatud — käivitatud migratsiooni muutmine ei tee andmebaasis midagi. Seetõttu saatis salvestamine tundmatu veeru, Postgres lükkas päringu tagasi (42703) ja **kogu ravikaardi salvestus ebaõnnestus**, mitte ainult see üks väli
- Uus migratsioon `sql/006_patient_tmj.sql` lisab veeru. `sql/003` on taastatud sellisena, nagu see käivitati
- Reegel edaspidi: iga muudatus saab uue migratsioonifaili, juba käivitatud faili ei muudeta kunagi

**Töö märkused ei paistnud salvestuvat**
- Märkus salvestus tegelikult andmebaasi korrektselt, aga paneel kuvas vana koopiat: paneel hoidis töö objekti sellisena, nagu see klõpsamise hetkel oli, ega lugenud värskeid andmeid
- Paneel loeb nüüd alati värsket seisu. See parandab ühtlasi olukorra, kus teises arvutis tehtud muudatus ei jõudnud avatud paneelini

## [1.1.3] — 2026-07-30
**Käivita `sql/005_job_notes.sql` Supabase SQL-redaktoris** (sulge Wivo enne). Ilma selleta ei saa töö märkusi salvestada — kast ütleb seda ka ise.

- **Märkuste kast töö kaardil**, Tootmise andmete all: lisa märkus autori ja ajatempliga, kustuta kaheastmelise kinnitusega. Autor tuleb Seaded → „Sinu nimi"
- Märkused kuuluvad tervele tööle, mitte valitud variandile — need püsivad, kui vahetad originaali ja muudatuste vahel
- Märkuse lisamine ei sulge paneeli ega salvesta ülejäänud vormi: kirjutab oma päringuga. `markused` on vormi andmetest teadlikult välja jäetud, nii et vormi salvestamine ei kirjuta vahepeal lisatud märkusi üle
- **Parandus**: paneel ei lähtesta end enam iga andmete värskenduse peale — varem viis märkuse lisamine variandi valiku tagasi algusesse ja muutmisrežiimis oleks üle kirjutanud vormi serveri väärtustega

## [1.1.2] — 2026-07-30
**Parandus: muudatuse avamine näitas originaali andmeid.** Patsiendi tööde ajaloos `-M1` rea avamine avas küll õige töö, aga paneel kuvas alati originaaltöö andmeid — muudatuse enda hambaid, materjali, tooni, hinda ja tähtaega ei olnud kuidagi näha.

- **Muudatuse avamisel näidatakse nüüd muudatuse andmeid**: kaardi pealkiri on „MUUDATUSE ANDMED", väljadel on muudatuse enda hambad, materjal, VITA toon, Print ID, aeg ja tähtaeg
- **Variandi valija** kaardi ülaservas: `Originaal | Muudatus 1 | Muudatus 2` — saab käigu pealt võrrelda, ilma paneeli sulgemata
- **Ajajoon järgib valitud varianti**: muudatusel on oma töövoo etapp, nii et ajajoon ja päise staatus näitavad nüüd seda, mitte originaali oma
- **Päis kirjeldab, mida ekraanil näidatakse**: „töö · muudatus 2", koos selle variandi hammaste arvu ja kuupäevaga
- **Tühi väli tähendab „muutmata"**: muudatus ei peri enam vaikselt originaali väärtusi — just see tekitas segaduse, et kõik read näevad ühesugused välja
- **TÖÖ AJALUGU read on klõpsatavad** — vii kursor sündmusele ja vajuta, et sama variant avada
- **Hinnad on selgelt eristatud**: muudatuse hind eraldi, töö hind kõrval hallilt, „Kokku tööl" alati kogusumma. Makse märgitakse endiselt kogu töö kohta, mitte muudatuse kaupa — see on nüüd ka kirjas
- **„Muuda" avab õige muudatuse** laiendatuna, mitte töö algusest

## [1.1.1] — 2026-07-30
Kasutajaliidese täpsustused 1.1.0 peale. Andmebaasi muudatusi ei ole — kehtivad samad migratsioonid `sql/003` ja `sql/004`.

**Töö kaart (avamine kalendrist, tabelist, patsiendilehelt)**
- **Töö avaneb nüüd vaatamisrežiimis**, mitte kohe muutmisvormina — varem pakkus iga avamine kõiki välju muutmiseks. Muutmine algab nupust „Muuda" paremal ülal; „Tühista" viib tagasi vaatesse, mitte ei sulge akent. Uus töö avaneb endiselt kohe vormina
- **Tootmise ajajoon on alati nähtav**, ka pärast valmimist: kõik töövoo etapid linnukestega, praegune etapp esile tõstetud, all valmimise kellaaeg. Etapid tulevad kasutaja enda töövoost (Seaded → Töövoog)
- **Uus paigutus**: päises töö identiteet (töö · Print ID, patsient, hammaste arv, kuupäev), siis ajajoon, siis kaks veergu — vasakul TÖÖ ANDMED ja TOOTMISE ANDMED, paremal HIND JA MAKSMINE ning TÖÖ AJALUGU
- **„Märgi makstuks"** otse töö kaardilt, kui arve on tasumata
- **TÖÖ AJALUGU** näitab muudatusi versioonidena koos loomise ja viimase muutmise ajaga

**Patsiendileht**
- **Tööde ajalugu kompaktsem**: tellimuse number ja kuupäev on nüüd üksteise all ühes veerus
- **Staatus on rea värviline serv**, mitte tekstiveerg — värvide selgitus on tabeli alumisel serval ja näitab ainult neid etappe, mis selles ajaloos esinevad
- **Märkusi saab nüüd ka kustutada** (kaheastmeline kinnitus), mitte ainult lisada
- **Hambakaardi muutmise saab tühistada**: klõpsud kogutakse kokku ja kirjutatakse alles „Salvesta" peale, „Tühista" viskab need ära. Varem läks iga klõps kohe andmebaasi ja eksliku klõpsu tagasivõtmiseks polnud võimalust
- **Muudatused on tööde ajaloos eraldi read**, taandega ja viitega `KM-2026-01-M1` — muudatus on omaette töö oma hambaste, hinna, tähtaja ja etapiga. Ka vanad imporditud muudatused on nüüd nähtavad

**Tabel**
- **Rea klõps avab alumise paneeli** (vaatamiseks), pliiats vasakus servas avab külgpaneeli (muutmiseks)

## [1.1.0] — 2026-07-29
Suur kasutajaliidese uuendus.

**Enne kasutamist sulge Wivo ja käivita Supabase SQL-redaktoris kaks eraldi päringut:**
1. `sql/003_patient_teeth.sql` — uued veerud ja `patient_teeth` tabel. Ilma selleta ei saa patsienti salvestada ega luua (veerg `markused` puudub) ja hambakaart ei tööta.
2. `sql/004_patient_teeth_realtime.sql` — reaalajas sünkroniseerimine. Vabatahtlik.

Need peavad olema **eraldi päringud**: koos ühes tehingus tekib `40P01: deadlock detected`, sest `ALTER PUBLICATION` vajab lukku, mida hoiab Supabase realtime-protsess, kes omakorda ootab `patients` tabelit, mille sama tehing juba hõivas. Avatud Wivo hoiab samu lukke — sulge rakendus enne käivitamist.

**Navigatsioon**
- **Kompaktne vasak külgriba** (76 px): ikoon peal, silt all — Ülevaade, Tööd, Kalender, Tabel, Patsiendid, Statistika, Seaded. Asendab senise ülemise vahekaardiriba; "Tahvel" kannab nüüd nime "Tööd"
- **Uus Ülevaade-vaade**: kuu statistika, tähtaega ületanud ja täna tähtajaga tööd, kiirvalikud
- **Üks otsingukast** ülaribal, mida jagavad Tabel ja Patsiendid — varem oli igal vaatel oma väli
- Rakenduse versioon on nähtav külgriba jalusel

**Patsientide otsing**
- **Patsiendinimekiri on nüüd omaette otsinguleht** täislaiuses, mitte kitsas riba profiili kõrval — profiil sai ~300 px juurde
- **Filtrid**: arst, kliinik, ainult tasumata, ilma töödeta; sorteerimine nime, tööde arvu, viimase töö või tasumata summa järgi
- **Tulemused tabelina**: patsient, arst/kliinik, tööd, hambad, viimane töö, arveldatud, tasumata

**Patsiendi profiil**
- **Töölaua paigutus**: identiteet (60%) + ärikokkuvõte (40%) üleval, siis kolm töösuunda kõrvuti — Ravikaart (30%) | Tööde ajalugu (40%) | Hambakaart (30%) — ja all Märkused (50%) | Arved (25%) | Viimati muudetud (25%)
- **„Kõik patsiendid" tagasinupp** profiili ülaservas
- **Ravikaardil on nüüd 7 eraldi välja**: kliinilised märkused, allergiad, materjali eelistused, tooni eelistused, **hambumus** ja **lõualiiges** (varem üks ühine väli) ning lisamärkused
- **Vaatamisrežiim vaikimisi**: profiil avaneb loetavana, muutmine algab nupust "Muuda" — varem oli kogu kaart alati redigeeritav
- **Paneelipõhine paigutus**: päis, nelja plaadiga statistikariba, ning paneelid Ravikaart, Hambastaatuse kaart, Tööde ajalugu, Arved, Märkused, Viimati muudetud
- **Uus väli "Värvi eelistused"** ravikaardil (VITA toonid)
- **Märkused**: kuupäeva ja autoriga märkmed patsiendi kaardil; autor tuleb uuest Seaded → "Sinu nimi" väljast
- **Arved**: arveldatud / makstud / tasumata kokkuvõte, arvutatud tööde ja muudatuste hindadest
- **Viimati muudetud**: näitab, millal ja millise kirje kaudu patsiendi andmed viimati muutusid
- **Tööde ajalugu** on nüüd tabel: tellimus, kuupäev, töö, materjal/värv, hambad, staatus, hind, makstud

**Hambastaatuse kaart (FDI)**
- Uus patsiendipõhine hambakaart nelja seisundiga: Töödeldud, Ravi olemas, Terve, Puudub
- **Töödeldud tuletatakse automaatselt** tööde ja muudatuste hambanumbritest; ülejäänud seisundid märgid ise klikkides
- Käsitsi määratud seisund on alati ülimuslik tuletatud seisundi ees (hammas võib olla vahepeal eemaldatud) ja on kohtspikris eraldi märgitud
- Uus tabel `patient_teeth` (migratsioonid 003 + 004) koos RLS-poliitika ja realtime-sünkroniseerimisega

**Tellimuse viide**
- Iga töö kuvatakse patsiendi ajaloos viitega kujul `KM-2026-01` = patsiendi initsiaalid + aasta + selle aasta järjekorranumber
- **Viide arvutatakse kuvamise hetkel, seda ei salvestata.** Töö kuupäeva muutmine või töö kustutamine nummerdab sama aasta hilisemad tööd ümber — ära kasuta seda raamatupidamises enne, kui number saab päris veeru

**Parandused**
- **Valge ekraan patsiendivaates parandatud** (kriitiline): kaks komponenti tellisid sama Supabase realtime-kanali (`patients-realtime`) — teine tellija viskas vea `cannot add postgres_changes callbacks after subscribe()`, mis võttis kogu rakenduse maha. Juhtus siis, kui avasid Patsiendid ja seejärel mõne töö või vajutasid „Uus töö". Iga tellimus saab nüüd unikaalse kanali; sama parandus tehti ka tööde ja hammaste kanalitele
- **Veapiire (ErrorBoundary)**: renderdusviga näitab nüüd veateadet, mitte tühja akent — see rakendus on tühja ekraani taha jäänud kaks korda
- **Kustutamise kinnitus ei vallandu enam topeltklõpsust**: prügikastinupp läheb 5 sekundi pärast automaatselt tagasi ootele ja topeltklõps ei kustuta patsienti (kustutamisel kaob ravikaart jäädavalt ja tööd kaotavad seose)
- **Salvestamata muudatuste hoiatus**: teise patsiendi valimine poolelioleva muutmise ajal küsib nüüd kinnitust, varem kadus kirjutatu vaikselt
- **Perioodifilter kaasab kuu/kvartali/aasta esimese päeva**: varem jäi 1. kuupäevaga töö statistikast täiesti välja, kuigi patsiendilehel oli arvestatud — Ülevaade ja Statistika näitasid tühja kuud
- **Seadete nimi jõuab kohe märkusteni**: „Sinu nimi" muutmine mõjus varem alles pärast vaate taaslaadimist, mistõttu märkused salvestusid autoriga „Tundmatu"
- **Sidumine ei tee enam topeltkirjeid**: „Katrin Mägi" ja „katrin mägi" loeti eri patsientideks ja tekitas tühja dublikaadi

- **Statistika hambaarv ühtlustatud patsiendilehega**: imporditud tööde vana `rev_hambad` muudatus loeti seni ainult ühes kohas — nüüd loevad mõlemad ekraanid sama arvu
- **Inter font on nüüd rakenduse sees**: varem laaditi see käivitamisel Google Fontsist, mistõttu ilma internetita vahetus kiri süsteemifondi vastu ja kogu paigutus nihkus
- Puuduva andmebaasiveeru viga suunab nüüd õigele migratsioonile (varem osutas vale SQL-faili peale)

## [1.0.47] — 2026-07-29
- **Fixed: dead buttons on the Patsiendid page** — the `patients` table had row level security enabled with no policy, so reads silently returned zero rows and every insert was rejected with `42501`. New migration `sql/002_patients_rls.sql` adds the same "Allow all for anon" policy the `jobs` table already uses. **Must be run in the Supabase SQL editor.**
- **Write errors are now visible**: creating, saving, deleting and backfilling patients no longer swallow a rejected request — the failure is shown as a red banner in the patient list, and the patient picker shows it inline. An RLS or missing-table error is translated into the exact SQL file to run
- **Empty-list hint**: when there are no patients but jobs do have names, the list explains the backfill button and points at `002` if nothing happens
- **`.env.example` restored**: the README told you to copy it but the file was missing from the repo; a missing `.env` makes the app start to a white screen, because the Supabase client throws at import time

## [1.0.46] — 2026-07-29
- **Patients are now a real entity**: new `patients` table in Supabase (migration `sql/001_patients.sql`) with name, date of birth, phone, e-mail, referring doctor, clinic, ravikaart, allergies, material preferences, jaw/occlusion notes and general notes
- **Jobs link to a patient record**: new `jobs.patient_id` foreign key; the free-text `patsient` name is kept alongside it as a display value so existing and imported jobs keep working unchanged
- **Patient picker on the job form**: the Patsient field is now a combobox — type to search existing patients, pick one to link the job, or create the record inline with "Loo patsient"; a "seotud / sidumata" indicator shows the link state
- **New "Patsiendid" view**: searchable patient list plus a profile with three tabs — Ülevaade (job count, teeth, invoiced, outstanding + contact fields), Ravikaart (treatment notes, allergies, preferences, jaw notes), Tööd (full job history, click to open the job)
- **One-click backfill**: "Seo N tööd patsientidega" creates patient records from every distinct existing job name and links the jobs; safe to run repeatedly
- **Realtime sync for patients**: patient changes propagate live between machines, same as jobs
- **GDPR**: ravikaart fields are marked as special-category health data in the UI and in the migration file, which also documents the RLS policies to enable before production use

## [1.0.45] — 2026-07-29
_(entry reconstructed from HANDOFF.md — was missing from this file)_
- **Top patsiendid sorted by tooth count**: the chart now ranks patients by total teeth produced instead of job count
- **Hambaid toodetud breakdown inline**: the stat card shows `N originaal · M muudatused` under the total
- **Removed two standalone cards** from Hammaste analüüs — the same numbers now live in the top card
- **Chart subtitle**: "Hambad töötüübi järgi" got the subtitle "Kokku toodetud hambad töö liigi kaupa"

## [1.0.44] — 2026-07-29
- **Töid kokku includes revisions**: stat card now shows `tööd + muudatused` as the total work count, with the breakdown ("N tööd · M muudatust") in the subtitle

## [1.0.43] — 2026-07-29
- **Revenue now includes revision prices**: all stats that sum money (`Käive kokku`, `Makstud`, `Maksmata`, `Ø hind/töö`, `Kiirtöö käive`, monthly chart) now add `rev.price` for every revision on each job — fixes the 2557 vs 1905 discrepancy
- **Hambaid toodetud includes revision teeth**: total tooth count and average teeth/job now sum revision teeth too, not just the main job's `hambad`
- **Duplicate jaw picker removed**: only one Allon jaw picker remains (inline under the Töö field)

## [1.0.42] — 2026-07-29
- **Shade A2.5 added**: between A2 and A3 in the VITA picker
- **Revision material picker**: "Uus materjal" section in both add and edit revision forms — same pill + shade sub-selector as the main job form; stored in `revision.materjal`
- **Allon jaw selector**: when Töö starts with "Allon" (4/5/6), two buttons appear — "Ülemine" / "Alumine" — clicking appends/removes the jaw suffix from the `too` field (e.g. "Allon4 ülemine")
- **Statistics period filter fixed**: `filterByPeriod` now uses `kuupaev` (actual received date) instead of `created_at` (import timestamp) — fixes all imported jobs showing in the same period; revenue/throughput charts also switched to `kuupaev`

## [1.0.41] — 2026-07-29
- **Fixed "1H shown, none selected" on imported revisions**: whitespace-only `hambad` values (e.g. `" "`) now filtered with `t.trim()` instead of `Boolean` — so a stray space no longer counts as a tooth
- **Auto-price now works when editing a priceless revision**: edit mode starts with `priceIsAuto = true` when the revision has no price yet (same logic as the main job form); editing a revision that already has a price still leaves it untouched
- **Teeth normalized on edit load**: imported `rev_hambad` strings are trimmed and cleaned when loaded into the edit form, preventing whitespace tokens from reaching the odontogram or price calculator

## [1.0.40] — 2026-07-29
- **Table: rich Muudatused column** — each revision shown as its own row with `#N` index, a coloured status dot (matching pipeline colour), truncated note, and price badge; up to 3 revisions visible with "+N veel" overflow; newest first; reads `revisions[]` array (old legacy field was ignored)

## [1.0.39] — 2026-07-29
- **Valmis week filter respects revision completion**: a merged card now appears in the current week's Valmis column when any completed revision's deadline (or creation timestamp) falls in that week — the original job's receive date (`kuupaev`) is no longer the only anchor

## [1.0.38] — 2026-07-29
- **Revision status picker**: both "Lisa muudatus" and the revision edit form now show pipeline stage pills — set a revision to Valmis (or any stage) directly when adding or editing
- **Fixed auto-price on 2nd+ revision**: replaced `useRef` with `useState` for the auto-price flag in `RevisionForm` — ensures flag is properly reset on each fresh mount so the 2nd, 3rd… revision forms all auto-fill price from tooth count
- **Teeth before payment (side panel)**: FDI odontogram now appears above "Hind ja maksmine"
- **Auto-price on existing jobs with no price**: opening a priceless job and selecting teeth now auto-fills at 15 €/tooth
- **Fixed hindAutoRef closure bug**: `PricingBlock` now receives `onHindChange` prop instead of referencing `hindAutoRef` across component boundaries
- **New Töö suggestions**: Abutmendile kroon, Implantkroon, Nightguard, Retainer, Splint

## [1.0.37] — 2026-07-29
- **Teeth before payment**: "Hambad (FDI)" now appears above "Hind ja maksmine" in the side panel
- **Auto-price on existing jobs**: opening a job that has no price set and selecting teeth now auto-fills the price (same 15 €/tooth logic as new jobs); jobs that already have a price are unaffected
- **Fixed hindAutoRef closure bug**: price input in the PricingBlock now correctly disables auto-price mode when manually edited (was silently broken due to a cross-component scope issue)
- **New work type suggestions**: "Abutmendile kroon", "Implantkroon", "Nightguard", "Retainer", "Splint" added to the Töö autocomplete
- **Revision hover contrast**: hover background darkened to `slate-900`, text brightened (`slate-300`/`slate-100`), badges use `slate-500` for clearer contrast

## [1.0.36] — 2026-07-29
- **Live auto-price on new jobs**: selecting teeth auto-fills "Hind kokku" — formula: per-material price from settings (default 15 €/tooth), ×2 if Kiirtöö is on; manually typing a price disables auto-fill for that session
- **Live auto-price on new revisions**: selecting teeth in "Lisa muudatus" auto-fills the revision price at 7.50 €/tooth; editing an existing revision never overwrites the stored price

## [1.0.35] — 2026-07-29
- **Editable revisions**: pencil icon on each muudatus row — click to edit note, price, kiirtöö, shade, teeth, deadline, print ID inline; "Salvesta" / "Tühista" buttons; "Muuda" link also appears at the bottom of the expanded read-only view
- **Print ID on revisions**: each revision now has its own Print ID field (SprintRay job number); shown as a `#badge` in the collapsed row and in the expanded details
- **Default tooth price 15€**: new material price entries default to 15 €/tooth (small and large) instead of 0; existing settings are unchanged

## [1.0.34] — 2026-07-29
- **Kiirtöö indicator everywhere**: orange ⚡ icon on board cards (top-right icon row), orange left border + ⚡ next to patient name in Table, small ⚡ before patient name in Calendar chips
- **Supabase Realtime sync**: app now subscribes to live Postgres changes — any change made on one computer (add, edit, delete, stage move) appears on the other instantly without refreshing

## [1.0.33] — 2026-07-29
- **Customizable pipeline**: Seaded → Töövoog — add, remove, rename, and reorder board columns; persisted in localStorage; changes reflect immediately across Tahvel, Tabel, Statistics, and the job status picker
- **Updated material list**: Crown HT (A1/A2/A3/BL1/BL2), Ceramic Crown (A1/A2/A3), OnX Tough 2 (A1/A2), NightGuard Firm 2, Apex Teeth, Apex Base, Retainer — removed old SprintRay-specific entries

## [1.0.32] — 2026-07-29
- **Board week navigation**: Valmis column header now has ‹ › arrows to browse completed jobs by week; clicking the date range returns to the current week
- **Revision pipeline independence**: adding a muudatus no longer resets the original job's status — the original stays where it is and the revision gets its own pipeline card starting at Disain; the revision's Prev/Next stage buttons only move the revision, not the original
- **Merged Valmis card**: when a revision's stage reaches Valmis, it merges with the original into a full-width card; the revision (left/prominent) now shows its updated shade, material, and teeth from the revision data — not just the original job's values
- Added `materjal` field to Revision type for per-revision material tracking

## [1.0.31] — 2026-07-29
- Board **Valmis** column is now double-wide (500 px) with a 2-column card grid so a full week of completed work doesn't require heavy vertical scrolling
- Board: jobs with revisions show a **separate navy "↩ Muudatus #N" card** immediately below the original in every pipeline stage — clicking it opens the job panel scrolled to that revision; stage-advance buttons work on both cards (they move the same underlying job)
- Board **Valmis**: jobs with revisions render as a **merged full-width card** — revision side (prominent, left) shows the muudatus note/deadline/price; original side (right, smaller) shows patient, work type, shade, price and original deadline
- Clicking a revision card in any stage opens the side panel with the revision auto-expanded and scrolled into view

## [1.0.30] — 2026-07-29
- Board cards: **Prev / Next stage buttons** at the bottom of each card — click to advance or retreat one step without opening the panel; next-stage button is tinted with the target stage's colour
- Time field reverted to plain HH:MM text input (was: drum scroller)

## [1.0.29] — 2026-07-29
- **24h clock fix**: Deadline inputs in revision block now use separate `date` + `time` inputs — `type="time"` always renders 24h in Chromium regardless of OS locale
- **Odontogram even spacing**: Arch angle now uses arcsin distribution (`Math.asin(2i/15−1) + π/2`) instead of linear — wisdom teeth get the same gap as front teeth
- **Statistics enhancements**: Added Kiirtöö count + revenue card, average turnaround (days), machine breakdown (Pro2/Midas), top patients chart, teeth-by-work-type chart; hambaid card now shows avg per job; revision rate now counts `revisions[]` array (not just legacy field)

## [1.0.28] — 2026-07-29
- Board cards: 3px coloured left border matching work type (same palette as calendar — Kroon=blue, Sild=violet, Viniir=emerald, etc.); also fixed revision indicator to use the new `revisions[]` array

## [1.0.27] — 2026-07-29
- Added **Ceramic Crown HT** to material list
- Material shade sub-selector: when Ceramic Crown, Ceramic Crown HT, or C&B Resin is selected, shade pills (A1, A2, A3, A3.5, B1…BL2) appear below — clicking stores e.g. "Ceramic Crown HT A2" as the material
- **Kiirtöö** (fast job) toggle on job form — lights up orange, labels "Kiirtöö — hind 2×"; auto-calculation and "Kanna hinna väljale" apply the 2× multiplier
- **Kiirtöö** toggle on revision add form — prices the revision at 2× (price entered × 2 stored); orange "⚡ 2×" badge shown in revision summary
- **New Supabase column:** `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS kiirtoo BOOLEAN NOT NULL DEFAULT false;`

## [1.0.26] — 2026-07-29
- Calendar: day cells now scroll vertically when they have more jobs than fit — all chips are rendered, no more "+N veel" truncation; 3px scrollbar appears on hover

## [1.0.25] — 2026-07-29
- Board: adding a revision to a job now auto-resets its status to **Disain** so it re-enters the pipeline and shows on the board
- Calendar: jobs also appear on their revision's deadline date — revision chips have a **dark navy left stripe** + "↩ muudatus" label to distinguish from the original
- Calendar: clicking a revision chip opens the bottom panel and **auto-scrolls to that revision** in the Muudatused block

## [1.0.24] — 2026-07-29
- Table: period filter pills in the toolbar — **Kõik kuupäevad / See nädal / See kuu / Eelmine kuu** — filter by `kuupaev`
- Table: bulk action bar now has a green **Makstud** button — marks all selected jobs as paid and sets payment date to today

## [1.0.23] — 2026-07-29
- Fixed datetime-local inputs showing AM/PM — Electron main process now launches Chromium with `--lang=et-EE` which forces 24-hour clock in all form controls

## [1.0.22] — 2026-07-29
- Bottom panel: colored stripe at the top of the rounded edge matches the job's work type (same palette as calendar chips — Kroon=blue, Sild=violet, etc.)

## [1.0.21] — 2026-07-29
- Calendar: clicking a job chip now opens the bottom sheet (same as the eye icon in Table), keeping the calendar visible above

## [1.0.20] — 2026-07-29
- Calendar: added work-type colors for Allon4/5/6=pink, Laminaat=lime, Täidis=yellow
- Job form: added Allon4, Allon5, Allon6, Laminaat, Täidis to the Töö autocomplete suggestions

## [1.0.19] — 2026-07-29
- Calendar: job chips now colored by work type instead of pipeline stage — soft pastel palette: Kroon=blue, Sild=violet, Viniir=emerald, Inlay=amber, Onlay=orange, Proteez=rose, Splint=cyan, IBT=indigo, Kirurgiline=teal; unknown types stay neutral gray; overdue (non-valmis, past deadline) still shows red

## [1.0.18] — 2026-07-29
- Board Valmis filter: switched from `updated_at` to `kuupaev` — import sets `updated_at` to now so all imported jobs were leaking into "this week"; now filters by the job's received date instead
- DeadlineChip: completed jobs (`status === 'valmis'`) no longer show "Tähtaeg möödas" — deadline chip shows the date in neutral styling instead

## [1.0.17] — 2026-07-29
- Board: **Valmis** column now shows only jobs completed this week (Mon–Sun based on `updated_at`); header badge shows this-week count, subtitle shows "see nädal · kokku N" so the total is always visible

## [1.0.16] — 2026-07-29
- Odontogram: FDI numbers moved out of the rotated tooth group into dedicated fixed rows — upper numbers sit above the gum band, lower numbers below it; font size increased from 7→9.5; selected teeth show their number in teal; clicking a label also toggles the tooth

## [1.0.15] — 2026-07-29
- Added **Print ID** field — stores the SprintRay job number so you can look up the print later; shown in the job form (after Masin) and as a column in Table view
- **New Supabase column:** `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS print_id TEXT;`

## [1.0.14] — 2026-07-29
- Delete confirmation on all destructive actions — revision Trash icon now shows inline "Kustuta? [Jah] [Ei]" before deleting (job-level and bulk-table delete already had confirmation)

## [1.0.13] — 2026-07-29
- Calendar: each day cell shows a `+` button on hover — clicking it opens the new-job panel with that day pre-filled as the deadline (valmis_aeg)
- Table: Eye icon now always visible (faint gray), turns teal on row hover — was invisible until hover which made it hard to find

## [1.0.12] — 2026-07-29
- Added **Kalender** view — fourth toggle in the TopBar (Tahvel / Tabel / Kalender / Statistika)
- Monthly grid, week starts on Monday, Estonian month names and day labels (E T K N R L P)
- Jobs placed on their deadline date (valmis_aeg); overdue jobs shown in red
- Each cell shows patient name + work type, up to 5 chips per day then "+N veel"
- Today's date has teal highlight; out-of-month days are dimmed
- Toolbar shows count of scheduled jobs this month and count without a deadline
- ← / → navigation between months, "Täna" button to return to current month
- Click any job chip to open the full edit panel

## [1.0.11] — 2026-07-29
- Each revision (muudatus) now has its own price field (€); shown as a teal badge in the collapsed summary row
- Revisions are collapsed by default — click any entry to expand and see shade, teeth odontogram, new deadline, and price
- Revision block redesigned with dark navy/slate background (slate-800) to visually separate from other form content
- Eye icon (👁) in Table view — hover a row to see it; click Eye to open a bottom sheet instead of the side panel; clicking the row name still opens the normal right sidebar
- Bottom sheet slides up from the bottom (70vh), full screen width, two-column layout: metadata on the left, odontogram + revisions + pricing on the right — table remains visible above it

## [1.0.10] — 2026-07-29
- Settings panel now has small/large tooth pricing per material (position 1–5 = small, 6–8 = molar) and a global design fee (€/job)
- Job form pricing section shows auto-calculated breakdown: X small teeth + Y large teeth + optional design fee; "Kanna hinna väljale" copies the total to the Hind field
- Design fee has a one-click "Lisa/Lisatud" toggle so you can include/exclude it per job
- Added separate `Disain hind` (€) field on every job — tracks design cost (in-house or third-party) independently from the total job price
- **New Supabase column:** `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS disain_hind NUMERIC(10,2);`

## [1.0.9] — 2026-07-29
- Multiple revisions per job — "Lisa muudatus" in the sidebar adds a new revision entry (note, shade, teeth, deadline); all revisions shown as a numbered list newest-first with expand/collapse for details; legacy single-revision data auto-migrated on load
- Full SprintRay material list: OnX Tough 2/S/S2, Ceramic Crown, C&B Resin, Model V2, Surgical Guide Plus, Splint, IBT, Denture Base, Denture Tooth
- Machine selector on each job: Pro2 / Midas
- Settings panel (gear icon in TopBar): configure default machine and per-material price per unit (€/tooth) stored in localStorage; job form shows "Arvuta automaatselt" button when material + teeth are set
- Fixed duplicate "Uus töö" button in Table view — removed from table toolbar since TopBar always has it
- **Requires Supabase migration:** `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS revisions JSONB NOT NULL DEFAULT '[]'; ALTER TABLE jobs ADD COLUMN IF NOT EXISTS masina TEXT;`

## [1.0.8] — 2026-07-29
- Fixed odontogram arch overlap — increased SVG height to 330, pushed arches apart (UCY=82, LCY=248 vs old 84/184), giving ~62px clear gap between bite surfaces; reduced tooth rotation factor from 0.5→0.38 for a gentler lean; slightly larger tooth rectangles for better clickability

## [1.0.7] — 2026-07-29
- Added bulk selection in Table view — checkbox on every row, select-all in header, teal highlight for selected rows
- Bulk action bar appears when any rows are selected: change status for all selected at once, or delete with confirmation
- Clicking a checkbox no longer opens the job panel (stopPropagation)
- Footer shows selected count alongside total/filtered count
- Visual SVG odontogram — teeth now rendered as a real dental arch with elliptic geometry, rotated rounded-rect teeth, pink gum backgrounds, and FDI labels; selected teeth fill teal

## [1.0.6] — 2026-07-29
- Fixed save not working: the submit button referenced `form="job-form"` but the form had no matching `id`, so the form submission never fired — added `id="job-form"` to the form element and removed the redundant `onClick` handler
- Added error display in the panel footer — if Supabase returns an error it now shows a red message instead of failing silently

## [1.0.5] — 2026-07-29
- Added **Tabel** view — third toggle in the top bar (Tahvel / Tabel / Statistika)
- Sortable columns: click any header to sort asc/desc
- Stage filter pills above the table to narrow by pipeline stage with live counts
- Search by patient name or work type
- Alternating row shading, status pills, shade swatches, tooth count, deadline coloring — same visual language as the board
- Clicking any row opens the full edit panel

## [1.0.4] — 2026-07-29
- Fixed import finding 0 rows — CSV has a revenue-total row first, then the real header row; parser now scans the first 5 rows and picks the one that best matches known header keywords
- Added status mappings for actual sheet values: Tehtud→Valmis, Tellimata/Tellitud→Disain, Printimata→Printimine, Prinditud→Poleerimine, Uus tehtud/Uus tellitud
- Added "DD.MM kell HH:MM" date format (no year) — assumes current year
- Import preview now shows patient name, work type, date and mapped stage instead of raw cell data

## [1.0.3] — 2026-07-29
- Fixed CSV import counting ~997 rows when the sheet has a data-validation dropdown extending to row 997 — now only imports rows where Patsient is non-empty

## [1.0.2] — 2026-07-29
- Fixed CSV import counting 997 rows instead of ~33 — Google Sheets exports semicolons as the delimiter in Estonian/European locales; the parser now auto-detects `,` vs `;` vs `\t` and also strips the UTF-8 BOM that some exports include


All notable changes to Wivo are documented here.
Format: `[version] — date — summary`

---

## [1.0.1] — 2026-07-29
- Added CSV import — import jobs directly from a Google Sheets export via the "Import CSV" button in the top bar or the `node scripts/import-csv.mjs` CLI script
- Status values from the sheet (e.g. "Default", "Tailfinna ok") are automatically mapped to pipeline stages

## [1.0.0] — 2026-07-29
- Initial release — Phase 1 MVP
- Electron + React 18 + TypeScript app scaffolded with electron-vite
- Supabase backend wired up (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`)
- Kanban board with drag-and-drop across six pipeline stages (Disain → Valmis), persisting to Supabase with optimistic updates
- Job detail slide-over panel with all fields: Kuupäev, Patsient, Töö, Materjal, Värv, Hambad, Valmis aeg
- 32-tooth FDI odontogram picker
- VITA Classical shade swatch picker (A1–D4) + free text
- Collapsible Muudatused (revision) block: rev. hambad, rev. värv, uus valmis
- Pricing block: Hind (€), Makstud toggle, Makse kuupäev
- Deadline chips with amber/red urgency coloring
- Statistika dashboard: summary cards, payment stats (donut + bar chart), material stats (bar + donut), production stats (WIP by stage + throughput line chart), period filter
- SprintRay-inspired styling — teal accent `#0AB6C4`, white cards, slate text
