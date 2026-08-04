# Changelog

## [1.27.0] — 2026-08-04
**Andmebaasi muudatus: `sql/034_profiles_read_scope.sql`** — jooksuta Supabase SQL
editoris, Wivo kinni.

Faas 0 suunamuutuse plaanist: hinnareeglid ühte kohta ja neli raha puudutavat
viga, mis olid koodis juba sees.

**Üks hinnaarvutus kolme asemel**
- Uus `shared/pricing/quote.ts` (`quoteJob`) on ainus implementatsioon. Töö vorm
  ja tööde ümberhindaja kutsuvad seda; veebi tellimusvorm hakkab sama tegema
- Kaks vana koopiat olid juba lahku läinud: `hambaHind = 0` korral kirjutas vorm
  tööle **0 €**, ümberhindaja keeldus. Nüüd keeldub ka vorm
- **Töö, mille mõnda osa ei õnnestu hinnastada, ei saa enam automaatselt hinda.**
  Paneelile ilmub kollane selgitus, mis puudu on ja kust seda seada
- **Mitme tööosaga töö hinnastatakse osade summana.** 10 krooni + 4 silda andis
  enne ühe tüübi hinna üle kõigi 14 hamba. Töö ilma tööosadeta saab sama hinna
  mis enne
- Lisatud `npm test` (vitest, ainult arenduses) — 18 testi hinnaloogikale

**Lisateenused jõuavad summadesse**
- `job.extras` lisati 1.25-s ja jäeti `jobTotalValue`-st välja. Iga ekraan, mis
  töö väärtust näitab, loeb seda funktsiooni, nii et auk oli korraga kõikjal:
  makseseis luges 60 € Ülesehitusega töö makstuks niipea kui põhihind laekus,
  arve kandidaat pakkus liiga väikest summat, Rahandus alahindas arveldamata tulu
- Juba väljastatud arveid ei muudeta — nende read on koopiad

**Turvaparandus: `profiles_read`**
- Poliitika oli `auth.uid() is not null`, ehk iga sisselogitud kasutaja luges
  **kõigi kliinikute** personali. Pärineb ajast, kui projektis oli üks kliinik
- Nüüd kliinikupõhine. Enda rida ja eemaldatud töötajad jäävad loetavaks, et
  sisselogimine ja ajaloo nimed töötaksid

## [1.26.1] — 2026-08-04
Andmebaasi muudatusi ei ole.

**Püsikulud ja lisateenused sünkroniseeruvad nüüd päriselt**
- `toRow()` ei pannud `pricing` veergu `fixedCostsPerJob` ega `lisateenused` välju,
  kuigi mõlemad olid `WivoSettings`-is ja `COLUMN_OF` märkis need kliiniku-ülesteks
- Tagajärg: seadistaja deklareeris `['pricing']`, sünkroniseerija kirjutas `pricing`
  veeru — ilma nende kahe väljata. **Töö püsikulud ja lisateenuste hinnakiri ei
  lahkunud kunagi masinast, kus need sisse trükiti.** Teine tööjaam ei näinud neid,
  ja uus masin alustas tühjalt
- Lugemistee oli kogu aeg korras (`applyClinicRow` spreadib `row.pricing` tervikuna),
  nii et katki oli ainult kirjutamine
- Olemasolevad andmebaasiread ei kaota midagi: puuduv võti spread'is ei kirjuta
  lokaalset väärtust üle. Esimene salvestus pärast seda parandust viib väljad kaasa
- `npx tsc` läheb nüüd puhtaks — see viga oli tüübikontrollis nähtav

## [1.26.0] — 2026-08-04
Andmebaasi muudatusi ei ole.

> **Viimane versioon enne suunamuutust.** Siit edasi kitseneb toode solo-kliiniku
> haldusest tagasi algse ideeni: **WivoLab, töövoo haldus hambalaborile**.
> Kliinikupool (patsiendikaart, visiidid) läheb lipu taha ja tuleb hiljem eraldi
> tootena. Järgmisena: jagatud hinnamootor, tellijakliinik ja B2B arveldus.

**Töö paneel avaneb nüüd alt üles**
- Täisekraani-režiim käitub nagu alumine paneel — tõuseb alt, jätab ülevalt 32px
  vahe, kust paistab läbi hägustatud eelmine leht
- Enne ilmus see sisse `scale`-iga ja kattis kogu akna, mis luges uue ekraanina,
  mitte töö kohal oleva paneelina
- Ümarad ülanurgad, ülemine ääris ja töötüübi värviriba — need olid ainult
  alumisel paneelil, sest täisekraanil polnud servi kuhugi joonistada

**Valitud filtrid kannavad logo värve**
- Uus `.chip-active`: logo tumesinine plaat taustaks, hamba tsüaan gradient tekstiks
- Enne valis iga vaade oma rõhuvärvi — tabelis türkiis, kuupäevapillidel must
- Kaks taustakihti eraldi clip'idega (`text, border-box`), sest gradient-tekst on
  *taust*, mitte tindivärv — plaat mis tahes muul viisil (inset shadow, ::before)
  maalitakse selle peale ja nupp jääb tühjaks
- Ikoonid saavad eraldi värvi: `currentColor` on siin läbipaistev

**Tabeli filtririba kukkus ühele reale**
- 20 chipi kolmes grupis → etapid + kaks rippmenüüd
- Tööliigid grupeeritakse nüüd Seadete töötüüpide järgi, mitte toore `too`
  vabateksti järgi: "Allon4", "allon4 ülemine", "all-on5" ja "allonx ülemine"
  on üks "All-on-X". Enne filtreeris täpse stringi järgi, nii et ühe variandi
  valimine peitis vaikselt ülejäänud
- Mitmikvalik otsinguga, valitud liigid eemaldatavate tokenitena
- `MultiFilterMenu` tõsteti `CalendarView`-st välja jagatud komponendiks
  (`ui/FilterMenu.tsx`) — kalendrist kadus 108 rida duplikaati

## [1.25.0] — 2026-07-31
Andmebaasi muudatusi ei ole.

**Uue versiooni teade koos taaskäivitamise nupuga**
- Kui kettal on uuem versioon kui see, millega aken käivitus, ilmub all paremale
  teade: "Töötab X, saadaval on Y" ja nupp **Taaskäivita**
- Nurgas, mitte modaalina: uuendus ei ole kunagi nii kiireloomuline, et katkestada
  keegi keset arve koostamist, ja ekraani blokeeriv aken suletakse refleksist läbi lugemata
- Peitmine kehtib selle versiooni kohta — järgmise juures tuletatakse uuesti meelde
- Kontrollitakse käivitusel, iga 30 sekundi järel ja akna fookusesse tulekul

**Versiooninumber külgribas on nüüd õige**
- Seni näitas see `__APP_VERSION__` konstanti, mis küpsetatakse **ehitamise ajal**
  sisse. Arenduses jääb see seisma niipea, kui `package.json` versiooni tõstetakse,
  sest Vite loeb konfiguratsiooni üks kord, samal ajal kui HMR serveerib uut koodi
  vana numbri all
- Ehk see näitas versiooni, millega rakendus ei töötanud. **Kaks korda selle
  sessiooni jooksul saatis see vigade otsimise valele rajale**
- Nüüd loetakse number `package.json`-ist iga kord uuesti: arenduses repo failist,
  pakendatud rakenduses asari seest, mis ei saa ilma uuesti paigaldamiseta muutuda

**Mida see ei ole**
- See ei ole automaatne uuendaja: uut versiooni internetist alla ei laadita.
  See ütleb, et **kettal olev** kood on uuem kui see, mida see aken käivitades luges

---

## [1.24.0] — 2026-07-31
Andmebaasi muudatusi ei ole (muudatused on JSONB-s, migratsiooni ei ole vaja).

**Muudatuse põhjuseid saab nüüd valida mitu**
- Ümbertegemisel on tihti mitu põhjust korraga — värv oli vale JA passivus halb —
  ja ühe valiku sundimine viskas poole infost minema
- Nupud töötavad nüüd lülititena: klõps lisab, teine klõps eemaldab
- Vana ühe põhjusega andmed loetakse muutumatult; kirjutatakse uude `reasons`
  välja, loetakse mõlemat (`revisionReasons()`)

**Statistika mitme põhjusega**
- **Muudatuste põhjused** (Tootmine): iga nimetatud põhjus loeb. Kahe põhjusega
  muudatus ilmub mõlemas tulbas, seega tulpade summa on suurem kui muudatuste arv
  — see on aus vastus küsimusele "kui tihti on vale värv mängus"
- **Muudatuste kahju** (Rahandus): raha **jagatakse** põhjuste vahel. Kogu kulu
  igasse lahtrisse liitmine paisutaks kogusummat täpselt nii mitu korda, mitu
  põhjust keegi juhtus märkima

**Muudatuse tähtaeg on nüüd nähtav**
- Väli "Uus tähtaeg" oli vormi kõige lõpus, värvivaliku ja hambakaardi taga —
  sinna keriti mööda ja tundus, et muudatusel polegi tähtaega
- Tõstetud üles, kohe staatuse alla, koos kalendriikooniga
- Juurde selgitus, et muudatus on kalendris **oma** tähtaja päeval, mitte
  originaaltöö oma peal

---

## [1.23.0] — 2026-07-31
Andmebaasi muudatusi ei ole.

**Patsiendi profiili ARVED kast näitab nüüd ka makseid**
- Senised kolm summat (arveldatud / makstud / tasumata) ei öelnud midagi selle
  kohta, **kuidas** raha tuli — ainult kui palju
- Uus **Makseviisid** plokk: iga viisi kohta maksete arv ja kogusumma
  (nt "Sularaha · 3× — 450.00 €"). Patsient, kes maksab alati sularahas, ja see,
  kes maksab ülekandega, on erineva jälgimisvajadusega, ja summad üksi seda ei ütle
- Uus **Viimased maksed** plokk: kuupäev, viis, viide ja summa, kuni kuus viimast,
  koos märkusega, kui neid on rohkem

**Maksed korjatakse mõlemast suunast**
- Nii need, mis on kirja pandud töö juures ("Makstud"), kui ka need, mis on
  arve alt. Ainult ühe lugemine alahindaks täpselt neid kliinikuid, kes teist teed
  kasutavad
- Arve seotakse patsiendiga nii `patient_id` kui ka nime järgi, sest arvel võib
  olla patsient, kellel ei ole veel patsiendikaarti

**Aus märkus tühja puhul**
- Kui makseid ei ole, öeldakse välja, et vanad "makstud" märked tehti enne maksete
  jälgimist ja neil ei ole makseviisi — mitte lihtsalt tühi kast

---

## [1.22.1] — 2026-07-31
Andmebaasi muudatusi ei ole.

**PARANDUS: osamakse salvestus, aga mitte kuskil ei näidatud seda**
- 1.22.0 kirjutas osamakse korrektselt kirja, kuid iga ekraan luges endiselt
  ainult `makstud` lippu — seega töö näitas ikka täissummat ja "Maksmata", nagu
  poleks midagi laekunud. Pool funktsionaalsust ilma teise pooleta
- Uus `lib/jobPayments.ts` on üks koht, mis vastab: kui palju on töö väärt, kui
  palju laekunud, kui palju võlgu

**Kus see nüüd näha on**
- **Töö vaade**: "Osaliselt makstud" oranži plokina koos laekunud summa ja jäägiga,
  ning nimekiri üksikutest maksetest (kuupäev, viis, viide, summa) — osamakset
  saab kontrollida, mitte ainult uskuda
- Nupp ütleb "Lisa makse", kui midagi on juba laekunud
- **Töö vorm**: "Makstud" lüliti all on kirjas, kui palju juba laekunud
- **Patsiendi profiil → ARVED**: makstud ja tasumata summad arvutatakse nüüd
  maksete ridade, mitte lipu pealt; juures on osaliselt makstud tööde arv
- **Patsiendi tööde ajalugu**: rida näitab "Osaliselt (X € jääk)" seniste
  "Makstud" / "Maksmata" asemel

**Vana ajalugu jääb terveks**
- Enne osamakseid lipuga makstuks märgitud töödel ei ole makseridu. Neid loetakse
  endiselt täielikult makstuks — muidu paistaks iga vana töö äkki võlgnevusena

---

## [1.22.0] — 2026-07-31
Andmebaasi muudatusi ei ole.

**Osaline makse**
- "Märgi makstuks" aknas saab nüüd sisestada, **kui palju** tegelikult maksti
- Väli näitab kogusummat, juba laekunut ja jääki, ning täidab end vaikimisi jäägiga
- Kui makstakse vähem: makse salvestatakse, aga **töö jääb maksmata seisu** ja
  jääk on endiselt võlgu. Makstuks märkimine peidaks võla ära, ja see on ainus
  asi, mida see ei tohi teha
- Nupp ütleb, kumb toiming käib: "Salvesta osamakse" või "Märgi makstuks"
- Hulgi märkimisel summat muuta ei saa — üks väli ei jagune mitme töö vahel nii,
  et keegi oskaks tulemust ette näha

**Arve saab jagada igakuisteks osamakseteks**
- Uue arve vormil väli **"Jaga osamakseteks"** — nt 6 tähendab kuut arvet, üks kuus
- Kõik luuakse kohe, kuupäevadega kuu kaupa edasi (nii arve kuupäev kui maksetähtaeg)
- **Esimene arve seob tööd**, ülejäänud on samade ridade osamaksed. Nii ei loeta
  tööd mitu korda arveldatuks ja see ei kao ka arveldamata nimekirjast valesti
- Viimane osamakse võtab ümardusjäägi, nii et osad annavad kokku täpselt terviku
- Iga osamakse saab oma arvenumbri ja on eraldi dokument, mida saab eraldi
  märkida makstuks ja välja printida
- Teadlikult luuakse need ette ära, mitte reeglina "korda iga kuu": töölauarakendus
  ei tööta suletuna, seega reegel, mis peaks järgmisel kuul käivituma, ei käivituks

---

## [1.21.0] — 2026-07-31
Andmebaasi muudatusi ei ole.

**"Makstud" küsib nüüd alati, KUIDAS maksti**
- `jobs.makstud` on boolean ja vastab ainult küsimusele "kas raha tuli". Ta ei
  oska vastata "mis kujul", mis on täpselt see, mida omanik peab kassa või
  pangaväljavõttega kokku viima
- Iga tee "makstud" juurde avab nüüd akna, kus valid **ülekanne / sularaha /
  kaart / muu**, kuupäeva ja soovi korral viite
- Kaetud on kõik kolm kohta: töö vaate nupp "Märgi makstuks", töö vormi
  "Makstud" lüliti ja tabeli hulgitoiming
- Hulgi märkimisel kehtib üks makseviis ja kuupäev kogu valikule — nii see
  päriselt käibki (üks ülekanne, üks kassapäeva lõpp)
- Lüliti väljalülitamine ei küsi midagi: see on parandus, mitte makse

**Töö makse on nüüd päris kirje**
- Lisaks lipule kirjutatakse `payments` tabelisse rida (summa, viis, kuupäev,
  viide, kes sisestas) — sama tabel, mida arved kasutavad
- Lippu hoitakse endiselt sünkroonis, sest mitu ekraani loevad seda

**Statistika parandus**
- "Maksmise viis" ja "Laekunud" lugesid ainult arvete makseid ja jätsid töö
  juures märgitud maksed täiesti välja — ehk alahindasid iga kliiniku puhul, kes
  arveid alati ei väljasta
- Loetakse nüüd kõiki makseid

---

## [1.20.0] — 2026-07-31
**Käivita:** `sql/031_delete_worker.sql` (Wivo kinni enne).

**PARANDUS: eemaldatud ja võõraste kliinikute kontod olid kõikjal valikutes**
- `useClinicProfiles` ei filtreerinud **üldse** kliiniku järgi, ja `profiles_read`
  poliitika lubab igal sisselogitud kasutajal lugeda kõiki profiile — seega tuli
  sinna iga konto kogu Supabase projektist, sh meeskonnast eemaldatud
- Puudutas kõiki kohti korraga: töö vormi Teostaja/Disainija, tabeli
  hulgimääramist ja Töötasusid
- Nüüd filtreeritakse `clinic_id` järgi

**Konto saab nüüd jäädavalt kustutada**
- Meeskond → vali töötaja → "Kustuta konto jäädavalt". Kasutajanimi vabaneb ja
  sama nimega saab uue konto luua
- **Andmebaas keeldub**, kui inimesel on töid, tunde või väljamakseid — ja ütleb,
  mitu neid on. `jobs.assigned_to` on ON DELETE SET NULL, seega kustutamine
  rebiks tema nime iga töö küljest lahti. Palgaajalugu, mis ei oska öelda, kellele
  maksti, on halvem kui seisev konto
- Omanikku ega iseennast kustutada ei saa

**"Lisa tagasi" on nüüd ajaline**
- Vaikimisi näidatakse ainult viimase minuti jooksul eemaldatuid — see nimekiri
  on eksliku klõpsu tagasivõtmiseks, mitte alaliseks kalmistuks
- Vanemad jäävad kättesaadavaks nupu "Näita kõiki eemaldatuid" taga. Konto
  eksisteerib niikuinii edasi, ja orb, keda keegi üles ei leia, on halvem tulemus
  kui üks lisaklõps

**Töötasud: arhiveeritud**
- Meeskonnast eemaldatud inimesed, kellele on tehtud väljamakseid, kuvatakse
  eraldi plokis "Arhiveeritud" koos väljamaksete arvu ja kogusummaga
- Uut tasu neile ei arvestata; ajalugu jääb jälgitavaks

---

## [1.19.0] — 2026-07-31
**Käivita:** `sql/030_reset_worker_password.sql` (Wivo kinni enne).

**Omanik saab töötajale uue parooli määrata**
- Meeskond → vali töötaja → "Määra uus parool"
- Seni oli vale parool ummiktee: kontot ei saa rakendusest kustutada (vajaks
  `service_role` võtit, mida ei tohi töölauarakendusse panna), üle luua ei saa
  (kasutajanimi on võetud), ja lähtestuskirja pole kuhugi saata, sest sünteetiline
  aadress ongi meelega tupik
- Uus parool kuvatakse pärast salvestamist koos kopeerimisnupuga, et selle saaks
  töötajale edasi anda
- Käib `admin_set_worker_password()` kaudu, mis kontrollib andmebaasi poolel, et
  kutsuja on selle kliiniku omanik ja sihtmärk kuulub samasse kliinikusse. Teise
  omaniku parooli muuta ei saa
- Eemaldatud (kliinikust lahutatud) inimese parooli **ei saa** määrata enne, kui
  ta on tagasi lisatud: orvuks jäänud konto ei kuulu ühelegi kliinikule, ja
  vastasel juhul võiks iga omanik selle endale võtta

**Selgem veateade**
- "Kasutajanimi on juba võetud" ütleb nüüd ka, mida teha: kui tegu on varem
  eemaldatud liikmega, lisa ta tagasi ja määra uus parool

---

## [1.18.3] — 2026-07-31
Andmebaasi muudatusi ei ole. **Vajalik Supabase seadistus, vt allpool.**

**"Email rate limit exceeded" töötaja loomisel**
- Põhjus ei ole rakenduses: Supabase sisseehitatud SMTP lubab vaid paar kirja
  tunnis, ja `signUp` saadab kinnituskirja ainult siis, kui **"Confirm email"**
  on sisse lülitatud
- Majasisest kontot ei ole vaja kinnitada — pealegi ei jõua kiri kuhugi, sest
  aadress on sünteetiline
- **Lahendus:** Supabase → Authentication → Providers → Email → lülita
  **"Confirm email" välja**. Siis ei saadeta ühtegi kirja ja piirangut ei teki
- Veateade rakenduses ütleb selle nüüd otse välja, koos täpse asukohaga

**PARANDUS: uue töötaja loomine vahetas omaniku sessiooni ära**
- `signUp` logib uue kasutaja sisse sellel kliendil, kus seda kutsuti. Peakliendil
  tähendas see, et omanik lõi tehniku konto ja **jäi ise tehnikuna sisse logituks**
- Seni jäi see märkamata just tänu kinnituskirjadele: kinnitust nõudev signUp ei
  tagasta sessiooni. See viga oleks avaldunud täpselt sel hetkel, kui "Confirm
  email" välja lülitada — ehk kohe, kui ülemine probleem lahendada
- Konto luuakse nüüd eraldi ühekordsel kliendil, mis ei salvesta sessiooni ega
  värskenda tokenit. Uue kasutaja token sureb funktsiooni lõpus

---

## [1.18.2] — 2026-07-31
Andmebaasi muudatusi ei ole. (`sql/029_username_login.sql` päis ja backfill uuendatud —
kui see on juba käivitatud, ei ole vaja midagi uuesti teha.)

**PARANDUS: "Email address tehnik@wivo.invalid is invalid"**
- Supabase (GoTrue) e-posti valideerija lükkab `.invalid` ja `.local` tipptasemega
  domeenid tagasi. Valisin `.invalid` sellepärast, et RFC 2606 garanteerib, et see
  ei saa kunagi lahenduda — aga see garantii ei aita, kui konto loomine sellega
  üldse läbi ei lähe
- Vaikimisi domeen on nüüd **`example.com`**: samuti RFC 2606-ga reserveeritud,
  seda ei saa keegi registreerida, IANA viskab sinna saadetud kirjad ära — ja
  erinevalt `.invalid`-ist läheb see Supabase valideerijast läbi
- Sünteetiline aadress jääb kasutaja eest endiselt peitu; kuvatakse kasutajanime

**Domeeni saab ise valida**
- `.env` failis `VITE_USERNAME_DOMAIN=users.sinukliinik.ee`, kui soovid, et
  andmebaasis oleks midagi äratuntavamat
- Vali see **enne** kontode loomist: hilisem muutmine jätab olemasolevad kontod
  orvuks, sest salvestatud aadress kannab vana domeeni

---

## [1.18.1] — 2026-07-31
Andmebaasi muudatusi ei ole.

**Meeskonna liikme saab nüüd eemaldada**
- Nuppu ei olnud üldse — prügikasti ikoon oli failis imporditud, aga mitte kordagi
  kasutatud
- Meeskond → vali töötaja → "Eemalda meeskonnast" (kaheastmeline kinnitus)

**Mis eemaldamisel täpselt juhtub**
- Profiil lahutatakse kliinikust ja kõik õigused kustutatakse. Ligipääsu võtab ära
  just lahutamine: iga RLS poliitika on kirjutatud `my_clinic_id()` vastu, mis
  muutub tema jaoks tühjaks
- **Kontot ennast ei kustutata.** Seda ei saa siit teha — see nõuaks
  `service_role` võtit, millel ei ole töölauarakenduses asja
- **Tehtud tööd jäävad alles** ja nende juures on tema nimi endiselt näha.
  Palgaajalugu ja väljamaksed samuti — neid ei tohigi kaotada
- Eemaldatud inimesed jäävad nimekirja alla eraldi plokki koos nupuga
  "Lisa tagasi": eksliku eemaldamise parandab üks klõps, ja orvuks jäänud konto
  ei ole nähtamatu

---

## [1.18.0] — 2026-07-31
**Käivita:** `sql/029_username_login.sql` (Wivo kinni enne).

**Töötaja konto ei vaja enam e-posti**
- Meeskond → Lisa töötaja küsib nüüd **kasutajanime**, mitte e-posti
- Pingi taga töötaval tehnikul ei ole firmapostkasti, ja talle "tehnik2@gmail.com"
  välja mõtlemine on korraga vale ja hilisem tugiprobleem
- Sisselogimine käib kasutajanimega. Väli aktsepteerib mõlemat: kui sisestatud
  tekstis on `@`, koheldakse seda e-postina, muidu kasutajanimena
- Päris e-posti saab endiselt sisestada — siis saab see inimene ise parooli
  lähtestada

**Kuidas see töötab**
- Supabase Auth nõuab parooli jaoks e-posti aadressi, seega tuletab rakendus
  kasutajanimest sünteetilise aadressi `<kasutajanimi>@wivo.invalid` ja ei näita
  seda kunagi kuskil
- `.invalid` on RFC 2606-ga reserveeritud just selleks, et see ei saa kunagi
  lahenduda ega kirju vastu võtta — nii ei satu ükski parooli lähtestamise kiri
  kogemata võõrale domeenile
- Kasutajanimed on tõstutundetult unikaalsed ("Tehnik" ja "tehnik" on sama inimene)

**Mida see tähendab**
- **Kasutajanimega konto ei saa ise parooli lähtestada** — kirja pole kuhugi
  saata. Omanik lähtestab selle. See on vahetuskaup postkastide mittenõudmise
  eest ja vastab sellele, kuidas majasisene konto niikuinii käib
- Kasutajanimed on unikaalsed kogu Supabase projekti ulatuses. Ühe labori puhul
  ei ole see nähtav; paljude kliinikute puhul tuleks kliinik nimesse sisse võtta
- Olemasolevad e-postiga kontod töötavad muutumatult

---

## [1.17.1] — 2026-07-31 — KRIITILINE PARANDUS
Andmebaasi muudatusi ei ole.

**Töö tüüpide hinnad kadusid iga taaskäivitusega**
- `workTypeList()` — funktsioon, mis loeb töö tüübid localStorage-ist ja
  andmebaasist — **ehitas iga kirje uuesti ainult väljadest `nimi`, `hex` ja
  `match`**. Kõik ülejäänud väljad kustusid vaikselt igal laadimisel:
  `hind`, `soodushind`, `hinnaTyyp`, `pilt`, `kulud`
- Seetõttu püsisid hinnad sessiooni jooksul (mälus olev objekt oli terve) ja
  kadusid taaskäivitusel. Sama funktsioon jookseb ka andmebaasist hüdreerimisel,
  nii et järgmine salvestus kirjutas kärbitud nimekirja ka serverisse
- Viga tekkis 1.7.13-s, kui funktsioon kirjutati ajal, mil neid välju veel ei
  olnud, ja seda ei uuendatud kordagi, kui välju juurde tuli
- Nüüd kasutab funktsioon spreadi (`...t`) ja normaliseerib ainult neid välju,
  mis seda vajavad. Iga uus WorkType väli kandub edaspidi automaatselt läbi
- Lisatud ka väärtuste kontroll: vigane arv ei muutu enam `NaN`-iks, mis rikuks
  kõik summad allpool

**Mida see tähendab sinu andmetele**
- Kadunud hinnad tuleb suure tõenäosusega uuesti sisestada
- **Enne uute hindade sisestamist** tasub Supabase SQL-redaktoris vaadata:
  `select work_types from clinic_settings;` — kui seal on hinnad veel alles,
  taastab parandatud versioon need järgmisel käivitamisel ise

---

## [1.17.0] — 2026-07-31
Andmebaasi muudatusi ei ole.

**Tarvikute kulud töö tüübi peal**
- Iga töö tüübi kaardil saab nüüd loetleda **kulud**: kruvi, abutment, mis iganes
  konkreetne töö alati vajab
- Iga kulu on nimi + summa + kas **töö kohta** või **hamba kohta** — implantaadi
  kruvi käib hamba kohta, kohaletoimetamine töö kohta
- Nimekiri, mitte üks number: tüüp vajab tavaliselt mitut asja, ja "12 € millegi
  eest" ei ole vastus, mida saab hiljem kontrollida
- **Ei lisandu kunagi arvele.** See on kulu, mitte hind — olemas selleks, et kate
  teaks, mis töö päriselt ära kulutas
- Statistika → Rahandus: kaart on nüüd "Materjal ja tarvikud", tarvikute osa eraldi
  välja toodud; kate arvestab neid maha; töötüübi tabelis on need materjali veerus

**Maksmise viisi statistika**
- Statistika → Rahandus näitab, kuidas kliendid päriselt maksavad: ülekanne,
  sularaha, kaart, muu — maksete arv, summa ja osakaal ribadena
- Arvestatakse perioodil **laekunud** makseid, mitte väljastatud arveid

**Muudatuste hinnad saab hulgi nullida**
- Seaded → Hinnad → "Arvuta tööde hinnad ümber" all on nüüd valik
  **Muudatuste hinnad**: *Jäta puutumata* / *Nulli (0 €)* / *Arvuta ümber*
- Vana poolhinna-loogika jäi vanadele muudatustele külge; nüüd saab need ühe
  korraga nulli panna, ilma et peaks kliendi hindu puutuma
- Ülevaade näitab eraldi, mitu muudatust muutub ja mis summast mis summani
- Töö hind ja selle muudatused kirjutatakse **ühe päringuga** — kaks kirjutust
  samale reale tähendaks kaotatud uuendust

**Seaded → Hinnad paigutus**
- "Arvuta tööde hinnad ümber" on nüüd kõige ülal, töö tüüpide kohal
- Kaks veergu: vasakul ümberarvutus + töö tüüpide kaardid, paremal automaatarvutus,
  disaini hind ja materjalide tabel — varem oli viis kaarti üle laiuse laiali

---

## [1.16.0] — 2026-07-31
Andmebaasi muudatusi ei ole.

**Kalendri päis kolis ülemisele ribale — grid sai kõrgust juurde**
- Vaate valikud (Tööd / Visiidid / Kombineeritud), Kuu/Nädal ja **Täna** on nüüd
  ülemisel ribal otsingu ja Import CSV vahel
- Eraldi "Kalender" pealkirjarida ja kuu-stepper (`‹ juuni 2026 ›`) on eemaldatud
- Kuu-stepper ei öelnud enam midagi: kalender on pidev keritav riba, mis märgib
  iga kuu algust niikuinii rea kohale. Ta võttis kogu laiuse, et korrata infot,
  mis on juba ekraanil
- Kokku ~52px rohkem päevalahtritele, ilma et ükski nupp kaoks
- Ülemine riba sai üldise "keskmise pesa", nii et see ei tea midagi kalendrist —
  iga vaade saab sinna ise oma juhtnupud panna

**Täna töötab nüüd ka kerimisega**
- Varem seadis see ainult valitud päeva; nüüd kerib ka päeva vaatesse

---

## [1.15.0] — 2026-07-31
**Käivita:** `sql/028_worker_engagement.sql` (Wivo kinni enne).

**Palgal vs esitab arve — number tähendab nüüd õiget asja**
- Töötasud nimetas iga summat "brutopalgaks" ja liitis kõigele tööandja maksud.
  Tehniku puhul, kes esitab arve oma ettevõttelt, ei ole see lihtsalt vale sõna,
  vaid **vale number**: arve on ost, brutot ei ole, tööandja sotsiaalmaksu ei ole,
  ja maksude pool on arve esitaja enda asi
- Ostu esitlemine palgana **ülehindaks kliiniku maksukohustust** — täpselt selline
  enesekindel vale number, mille pealt omanik hakkaks planeerima
- Iga inimese juures on nüüd **Töösuhe**: *Palgal* või *Esitab arve*
- Palgal → summa on bruto, tööandja maksud lisanduvad
- Esitab arve → summa on arve summa, tööandja makse ei lisandu
- Töötaja nime kõrval on silt "esitab arve", summa all kirjas "bruto" või "arve summa"

**Kokkuvõte on jaotatud**
- "Palgal, bruto" + "Tööandja maksud" + "Arve alusel (ettevõtted)" + "Kogukulu kliinikule"
- Varem oli üks "Bruto kokku", mis liitis kaks eri asja kokku ja korrutas mõlemad maksudega

**Statistika → Rahandus**
- Tööandja maksud arvutatakse ainult **palgaliste** pealt
- Töötajate tabelis on veerg "Töösuhe"
- Kate on seetõttu nüüd õige ka siis, kui osa tehnikuid on lepingulised

---

## [1.14.0] — 2026-07-31
**Käivita:** `sql/027_payroll_permission.sql` (Wivo kinni enne).

**Töötasusid saab nüüd delegeerida**
- Uus õigus **`payroll.manage`** (Meeskond → töötaja õigused): "Töötasusid hallata"
- Näeb kõigi tasumäärasid, tunde ja väljamakseid, saab neid kinnitada ja tühistada
- Omanikul on see alati olemas
- Varem oli palgaarvestus poliitikates omaniku-ainult, mis tähendas, et raamatupidaja
  või juhatajaga omanik pidi iga väljamakse ise tegema. See ei olnud turvaotsus,
  vaid puuduv õigus
- **Jõustatud andmebaasis** (`can_manage_payroll()`), mitte ainult liideses
- Tavatöötaja näeb endiselt ainult iseennast — mida keegi teenib, on tema ja
  palgaarvestaja vaheline asi

**Ridade väljajätmine enne kinnitamist**
- Iga arvestamata rea ees on nüüd linnuke; võta maha, et see väljamaksest välja jätta
- Väljajäetud read **jäävad maksmata ja tulevad järgmisel perioodil uuesti ette** —
  seega "lisamine" käib nii, et jätad rea praegu välja ja kinnitad hiljem
- Nupp näitab, mitu rida tegelikult kinnitatakse, ja summa arvestab valikut

**Väljamakset saab tagasi võtta**
- "Võta tagasi" viib makstud väljamakse tagasi kinnitatud olekusse
- Kustutamine kahe klõpsuga; makstud väljamakse puhul on hoiatus valjem
- Kustutamine **tagastab kõik read arvestamata hulka** — `paidKeysFrom` loeb
  otse väljamaksetest, seega midagi muud tagasi kerima ei pea
- Külmutamise põhimõte jääb: vigast väljamakset ei parandata dokumenti muutes,
  vaid see kustutatakse ja tehakse uuesti

---

## [1.13.0] — 2026-07-31
**Käivita:** `sql/026_revision_pay_scope.sql` (Wivo kinni enne).

**Muudatustel saab nüüd olla oma tasumäär**
- Seni sai muudatuste kohta öelda ainult "sama reegel, mis tööl — sees või väljas"
  (`pay_revisions`). Labor, kes maksab töö eest 15 €/hammas ja ümbertegemise eest
  8 €/hammas, ei saanud seda kuidagi kirja panna — ja just nii see tavaliselt käib
- "Mille eest" valikutele lisandus **Muudatus (ümbertegemine)**
- Muudatuse reegel saab olla hamba kohta, fikseeritud või protsent — sõltumatult
  sellest, mille järgi tööd ennast makstakse
- Kui muudatuse reeglit ei ole, kehtib vana käitumine: tööreegel katab muudatused
  ainult siis, kui sellel on linnuke "Katab ka muudatused". Olemasolevad
  seadistused töötavad täpselt nagu enne

**PARANDUS: muudatuste puudumist ei selgitatud kuidagi**
- Diagnostika vaatas ainult töid, mitte muudatusi. Töö, mis ise arvestusse läks,
  võis kanda muudatust, mis vaikselt midagi ei teeninud — ilma ühegi märkuseta
- Nüüd öeldakse muudatuste kohta sama moodi: ei ole valmis-etapis, kuupäev jääb
  perioodist välja, muudatuste eest ei maksta, hambaid ei ole valitud, hinda ei ole

**Muudatustel on nüüd oma valmimiskuupäev**
- Sama viga, mis töödel oli 1.11.2-ni: perioodi otsustas tähtaeg, mis on plaan
- `valmis_kuupaev` pannakse muudatusele hetkel, mil see liigub valmis-etappi
- Vanadel muudatustel jääb aluseks tähtaeg, siis loomise aeg

---

## [1.12.0] — 2026-07-31
Andmebaasi muudatusi ei ole.

**Teostaja ja disainija määramine hulgi — Tabel**
- Vali tabelis tööd (või kõik korraga päise linnukesega) ja määra teostaja või
  disainija kõigile valitutele korraga
- Vajalik selleks, et olemasolevad tööd üldse palgaarvestusse jõuaksid — ükshaaval
  vormi avades jääks see lihtsalt tegemata, ja siis ei ole millegi pealt maksta
- Sama ribal on juba staatuse muutmine, "Makstud" ja kustutamine
- "— eemalda —" võtab määrangu maha
- Tabeli otsing ja sorteerimine töötavad enne valimist, nii et saab näiteks
  filtreerida ühe töö tüübi või patsiendi ja määrata ainult neile
- Kirjutamine käib kaupa 15 töö haaval, et pikk nimekiri ei jääks poolele teele

---

## [1.11.3] — 2026-07-31
Andmebaasi muudatusi ei ole (kui `sql/025_job_completed_date.sql` on käivitamata, tee see ära).

**Töötasud näitab nüüd alati, mitu tööd jäi arvestamata ja miks**
- 1.11.2 näitas põhjuseid ainult siis, kui kokku oli 0 €. See tähendas, et
  **osaline tulemus — neli määratud tööd, üks rida — nägi välja täpselt nagu
  täielik tulemus**. Just see on raskem viga märgata, ja just see jäi märkamata
- Põhjused arvutatakse ja näidatakse nüüd alati, ka siis kui midagi arvestati
- Töötaja rea peal on kohe näha: `N reeglit · M rida · K määratud valmis tööd`
  ning oranžilt `X tööd arvestamata`, ilma et peaks lahti klõpsama
- Lisatud ka disainija põhjused: "disainijaks on määratud, aga disaini eest
  makstavat reeglit ei ole"
- Reegli puudumise teade ütleb nüüd, kust vaadata: "kontrolli 'Mille eest' ja
  'Ainult töö tüübile'"

---

## [1.11.2] — 2026-07-31
**Käivita:** `sql/025_job_completed_date.sql` (Wivo kinni enne).

**PARANDUS: töötasu näitas 0, kuigi töö oli valmis ja määr olemas**
- Palgaarvestus otsustas, millisesse perioodi töö kuulub, `valmis_aeg` järgi —
  see on aga **tähtaeg, mitte valmimise kuupäev**. 28. juuni tähtajaga töö, mis
  sai valmis 3. juulil, ei teeninud seetõttu ei juunis ega juulis midagi: ta
  lihtsalt jäi ekraanil oleva kuu vahelt välja
- Tähtaeg on plaan. Palka makstakse selle järgi, mis tegelikult juhtus
- Uus väli `valmis_kuupaev`, mille rakendus paneb hetkel, mil töö liigub
  valmis-etappi (tahvlil lohistades, vormist salvestades või hulgi muutes).
  Kirjutatakse ainult üks kord — valmis töö edasi-tagasi lohistamine ei muuda seda
- Olemasolevatele ridadele tuletatakse kuupäev `updated_at` pealt. See on
  **oletus** ajalooliste ridade kohta ja migratsioon ütleb seda välja

**Töötasud ütleb nüüd, MIKS midagi ei arvestatud**
- Kui rida ei teki, näidatakse põhjust töö kaupa: töö ei ole valmis-etapis,
  valmimiskuupäev jääb perioodist välja, ükski tasureegel ei sobi, tasu on hamba
  kohta aga hambaid pole valitud, tasu on protsent aga hinda pole, juba makstud
- Iga põhjuse juures on tööde arv ja näited
- Põhjus: "0 €" koos seadistatud määra ja valmis töödega on ekraan, millele ei
  saa vastata ilma koodi lugemata. Rakendus teab vastust, nüüd ka ütleb seda

**Töö tüüp on vormil valikukaardid, mitte tekstiväli**
- Uus töö / Muuda tööd: töö tüübid on pildi, nime ja hinnaga kaardid
- Vaba tekst jääb alles nende juhtude jaoks, mida nimekiri ei kata — aga see ei
  ole enam vaikimisi tee
- Vabatekst oli see, kuidas "D14 abutmendile kroon" ja "all-on5" said omaette
  kategooriateks, mis siis vale hinna ja vale värvi said

---

## [1.11.1] — 2026-07-31
Andmebaasi muudatusi ei ole.

**Tööde hindade ümberarvutus — Seaded → Hinnad (ainult omanik)**
- Vanad tööd kandsid hindu ajast, mil see oli ühe tehniku tööriist ja vaikimisi
  oli 15 €/hammas. Nüüd on need kliendi hinnad, mille pealt arveid kirjutatakse,
  seega peavad nad vastama päris hinnakirjale
- Arvutab sama valemiga, mis töö vorm: töö tüübi hind → materjali hind →
  €/hammas, kiirtöö kordaja peale. Sama valem tähendab, et ümberarvutatud töö ei
  saa vormis näidatust erineda
- **Kaheastmeline**: enne kirjutamist näidatakse ülevaade — mitu tööd muutub, mitu
  jääb samaks, praegune kogusumma ja uus kogusumma, ning rida-realt vana ja uus
  hind koos arvutuse alusega
- **Juba väljastatud arveid see ei puuduta** — arve read on koopiad arveldamise
  hetkest, täpselt selleks, et hinna hilisem muutmine ei kirjutaks dokumenti ümber
- Arvel olevad tööd saab soovi korral välja jätta (linnuke), vaikimisi on kaasas
- Tööd, mille hinda ei saa arvutada (hambaid pole ja töö tüübil hinda pole),
  jäetakse vahele ja loendatakse eraldi — vaikselt nulliks ei kirjutata
- Kirjutamine käib kaupa 15 töö haaval, et suurem nimekiri ei jääks poolele teele
  pidama
- Tagasivõtmist ei ole ja seda öeldakse enne kinnitamist välja

---

## [1.11.0] — 2026-07-31 — Testimise tagasiside: kliinik, hinnamudel, tasureeglid
**Käivita:** `sql/023_material_costs.sql` ja `sql/024_worker_pay_scope.sql` (Wivo kinni enne).

**PARANDUS: "Kliinik puudub — seaded kehtivad ainult selles arvutis."**
- Põhjus: `fetchClinic` neelas oma vea alla ja tagastas `null`, mistõttu
  **ebaõnnestunud päring ja "kliinikut polegi" nägid välja täpselt ühesugused**
- Sünkroniseerimine käis kliiniku **objekti** küljes, mitte profiili `clinic_id`
  küljes. Üks ebaõnnestunud päring lülitas seetõttu kogu kliiniku seadete
  sünkroni vaikselt välja, kuigi kliinik oli täiesti olemas
- Nüüd: sünk käib `clinic_id` järgi, viga logitakse konsooli, ja riba eristab
  kolme olukorda — kliinikut ei ole, kliinik on aga andmeid ei saanud laadida,
  kõik korras
- Seaded → Kliinik ei ole enam tühi leht, kui kliinikut ei õnnestunud laadida

**Töö tüübi hind: töö kohta VÕI hamba kohta**
- Silda ei saanud hinnastada, sest selle hind sõltub ulatusest — sama disaini puhul
- Iga töö tüüp valib nüüd ise: **Töö kohta** või **Hamba kohta**
- Hamba kohta hind korrutatakse hammaste arvuga; hambaid valimata ei ole hind veel
  teada (0 € ei kirjutata vormile)

**Soodushind**
- Igal töö tüübil on täishind ja soodushind
- Töö vormil saab valida, kumba kasutatakse — otsustab see, kes tööd sisestab

**Hinnaseaded näevad välja nagu kaardid**
- Tabeli asemel kaardid: pilt, nimi, hinnastamise viis, täishind, soodushind
- Piltide kaust: `src/renderer/src/assets/worktypes/`
- Failinimi = töö tüübi nimi väiketähtedes, täpitähed asendatud, tühikud
  sidekriipsuga: `kroon.png`, `abutmendile-kroon.png`, `all-on-x.png`, `taidis.png`
- Kaustas on README kogu nimekirjaga. Pildi puudumisel näidatakse töö tüübi
  värviga kohatäidet koos oodatava failinimega — midagi katki ei lähe
- Faili saab ka käsitsi määrata kaardilt

**Tasureeglid: "Disain" ei ole enam Liik**
- Liik vastab küsimusele **kuidas makstakse** — tund, hammas, töö, %, kuu.
  "Disain" ei ole vastus sellele küsimusele, see on **töö liik**
- Uus väli **"Mille eest"**: teostatud töö või disain
- Tänu sellele saab disaini eest maksta **hamba kohta** (nagu tegelikult tellitakse),
  mitte ainult fikseeritud summana
- Olemasolevad `disain`-reeglid teisendatakse automaatselt: kind='too' + "disaini eest"

**Automaatsed töötunnid**
- Tunnitasu reegel saab "Täida tunnid automaatselt" + tunde päevas
- Kuu tööpäevad (E–R) täidetakse ise, administraator ei pea 21 ühesugust rida sisestama
- **Käsitsi sisestatud päev on alati ülimuslik** — erand sisestatakse üks kord

**Tööandja maksud**
- Uus seade Seaded → Hinnad: tööandja maksude määr %
- Töötasud näitab omanikule brutot, makse ja **kogukulu tööandjale**
- Statistika → Rahandus arvestab katte nüüd tööjõukulust **koos maksudega**
- Vaikimisi 0% ja seda öeldakse välja: vale maksumäär, mille rakendus ise välja
  mõtles, on halvem kui ilmselgelt puuduv

---

## [1.10.0] — 2026-07-30 — Rahandus: kate, kulud, muudatuste kahju
**Käivita:** `sql/023_material_costs.sql` (Wivo kinni enne).

**Uus vaheleht Statistika → Rahandus**
Senine statistika luges hambaid ja töid. See vaheleht loeb raha: mis tuli sisse,
mis läks välja, mis jäi alles. Tootmise ja raha vaated on eraldi, sest leht oli
juba pikk ja hambaloendust ei ole mõtet katteprotsendiga ühte kerimisse panna.

**Sisse**
- **Arveldatud** — arvete netosumma perioodis (käibemaksuta)
- **Laekunud** — maksed nende laekumise kuupäeva järgi, mitte arve kuupäeva järgi
- **Tasumata** ja sellest **üle tähtaja**
- **Arveldamata** — valmis tööd, mis ei ole ühelgi arvel. Kulu on juba kantud,
  tulu mitte: kõige kiirem koht, kust raha leida

**Välja**
- **Tööjõukulu (arvestatud)** — sama mootor, mis Töötasud (`lib/earnings.ts`),
  nii et statistika ja palgaleht ei saa erineda
- **Välja makstud** — külmutatud väljamaksed
- **Materjalikulu** — uus, vt allpool
- **Muudatuste kahju** — tööjõud + materjal − muudatuse eest tasutud

**Materjali omahind — uus väli (migratsioon 023)**
- Seaded → Hinnad materjalitabelis on nüüd kaks veergu juurde: **omahind** väikese
  ja suure hamba kohta
- Põhjus: `material_prices` on **müügihind**, mis läheb arvele. Mitte kusagil ei
  olnud kirjas, mis materjal laborile maksab, seega "kui palju töö sisse tõi"
  oli vastatav ja "kui palju see teenis" mitte
- Omahinda ei lisata kunagi arvele — sellest arvutatakse ainult kate
- Tühi tähendab **teadmata**, mitte tasuta

**Kate**
- Kate = arveldatud − tööjõud − materjal, koos katteprotsendiga
- Arvutatud **arveldatud** summast, mitte tööde hindadest: arve on see, mille saab
  reaalselt sisse nõuda
- Üldkulud (rent, seadmed, tarkvara) ei ole arvestatud ja seda on ka öeldud

**Kate töö tüübi järgi**
- Iga töö tüübi kohta: töid, arveldatud, tööjõud, materjal, kate, kate %
- Vastab küsimusele, milline töö tegelikult teenib — mitte milline on kalleim

**Muudatuste kahju põhjuse järgi**
- Iga põhjuse (Vale disain, Patsiendi soov, …) kohta: mitu korda, tööjõud,
  materjal, tasutud, **netokahju**
- Eristab labori enda vea kliendi soovist — see on see, mida saab juhtida
- Kui muudatused ei ole tasureeglis tasustatud, on tööjõukulu 0: aeg läheb siis
  kaotsi tööajana, mitte rahana. Ka see on kirjas

**Töötajate kaupa**
- Töid, hambaid, arvestatud tasu, välja makstud

**Numbrid ütlevad, mida nad ei näe**
- Tööjõukulu ja materjalikulu näitavad katvust: "12/20 tööl on teostaja — 8 tööd puudu"
- Ilma selleta oleks määramata teostajaga töödest tekkinud kate, mis näeb hea välja
  ja on väljamõeldis. Osaline arv, mis end täisarvuna esitab, on halvem kui arv puudu

---

## [1.9.0] — 2026-07-30 — Töötasud (Phase 4b)
**Käivita:** `sql/022_worker_pay.sql` (Wivo kinni enne).

**Paindlik tasumudel — reeglite loend, mitte palgaväli**
- Labor ei maksa ühtemoodi: administraator tunnitasu, tehnik 15 €/hammas, aga
  täiskaar fikseeritud summa, disaini eest lisatasu peale. Üks `palk` väli seda
  väljendada ei suuda, seega on tasu **reeglite loend** inimese kohta
- Kuus liiki: **hamba tasu**, **töö tasu** (fikseeritud), **% töö hinnast**,
  **tunnitasu**, **kuutasu**, **disaini lisatasu**
- Iga reegel võib kehtida ainult ühele töö tüübile. Töö tüübiga reegel on
  ülimuslik üldise ees — nii toimib "15 €/hammas, aga Allon4 on 200 €/töö"
  ilma et üldreegel selle vaikselt üle kirjutaks
- Ühe töö kohta rakendub täpselt üks tootmisreegel; disaini lisatasu liidetakse peale
- Reeglitel on kehtivusaeg (`active_from` / `active_to`), et vana töö
  arvestataks vana määraga

**Kes töö tegi**
- Töö vormil kaks uut välja: **Teostaja** ja **Disainija**
- Kaks eraldi välja, sest disain on eraldi tasustatud: sageli sama inimene,
  vahel mitte, vahel sisse ostetud (jäta tühjaks)
- Tühi on õige vastus — sundvalik paneks palgaaruandesse olematuid inimesi

**Muudatused (rework)**
- Vaikimisi **tasustamata**: tavaline juhtum on labori enda veast tingitud
  ümbertegemine, mille eest teist korda ei maksta
- Lülitatav reeglipõhiselt sisse, kui muudatused on tasustatav töö

**Töötunnid**
- Tunnipõhiste inimeste jaoks: kuupäev, tunnid, märkus
- Töötaja saab sisestada enda tunde, omanik kõigi omi

**Uus vaade "Töötasud"**
- Kuu kaupa, iga töötaja arvestamata read koos allikaga (töö, muudatus, disain, tunnid)
- Arvestatakse ainult **valmis** töid — pooleli oleva töö eest maksmine tähendaks
  praaki minnes tagasinõuet, mida see süsteem teadlikult ei toeta
- "Kinnita väljamakse" **külmutab read**: määra hilisem muutmine juba makstud
  perioodi ümber ei arvuta. Sama reegel, mis arvetel
- Juba väljamakstud töö ei ilmu enam järgmise perioodi arvestusse
- Töötaja näeb ainult iseennast; omanik näeb kõiki (jõustatud RLS-is, mitte ainult UI-s)

**Kuutasu ja osalised perioodid**
- Kuutasu makstakse perioodi kohta täies ulatuses, mitte proportsionaalselt.
  Osalise kuu reeglit ei ole keegi öelnud, seega on rida nähtav ja käsitsi
  parandatav, mitte vaikne murdosa

**Turvalisus**
- Palgaandmed on RLS-iga piiratud: igaüks näeb enda määra, tunde ja väljamakseid,
  omanik kõiki. Palk ei ole kogu kliiniku asi

---

## [1.8.0] — 2026-07-30 — Arved ja maksed (Phase 4)
**Käivita:** `sql/020_invoices.sql` (Wivo kinni enne).
**Valikuline:** `sql/021_legacy_payments.sql` — loe enne käivitamist selle päist.

**Uus jaotis "Arved"**
- Nähtav `payments.read` õigusega, muutmine `payments.write` õigusega
- Nimekiri numbri, patsiendi, kuupäeva, tähtaja, summa ja tasumata jäägiga
- Kokkuvõte: arveldatud, laekunud, tasumata, üle tähtaja — arvutatud
  **nähtava nimekirja** põhjal, mitte kõigi arvete pealt, et filtreeritud vaate
  kokkuvõte ei kirjeldaks teist hulka kui tabel selle all
- Filtrid: kõik / tasumata / mustandid / saadetud / makstud, otsing numbri ja nime järgi

**Arve koostamine**
- Vali patsient → näed tema **arveldamata** töid ja muudatusi, klõps lisab rea
- Juba arvel olev töö ei ole enam valikus: sama töö kaks korda arveldamine on
  viga, mida see ekraan peab kõige enam ära hoidma
- Muudatused on eraldi read (oma hind, sageli eraldi arveldatavad)
- Käsitsi ridade lisamine (transport, allahindlus vms)
- Ridade kirjeldus ja hind **kopeeritakse töölt arve koostamise hetkel**, mitte ei
  loeta iga kord uuesti: väljastatud arvet ei tohi hiljem töö hinna muutmine ümber kirjutada

**Maksed**
- Osalised maksed: makse summa, viis (ülekanne/sularaha/kaart/muu), kuupäev, viide
- Tasumata jääk arvutatakse maksete summast, mitte lipust
- Täies ulatuses tasumine märgib arve automaatselt makstuks, et nimekiri ja seis
  ei läheks lahku
- Makse saab kustutada (vale sisestus)

**Arve number**
- Kliiniku- ja aastapõhine järjekord (nt `2026-0001`), genereeritud **andmebaasis**
- Põhjus: kaks samal hetkel arvet väljastavat töökohta loeksid mõlemad "viimane oli 6"
  ja kirjutaksid mõlemad 7. Lünk või kordus arvenumbrites on auditi leid
- Unikaalsus jõustatud `(clinic_id, number)` indeksiga

**Summad**
- Netosumma, käibemaks ja kogusumma arvutab **andmebaasi trigger** ridade pealt
- Kliendi arvutatud summa salvestamine tähendaks arvet, mille päis ei klapi
  omaenda ridadega niipea, kui midagi läheb pooleldi valesti
- Käibemaksumäär salvestatakse **arve peale**, mitte ei loeta seadetest —
  määra muutmine järgmisel aastal ei tohi vanu dokumente ümber arvutada

**Trükkimine / PDF**
- "Prindi / salvesta PDF" avab A4 dokumendivaate ja süsteemi prindidialoogi
  (Electron oskab ise PDF-i salvestada — teeki ega fonte juurde ei ole vaja)
- Väljad: müüja andmed koos registrikoodi, KMKR-i ja IBAN-iga, dokumendi number,
  kuupäev ja tähtaeg, read, käibemaks eraldi real, kokku, maksejuhis
- Puuduvate kliiniku rekvisiitide kohta hoiatab riba **enne** printimist
- Prindi-CSS lähtestab kuvasuurenduse 1-le: 125% ekraanieelistus ei tohi
  millimeetrites määratud dokumenti ümber mõõta

**Seaded → Hinnad**
- Käibemaksumäär (vaikimisi **0%** — rakendus ei hakka ise maksu arvele panema;
  kontrolli, milline määr sinu teenustele kehtib)
- Maksetähtaeg päevades (vaikimisi 14)

**Vana `makstud` lipp**
- Jäeti puutumata. Selle teisendamine makseridadeks tähendab finantskirjete
  **väljamõtlemist**, seega on see eraldi valikuline skript `021`, mille omanik
  käivitab teadlikult
- Skript märgistab loodud read (`Imporditud: makstud-lipp (021)`), tähistab
  tuletatud kuupäevad, on korduvkäivitatav ja tagasivõetav ühe DELETE-ga
- Skripti päis loetleb täpselt, mida ta oletab

---

## [1.7.15] — 2026-07-30
**Käivita:** `sql/019_clinic_settings.sql` (Wivo kinni enne).

**Kliiniku seaded kolivad andmebaasi — enne arvete moodulit, mitte pärast**
- Töö tüübid (nimi, värv, hind), materjalid ja nende hinnad, masinad, töö etapid,
  hinnastamise ja kalendri seaded olid seni `localStorage`-is ehk **arvutipõhised**
- See tähendas, et kaks töökohta samas kliinikus võisid sama töö eest küsida eri hinda
  ja miski ei viinud neid kokku
- Phase 4 (arved) ehitatakse just nende numbrite peale — arve rida, mille hind sõltus
  sellest, millises arvutis see loodi, on defekt, mis tuleb välja auditil, mitte laua taga
- Uus tabel `clinic_settings`, üks rida kliiniku kohta, RLS `my_clinic_id()` järgi
- Reaalaja tellimus: omaniku arvutis muudetud hind jõuab teistesse töökohtadesse
  ilma taaskäivituseta

**Mis jääb arvutipõhiseks**
- Teema, teksti suurus, külgriba, kasutaja nimi — need on isiklikud eelistused ja
  neid ei ole mõtet kliinikuga jagada
- Seadete jaotus "Minu eelistused" vs kliiniku omad (1.7.13) vastab nüüd täpselt
  sellele, mis on andmebaasis ja mis mitte

**Üleminek olemasolevatelt seadetelt**
- Esimesel käivitusel pärast migratsiooni loeb rakendus kliiniku rea; kui seda pole,
  **külvab selle sinu praeguse seadistuse põhjal** — juba sisestatud hinnad ja töö
  tüübid liiguvad serverisse, neid ei asendata vaikeväärtustega
- Kui rida on juba olemas, võidab andmebaas ja `localStorage` jääb vahemäluks,
  et esimene ekraanitäis oleks kohe õige ja rakendus töötaks ka ilma ühenduseta
- Kui kaks arvutit külvavad korraga, võidab esimene — teise oma ei kirjuta üle

**Kirjutamine**
- Iga jaotis on eraldi jsonb veerg ja salvestatakse ainult see, mis tegelikult muutus:
  kalendri kellaaegade muutja ei kirjuta üle hinda, mille keegi teine hetk tagasi muutis
- Kirjutused kogutakse kokku ja saadetakse 400 ms pärast — hinna kerimine ei tähenda
  päringut iga klahvivajutuse kohta
- Oma kirjutuse reaalaja kaja jäetakse vahele, muidu kirjutaks see üle selle,
  mida kasutaja vahepeal juba trükkis

**Õigused**
- Kliiniku seadeid muudab omanik; töötajale näidatakse neid loetavana
- See ei ole kosmeetika: ilma selleta salvestuks töötaja muudatus tema enda arvutisse
  ega jõuaks kunagi kliinikusse — täpselt see hajumine, mille pärast need seaded
  andmebaasi kolisid. Päris jõustamine on RLS poliitikas
- Seadete lehel on riba, mis ütleb otse, kas muudatused kehtivad kogu kliinikule
  või ainult sellesse arvutisse (ja miks), koos viimase muutmise ajaga
- **Teadaolev tagajärg:** `pipeline.write` õigusega töötaja näeb Töö etappe, kuid ei
  saa neid praegu muuta — `clinic_settings` kirjutusõigus on veerupõhiseta ja seetõttu
  omaniku päralt. Peenem poliitika tuleb koos Phase 4-ga

---

## [1.7.14] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Kalendri töö tüübi filter tuleb nüüd seadetest**
- Varem koostati valikud tööde `too` vabatekstist, mistõttu filtris seisid kategooriatena ühekordsed kirjapildid: "D11-22 ajutine sild", "D14 abutmendile kroon", "all-on5"
- Nüüd on valikud **Seaded → Valikud → Töö tüübid** nimekiri, iga rea ees oma värvitäpp
- Filtreerimine käib lahendatud tüübi järgi: "Implantkroon" valimine leiab kõik kirjapildid, sh "D14 abutmendile kroon"
- "Muu / määramata" valik ilmub ainult siis, kui midagi tõesti jääb nimekirjast välja

**Töö tüüpidel on nüüd hind küljes — üks nimekiri, mitte kaks**
- `tooHinnad` eraldi tabel kaotatud; hind on nüüd töö tüübi väli (`hind`)
- Põhjus: töö tüüp ja selle hind on üks fakt, ning kaks vabatekstiga seotud nimekirja lähevad lahku kohe, kui üht ümber nimetada
- Hinnad → Tööde hinnad näitab sama nimekirja, mis Valikud → Töö tüübid; tühi väli tähendab "hinnasta hammaste järgi"
- Valikud lehel on hind real näha (nt "150.00 €/töö")
- Varem sisestatud hinnad tõstetakse automaatselt tüüpide külge

**Kõik töötüüpide värvid tulevad nüüd seadetest**
- Leitud ja kõrvaldatud veel kaks kohta, kus värvid olid koodi sisse kirjutatud:
  töö kaardi vasak serv tahvlil (`getJobTypeBorderColor`) ja töö paneeli ülemine riba (`getJobTypeBg`)
- Valmis-veeru liitkaart arvutas tausta klassinime stringivahetusega ("border-l-blue-400" → "bg-blue-100") — see ei saanud kuidagi töötada kasutaja valitud värvidega; nüüd sama hex 15% tugevusega

**Töö tüüpide värviparandus**
- 1.7.13 migratsioon otsis värvi täpse nimega, mistõttu 1.7.12 nimekirjast tulnud "Allon4" jäi halliks — sisseehitatud tüüp kannab nime "All-on-X"
- Nüüd kasutab migratsioon sama sünonüümide tabelit, mis kogu ülejäänud rakendus: "Allon4" → All-on-X, "Abutmendile kroon" → Implantkroon, "Nightguard" → Kaitse / splint
- Ühekordne parandus ka juba salvestatud nimekirjadele: hallile jäänud nimeline tüüp saab õige värvi tagasi. Käivitub üks kord, nii et hiljem teadlikult valitud halli üle ei kirjutata

**Filtri otsing ja vastete navigeerimine**
- Pikemates filtriloendites (üle 6 valiku) on nüüd otsinguväli — patsienti ei pea enam sadade nimede seast kerima
- Juba valitud kirjed jäävad otsingu ajal nähtavaks
- Filtri all olevad päevad on kalendris punase täpiga märgitud
- "Esmaspäev" lahtris on vastete loendur `1/7` koos nooltega — klõps viib vastele, kalender kerib selle vaatesse ja päev saab punase raami
- Vajalik seetõttu, et kalendririba katab ±3 kuud: filtri vasted on tavaliselt ekraanilt väljas

---

## [1.7.13] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Teksti suurus töötab nüüd päriselt — kohe, ilma salvestamise ja taaskäivituseta**
- 1.7.11 kasutas Electroni akna suumi, mis nõuab preload-silda; kui sild puudus (vana preload mälus, brauseri aken), vajus seade vaikselt läbi ja tundus katki
- Nüüd CSS `zoom` `#root` peal, mida juhib `--ui-scale` muutuja — sama dokument, mis liidese joonistab, ei saa olla pooleldi paigaldatud
- `#root` kompenseerib oma laiuse ja kõrguse (`calc(100% / var(--ui-scale))`), nii et 125% juures ei teki kerimisriba
- Paneelid, mis olid mõõdetud vh/vw-s, kasutavad nüüd `.h-panel` / `.max-w-dialog` klasse, mis jagavad sama muutujaga läbi
- Preload-sild eemaldatud — üks mehhanism, mitte kaks

**Seaded jagatud: minu eelistused vs kliiniku seaded**
- "Minu eelistused" (Profiil, Kasutajaliides) on nähtav igale töötajale ilma õigusteta — teksti suurus ja teema on localStorage-põhised isiklikud eelistused, mitte kliiniku andmed
- Kliinik, Valikud, Masinad, Hinnad, Kalender nõuavad nüüd `settings.read` õigust
- Töö etapid nõuab `pipeline.write` õigust (iga nupp seal kirjutab)
- Vastus küsimusele "kuidas töötaja fonti muudab, kui ma talle seadete õigust ei anna": teksti suurus ei ole enam õiguse taga

**Töö tüübid on nüüd muudetavad — nimi JA värv**
- Varem oli 14 töötüüpi värvidega koodi sisse kirjutatud, mistõttu kalendri legend näitas asju, mida seadetes muuta ei saanud
- Seaded → Valikud → Töö tüübid: lisa, nimeta ümber, muuda värvi, muuda järjekorda, eemalda, lähtesta
- Värvipalett ja rea kujundus samad, mis töö etappidel
- Järjekord = sobitamise järjekord ("Implantkroon" peab olema "Kroon" kohal); nooltega liigutatav
- Sisseehitatud sünonüümid (nt "abutmendile" → Implantkroon) on real näha
- Kalender, legend ja statistika loevad värve nüüd `useWorkTypes()` kaudu, mis on seadete külge tellitud — värvi muutmine värvib kaardid ja legendi samas renderis
- Legendi täpp on nüüd täisvärv (varem 12% läbipaistvusega täidis, mis navy taustal muutus kõik ühte halli tooni)

**Statistika**
- "Hambad töötüübi järgi" → **"Tööd töötüübi järgi"**: loeb töid, mitte hambaid. Üks 14 hambaga Allon4 on üks töö, mitte 14 — hammaste lugemine lasi täiskaare tööd kõige muu üle domineerida
- **Top patsiendid**: suurima patsiendi nimi puudus. Recharts jätab vaikimisi (`interval="preserveEnd"`) sildid ära, kui need ei mahu — 8 rida 180px sees ei mahtunud. Nüüd `interval={0}` ja kõrgus kasvab ridade arvuga (26px/rida)
- Nimede veerg 118px, pikad nimed lõigatakse kolmikpunktiga; kahekordne ruumibroneering (margin + axis width) eemaldatud, nii et tulpadele jääb rohkem laiust

**Hinnad → Tööde hinnad (€/töö)**
- Uus hinnakiri töö tüübi kaupa: lisa, muuda, eemalda
- Terve töö hind, mitte hamba hind — kui töö tüübil on hind, kasutab autoarvutus seda ja jätab hamba-põhise arvutuse vahele
- Sobitub ka variantidega: "Allon4 ülemine" leiab kirje "Allon4" (pikim sobiv kirje võidab, sama reegel mis materjalidel)
- Kehtib ka enne hammaste valimist — töö hinnastatakse tööna
- Autoarvutuse plokk näitab rida "1 × Allon4 (hind töö kohta)" hamba-ridade asemel

**Kalender**
- Filtririba asendatud filtriikooniga "Esmaspäev" lahtris — klõps avab akna patsiendi, töö tüübi ja arsti filtritega
- Aktiivsete filtrite arv on ikoonil punase märgisena
- Vabastab ~44px kalendri kõrgust, mida kolm enamasti tegevusetut nuppu enne hõivasid

---

## [1.7.12] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Kohandatavad valikud — masinad, materjalid ja töö tüübid**
- Uus seadete jaotis **Valikud** (Töö ja tootmine all): materjalide ja töö tüüpide loendid
- **Masinad** jaotis: lisaks vaikimisi masina valikule saab nüüd masinaid ise lisada, ümber nimetada ja eemaldada
- Kõik kolm loendit olid varem koodi sisse kirjutatud (`Pro2`/`Midas`, 7 materjali, 16 töö tüüpi) — kolmanda printeri või oma materjaliga labor pidi selle iga kord käsitsi sisse tippima
- Nimetuse muutmiseks klõpsa sildil; eemaldamiseks prügikasti ikoon; "Lähtesta" toob vaikimisi loendi tagasi
- Dubleerivad kirjed blokeeritakse (tõstutundetu võrdlus)
- Uus materjal ilmub automaatselt hinnatabelisse (Hinnad → Hind materjali järgi)
- Töö tüüpide loend toidab töö vormi "Töö" välja soovitusi — väli ise jääb vabaks tekstiks
- Loendi tühjaks jätmine on lubatud valik: vormil lihtsalt ei näidata nuppe, vaba tekst töötab edasi
- Nimetuse muutmine ei muuda juba salvestatud töid — need jäävad vana väärtusega

---

## [1.7.11] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Teksti suurus muudetav — Seaded → Kasutajaliides**
- 5 valmis astet (Väike 90% … Väga suur 140%) + liugur vahemikus 80–160%
- Iga aste näitab enda suurust nupu peal
- Kehtib kohe ja jääb meelde (localStorage)
- Skaleerib kogu kasutajaliidese ühtlaselt — tekst, ikoonid ja vahed koos, paigutus ei lagune
- Tehniliselt: Electroni akna suum (`webFrame.setZoomFactor`), mitte `font-size`. Rakenduses on ~200 kohta, kus tekstisuurus on antud kindlas pikslis (`text-[10px]`) — font-size skaleerimine oleks kasvatanud poole tekstist ja jätnud tihedaima osa, mille kohta kurdetakse, puutumata
- Vigane või liiga suur salvestatud väärtus lõigatakse 80–160% vahemikku, et liidest ei saaks kasutuskõlbmatuks seadistada

---

## [1.7.10] — 2026-07-30
Andmebaasi muudatusi ei ole.

**Muudatused on nüüd kalendris nähtavad**
- Varem näitas kalender ainult originaaltöid — muudatused olid peidus, kuigi neil on oma tähtaeg ja oma etapp
- Iga muudatus on nüüd kalendris eraldi kaart oma tähtaja päeval (`deadline`, selle puudumisel muudatuse loomise kuupäev)
- Kaardil navy "Muudatus #N" märgis ja hall ääris — originaaltööst eristatav
- Servavärv näitab muudatuse enda etappi, mitte originaaltöö oma
- "Üle tähtaja" arvutatakse muudatuse enda tähtaja ja etapi järgi — valmis originaaltöö ei kata enam pooleliolevat muudatust
- Päeva loendur näitab eraldi töid (⚡) ja muudatusi (⤶)
- Topeltklõps muudatusel avab töö kaardi otse selle muudatuse peal
- Parem paneel näitab muudatuse põhjust ja kirjeldust; päeva kokkuvõttes uus rida "Muudatusi"
- Patsiendi ja töötüübi filtrid kehtivad ka muudatustele (päritakse originaaltöölt)
- Legendi lisatud "Muudatus (oma tähtaeg)"

---

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
