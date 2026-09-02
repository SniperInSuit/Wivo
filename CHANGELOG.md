# Changelog

## [1.60.1] — 2026-09-02

**Cron ütles „succeeded" ja ükski arve ei liikunud**

02.09 hommikul jäi maksegraafiku esimene osamakse saatmata. Saatja ise oli
korras — proovikäivitus leidis arve ja oleks selle õigesse kohta saatnud. Kutsuja
oli katki, ja **see nägi välja nagu töötaks**.

- `net.http_post` on **asünkroonne**: ta paneb päringu järjekorda ja tagastab
  kohe. `cron.job_run_details` näeb, et SQL-lause õnnestus, ja kirjutab
  „succeeded" ka siis, kui funktsioon vastas 401-ga. Minu `sql/052` kontrollplokk
  käskis vaadata täpselt seda välja, mis mõlemal juhul roheline on
- Kontrollplokk parandatud: õige koht on `net._http_response`, ja seal on ka
  kirjas, mida iga staatuskood tähendab. Kõige tõenäolisem põhjus on
  `<SERVICE_ROLE_KEY>` asendamata jäämine — siis läks Vaulti see string ise
- **Saatja stampib nüüd südamelöögi** (`email.viimane_kaivitus`) igal käivitusel,
  ka siis kui saata ei olnud midagi. Seaded → E-post näitab „viimati käis X
  tagasi" ja muutub oranžiks kolme tunni järel
- See on ainus nähtav sümptom: kõik lülitid võivad olla rohelised ja mitte midagi
  liikuda, sest tõrge on kutsuja pool. Nüüd ütleb ekraan seda ise

## [1.60.0] — 2026-09-01

**23 uut paneeli, viis uut meetrikamoodulit — ja üks grupp, mis ei plaani midagi**

Kataloogis on nüüd **56 paneeli**. Iga uus number elab `lib/`-is koos testidega,
mitte paneeli sees — paneel jääb puhtaks renderdajaks.

**Raha (`lib/invoiceMetrics.ts`)**
- **Võlgnevuse vanus** — 1–30 / 31–60 / 61–90 / 90+ päeva, vanem võlg punasem
- **Keskmine laekumisaeg** — päevi arvest rahani, ainult perioodil lõplikult
  tasutud arvete pealt, nii et number liigub värske käitumisega. Kui midagi ei
  ole tasutud, on vastus „—", mitte 0
- **Käibemaks perioodis** — `vat_total` oli olemas ja seda ei liidetud kusagil
- **Keskmine arve**

**Ühikumajandus (`lib/unitEconomics.ts`)**
- **Kasum töö kohta** ja **kate/kulu hamba kohta** — sinu „work per profit"
- **Kulude osakaal tulust** — tööjõud, materjal, üldkulud protsendina
- **Tulu tööpäeva kohta** — E–R, tänaseni, nagu üldkuludki
- Iga jagatis annab nulli nimetaja korral **`null`**, mitte NaN ega enesekindla 0

**Tootmine (`lib/throughput.ts`)**
- **Tähtajaks valmis %** — tähtajata töö ei loe kummalegi poole, vaid katvusse
- **Läbiaja jaotus** — mediaan, 90. protsentiil, kiireim, aeglaseim. Keskmine
  üksi varjab saba
- **Tarne seis ja tarneaeg** — `delivery_status` on olnud olemas migratsioonist
  035 ja seda ei näidatud statistikas kordagi
- **Koormus nädalapäeva järgi** — saabunud vs valminud, esmaspäev ees

**Kliendid (`lib/customerStats.ts`)**
- **Top kliendid**, **maksedistsipliin**, **aktiivsed ja uued**, **magavad
  kliendid** (90 päeva). `customer_id` on olnud tööl ja arvel alates 1.28 ning
  seda ei agregeeritud kunagi
- Kliendita töö läheb **„Määramata"** alla, mitte prügikasti: labor, kes välja ei
  täida, näeks muidu tühja paneeli ja järeldaks, et tal pole kliente

**Lõbus teada (`lib/funFacts.ts`)** — uus grupp ja oma valmisvaade
- **Hambaid kokku** kogu aeg, ümber arvutatud täissuudeks (32 hammast)
- **Rekordid** — suurim töö, tihedaim päev, kiireim ja aeglaseim
- **Pikim veatu seeria** — mitu valmis tööd järjest ilma muudatuseta
- **Lemmikud** — sagedaseim värv, materjalide arv, hambakaardi katvus 32-st,
  lojaalseim patsient, sagedaseim ümbertegemise põhjus
- **Tempo** — nädalavahetusel valminud tööd, kiirtööde osakaal
- **Kaua me juba teeme** — esimesest tööst tänaseni
- Kõik kogu aja peale ja **iga paneel ütleb seda ise**, et ta ei loeks perioodi
  numbrite seas perioodi numbrina

**Muu**
- Register nõuab **õigust igalt paneelilt, mis raha puudutab** — nüüd ka
  arvete, ühikumajanduse ja kliendikäibe omadelt. Test loetleb erandid käsitsi,
  nii et uus rahapaneel ei saa nende hulka kogemata sattuda
- „Lõbus teada" ei tohi testi järgi sisaldada ühtegi õigust nõudvat paneeli —
  uudishimu, mis vajab `payments.read`, on rahapaneel naeratusega
- Uued arvutused käivad ainult siis, kui mõni **nähtav** paneel neid küsib
- Valmisvaated said uued paneelid sisse; juurde tuli **„Lõbus"**

## [1.59.1] — 2026-09-01

**Joon on liigutatava paneeli mõõtu, ja kukutamine läheb sinna, kuhu joon lubas**

- **Tihe pakkimine (`grid-auto-flow: dense`) välja.** See oli tegelik põhjus,
  miks paneel maandus mujal, kui joon näitas: tihe pakkimine tõstab hilisema
  kaardi ettepoole, et auk täita, nii et **nähtav asukoht ei vasta enam
  järjekorrale** — ja järjekord on ainus asi, mida kukutamine muuta saab. Joon
  lubas ühte kohta, brauser valis teise. Auk ruudustikus on vihje midagi ümber
  tõsta või suuremaks teha; paigutus, mis end su selja taga ümber korraldab, ei
  ole üldse paigutatav
- **Reajoon on liigutatava paneeli laiune**, mitte üle terve ekraani. Üle
  ruudustiku ulatuv riba lubas täislaiuses maandumist ja andis midagi muud —
  marker peab olema selle mõõtu, mida ta paigutab
- **Joon algab sealt, kust rida algab.** Mitte alati ruudustiku vasakust servast:
  eelmisest reast ulatuv kõrge kaart võib esimest veergu kinni hoida

## [1.59.0] — 2026-09-01

**Paneeli saab nüüd panna ka teise alla, mitte ainult kõrvale**

Paigutus on lineaarne järjekord, mis voolab ruudustikku — ja senised
sisestuskohad olid ainult „enne" ja „pärast" ühte kaarti, mõlemad vertikaalse
joonena kaardi küljel. „Selle alla" ei olnud lihtsalt olemas, ükskõik kui täpselt
sihtida.

- **Reapiiridest said päris sisestuskohad.** Iga rea kohal ja viimase rea all on
  koht, mis tähendab „alusta siit uus rida". Voolavas ruudustikus ongi „selle
  kaardi alla" sama mis „järgmise rea algusesse" — nüüd on see ka pakutav
- **Kaks joont, kaks tähendust.** Vertikaalne riba kaartide vahel = „nende kahe
  vahele". Üle ruudustiku ulatuv horisontaalne riba = „siia, uuele reale"
- **Kaardi keskosa pakub külge, ülemine ja alumine kolmandik rida.** Reariba
  ulatub üle terve ruudustiku, nii et ilma käsitsi seatud eelistuseta võidaks ta
  igalt poolt — väikese kaardi küljevahe on 200 px kaugusel, tema reapiir 60
- **Marker joonistatakse ruudustiku peale**, mitte kaardi sisse. Kaardi sees
  saab riba olla ainult nii kõrge kui kaart ise — seepärast ei olnud reapiiri
  üldse võimalik näidata
- Sisestuskoht on nüüd **indeks järjekorras**, mitte „selle kaardi see külg".
  Sama mõiste, mida salvestus niikuinii hoiab, ja üks teisendus vähem

## [1.58.3] — 2026-09-01

**Lohistamine töötab jälle — `popLayout` kirjutas mõõtmise üle**

1.58.2 tegi näidisjoone koha sõltuvaks paneelide ristkülikutest, mis koguti
React-i `ref`-idesse. Need jäid tühjaks, sest **`AnimatePresence mode="popLayout"`
renderdab iga lapse läbi `cloneElement(children, { ref })` — ja asendab lapse
enda `ref`-i omaga.** Ilma ristkülikuteta ei leidnud otsing ühtegi pesa: joont ei
tekkinud ja kukutamisel ei liikunud midagi.

- **Ristkülikud loetakse DOM-ist** `data-panel-id` järgi, mitte `ref`-idest.
  Ükski teegi ümbris ega kloonimine ei saa seda enam vahelt ära võtta
- **`popLayout` eemaldatud.** Ta andis lahkuvale paneelile pisut sujuvama
  kadumise ja võttis vastu kogu ülejäänud lohistamise — vale vahetus
- **Lohistamise olek elab `ref`-ides**, mitte ainult `useState`-is. `setDragId`
  jõustub alles järgmisel renderdusel, aga `dragover` hakkab pihta kohe: käsitleja,
  mis luges veel tühja olekut, ei kutsunud `preventDefault`-i ja brauser luges
  kogu ruudustiku kohaks, kuhu kukutada ei tohi
- **`preventDefault` käib nüüd iga `dragover` peale**, enne igasugust
  vahelejätmist. Mõõtmist tohib vahele jätta, vastuvõtmist mitte
- Natiivsed lohistamiskäsitlejad istuvad tavalisel `div`-il `motion.div` sees.
  Framer edastab `onDrag*` ainult siis, kui `draggable` on tõene — see kehtis,
  aga kaudne sõltuvus teegi erandist ei ole koht, kus lohistamine peaks seisma
- `dataTransfer` saab `effectAllowed`, `dropEffect` ja nime, nii et lohistamine
  on platvormi jaoks korrektne, mitte lihtsalt enamasti töötav

## [1.58.2] — 2026-09-01

**Näidisjoon järgib hiirt, mitte seda, kes sündmuse kätte sai**

- **Koht arvutatakse kursori koordinaadist.** Varem küsis joone asukohta see
  paneel, mis `dragover` sündmuse kätte sai — aga **kastide vaheline tühimik ei
  kuulu ühelegi paneelile**, ja just sinna paneb kursori see, kes sihib „nende
  kahe vahele". Sündmust ei tulnud kellelegi ja marker jäi rippuma sinna, kus ta
  viimati oli. Nüüd kuulab sündmust ruudustik ise ja lähim pesa leitakse
  koordinaadist
- **Rida enne, siis külg.** Kursoriga samal real olev paneel võidab alati selle,
  mis on linnulennult lähemal, aga rea võrra eemal — see oli põhjus, miks joon
  hüppas kolm rida allapoole
- **Vasak või parem pool paneeli keskkohast** otsustab, kummale servale joon
  läheb. Kahe kaardi vahel annavad mõlemad naabrid sama pesa, nii et joon on
  seal, kuhu kursor osutab, sõltumata sellest, kummast küljest lähened
- **Enda peal hõljudes joont ei ole** — lohistatava paneeli enda kohal ei ole
  liigutust, mida soovitada
- Ümberarvutus jäetakse vahele, kui kursor on liikunud alla nelja piksli

## [1.58.1] — 2026-09-01

**Lohistamine: joon näitab kohta, plokid liiguvad sujuvalt**

- **Joon näitab, kuhu paneel läheb.** Kursori poolel olev sinine joon selle
  paneeli serval, mille kõrvale kukutad — „nende kahe vahele" on näha, mitte
  arvata. Joon ise libiseb serva pealt servale, mitte ei hüppa
- **Ruudustik ei paiguta end enam lohistamise ajal ümber.** Varem tõsteti
  paneelid iga `dragover` sündmuse peale ringi, mitu korda sekundis — miski ei
  seisnud paigal piisavalt kaua, et selle peale sihtida. Nüüd liigub paigutus
  ühe korra, kukutamisel
- **Kõik liigub kohale ~0.34 s jooksul**, tugevalt aeglustuva kõveraga: paneel
  saabub settides, mitte ei jää järsku seisma. Sama animatsioon kehtib ka
  suuruse muutmisel ja paneeli lisamisel või eemaldamisel
- Lahkuv paneel võetakse enne teiste liikumist voost välja, nii et augu
  sulgumine on liuglemine, mitte hüpe
- `dragleave` ei kustuta enam joont, kui kursor liigub paneeli **enda lapse**
  peale — diagrammi või tabelilahtri kohal vilkus joon täpselt seal, kuhu
  kasutaja sihtis
- Süsteemi „vähenda liikumist" seade lülitab animatsiooni välja

## [1.58.0] — 2026-09-01

**Paneelide suurus ja paigutus — ruutudes, mitte pikslites**

„Minu vaade" sai juurde selle, milleta järjekord üksi oli odav: iga paneeli saab
suuremaks ja väiksemaks teha ning ruudustikus ümber lohistada.

- **Neljaveeruline ruudustik**, paneel on `[veergu, rida]`. Laius 1–4, kõrgus
  1–6, kus 6 rida ≈ ekraanitäis. Kaheksa nimega suurust — Väike, Lai, Kõrge,
  Ruut, Suur, Täislaius, Pikk, Täisekraan — ja kahe nupuga sammud selle jaoks,
  mida nimekiri ei kata
- **Ruudud, mitte pikslid.** Sama salvestatud paigutus on õige sülearvutis, 27"
  ekraanil ja 125% tekstisuurusega. Vabalt venitatav paneel salvestaks arvu, mis
  kehtib ainult selles masinas, kus seda lohistati
- **„Paiguta" režiim.** Lohistamine ja suuruse muutmine on nupu taga, sest
  alati lohistatav kaart võitleb iga diagrammi tooltipi, iga tabeli kerimise ja
  iga tekstivalikuga. Väljas = puhas töölaud, sees = kaartidel käepide,
  suurusemenüü ja eemaldusnupp
- **Tihe pakkimine** (`grid-auto-flow: dense`): kitsas paneel laia järel täidab
  augu, mitte ei jäta seda lahti
- **Sisu venib kaasa** — diagramm kasvab paneeliga, pikk nimekiri kerib paneeli
  sees, tabel kerib horisontaalselt. Suurus muudab seda, kui palju näed, mitte
  ainult tühja ruumi ümber sama pildi
- **Suurused elavad eraldi kaardis** (`sizes`), mitte paneeli kirje sees. Nii
  jääb `panels` puhtaks id-de nimekirjaks ja vanem versioon, mis mõne id kohta
  midagi ei tea, ei pea säilitama ka selle sisemist kuju. Suurus säilib, kui
  paneel korraks eemaldada ja tagasi panna, ja klammerdub ruudustikku ka siis,
  kui salvestuses on 99×99
- Suuruse muutmine **ei tühista valmisvaate silti** — valmisvaade otsustab, mida
  sa näed, mitte kui suur see on. Ümberpaigutamine ja eemaldamine tühistavad

## [1.57.0] — 2026-09-01

**Minu vaade: Statistika, mille iga inimene ise kokku paneb**

Uus vahekaart „Minu vaade" Statistika lehel: vali kataloogist paneelid, lohista
järjekorda, või võta valmisvaade. Valik käib **konto küljes** ja tuleb kaasa
igasse masinasse. **Vajab migratsiooni `sql/055_profile_ui_prefs.sql`.**

- **33 paneeli neljas grupis** — raha ja kasum, ühikumajandus, tootmine ja
  tähtajad, kliendid ja inimesed. Kõik loevad juba olemasolevaid arvutusi
- **Valmisvaated**: Juht · Finantsjuht · Tootmisjuht · Tehnik · Tootmine ·
  Rahandus. Lähtepunkt, mitte lukk — esimene käsitsi muudatus teeb vaate sinu
  omaks ja silt muutub „Kohandatud". „Tehnik" ei sisalda ühtegi rahapaneeli
  **ehituse poolest**, mitte ainult õiguste tõttu
- **Iga paneel kannab õigust.** Statistika leht ei küsinud seni `can()` mitte
  kordagi — `stats.read` piisas, et näha iga inimese teenistust. Rahapaneelid
  nõuavad nüüd `payments.read`, palgapaneelid `payroll.manage`, ja paneel,
  milleks õigust ei ole, **ei ole kataloogis** ega renderdu ka siis, kui
  salvestatud nimekiri teda nimetab
- **Tundmatu paneel jääb alles.** Uuema versiooniga lisatud paneel, mida vanem
  masin ei tunne, säilib salvestuses koos oma kohaga järjekorras — teda lihtsalt
  ei joonistata. Vanem klient, mis kustutaks selle, mida ta ei tunne, kaotaks
  teises arvutis tehtud valiku jäädavalt ja vaikselt
- **Tühi nimekiri ei ole sama mis puuduv.** „Võtsin kõik ära" jääb kehtima;
  „pole kunagi kohandanud" annab rolli vaikevaate, mida **ei kirjutata
  andmebaasi** — kaks masinat ei võistle sama konto vaikeseade külvamisega
- **Vahemälu võti kannab kasutaja id-d.** Ühe pingi taga kaht inimest teenindav
  masin ei näita enne sünki teise inimese töölauda
- **Paneelil on oma veapiire**: üks katkine kaart maksab ühe kaardi, mitte terve
  lehe. Rakenduse üldine ErrorBoundary on täisekraani veateade ja siin vale
- **Ainult nähtavad paneelid arvutatakse.** `calculateFinance` jooksutab
  palgamootorit kolm korda töötaja kohta; tehnik, kes vaatab nelja tootmisnumbrit,
  ei maksa selle eest
- Vanad vahekaardid Tootmine ja Rahandus on **puutumata** — sama sisu, sama
  koht. Uus vaade on nende kõrval, mitte nende asemel

## [1.56.0] — 2026-09-01

**Kaks numbrit, mis mõõtsid valet asja**

⚠ **Muudab ajaloolisi numbreid.** Mõlemad allpool näitavad möödunud perioodide
kohta nüüd teist arvu kui eile. Vana number oli vale, mitte teine vaade.

- **„Ø läbiaeg" mõõtis tähtaega, mitte valmimist.** Arvutus käis
  `kuupäev → valmis_aeg`, aga `valmis_aeg` on **tähtaeg**; tegelik valmimine on
  `valmis_kuupaev` — sama eristus, mille peal palgaarvestus seisab. Labor, mis
  jääb igast tähtajast nädala võrra hiljaks, näitas sama läbiaega kui see, mis
  peab kõigist kinni, ja number liikus ainult siis, kui keegi tähtaega muutis
- **„Ø hind / töö" jagas käibe hinnaga tööde arvuga.** Lugeja oli käive (kõik
  perioodi tööd **ja** muudatused), nimetaja „tööd, millel juhtub hind olema" —
  keskmine oli üleval täpselt hinnastamata töö osakaalu võrra. Nüüd jagatakse
  sama ühikuarvuga, mida lugeja kokku loeb
- **Visiitidel ja uutel patsientidel puudus ülempiir.** „See nädal" tähendas
  „esmaspäevast alates, igavesti" — iga tulevane broneering luges selle nädala
  toimunud visiidiks. Töödel sai see parandatud juba varem; visiidid ja
  patsiendid jäid maha
- Mõlemal parandatud numbril on nüüd **katvuse silt**: mitmel valmis tööl
  puudub valmimiskuupäev, mitmel tööl puudub hind. Keskmine, mis vaikselt
  poolt andmetest ei näe, on halvem kui puuduv keskmine
- **`profitOf()`** kolis `lib/finance.ts`-i. „Kasum" on nimega number, mida
  hakkab lugema mitu paneeli, ja vaates arvutatud nimega number on koht, kust
  kaks ekraani hakkavad ühe asja kohta eri vastust andma

## [1.55.0] — 2026-09-01

**Statistika ettevalmistus: üks paan, üks diagrammiteema, kolm parandust**

Ettevalmistus kohandatavale Statistika lehele. Kasutajale nähtav osa on kolm
parandust; ülejäänu on kolimine, mis järgmise etapi võimalikuks teeb.

- **„Töötajate kaupa" veerud olid ühe võrra nihkes.** Töösuhte lahter oli igas
  reas olemas, aga päises mitte, nii et iga veerg kandis oma vasaku naabri
  nime — „Arvestatud" luges „Hambaid" all. Palgatabelis on see see sort viga,
  mille pealt tegutsetakse
- **„€/h tulu / kulu / kate" on tegelikult €/hammas.** Veerud jagasid alati
  hammastega, mitte tundidega. Päris €/tund vajaks tunde töötüübi kaupa, mida
  andmetes ei ole — nimi parandatud, arvutus oli õige
- **Kate töötüübi järgi sorteeris memoiseeritud massiivi paigal.** Renderdamise
  ajal muudeti `calculateFinance`'i enda tulemust; nüüd sorteeritakse koopiat
- **Üks jagatud paan** `ui/StatTile` kahe peaaegu identse asemel. Need olid
  triivinud nii, et kumbki oskas poolt tööd: üks kahepoolset jaotust, teine
  katvuse silti. Segavaates on pool oskust vaikselt kadunud aus
- Diagrammide värvid, tooltip ja telje mõõdud `Dashboard/chartTheme.ts`-i —
  igasse paneeli kopeeritud paletist saab hunnik diagramme, mis triivivad ühe
  commiti kaupa lahku

## [1.54.0] — 2026-09-01

**Neto- või brutopalk, ja iga inimese oma maksuprofiil**

Töötasud luges iga summa brutopalgaks. Kes lepib kokku kättesaadava summa —
enamik väikesi tööandjaid — sai kliiniku kulu, millest oli puudu kogu töötaja
poolt kinnipeetav maksuosa. **Vajab migratsiooni `sql/054_worker_net_pay.sql`.**

- **Bruto/neto valik iga inimese juures.** 1600 € neto (Eesti 2026) on 1923.08 €
  bruto ja **2573.08 € tööandja kulu**, mitte 2140.80 €, mille annab netosumma
  brutona lugemine. Vahe oli 432.28 € kuus ühe inimese pealt ja läks otse
  Statistika kasuminumbrisse
- **Maksuprofiil inimese kaupa: II sammas ja maksuvaba tulu.** 2/4/6% on töötaja
  enda valik ja muudab seda, kui suur bruto on sama neto jaoks vaja. Maksuvaba
  tulu rakendub ainult seal, kus inimene on seda taotlenud — teise tööandja
  juures töötaval inimesel siin mitte
- **NULL ei ole 0.** Tühi väli tähendab „kliiniku vaikeväärtus", 0 tähendab „ei
  ole II sambas" / „maksuvaba tulu ei rakendata". Nende kokkuliitmine paneks
  inimese vaikselt tagasi sambasse, millest ta välja astus
- **Palgaleht töötaja kaardil**: bruto → kogumispension → töötuskindlustus →
  tulumaks → kätte → tööandja maksud → kulu kliinikule
- **Maksumäärad on seaded, mitte konstandid** (Seaded → Hinnad): tulumaks,
  maksuvaba tulu, töötaja töötuskindlustus, II samba vaikemäär. Maksuseadus
  muutub igal aastal ja rakenduse enda välja mõeldud määr oleks kellegi jaoks
  vaikselt vale. Vaikimisi 0 — ja kui keegi on netopalgal, ütleb Töötasud
  eraldi välja, et määrad on seadmata
- **Statistika kasutab sama arvutust.** Tööjõukulu, kate ja kasum on nüüd
  tõelise brutopalga peal, mitte kättesaadava summa peal
- Testid kontrollivad iga numbrit kalkulaator.ee 2026. aasta palgakalkulaatori
  vastu — ise tuletatud palganumber on väärt ainult seda, kui see langeb kokku
  sellega, mille raamatupidaja annab

**Lisaks: kuuvalik Statistika lehel**

- **„Kuu" asendab „See kuu"** — nooled ‹ › naaberkuudele, kuuväli kaugemale,
  „Käesolev kuu" tagasi. Iga muu kuu peale praeguse tähendas seni kahe kuupäeva
  tippimist vahemikuvalijasse
- Valitud kuu liigub edasi tavalise vahemikuna, nii et Tootmine ja Rahandus
  saavad selle ilma ühegi eritingimuseta
- Eemaldatud Rahanduse oma `periodRange`, mis oli jäänud ühise `rangeFor` kõrvale
  kasutuseta seisma — kaks perioodiarvutust ühel lehel on kaks vastust, mis
  jõuavad varem või hiljem lahku

## [1.53.0] — 2026-09-01

**Turunduskontaktide eksport — koos nõusolekuga**

Patsientide kontaktide eksport turunduse jaoks. **Vajab migratsiooni
`sql/053_patient_marketing.sql`.**

- **Nõusolek tehti enne nuppu, mitte pärast.** Patsient andis oma e-posti RAVI
  jaoks; sama nimekirja kasutamine turunduseks on eraldi eesmärk ja vajab eraldi
  alust. Ilma selle veeruta oleks „ekspordi kõik kontaktid" nimekiri, mida ei
  tohi kasutada ja mille kasutamist ei saaks keegi tõestada
- **Kolm olekut, mitte lipp.** `küsimata` ei ole sama mis `ei` — iga tänane
  patsient on „küsimata", ja loobumine peab jääma eristatavaks „ei jõudnud
  küsida" seisust, muidu kaob see esimese andmete puhastuse käigus. Vaikimisi
  nõusolek ei ole nõusolek
- Nõusoleku **aeg** salvestatakse ka tagasivõtmisel: „millal ta ütles ei" on sama
  sage küsimus kui teine
- **Eksport on lubatud veergude nimekiri**, mitte `select *` — täpselt nagu
  avalik `/services` päring. `ravikaart`, `allergiad`, `eelistused`, `lõuad` ja
  märkmed on GDPR art. 9 terviseandmed ja veerg, mida kunagi ei nimetata, ei saa
  lekkida turundustabelisse
- **Nõusolek reisib reaga kaasa.** Postitustööriist, mis nimekirja ilma selleta
  saab, ei saa tagasivõtmist austada
- Nupp ütleb, mitu kontakti tuleb ja **mitu jäetakse välja** — vaikselt kõigi
  eksportimine annaks nimekirja, mida ei tohi kasutada, ilma et ekraan seda
  ütleks

## [1.52.0] — 2026-09-01

**PDF kaasa, `=20` välja, ja tunnine ajastus**

- **PDF manus.** Kiri on see, mida loetakse; manus on see, mille patsient
  salvestab, prindib või raamatupidajale edasi saadab. Mõlemad samast
  `InvoiceDoc`-ist, nii et fail ei saa öelda midagi, mida kiri ei ütle
- **Fonti ei pakita sisse.** pdf-lib'i Helvetica kasutab WinAnsi kodeeringut,
  kus on olemas iga eesti täht — ä ö ü õ š ž ja € kaasa arvatud. Kontrollitud,
  mitte eeldatud. TTF-i pakkimine lisaks iga külmkäivituse juurde ~megabaidi
- Pikk kirjeldus **murtakse ridadeks**, mitte ei lõigata: neli töötüüpi koos
  hammastega jookseb veerust kergesti välja
- **`=20` parandatud.** Esimeses päris arves oli neid laiali, ka Gmaili
  eelvaates. Põhjus: quoted-printable **peab** rea lõpus oleva tühiku
  kodeerima, ja `${tingimus ? x : ''}` omal taandega real jätab täpselt sellise
  tühiku. Nüüd lõigatakse iga rea lõpp puhtaks — genereeritud märgendil ei ole
  põhjust tühikuid lohiseda
- **Päevalimiit on nüüd libisev 24 tundi**, mitte kalendripäev. `day` on
  Tallinna kuupäev ja `sent_at` on ajahetk, nii et `T00:00:00Z` alustas akent
  suvel kolm tundi hiljem — tunnise ajastusega poleks see enam teoreetiline
- **`sql/052_invoice_cron.sql`** — `pg_cron` iga tunni 7. minutil. Õhtul tehtud
  arve läheb sama õhtu jooksul välja, mitte hommikul. Teenusevõti Vaulti,
  mitte `cron.job` tabelisse

## [1.51.1] — 2026-09-01

**Saatja ütles „saatmata arveid ei ole", kui neid oli kaks**

- Päring filtreerib tulevikukuupäevaga arved juba enne valvurit välja, nii et
  teade oli tehniliselt tõsi ja praktikas eksitav: kaks arvet olid olemas, aga
  homse kuupäevaga
- Ütleb nüüd „täna ei ole midagi saata — N arve ootab hilisemat
  väljastuskuupäeva". Maksegraafik kirjutabki oma osamaksed ette, nii et see on
  **tavaline olukord**, mitte viga — aga ka mitte „midagi ei ole"

## [1.51.0] — 2026-09-01

**Allon4: viimast hammast sai lisada, aga mitte välja jätta**

Kaarevalik oli kogu 2. sammu ainus juhtnupp ja see on kõik-või-mitte-midagi:
„ülemine" täitis kõik 16 hammast ja üksikut maha võtta ei saanud. Allon4 lõpeb
aga tavaliselt enne viimast molaari.

- **Pärast lõualuu valikut tuleb odontogramm.** Kõik hambad on vaikimisi kaasas,
  klõps võtab maha. Sama kaart, mida tavaline töö juba kasutab
- Kaare vastus jääb kiireks teeks — see täidab lõualuu, valik kitsendab
- **Puutumata ≠ tühi.** `undefined` võtab terve kaare, selgesõnaline tühi
  nimekiri jääb tühjaks. Nende kokkusulatamine tähendaks, et viimase hamba
  eemaldamine täidab lõualuu vaikselt uuesti
- Lõualuu vahetamine **kustutab kitsenduse** — ülemise vastu tehtud valik ei
  tähenda midagi, kui vastuseks saab „alumine", ja üle kandmine annaks uuele
  kaarele augu, mille keegi valis vana jaoks
- Teise lõualuu hambad filtreeritakse välja, mitte ei usaldata nimekirja: vana
  vastuse jäänuk ei tohi panna ülemisi hambaid alumisele tööosale
- **Kõiki hambaid ei saa ära võtta.** Tööosa, mis ütleb et katab lõualuu ja ei
  kata midagi, hinnastuks ja prindiks nii nagu kataks
- `teethForArch()` `shared/wizard/archRules.ts`-is — üks vastus küsimusele
  „mida see kaare tööosa katab", nii nõustajas kui tööosade koostamisel

## [1.50.0] — 2026-09-01

**Kirja tekst on nüüd seadistatav**

Kirjas oli terve arve — päis, rekvisiidid, read, summad, makseinfo — aga ümber
ei olnud ühtegi sõna. Ei tervitust, ei selgitust, ei allkirja. Õige dokument
ilma kirjata loeb nagu masina väljund, ja see on täpselt see, mida patsient
kõige tõenäolisemalt ignoreerib või rämpsuks märgib.

- Uus `shared/billing/mailTemplate.ts` — pealkiri, sissejuhatus arve kohale,
  lõpp arve alla. Kohatäited `{arve}`, `{saaja}`, `{summa}`, `{tasumata}`,
  `{tahtaeg}`, `{kuupaev}`, `{kliinik}`
- **Tundmatu kohatäide jäetakse alles**, mitte ei tühjendata. Nähtav
  `{tahtaef}` saab teatatud ja parandatud; vaikselt tühjaks muutunud jätab
  lausesse augu, mida keegi ei märka
- **Vaikimisi on päris kiri**, mitte tühi kast. „Kirjuta ise või ei saa midagi"
  saadaks välja täpselt selle tühja kirja, mille pärast see funktsioon üldse
  olemas on
- Seaded → E-post → **Kirja tekst**, elava eelvaatega. Eelvaade renderdatakse
  **samade funktsioonidega**, mida saatja kasutab — ekraan ei saa lubada
  sõnastust, mida patsient ei saa
- Ka plain-text osa saab sama teksti. Kiri ilma tekstiosata skoorib rämpsufiltris
  halvemini, ja see läheb välja kliiniku ainsalt aadressilt

## [1.49.0] — 2026-09-01

**Arvete saatja — deploy'tud ja proovitud**

`supabase/functions/send-invoices/`. Deploy näitas, et `shared/billing/`
jõuab kohale: üleslaadimises olid `invoiceDoc.ts` ja `sendGuard.ts` nimeliselt.

- **Ei ole avalik.** Erinevalt `public-booking`-ist deploy'tud **ilma**
  `--no-verify-jwt`-ta: see funktsioon saadab kirju kliiniku põhiaadressilt,
  nii et autentimata kutsuja saaks kätte kahuri
- **Ei otsusta ise midagi.** Iga „kas tohib" vastus tuleb `sendGuard`-ist —
  samast funktsioonist, millega Seadete ekraan end seletab. Siin väljamõeldud
  reegel oleks reegel, mida kliinik ei näe ega saa välja lülitada
- **`?dry=1`** käib kogu ahela läbi — poliitika, valvur, renderdus — ja ütleb,
  mida ta SAADAKS, avamata ühtegi ühendust. Sellepärast käibki valvur enne
  SMTP-seansi avamist
- Vastus ütleb ka **iga kliiniku kohta, miks** midagi ei juhtunud: „saatmine on
  väljas", „päevalimiit täis", „saatmata arveid ei ole". Tühi tulemus üksi oli
  mitmetähenduslik ja see on esimene asi, mida keegi selle otspunktiga teeb
- Üks SMTP-seanss kogu käivituse peale, mitte üks kirja kohta — jagatud
  majutuse limiidile näeb see välja nagu üks seanss, mitte nagu puhang
- Üks vigane aadress ei peata käivitust: viga läheb `send_error`-isse ja
  järjekord jookseb edasi
- `sent_at` stampitakse **kohe** pärast serveri kinnitust — aken, mille sees
  kokkujooksmine saaks topelt saata, on üks `await`
- SMTP veateated puhastatakse enne salvestamist: serverid tsiteerivad, mida sa
  neile saatsid, ja `send_error` on loetav igale kliiniku liikmele
- Kiri on tabelites ja inline-stiilides, sisu `invoiceDoc`-ist. Kaasas ka
  plain-text osa — kirjal ilma selleta on halvem rämpsuskoor, ja see läheb välja
  kliiniku ainsalt aadressilt, mis ei tohi rämpsuks minna

## [1.48.0] — 2026-09-01

**E-posti õigused ja kaitsed — enne saatjat**

Kliinik ühendab oma PÕHIPOSTKASTI, sama aadressi, kuhu patsiendid ja tarnijad
kirjutavad. Kaitsed tulevad seega enne saatjat, mitte pärast.
**Vajab migratsiooni `sql/051_email_settings.sql`.**

- Uus `shared/billing/sendGuard.ts` — üks funktsioon otsustab, kas kiri tohib
  välja minna, ja **iga vastus on vaikimisi keeldumine**. 38 testi, sest see on
  pidur, mitte funktsioon
- **Peakaitse ja iga luba eraldi, kõik vaikimisi väljas.** Uus kirjaliik
  tulevikus tähendab uut lülitit, mitte olemasoleva laienemist
- **Ei kunagi kaks korda:** `sent_at` blokeerib. Cron käivitub sagedamini kui
  keegi arvab
- **Ei kunagi tulevikuarvet.** Maksegraafik kirjutab viis arvet ette, neist neli
  tulevikukuupäevaga — ilma selle kontrollita saadaks esimene käivitus kõik viis
  välja esimesel päeval. Kõige hullem asi, mida see funktsioon teha saaks
- **Päevalimiit**, mida kontrollitakse ENNE aadressi, et kättesaamatute
  aadresside nimekiri ei põletaks päeva kvooti ära. Katkine limiit loetakse
  nulliks, mitte lõpmatuseks
- **Testaadress:** täidetuna läheb iga kiri sinna, ka siis kui patsiendil on
  aadress olemas. Sama kood, sama kiri, sama limiit — üks aadress
- Koma ja semikoolon aadressis lükatakse tagasi: päis, mis smugeldab teise saaja
  limiidist mööda, on odavaim viis see spämmiks muuta
- Tühistatud arvet ega tasutud arvet ei saadeta
- Uus Seaded → Kliinik → **E-post**: ühendus ja õigused eraldi plokkidena, ja
  kokkuvõte, mis ütleb täpselt, miks midagi ei saadeta
- **Parooli seadetes ei ole ega tule.** `clinic_settings` on loetav igale
  kliiniku liikmele; parool elab ainult `supabase secrets` sees
- Ekraanil on kirjas ka see, mida süsteem EI saa: IMAP-i seadeid ei küsita
  kuskil, seega postkasti ei loeta, ei kustutata ega liigutata

## [1.47.0] — 2026-09-01

**Arve sisu ühte kohta — e-posti ettevalmistus**

Arve hakkab peagi olemas olema kaks korda: väljatrükk ja e-kiri. Need **ei saa
jagada markupi** — e-kliendid söövad CSS-i ära ja nõuavad tabeleid ning
inline-stiile. Jagada saab aga selle, mis päriselt lahku triivib: numbrid.

- Uus `shared/billing/invoiceDoc.ts` — iga tuletatud number ja iga string
  **juba vormindatuna**. See on ainus koht, kus number tekstiks saab. Kui üks
  renderdaja kirjutab oma `toFixed(2)` ja teine oma, siis eraldaja muutmise
  päeval muutub ainult üks ja raamatupidaja mapis olev arve lakkab kattumast
  sellega, mis patsiendi postkastis on
- `InvoicePrintView` on nüüd **ainult küljendus** — sama väljanägemine, aga
  ükski number ei sünni seal enam
- Null sõltuvusega, ka mitte date-fns: `dd.MM.yyyy` on käsitsi, ja pooleli
  kuupäev annab „—" mitte oletuse
- Tühistatud arve ei võlgne midagi, olenemata arveldatust — sama reegel mis
  `outstanding()`-il, kirjas ka siin, sest `shared/` ei saa seda importida
- **`sql/050_invoice_sending.sql`**: `invoices.sent_at` + `send_error`.
  `sent_at` on eraldi `status = 'saadetud'` väärtusest, sest see on inimese
  märge — ilma selleta ei saa ükski ajastatud saatja olla ohutu, ta jookseks
  uuesti ja saadaks teise koopia. Osaline indeks ainult saatmata arvetele

## [1.46.1] — 2026-09-01

**Kogusehinna rea kustutas hinna ümberkirjutamine**

- Astmete redaktor käis läbi `sortedTiers`, mis viskab välja astme, mille hind
  on 0. Ehk hinna välja tühjendamine ümberkirjutamiseks **kustutas rea kursori
  alt ära**, ja koguse muutmine oleks rea keset kirjutamist ümber järjestanud
- Redaktor käib nüüd toorele massiivile. Järjekord ja praht lahendatakse
  **lugemisel** (`tierFor`) ja laadimisel, mitte kirjutamise ajal

## [1.46.0] — 2026-09-01

**Kogusehinnad: mitu krooni, teine hambahind**

Töötüübil oli üks fikseeritud hind. Nüüd saab öelda „alates 3 hambast 370,
alates 6-st 340". **Migratsiooni ei ole vaja** — `work_types` on jsonb ja
astmed elavad tüübi sees.

- **Lame, mitte astmeline.** Kuus krooni 6+ hinnaga tähendab, et **kõik kuus**
  on selle hinnaga, mitte kaks esimest vana ja ülejäänud uuega. Nii käib
  pakkumine telefonis, ja seega on see ainus variant, mida vormil kontrollida
  saab
- Põhihind jääb hinnaks alates ühest, nii et astmete nimekiri sisaldab ainult
  **erandeid** — „1+" rida ei pea kunagi kirjutama
- Võidab **kõrgeim aste, mis on koguse peal või all**, seega kirjutamise
  järjekord ei loe ja hiljem lisatud aste ei jää varju
- Iga tööosa hinnastatakse **oma koguse järgi**. Kahe eraldi krooni-tööosa
  hambaid kokku ei liideta — see annaks kogusesoodustuse juhtumile, millel
  kogust ei olnud
- Astmel võib olla oma soodushind; kui ei ole, kehtib tüübi oma, nii et
  soodustus ei kao suurema koguse juures ära
- Töö vormil ütleb märgis **„kogusehind alates 6"**, miks ühikuhind muutus.
  Ilma selleta liigub number kuuenda hamba klõpsamisel vaikselt ja keegi ei
  oska seda arstile seletada
- Katkine aste (hind 0, kogus 0) jäetakse vahele, mitte ei hinnastata sellest
- Kõik käib läbi `workTypePriceFor`, seega kehtib korraga töö vormil,
  nõustajas, hinnapakkumises ja ümberhindajas

## [1.45.2] — 2026-09-01

**Maksegraafikud on nüüd nähtavad**

Graafiku sai luua, aga mitte vaadata: viis osamakset olid viis tavalist rida
neljakümne arve seas ja miski ekraanil ei öelnud, et nad on üks kokkulepe.

- Uus plokk Arvete vaate ülaosas. Ei renderda midagi, kui graafikuid ei ole
- Iga graafik: tasutud/kokku, edenemisriba, hilinenud osamaksed punaselt, ja
  lahtivolditult iga osamakse oma numbri, tähtaja ja jäägiga. Rida viib arve
  juurde
- Edenemine käib **raha, mitte osamaksete arvu** järgi — neli väikest tasutud ja
  suur maksmata ei ole 80% valmis
- **„Peata graafik"** ütleb enne, mitu maksmata osamakset ta tühistab, ja et
  laekunut ei tagastata. `payments_amount_positive` (sql/020) ei luba laekumist
  miinusega tagasi pöörata, nii et peatamine on peatamine, mitte tagasimakse
- Tühistatud graafik jääb nimekirja alla alles — tema arved on päris ajalugu ja
  peitmine jätaks nad kuuluma mitte millegi külge

## [1.45.1] — 2026-09-01

**Maksegraafik arve vormil**

Osamaksete valik on nüüd päris graafik. Arve vorm oskas juba patsiendi, tööd ja
read valida — puudu oli graafiku kaks küsimust ja rida, mis need viis arvet kokku
seob. **Vajab migratsiooni `sql/049`.**

- **Arve päev** (1–28) ja **maksetähtaeg päevades** — mõlemad määratavad.
  Ekraanil on kirjas, miks 28: kuupäev peab kehtima ka veebruaris
- **Eelvaade** näitab iga osamakse väljastus- ja tähtaega ning summat, samade
  funktsioonidega, millega dokumendid kirjutatakse — ekraan ei saa lubada
  kuupäeva, mida arve ei kanna
- Katkine graafik nimetab probleemid ega lase salvestada
- Loomine käib ühe mutatsiooniga: `payment_plans` rida ja arved koos. Rida
  kirjutatakse esimesena, nii et poolel teel katkedes kuuluvad juba loodud
  arved päris graafikusse — vastupidine järjekord jätaks orvud
- Nupp on nüüd blokeeritud ka graafiku loomise ajal. Graafik on **tsükkel**
  insert'e, nii et teine klõps oleks kirjutanud teise graafiku ja teise
  komplekti dokumente
- Ülempiir tõusis 24-lt 60-le, sama mis andmebaasis

## [1.45.0] — 2026-09-01

**Maksegraafik: andmemudel ja loogika**

Patsient maksab ravi osade kaupa — nt 5 × 1000 €. Esimene pool: tabel, tüübid
ja loogika. UI tuleb järgmisena. **Vajab migratsiooni `sql/049_payment_plans.sql`.**

- `payment_plans` tabel + `invoices.payment_plan_id` / `instalment_no`.
  Arved genereeritakse **ette, päris dokumentidena** — töölauarakenduse taga ei
  jookse midagi, kui ta kinni on, nii et reegel „käivitub järgmisel kuul" ei
  käivituks kunagi. Viis arvet õigete kuupäevadega ei vaja ajastajat, et
  eksisteerida; ajastajat vajab ainult **saatmine**
- `arve_paev` on kuni **28**, nii koodis kui andmebaasis. Graafik „31. kuupäeval"
  muutuks veebruaris vaikselt 28-ndaks ja märtsis jälle 31-ndaks
- `planProgress()` loeb **arveid, mitte graafiku enda numbreid**: plaan ütleb,
  mis kokku lepiti, arved ütlevad, mis juhtus, ja lahknemisel on dokument tõde
- Tühistamine tühistab ainult need osamaksed, millele **ei ole midagi laekunud**.
  `payments_amount_positive` (sql/020) tähendab, et laekumist ei saa miinusega
  tagasi pöörata — tühistamine on peatamine, mitte tagasimakse
- Iga osamakse kannab `job_id`-d, nii et „Laekumata" kahaneb iga makse järel

## [1.44.1] — 2026-09-01

**Osamaksetega tasutud töö jäi 1/5 makstuks**

Arve osamakseteks jagamine pani `job_id` **ainult esimesele osamaksele**.
`paidForJob` krediteerib tööd arve RIDADE järgi, nii et osamaksete 2–5
laekumine ei jõudnud tööni. Viie kuuga ära makstud töö näitas igavesti
1/5 makstud — oma paneelil, patsiendi lehel ja Laekumata summas.

- Iga osamakse kannab nüüd `job_id`-d oma osasummaga. Topeltarveldust see ei
  tekita: `billedJobIds` on `Set`
- Uus `shared/billing/instalments.ts` — graafiku kuupäevad ja rahajaotus ühes
  kohas, **null sõltuvusega** (ka mitte date-fns), et sama funktsioon jookseks
  hiljem Deno edge-funktsioonis, kui saatmine automatiseeritakse
- Kuupäevamatemaatika käib UTC-s ja **klammerdub** lühemasse kuusse: 31. jaanuar
  + 1 kuu on 28. veebruar, mitte 3. märts. Ja klammerdumine ei triivi — märts on
  jälle 30., mitte 28.
- `splitAmount` annab ümardusjäägi **viimasele** osale: 1000/3 on
  333.33 + 333.33 + 333.34. Iga osa eraldi ümardamine annaks kokku 1000.02 —
  sent, mida keegi ei tellinud ja mida ükski rida ei seleta
- Graafik, mille summad või kuupäevad ei klapi, **ei genereerita** — sama
  ausus mis `publishProblems()` ja `quoteJob`-i `unpriced`

## [1.44.0] — 2026-08-20

**Abutmendi kood nõustajas, ja hammaste kaupa**

Nõustajas ei saanud kruvi/abutmenti üldse märkida — see väli oli ainult töö
lehel, nii et nõustajaga loodud implantaaditöö tuli pärast lahti teha ja
üle salvestada, et kirja panna miski, mida tehnik teadis juba hambaid valides.

- **Nõustaja 2. samm** küsib nüüd koodi iga implantaaditöö kohta, kohe hammaste
  kõrval. Üks väli katab kõik selle töö hambad — „kõik neli on MIS C1" on üks
  vastus, mitte neli
- **„Hammaste kaupa"** avab erandid: kolm ühte süsteemi ja üks teist on
  tavaline juhtum, mis varem lõppes märkmes, mida keegi tagasi ei loe
- Tühi hambarida **pärib** töö koodi, ei tähenda „abutmenti ei ole". Sama reegel
  lugemisel (`abutmentFor`), nii et ekraan ja salvestatu ei saa lahku minna
- `WorkItem.kruvid` — hammas → kood. Salvestatakse ainult erandid, nii et
  tavajuhtum jääb üheks stringiks. JSONB veerg, migratsiooni ei olnud vaja
- **Töö leht** sai sama: üks väli + hammaste kaupa erandid. Ühtlasi ilmub see
  väli nüüd ka **külgpaneelis** — varem oli see ainult täisekraanivaates, ehk
  see, kas abutmenti sai üldse kirja panna, sõltus Seadetes valitud paneeli
  suunast
- Implantaaditöö tuvastus käib nüüd `workTypeRules.supportsAbutment` kaudu, mitte
  töö lehele kirjutatud regexi järgi. Vana `/implant|abutment/i` ei tundnud ära
  „Abutmendile kroon" — sama töö sai välja ühel ekraanil ja teisel mitte
- Lugemisvaade ja nõustaja kokkuvõte näitavad koode koodi kaupa grupeerituna:
  „MIS C1: 14, 15 · Straumann BL: 16"

## [1.43.1] — 2026-08-20

**Ühe tööosaga töö sai ka värvilise sildi**

Tahvli kaart hargnes tööosade ARVU järgi: mitu tööosa → värvilised sildid,
üks tööosa → hall tekst. Kaks kaarti, mis näitavad sama asja, nägid välja nagu
kaks eri liiki kaarti, ja ainus, mis neid eristas, oli loendur.

- Iga tööosa saab nüüd oma sildi, olenemata sellest, kui palju neid on.
  `jobWorkItems` ehitab vanast `too`/`hambad` paarist ühe tööosa, nii et vanad
  read saavad sildi täpselt samamoodi
- Värviriba vasakul järgib sama loogikat
- Sama muudatus muudatuse kaardil: sildid tulevad muudatuse enda tööosadest,
  ja kui muudatus neid ei nimeta, siis töö omadest — sama tagavara, mida
  tasuarvestus kasutab. Varem näitas see `job.too`, ehk töö ESIMEST tüüpi,
  ka siis kui ümber tehti hoopis midagi muud
- Nimeta tööosa ei saa tühja silti

## [1.43.0] — 2026-08-19

**Palgarida nimetas tööd, mille eest raha ei makstud**

„Disain: Kroon + Sild + **Mudel** · Elena Lund — 23 × 18.00 €" luges nii, nagu
oleks mudeli eest makstud. Rida loetles KÕIK töö tööosad, olenemata sellest,
kas need summasse midagi andsid.

- Hambapõhine reegel maksab tööosa eest, millel hambaid ei ole, **täpselt null**.
  Mudel ilma hammasteta pani oma nime reale ja mitte sentigi summasse — ainus
  viis seda teada saada oli mootorit lugeda
- `payProduction` tagastab nüüd `paidItems` — tööosad, mille eest tegelikult
  maksti — ja iga palgarida nimetab ainult neid
- Sama lisatasureeglitel: „Igeme disain: Allon6" ei loetle enam tüüpe, mida see
  reegel ei katnudki
- Mudeli rida on lihtsalt „Mudel · patsient" — mudeli tasu ei sõltu tööosadest,
  nii et nende loetlemine ütles seal alati vale asja

**NB:** kui tööosal Mudel ON hambad, siis on see raha ja rida nimetab teda
edasi. Hambapõhine reegel ilma töötüübi piiranguta („Kõik tööd") katab ka
Mudeli — kui mudeli eest ei tohi disaini tasu maksta, tuleb reeglil tüübid
nimeliselt valida.

## [1.42.1] — 2026-08-19

**Kaks rahanumbrit, mida ei saanud omavahel võrrelda**

Ülevaade ütles „Laekumata 45 285 €", Rahandus „Tulu 111 390 € / Laekunud
92 985 €". Kumbki ei olnud vale — nad vastavad **eri küsimustele** ja kummalgi
ei olnud ekraanil piisavalt infot, et seda välja lugeda.

- **Laekumata** on nüüd isekontrollitav: suure numbri all seisab, mille seest
  see tuleb — kogu väärtus ja laekunud summa. Number, millel ei ole nimetajat,
  ei ole ühegi teise ekraaniga võrreldav
- **„Tasumata"** Rahanduses on ümber nimetatud **„Tasumata arvete järgi"** ja
  ütleb välja, et loeb ainult väljastatud arveid. Labor, kes märgib töid
  makstuks arvet tegemata, näeb seal 0.00 € — „keegi ei võlgne midagi" — samal
  ajal kui kõrval seisab „Arveldamata 111 390 €"

Neli asja, mis neid numbreid lahku viivad, ja kõik neli on kavatsetud:
periood (kogu aeg vs valitud vahemik), staatus (Ülevaade loeb ka pooleliolevaid
töid, Rahandus ainult valmis omi), alus (`jobTotalValue` vs ainult `hind`) ja
maksete aken (Laekunud on perioodi sees, Laekumata lahutab kõik).

## [1.42.0] — 2026-08-19

**Arvega tasutud töö jäi igaveseks „maksmata"**

Raha jõuab tööni kahte teed pidi ja `paidForJob` nägi ainult esimest:

1. makse otse tööle — `payments.job_id`, mida kirjutab „Märgi makstuks"
2. makse ARVELE, mille peal töö on real — `payments.invoice_id`, `job_id` NULL,
   mida kirjutab arvete ekraan

Teine ei vähendanud kellegi võlga. Töö, mis arveldati ja mille arve maksti
**täies mahus**, luges endiselt „Maksmata" oma paneelil, patsiendi lehel,
tööde tabelis, tahvli kaardil ja Ülevaate summas. Raha oli näha ainult Rahandus
→ Laekunud all. Sellepärast ütles Ülevaade 45 285 € laekumata, samal ajal kui
Tulu miinus Laekunud andis 20 405 € — vahe oli täpselt see, mis oli arveldatud,
mitte töö kaupa märgitud.

- `paidForJob` arvestab nüüd mõlemat teed. Arve jagatakse **tasumise suhtarvu**
  järgi: täies mahus makstud arve tasub iga töö selle peal, pooleldi makstud
  pooled. Suhtarv võetakse `gross_total` vastu ja rakendatakse neto ridadele,
  nii et käibemaks taandub ega kirjuta tööle liiga palju
- Kes millise rea eest maksis, on küsimus, millele andmed ei vasta — keegi ei
  maksa arverida — nii et väärtuse järgi jagamine on ainus aus jaotus
- Tühistatud arve ei tasu midagi
- Kõik lugejad saavad nüüd arved kaasa: töö paneel, lugemisvaade, tahvli kaart,
  tabelivaade, Ülevaade, patsiendi profiil ja patsientide nimekiri
- Patsientide **nimekiri** ei saanud varem üldse makseridu (`patientStats(pj)`),
  ehk „tasumata" veerg ja „ainult tasumata" filter käisid vana `makstud` lipu
  järgi. Nüüd päris andmete järgi

## [1.41.2] — 2026-08-19

**„kogu aeg" valetas otsingu ajal**

Ülevaate kaardid saavad `searchedJobs` — **otsingukastiga filtreeritud** nimekirja.
Tühja otsinguga on „kogu aeg" täpne, aga niipea kui otsingusse midagi kirjutada,
kitsenesid kõik numbrid vaikselt ja silt väitis endiselt „kogu aeg".

- Otsingu ajal on sildiks nüüd **„otsingu tulemused"** — kõigil kolmel kaardil,
  mis varem „kogu aeg" väitsid (Tööd kokku, Hambaid toodetud, Laekumata)
- Kuupäevafiltrit sellel lehel ei ole ega olnud — „kogu aeg" on selles mõttes
  sõna-sõnalt tõsi

## [1.41.1] — 2026-08-19

**„Maksete seis" ei olnud käive — ja number oli vale**

Ülevaate suur punane number luges nagu käive. See on **võlg**: mis kliendid veel
võlgu on. Kaardil ei olnud ühtegi sõna, mis suunda ütleks.

- Silt on nüüd **„Laekumata"**
- Number liitis kokku iga töö **täishinna**, mille vana `makstud` lipp oli maas.
  Töö, kus 6800 €-st oli 6000 € juba laekunud, andis kaardile ikka 6800 €.
  Pangas olev raha oli kirjas võlana
- Kaart kasutas ühel ekraanil **kahte eri „makstud" mõistet**: € läks lipu järgi,
  loendurid all päris maksete ridade järgi. Seepärast olid needsamad 8 tööd
  korraga „8 osaliselt" JA täishinnaga summa sees
- Käib nüüd läbi `jobsPaymentTotals` — sama funktsioon, mida patsiendileht ja
  tööde nimekiri loevad. Loendurid on lahus: makstud · osaliselt · puutumata
- `useDashboardStats` sama mustriga surnud rida välja

## [1.41.0] — 2026-08-19

**Muudatuste kulu läks ikka veel patsiendi arvele**

`jobTotalValue` on kogu aeg õige olnud — hind + disaini hind + lisateenused,
muudatused välja jäetud, sest need on labori enda ümbertegemise kulu. Aga **kuus
ekraani arvutasid summa käsitsi** ja iga koopia liitis muudatused tagasi sisse.

- Nähtav tagajärg: töö lugemisvaade ütles 6800 € maksmata ja „Märgi makstuks"
  avanes **samal ekraanil** 7048 € peal. Kumbki number ei olnud kokkuleppes
  teisega ja üks neist oli vale
- Parandatud kõik kuus: töö „Märgi makstuks", hulgi „Märgi makstuks" (App ja
  tabelivaade), patsiendi ajalugu, Ülevaate maksmata summa, Töölaua statistika
- Käsitsi summa jättis ka **`extras` välja** — 60 € Ülesehitusega töö luges end
  täielikult makstuks niipea, kui põhihind laekus. Vale mõlemas suunas korraga
- Patsiendi ajalugu jättis lisaks `disain_hind` välja, uskudes et hinnaarvutus
  on selle juba `hind` sisse kokku pannud. Ei ole — `quoteJob` tagastab
  `production` ja `disain` eraldi ja need lähevad eraldi veergudesse
- Töö lugemisvaate lause „Makse käib kogu töö kohta, **koos muudatustega**"
  ütles täpselt vastupidist sellele, mida summa teeb. Ümber sõnastatud
- Uus `lib/jobPayments.test.ts` — see viga on nüüd kaks korda tehtud, seega on
  reegel testis kirjas, mitte ainult kommentaaris

Teadaolev, PUUDUTAMATA: `periodMetrics` „käive" liidab muudatuste hinnad ikka
juurde. See on eraldi mõiste (käive, mitte arve) oma seadistuse ja testidega —
ütle, kui ka see peab muudatused välja jätma.

## [1.40.2] — 2026-08-18

**Palgadiagnostika neelas pooled põhjused alla**

- `diagnoseEarnings` grupeeris probleeme ainult koodi järgi. Koodi „reegel" all
  on mitu eri põhjust — ükski reegel ei sobi, osa tööosi jääb katmata, mudel on
  valesse kohta märgitud — ja need liideti üheks kirjeks, millel oli **esimesena
  tulnud silt**. Ülejäänud loeti kokku pealkirja alla, mis neid ei kirjelda
- See on halvem kui teatamata jätmine: ekraan nägi välja, nagu oleks vastanud
- Grupeerimine käib nüüd koodi JA sildi järgi, nii et iga põhjus on oma real
  oma arvuga

## [1.40.1] — 2026-08-18

**Palgadiagnostika ütleb, kui mudel on valesse kohta märgitud**

Mudeli tasu loeb `job.mudel` lippu (Kiirtöö kõrval). Töö, mille mudel on kirjas
„Mudel" TÖÖOSANA, ei näinud sellest midagi ja nägi välja täpselt nagu töö, millel
mudelit ei olegi — see on täpselt see segadus, mille pärast kaks kohta kaotati.

- Uus diagnostikarida: „Mudel on kirjas tööosana, mitte Mudel-märkena Kiirtöö
  kõrval — mudeli tasu jääb arvestamata". Nii on vanad tööd, mis vajavad
  märkeruudu järeletegemist, palgalehel nimeliselt kirjas
- Ütleb seda ainult inimesele, kellel mudeli tasureegel tegelikult on — muidu ei
  lähe raha kaduma ja rida oleks lihtsalt müra igal tööl

## [1.40.0] — 2026-08-18

**Mudel on lipp, mitte töötüüp**

Mudelit sai öelda kahes kohas: lipuga Kiirtöö kõrval ja „Mudel" töötüübiga
tüübiruudustikus. Kontrollitud ja ühtlustatud — **lipp on ainus koht, mis loeb**.

- **Töötasu** luges juba lipult (1.39.0), mitte töötüübilt. Kaeti testiga, et
  „Mudel" nimeline tööosa EI vallanda mudelitasu ja lipp vallandab
- Mudelireegel maksab nüüd ka tööl, millel ei ole ühtegi tööosa — mudel on
  midagi, mis tööl ON, mitte üks selle tööosadest. Varem ei olnud reeglil
  midagi vastu panna ja tasu jäi vaikselt nulliks
- **Kliendi hind:** `settings.mudeliHind` seisis Seadetes ja Mudel-nupu sildil
  sellest saati, kui lipp olemas oli, ja **mitte keegi ei lugenud seda** — ainus
  viis mudelit arvele saada oli lisada „Mudel" töötüüp. Nüüd lisab `quoteJob`
  selle lipu peale, nagu seade ise on kogu aeg lubanud
- Mudeli tasu **ei korrutata kiirtööga**, samal põhjusel millega disaini oma ei
  korrutata: printimine võtab oma aja, olgu juhtum kui kiire tahes
- Nõustaja „Mudel" kaart näitab nüüd hinda — see oli teadlikult peidus seni,
  kuni seadet keegi ei lugenud
- Seadete vihjed ütlevad välja, et kiirtöö kordaja ja mudeli hind on KLIENDI
  numbrid; töötasu pool on inimese Töötasud lehel
- Ümberhindaja ei loe kiirtööd ega mudelit hinnastamisviisiks — mõlemad
  lisanduvad selle otsa, mitte ei ole see

## [1.39.0] — 2026-08-18

**Kiirtöö ja mudel jõuavad palgalehele**

Kaks auku, mis mõlemad lõppesid kliendi arvel ja töötasuni ei jõudnud.
**Vajab migratsiooni `sql/048_worker_rush_and_model.sql`.**

- **Kiirtöö** korrutas ainult kliendi hinda — `quoteJob` paneb ülekursi
  `job.hind` sisse ja sinna see jäigi. Palgamootor ei vaadanud `job.kiirtoo`
  välja üldse, nii et 15 €/hammas jäi kiirtööl 15 €-ks
- Kordaja on nüüd **inimese Töötasud lehel**, mitte üks number Seadetes.
  Kliiniku kordaja on HIND, mida klient maksab; kui palju sellest jõuab
  tegijani, on iga inimesega eraldi kokku lepitud. Üks väli mõlema jaoks
  tähendas, et kliendi hinna tõstmine tõstab vaikselt kõigi palka
- **Tühi = 1×**, ülekurssi ei maksta. Ükski juba tehtud töö tasu ei muutunud —
  kordaja tuleb teadlikult sisse panna
- Protsendireeglit **ei korrutata**: töö hind kannab kliiniku kordajat juba
  endas, teistkordne korrutamine maksaks ülekursi kaks korda välja
- Muudatusel on oma kiirtöö lipp ja see loeb muudatuse ridadel
- Palgalehe real on nüüd „· kiirtöö ×2" juures, et number oleks kontrollitav
- **Mudel** sai oma tasureegli — „Mille eest → Mudel". Lisandub tootmistasule,
  ei võistle sellega, ja fikseeritud reegel maksab korra töö kohta. Mudel
  muudatusel tasustatakse ainult reegliga, millel on „Katab ka muudatused"
- Diagnostika ütleb välja: „Tööl on mudel, aga mudeli eest makstavat reeglit
  ei ole"
- Omahind töö lehel ja Rahanduse tööjõukulu arvestavad mõlemat

## [1.38.2] — 2026-08-18

**`NEXT.md` — seis, mis rändab kaasa**

- Uus `NEXT.md` repo juurikas: mis on tehtud, **mis ootab sind koos täpsete
  käskudega**, mis on blokeeritud ja mille taga, ning kus plaan ja auditid asuvad
- Kirjutatakse iga töö lõpus üle — see on hetkeseis, mitte logi
- Eristub `HANDOFF.md`-st teadlikult: seal on arendaja püsireeglid („ära kunagi
  tee X"), siin on „mida ma järgmisena teen"

## [1.38.1] — 2026-08-18

**Avalik `/services` otspunkt — esimene edge-funktsioon**

Dentasest sõltumatu, seega ehitatav juba enne API vastuseid. Loeb ainult
`clinic_settings.public_services` ja tagastab patsiendile mõeldud kataloogi.

- `supabase/functions/public-booking/` + `_shared/` (cors, respond, ratelimit,
  settings). Üks funktsioon, mitte kolm — kolm tähendaks kolme külmkäivitust,
  kolme CORS-poliitikat ja kolme koopiat allowlist-mapperist
- **`_shared/settings.ts` on ainus koht, mis `clinic_settings`-i pärib**, ja
  selle päring on `.select('public_services')`. Mapperi viga ei saa lekitada
  veergu, mida kunagi ei toodud — see on kolmest kaitsest tugevaim
- Vastus alati ümbrikus `{ ok, data }` / `{ ok:false, error }`, et Frameri
  komponent ei parsiks kunagi HTTP 500 keha
- CORS on lubatud päritolude nimekiri, `Vary: Origin` alati — ilma selleta
  serveerib CDN ühe päritolu päise teisele
- IP räsitakse pipraga ja ei salvestata

**Kliiniku veebilehe tunnus**
- Seaded → Kliinik saab välja `Veebilehe tunnus` (`clinics.public_slug`).
  Tühjaks jättes avalikku broneerimist ei ole. Kirjapilt parandatakse
  automaatselt `slugify()` kaudu

**Deno vs bundler — laiendite asümmeetria**
- Deno nõuab relatiivsetel importidel faililaiendit, bundler mitte. Seetõttu
  `shared/portal/publicQuote.ts` impordib `./publicService.ts` **laiendiga** ja
  seda ei tohi „korrastada"
- Leitud katsetades: TypeScript lubab `.ts` laiendi **tüübi**-impordil, aga
  **väärtuse**-impordil nõuab `allowImportingTsExtensions`. Kirjas
  `supabase/functions/README.md`-s, et järgmine inimene ei avastaks seda uuesti

## [1.38.1] — 2026-08-18

**Disainija küsiti kaks korda**

1.37.0 pani tööosade read job-taseme „Disainija" kasti ALLA, nii et sama küsimus
oli ekraanil kaks korda ja ei olnud näha, kumb vastus loeb.

- Kaks kontrolli on nüüd alternatiivid, mitte kihid — täpselt nagu masinavalik.
  Üks tööosa → üks „Disainija" kast. Mitu tööosa → ainult read, üks tööosa kohta
- Rida näitab **tegelikku** disainijat (päritud nimi kaasa arvatud), mitte
  „sama mis tööl" — nii ei näita ükski rida tühja välja töö eest, millel on
  disainija olemas
- `WorkItem.designed_by` on nüüd kolm olekut: **puudub** = päri töölt,
  **id** = see inimene, **null** = mitte keegi. Null on vajalik, sest jagatud
  tööl ei ole job-taseme välja ekraanil, ja „laminaadid tellisime väljast" pidi
  olema öeldav. `??` oleks null tagasi töö disainijaks muutnud ja talle maksnud
- Salvestamine teeb valiku lõplikuks: jagatud tööl saab iga tööosa oma nime
  kirja, jagamata tööl ei kanna ükski tööosa nime. Muidu muutus tööosa disainija
  vaikselt siis, kui `job.designed_by` liikus
- ✎ märgis tööosa sildil ainult siis, kui disainijaid on tegelikult mitu

## [1.38.0] — 2026-08-18

**Patsiendi hinnakiri — avaliku veebilehe alus**

Esimene osa Frameri broneerimisvoost. See on **Dentasest täiesti sõltumatu** ja
kasulik ka üksi: kliinik saab hallatud patsiendihinnakirja koos üldise raviplaaniga.

- Uus Seaded vahekaart **„Patsiendi hinnakiri"** Kliiniku grupis — teadlikult
  **mitte** Hinnad sees. Üks nimekiri on see, mida labor kliinikult küsib, teine
  see, mida patsient maksab; need on eri numbrid ja nüüd ka eri kohtades
- Teenusel on hinnavahemik (alates–kuni), käibemaksu märge, kategooria,
  lühikirjeldus ja **üldine raviplaan** visiitide kaupa (pealkiri, kestus,
  ootaeg). Visiitide arv tuletatakse nimekirjast, mitte ei salvestata eraldi
- **Eelvaade renderdub samadest funktsioonidest, mida veebileht kasutab** — kaks
  renderdajat läheksid lahku ja see on rahaasi
- Teenus jõuab veebi ainult siis, kui ta on avalik JA tal ei ole puudusi.
  `publishProblems()` loetleb puudused välja; hinnata teenust **ei näidata kunagi
  „0 €"-na** — sama ausus, mida `quoteJob()` juba järgib
- Vajab migratsiooni `sql/047_public_services.sql`

**Uus `shared/portal/` — avaliku pinna leping**

- `publicService.ts` ja `publicQuote.ts`, mõlemad sõltuvusteta. Eraldi kaustas,
  et „avalik kood ei impordi kunagi `PriceBook`-i" oleks näha **kaustaloendist**,
  mitte ainult kommentaarist
- Ei laiendatud `work_types`: seal on **järjekord sobitamise järjekord** (ümber
  järjestamine hinnastaks tööd ümber) ja seal on `kulud`. Eraldi veerg teeb
  „marginaal ei lahku andmebaasist" struktuurselt tõeseks
- `toPublicCatalogue()` on allowlist-mapper: uus väli on vaikimisi privaatne.
  Deny-list läheks lahti iga kord, kui keegi välja lisab
- **Lekketest**, mis loeb nagu süüdistus: fixture, kus iga kuluväli on täidetud
  sentineliga `LEAK`, ja väide, et serialiseeritud vastus ei sisalda seda ega
  ühtki keelatud võtit. 22 testi kokku

## [1.37.0] — 2026-08-18

**Disainija tööosa kaupa**

Ühel tööl võib olla kroone ja laminaate, mille disainivad eri inimesed.
`designed_by` oli üks nimi kogu töö peale, nii et tasuarvestus maksis kogu
disaini ühele neist ja teine ei saanud oma osa eest midagi.

- `WorkItem.designed_by` — tööosa oma disainija. Puudub = „sama mis tööl",
  täpselt see, mida iga varem kirjutatud tööosa tähendas. `work_items` on JSONB,
  migratsiooni ei olnud vaja
- Töö lehel uus plokk „Disainija tööosade kaupa" — üks rippmenüü tööosa kohta,
  nähtav ainult mitme tööosaga tööl. Ülemine „Disainija" jääb vaikeväärtuseks
- Tööosa siltidel näitab ✎ märgis oma disainija eesnime, et jagatud juhtum oleks
  ühe pilguga näha
- Tasuarvestus maksab igale disainijale ainult tema enda tööosade eest.
  Protsendireegel jagatakse hammaste järgi — muidu makstaks sama disainihind
  kaks korda välja. Lisatasureeglid (nt igeme disain) samuti tööosade kaupa
- Sama loogika muudatustel: tööosa disainija, siis muudatuse oma, siis töö oma
- Omahind, palgadiagnostika ja CSV eksport („Disainija" veerus kõik nimed)
  arvestavad nüüd kõiki disainijaid

## [1.36.2] — 2026-08-17

**Valmis veergu lohistatud töö kadus ära**

- „Valmis" veerg filtreeris nädalat **`kuupaev` järgi — päev, mil töö laborisse
  JÕUDIS**. Lohistamine märgib `valmis_kuupaev` tänaseks, aga filter vaatas
  saabumiskuupäeva, nii et iga töö, mis oli tulnud rohkem kui nädal tagasi,
  kadus kohe pärast lohistamist ära. Loendur „kokku" kasvas (46 → 47), kaart ei
  ilmunud kuhugi
- Filter kasutab nüüd `jobPeriodDate` — sama valmimisankrut, mille järgi palk ja
  Rahandus juba arvestavad (`valmis_kuupaev`, siis tähtaeg, siis saabumine).
  Muudatuste kuupäevad käivad läbi sama `revisionPeriodDate` funktsiooni
- Seepärast Liina tööga probleemi ei olnud: see saabus jooksval nädalal, nii et
  vale kuupäev juhtus samasse aknasse sattuma

## [1.36.1] — 2026-08-13

**Tulu valem oli katki — mõlemas suunas**

Mitme tööosaga töö hind jagati tööosade vahel `job.hambad` hammaste arvu järgi.
See ei anna kokku 1, sest `job.hambad` on **dedupliteeritud** tööosade hammaste
ühend. Kaks tõestatud viga (`lib/finance.test.ts`):

- **Kadu:** hambatu tööosa (nt kaitse) jättis oma osa nõudmata → 1000 € töö
  raporteeris **500 €**
- **Ülepaisutus:** sild 14-16 + kroon 14 nõudsid 4 hammast 3-hambalise töö
  vastu → 1000 € töö raporteeris **1333 €**

Osakaalud normaliseeritakse nüüd selle järgi, mida tööosad **ise** nõuavad, nii
et need annavad täpselt 1 ja Tulu võrdub tööde hindade summaga. Kui ühelgi
tööosal pole hambaid, jagatakse võrdselt.

**Mõju:** mitme tööosaga tööde Tulu muutub. Ühe tööosaga tööd ei muutu üldse.
Ühesuunalist nihet ette ennustada ei saa — osal töödel oli number liiga väike,
osal liiga suur.

## [1.36.0] — 2026-08-13

**Uue töö nõustaja: masin tööosa kaupa**

Masinavalik oli üks rippmenüü kogu töö peale. Nüüd on see tööosade kaupa, sama
mustriga mis materjalil juba oli — sild võib käia Pro2-l ja kroonid Midasel.

- Uus `machineByType` nõustaja olekus, `machinesOf()` / `machineFor()` abifunktsioonid
- Tööosad saavad `masina` välja kaasa (`wizardWorkItems`), töö tasemel `masina`
  on esimene määratud masin — täpselt nagu materjalil
- Kokkuvõttes on iga tööosa masin eraldi real, nii et kahe printeri vahel jagatud
  töö on enne loomist näha
- **Ühe tööosaga töö puhul ei muutu midagi** — sakiriba ilmub alles siis, kui on
  midagi jagada
- Pooleliolevad mustandid jäävad alles: puuduv `machineByType` täidetakse tühjaga,
  mustandi versiooni ei tõstetud

**Miks see loeb rohkem kui detail:** `jobMaterialCost` otsib masinapõhist
kuluvõtit (`materjal|masin`) enne baashinda, sest Pro2 kaarekomplekt on hulgi ja
Midas on kapsel hamba kohta. Üks masin kogu töö peale ei kaotanud lihtsalt
detaili — see andis **vale omahinna**. Sama viga, mille materjali jaotus juba
parandas.

## [1.35.2] — 2026-08-13

**Uue töö nõustaja: materjali toon**

- Materjali sai valida ainult ilma toonita — „Crown HT", mitte „Crown HT A1".
  Nüüd ilmub toonivalik kohe materjali alla, kui sellel materjalil toonid on
  (Crown HT, Ceramic Crown, OnX Tough 2 — sama nimekiri, mida töö muutmise
  vorm juba kasutas)
- Salvestub ühe stringina `materjal` välja, nagu töö muutmise vormil, nii et
  `jobMaterialCost` leiab prefiksi järgi õige hinna üles
- Toonita jätmine on endiselt korrektne valik ja seda öeldakse välja

**Selgituseks:** materjali toon ja VITA toon on kaks eri küsimust — esimene on
vaigu tellimuskood, teine see, mida valmis töö peab matkima. Seepärast küsitakse
neid eri kohtades ja eri nimede all.

## [1.35.1] — 2026-08-13

**Tööd ei sünkroniseerunud arvutite vahel**

- Töö lohistamine teise etappi ei liikunud teistes arvutites enne rakenduse
  taaskäivitamist. Klient oli korras — `useJobs` avab iga mount'i kohta
  `postgres_changes` kanali — aga **`jobs` tabelit ei ole kunagi
  `supabase_realtime` publikatsiooni lisatud**, nii et sündmusi lihtsalt ei
  tekkinud
- Iga teine sünkroniseeritav tabel on migratsiooniga lisatud (001 patsiendid,
  004 hambakaart, 008 visiidid, 019 seaded, 020 arved, 022 tasud, 036 kliendid).
  `jobs` mitte — see on vanem kui `sql/` kaust ise ja loodi käsitsi README
  koodiplokist. `sql/005` kommentaar väidab, et see on juba publikatsioonis, aga
  see on kommentaari kirjutatud oletus, mitte kunagi jooksnud lause
- `sql/046_jobs_realtime.sql` — sama kaitstud muster mis 004/008/036, ohutu ka
  siis kui tabel on juba publikatsioonis

## [1.35.0] — 2026-08-13

**Finantsnäitajad lepitatud: üks agregaator kolme ekraani jaoks**

Sama „See kuu" andis kolmel ekraanil kolm vastust — 19 vs 15 tööd, 156 vs 144
hambaid, Laekunud 21 980 vs Makstud 12 800. Neli põhjust, kõik leitud koodist
(vt `docs/finance-metrics.md`):

1. **Perioodi lõpp erines** — Tootmine kuni kuu lõpp, Rahandus kuni täna
2. **Ülevaates ei olnud perioodi üldse** — kõigi aegade summa, sildistamata
3. **Loendusühik erines** — Rahanduse tabel luges **tööosi** (mitme tööosaga töö
   luges mitu korda), Tootmine töid ja muudatusi eraldi
4. **Neli rahamõistet kahe sildi all** — „Makstud" oli tegelikult *märgitud
   makstuks* lipuga tööde hinnakiri, mitte laekunud raha

**Parandus**
- Uus `lib/periodMetrics.ts` — ainus koht, kus perioodi summa arvutatakse.
  Parameetrid: `dateAnchor`, `includeChanges`, `moneyConcept`. Kolm ekraani
  kutsuvad seda; erinevused on nüüd parameetrid, mitte failide omadused
- `rangeFor()` — üks perioodiaken kõigile. Üldkulud üksi klapivad `elapsedEndOf`
  külge, sest üür ei kogune päevade eest, mida ei ole olnud
- **„Makstud" → „Laekunud"** ja see on nüüd samad maksekirjed, mida Rahandus
  näitab. Vana `jobs.makstud` lippu ei summeerita enam kuskil
- Iga loend, kus originaal ja muudatus on koos, näitab jaotust — üks funktsioon,
  mitte kolm sõnastust
- Rahanduse tabeli veerg „Töid" → **„Tööosi"** koos selgitusega, miks see summa
  on tööde arvust suurem ja miks „0 tööosa · hambaid · negatiivne kate" on õige
- Ülevaate kaardid kannavad nüüd silti **„kogu aeg"**
- 13 uut testi, mis reprodutseerivad kõik neli lahknevuse klassi

Muudatused on esitusloogikas: palga külmutamist ja ümbertegemise kulu jaotust
ei puudutatud.

## [1.34.0] — 2026-08-13

**Visiidi tüübid — miks patsient tuleb**

Visiidil oli seni ainult **staatus** (planeeritud → saabunud → toimunud), mis
ütleb, kus broneering on. Nüüd on ka **tüüp**, mis ütleb, milleks see on:
kontroll, jäljendi tegemine, proovimine, tsementeerimine, täidis, juureravi,
hügieen, ekstraktsioon, konsultatsioon. Vaikimisi üheksa, kõik muudetavad
Seaded → Valikud all, sama redaktoriga mis töö tüüpidel.

- Tüüp ei ole kohustuslik — registratuur ei tohi kiirustades broneerides
  valikunimekirja taha kinni jääda. Määramata visiit on **hall**
- Tüübi ümbernimetamine ei kirjuta juba salvestatud visiite ümber: need jäävad
  vana nime kandma ja muutuvad halliks. Salvestatud kirjet ei muuda valiku-
  nimekirja redigeerimine
- Vajab migratsiooni `sql/045_visit_types.sql`

**Kaks fakti, kaks kanalit**

Tüüp ja staatus ei võitle enam ühe värvi pärast — varem sai kalender näidata
kas põhjust või seisu, mitte mõlemat:

- **Täidis** = tüüp (mis see on)
- **Serv** = staatus (kus see on)

**Ülevaate ajajoon on nüüd sama loogikaga kui tahvel**

- Töö kaart kannab **töö tüübi värvi** — sama, mida tahvel ja kalender kasutavad
- Visiidi kaart kannab **visiidi tüübi värvi**
- Paks vasak serv on kategooria, ülejäänud ääris on seis. Möödunud tähtaeg
  võidab ikka kõik: punane üle kõige, sest lõpetamata hilinenud töö on tähtsam
  kui see, mis liiki tööga tegu on. Valmis asjad lähevad halliks ja lõpetavad
  konkureerimise

## [1.33.0] — 2026-08-13

**Kolm režiimi: WivoLab · WivoDental · WivoX**

Varem oli üks lüliti („kliiniline režiim sees/väljas"), mis andis kaks toodet.
Nüüd on kolm eraldi valikut Seaded → Kalender all:

- **WivoLab** — labor: tööd, tahvel, tellijad, arved
- **WivoDental** — kliinik: patsiendid, visiidid, arved
- **WivoX** — mõlemad: kliinik oma laboriga

Kolm nuppu, mitte kaks märkeruutu — kaks märkeruutu saab mõlemad tühjaks jätta ja
rakendus ilma kummagi pooleta on tühi aken. Kõrvalribalt, kalendri režiimivalikult
ja vaadete vahetusest kaob nüüd ka labori pool, kui see on välja lülitatud.
Väljalülitamine ei kustuta midagi.

Ühilduvus: enne 1.33 salvestatud seadetes ei ole `laboratory` välja üldse — need
loetakse **laboriks**, nii et olemasolev paigaldus ei kaota ühtki vaadet.

**Ülevaate ajajoon näitab ka visiite**

- WivoDental ja WivoX režiimis ilmuvad päeva ajajoonele lisaks tööde tähtaegadele
  ka **visiidid** — oma ikooni ja visiidi staatuse värviga (planeeritud, saabunud,
  toimunud, ei tulnud, tühistatud), nii nagu kalendris
- Hõljutamisel näeb patsienti, suunavat arsti, kestust, staatust ja märkust;
  klõps avab kalendri
- Tähtaeg ja visiit ei ole ühte patta pandud: möödunud tähtaeg lõpetamata tööga
  on probleem, möödunud visiit on lihtsalt läbi. Sama värv oleks ajajoone
  valetama pannud
- Iga visiit saab oma punkti — kaks inimest kell 10:00 on topeltbroneering ja
  kokku liidetuna jääks see nähtamatuks
- WivoLab režiimis on ajajoon täpselt endine

## [1.32.3] — 2026-08-13

**Tähtaeg nihkus 3 tundi (15:00 → 18:00)**

`jobs.valmis_aeg` on `timestamptz`, aga rakendus saatis sinna **naiivse**
kohaliku stringi (`2026-08-13T15:00`). Postgres rakendas siis serveri ajavööndi
— Supabase'is UTC — nii et 15:00 Tallinnas salvestus kui 15:00Z ehk 18:00
Tallinna aega. Iga ekraan, mis selle kohalikku aega tagasi teisendas, näitas
18:00. Töö muutmise vorm näitas 15:00, sest see lõikas stringi tükkideks
teisendamise asemel — kaks ekraani, kaks eri kellaaega, sama töö.

- **Kirjutamine** saadab nüüd päris ajahetke koos nihkega (`fromLocalInput`)
- **Lugemine** vormi teisendab ajahetke kohalikuks ajaks (`toLocalInput`),
  mitte ei lõika stringi
- Puudutab töö vormi, uue töö nõustajat ja visiidi vormi

**Sama viga visiitidel, teistpidi**
- `visits.algus` **kirjutati** alati õigesti (`toISOString`), aga muutmise vorm
  **luges** seda stringi lõigates — 15:00 visiit avanes oma vormis kui 12:00.
  Salvestatud andmed on korras, parandust andmebaasis ei vaja

**Olemasolevad tööd**
- `sql/044_fix_valmis_aeg_timezone.sql` — diagnostika + parandus. Parandus on
  kommentaari all ja piiritletud kuupäevaga: uued read on juba õiged ja neid ei
  tohi nihutada. Teisendus käib `AT TIME ZONE` kaudu rea kaupa, nii et talvine
  (+02) ja suvine (+03) aeg lahenevad kumbki õigesti — lame „miinus 3 tundi"
  lõhuks kõik talvised tähtajad
- `kuupaev`, `valmis_kuupaev`, `makse_kuupaev` on DATE-veerud ilma kellaajata —
  neid see ei puuduta

## [1.32.2] — 2026-08-13

**Puuduv migratsioon: `jobs.extra_costs`**

- `extra_costs` on olnud `Job` tüübis ja töö vormi kulukastis ammu, aga **veergu
  ei ole kunagi loodud**. Miski ei katkenud, sest kõik kirjutamisteed jätsid
  võtme juhuslikult välja, ja kõik lugemised kasutavad `?? []`
- 1.31.6 sulges need kaks auku (nõustaja saadab nüüd `extra_costs: []`, töö vorm
  laeb ja salvestab päris nimekirja) — ja puuduv veerg lükkas kohe terve inserti
  tagasi, sest mõlemad kirjutused on toored spread'id. See on migratsioon, mis
  oleks pidanud funktsiooniga kaasa tulema
- `sql/043_job_extra_costs.sql` — jsonb, not null, vaikimisi `[]`, nagu `extras`
- Veateate kaardistus parandatud: `extra_costs` osutas ekslikult `033`-le, mis
  loob hoopis `extras` — teine veerg, teine funktsioon, üks sõna vahet

## [1.32.1] — 2026-08-13

**Nõustaja: „Loo töö" ja „Salvesta mustand" nägid välja nagu surnud nupud**

Kumbki ei olnud katki — mõlemal puudus tagasiside seal, kus kasutaja vaatab.

- **„Loo töö"** — kui lisamine ebaõnnestus, renderdus veateade *sammu sisu
  lõpus*. 6. samm on pikk keritav ülevaade ja nupp on kinnitatud jalusesse, nii
  et veateade jäi allapoole nähtavat ala. Nüüd ilmub see **nupu kõrvale jalusesse**
- **„Salvesta mustand"** — kirjutas localStorage'i ja ei öelnud mitte midagi,
  mis on eristamatu mittetöötavast nupust. Nüüd ütleb „Mustand salvestatud siia
  arvutisse" — ja kui salvestusruum on täis või blokeeritud, ütleb ka seda,
  selle asemel et vaikselt valetada

**Veateated nimetavad nüüd puuduva veeru ja õige migratsiooni**

- Iga insert on toores spread, nii et üks käivitamata migratsioon lükkab terve
  rea tagasi ja mitte midagi ei salvestu. PostgREST-i „Could not find the
  'mudel_id' column of 'jobs' in the schema cache" ei ütle omanikule midagi
- Nüüd: **„Andmebaasis puudub veerg „mudel_id". Käivita
  sql/041_job_mudel_id.sql Supabase SQL-redaktoris."** — veerg loetakse veast
  välja ja seotakse õige failiga

## [1.32.0] — 2026-08-12

**Köndivärv**

- Uus väli **Köndivärv** — ihutud köndi enda toon, eraldi hamba toonist.
  Läbipaistva keraamika all paistab könt krooni läbi, nii et sama A2 tuleb tumeda
  köndi peal teistsugune. Tehnik valib selle järgi ingoti läbipaistmatuse
- **VITA ND1–ND9** skaala värvinäidistega + vaba tekst (nt „titaanabutment")
- Kohad: töö vorm (Värvi all), muudatuse vorm, uue töö nõustaja 3. samm
  (Värvitooni sektsioonis, sest need kaks on üks otsus), töö vaade, eksport
- Nõustajas ja kokkuvõttes küsitakse ainult nende tööde puhul, mis üldse tooni
  toetavad — kaitsel ega proteesil ei ole könti
- Tühjaks jätmine on täisväärtuslik vastus. Vale ND on halvem kui puuduv, sest
  tehnik tegutseb selle järgi
- Vajab migratsiooni `sql/042_job_kondivarv.sql`

**Kuupäevade läbivaatus (live-valmidus)**

Käisin läbi kõik `format` / `toISOString` / `differenceIn` kutsed rakenduses.
Ülejäänud olid juba kaitstud või formaadivad `new Date()` pealt. Kolm parandust:

- **Ülevaate keskmine läbimisaeg** andis `NaN`, kui kasvõi ühel valmis tööl oli
  loetamatu kuupäev — üks NaN mürgitas terve keskmise
- **Arve osamaksed** — kuupäeva nihutamine osamaksete tsüklis võis visata keset
  tsüklit, jättes pooled dokumendid loomata. Nüüd nihutatakse ainult loetavat
  kuupäeva
- **Visiidi lohistamine kalendris** — vigane uus aeg viskas `toISOString()`
  pealt, nüüd tuleb veateade

**Tahvel**
- Lohistamise diagnostikalogi eemaldatud (parandus ise jääb)

## [1.31.12] — 2026-08-12

**Tahvel: muudatuse kaardi lohistamine ei teinud midagi**

Diagnostika näitas, et lohistamine ise oli terve — `drop` jõudis kohale, ID oli
küljes, viga ei olnud. Katki oli see, mida drop tegi.

- **Muudatuse kaart pani lohistamisele kaasa ainult originaaltöö ID.** Drop
  liigutas seega **tööd**, mitte muudatust. Tahvel paigutab muudatuse kaardi
  `rev.status` järgi ja töö kaardi `job.status` järgi — nii et kaart jäi täpselt
  sinna, kus ta oli, samal ajal kui mõni nähtamatu töö vaikselt etappi vahetas.
  Midagi ei vigastanud ja midagi ei liikunud, mis nägi välja täpselt nagu
  „kaart ei kuku"
- Muudatuse kaart kannab nüüd `revId` kaasa ja drop suunab selle
  `onRevisionStageChange`-i — juhtmestik oli juba olemas, lohistamine lihtsalt
  ei kasutanud seda
- Puudutab ainult töid, millel on aktiivne muudatus. Ilma muudatuseta töö kaardi
  lohistamine töötas kogu aeg, mistõttu see nii kaua märkamata jäi

## [1.31.11] — 2026-08-12

**Ajutine: tahvli lohistamise diagnostika**

- Tahvli kaardi lohistamine logib nüüd debug-konsooli (Meeskond → allservas):
  `DRAG algus`, seejärel kas `DROP → veerg` koos edastatud ID-ga või
  `DRAG katkes ILMA kukkumiseta`. Nendest kolmest reast on näha, kas viga on
  lohistamises, andmete edastamises või alles staatuse salvestamises
- See on diagnostika, mitte funktsioon — eemaldub kohe kui põhjus on teada

## [1.31.10] — 2026-08-12

**Kuupäevade lugemine liiga range (1.31.9 regressioon)**

- `toDate` kasutas ainult `parseISO`-t, mis on rangem kui vana `new Date(...)`
  — muu hulgas nõuab ta `T` eraldajat, samas kui Postgres võib tagastada
  `2026-08-12 17:00:00+00`. Tagajärg oleks olnud, et osa tähtaegu kaob kaartidelt
  `—` taha, kuigi need on täiesti korras. Nüüd on `new Date` tagavaraks ja
  `null` jääb ainult päriselt loetamatutele väärtustele

## [1.31.9] — 2026-08-12

**„Invalid time value" — vaate kokkujooksmine**

Täpne põhjus on **veel leidmata**. Esimene diagnoos (et `jobs.valmis_aeg` on
tekstiveerg ja hoiab pooleli trükitud kellaaegu) osutus valeks — veerg on
`timestamptz`, mis tähendab et Postgres poleks katkist väärtust vastu võtnudki.
Selle põhjal kirjutatud parandusskript `sql/042` on eemaldatud.

Mis sai tehtud:

- **Veateade on nüüd kasutatav.** `Invalid time value` tuleb date-fns'ist ja
  võib pärineda kümnetest kohtadest — pelgalt sõnum ei ütle millisest. Veaaken
  näitab nüüd ka **„Kus see juhtus"** (komponentide jada) ja sellel on nupp
  **„Kopeeri veateade"**, mis paneb lõikelauale sõnumi, komponendid, stack'i ja
  versiooni. Järgmine kord piisab ühest kopeerimisest, et koht üles leida
- **Loetamatu kuupäev kuvatakse `—`-na, mitte ei võta vaadet maha.** Kaetud:
  tähtaja märgis (tahvel/tabel/kalender/töö paneel), tabelivaade, „Valmis"
  koondkaart, muudatuste plokk. Muudatused elavad JSONB-s, kus andmebaas midagi
  ei valideeri, nii et need on päriselt kaitseta olnud
- Uus `lib/dates.ts` (`toDate` / `fmtDate` / `normalizeDateTime`) + 24 testi

**Töö vormi Kell-väli**
- Oli vaba tekst ja kirjutas iga klahvivajutuse otse `valmis_aeg` külge, nii et
  „12:00" trükkimine saatis teel andmebaasi `…T1`, `…T12:`, `…T12:0`. Kuna veerg
  on `timestamptz`, lükkas Postgres need tagasi — **salvestamise veana**, mitte
  vaikse rikutud reana. Nüüd on natiivne kellaväli, kust tuleb kas täielik HH:MM
  või tühi

**Sama viga mujal, päris leiud**
- **Arve vorm:** väljastamise kuupäeva tühjendamine jooksis **renderdamisel**
  kokku (maksetähtaja arvutus `parseISO('')` pealt). Nüüd jääb tähtaeg tühjaks
  ja salvestamine on blokis
- **Visiidi vorm:** tühi algusaeg viskas `toISOString()` pealt väljaspool
  püünist — nüüd tavaline veateade

## [1.31.7] — 2026-08-12

**Töötasud: väljamakstud summa ei kao enam ära**

- Väljamakse kinnitamine viis töötaja summa **0.00 €** peale ja tühjendas ka
  ülemise koondkaardi — kuu nägi välja nagu poleks seal midagi teenitud
- Rea summa näitab nüüd **kogu perioodi teenistust**, makstud või mitte.
  Kõrval ütlevad märgised, kuidas see jaguneb: roheline „Välja makstud X €"
  ja osalise makse korral kollane „Maksmata Y €"
- Koondkaart (Palgal bruto / Tööandja maksud / Arve alusel / Kogukulu) arvestab
  samuti kogu perioodi — tööandja maks on kuu pealt võlgu, mitte selle pealt,
  mis veel maksmata on. Kogukulu all näidatakse „sh välja makstud X €"
- Rea alltekst ütleb nüüd „N **arvestamata** rida", mitte „N rida" — 0 rida
  makstud perioodil luges nagu viga

**Lisakulude kadumine töö vormil (andmekadu)**
- Salvestatud töö avamine ei laadinud `extra_costs` välja vormi. Kulud jäid
  baasi alles, aga olid vormis nähtamatud — ja järgmine lisatud kulu kirjutas
  kogu vana nimekirja üle
- Ühtlasi kadusid viimased 3 tüübiviga, `npx tsc` on nüüd puhas

## [1.31.6] — 2026-08-12

**Mudel ID**

- Uus väli **Mudel ID** — mudeli enda töönumber, eraldi Print ID-st
- Ilmub ainult siis kui **Mudel** on sisse lülitatud: töö muutmise vormis kohe
  Kiirtöö/Mudel nuppude all, muudatuse vormis sama koha peal, uue töö
  nõustaja 4. sammus Prioriteedi valiku all
- Mudeli lipu mahavõtmine tühjendab ka ID — töö ei kanna numbrit mudelile,
  mida tal pole
- Nähtav töö vaates (Tootmise andmed), otsitav globaalsest otsingust,
  kaasas Exceli/CSV ekspordis
- Vajab migratsiooni `sql/041_job_mudel_id.sql` (Supabase SQL editoris)
- Pooleliolevad uue töö mustandid lähtestuvad (mustandi versioon v1 → v2)

## [1.31.5] — 2026-08-10

**Omahind, rahanduse parandused, implantaadi kruvi**

**Omahind (labori kulu) kast töö ja muudatuse vormil**
- Tehnik ja disainija tasu arvutatakse **tegelikest tasureeglitest** — fetchib
  valitud töötaja reeglid (hammas/töö/%) ja arvutab tegeliku summa
- "Sama mis tööl" → kasutab originaaltöö tehnik/disainija reegleid, mitte fallback'i
- Materjali kulu: `materialCosts` → `materialPrices` fallback kui omahinda pole
- Tarvikud (kruvid, abutmendid) seadetest — iga kulu nimepidi eraldi real
- **+ Lisa kulu** — ad-hoc lisakulud (nt juureravi, väline labor) mitu rida
- Kate = Tulu − Kokku kulu (protsendiga)
- Tunnihind: kuutasult arvutatakse `kuupalk / (päevad × 4.33 × tunnid)`

**Muudatuse ümbertegemise kulu**
- Automaatne: materjal + tehnik/disainija tasu + lisakulud × kiirtöö kordaja
- Tarvikud (kruvid) ei arvestata — kasutatakse originaaltöö omi
- **Lisakulud** mitmerealiseks (nimi + summa, + Lisa kulu / × eemalda)
- Tasustamata toggle → tööjõud = 0 kulus
- Disain ID lisatud Print ID kõrvale
- Käsitsi hinna sisestamine eemaldatud — kulu on alati automaatne

**Rahanduse tabel parandused**
- Tabel arvestab **iga tööosa eraldi** (mitte ainult job.too)
- Muudatuste tööosad arvestatakse ka (Allon4 redo ilmub tabelis)
- Muudatused ilmuvad ka kui originaaltöö on vanemast perioodist
- Veerud: Tulu, Kulu, Tööjõud, Materjal, Kate, Kate %, Kesk. tulu/kulu/kate, €/h tulu/kulu/kate
- **Kasum / Tulu / Kulu** kokkuvõte kaardid ülaosas (vana arveldatud-põhine eemaldatud)
- Materjali kulu fallback müügihinnale kui omahinda pole
- Kulu kaardil detailne jaotus: tööjõud, materjal, fikseeritud, üldkulud

**Implantaadi kruvi väli**
- `WorkItem.kruvi` väli — ilmub automaatselt implantaat-tüüpi tööosadel
- Read view näitab kruvi infot: 🔩 MIS C1 3.75×11.5mm

**Töötasude tööpäevade valik**
- E T K N R L P nupud — valitav tunni- ja kuutasu reeglile
- Vaikimisi E-N (4 päeva), mitte hardcoded E-R

**Muud parandused**
- `resolveWorkType` matchib pikima nime enne (Implantkroon > Kroon)
- Töö tüüp näitab kõiki tööosasid: "Kroon + Implantaadi kroon"
- DeadlineChip kasutab kalendripäevi (`differenceInCalendarDays`)
- "Muudatuse hind" → "Ümbertegemise kulu (sisemine)"
- `package-lock.json` sünkroonitud, `allowScripts` lisatud

## [1.31.3] — 2026-08-07

**Uus odontogram ja wizard parandused**
- **Uus odontogram** — SVG asendatud CSS grid layoutiga. Hambad on ümarad kastid
  FDI numbriga sees, U-kujuline arch marginTop offsetiga, kerge rotatsioon.
  Gradient rose-50 taust, bridge connector hambaste servast, legend chips üleval
- **Drag-to-paint** — hambaid saab valida lohistades, mitte ainult klõpsates.
  Mousedown alustab, lohista üle hammaste, mouseup lõpetab
- **Wizard sildade duplikaadid** — + nupp hambaste sammus lisab sama tüübi tööosa
  (Sild 1, Sild 2). × nupp eemaldab duplikaadi. `selectedTeeth` kasutab `Sild§2` võtmeid
- **Wizard 2-kolumni layout** — tabid ja nupud vasakul, odontogram paremal.
  Kõik mahub ühele ekraanile ilma kerimiseta
- **Töötüübi nupud uus disain** — suurem pilt (h-14), check badge ülal paremal,
  hind all. Vaikimisi näidatakse ainult valitud tüüpe, "Näita kõiki" laiendab
- **Ülemine/Alumine kaardi nupud** — Upper.png/Lower.png piltidega, sama disain
  mis töötüübi nupud. Peegelda nupp eemaldatud (odontogramil on juba mirror toggle)
- Muudatuse read-only odontogram eemaldatud RevisionBlock'ist (topelt info)
- Wizard header kompaktne, step progress samal real
- Wizard roosa taust vähendatud, odontogram suurem (max-width 600px)

## [1.31.1] — 2026-08-07

**Töötüübi pildid ja vormi parandused**
- Töötüübi PNG ikoonid (`assets/jobs/`) nüüd nähtavad kõikjal — edit form, wizard,
  seadete hinnakaardid. Alias map seob eesti nimed inglise failinimedega (Kroon→Crown,
  Sild→Bridge, Implantkroon→Implant_crown jne)
- Fullscreen keskkolumn kasutab nüüd `WorkItemsField`'i: + nupp (lisa sama tüüpi
  tööosa juurde, nt Sild 1, Sild 2), × (eemalda), silla toggle, materjali badge
- **Masin per-tööosa** — igale tööosale saab oma masina valida (nt Kroon→Midas,
  Sild→Pro2). Sama muster mis materjalil
- Kuupäev/tähtaeg/kell ühel real (3 kolumni), enam ei jää HH:MM kast piiridest välja
- Wizard header kompaktne — step progress samal real pealkirjaga, "Samm X/6" badge.
  Enam ei pea kerima et sisu näha
- Akna kõrgus 900→960px, miinimum 700→750px
- NSIS `oneClick: true` — uuendus installib vaikselt, enam pole installeri viisardit

## [1.30.19] — 2026-08-07

**Read view tegevused ja muudatuse overlay**
- **Lisa muudatus**, **Dubleeri**, **Prindi** nupud otse read view'l
- Lisa muudatus on variant chipide real: `[Originaal] [Muudatus 1] [+ Lisa muudatus]`
- Muudatuse lisamine ja redigeerimine overlay'na read view peal — ei mine enam
  edit mode'i. Pärast salvestamist jääd read view'le, muudatus automaatselt aktiivne
- Nested form fix: `RevisionEditFullscreen` kasutab `<div>` mitte `<form>`, vältides
  pesastatud vormide probleemi mis saatis kasutaja dashboardi
- Eemaldatud duplikaat X nupp muudatuse vormilt (jäi ainult Tühista)

## [1.30.18] — 2026-08-07

**Per-tööosa materjal, purunemise hambavalija, tasustamata lüliti**
- `WorkItem` sai `materjal` välja — sillale ja kroonile saab eri materjali valida.
  Materjali valik kehtib aktiivsele tööosale, chip näitab materjali nime
- Materjal on nüüd nupuvalik (mitte vabatekst) nii töö kui muudatuse vormil,
  koos materjali alamtoonidega (nt Crown HT → A1, A2, A3)
- **Purunemise hambavalija**: "Purunemine" põhjuse valimisel avaneb odontogram popup
  purunenud hammaste märkimiseks. Salvestatakse eraldi `purunenud_hambad` väljale
- **Tasustatud/Tasustamata lüliti** muudatuse vormil — labori vea puhul jätab
  palgareeglid vahele (`taspidev: false`). Badge nähtav board-kaardil ja ajaloos
- Kaardi värvid `overflow-hidden` kaudu — kärbuvad ümarate nurkadega ilusti
- "Katab ka muudatused" checkbox nähtav ka Disain reegliga (mitte ainult Teostatud töö)

## [1.30.15] — 2026-08-06

**Revision card värvid, mudeli badge, debug konsool**
- Muudatuse board-kaardi vasak äär kasutab töötüübi värvi (oli hall)
- Mudeli "M" badge nähtav nii töö- kui muudatuskaardil
- Board peidab originaalkaardi kui aktiivne muudatuskaart on olemas
- `DeadlineChip` muudatuskaardil (oli väike tekst)
- Debug konsool (`DebugConsole`) Meeskond lehe all — püüab `console.error`,
  `unhandledrejection` ja `error` sündmused. `debugLog()` manuaalseks logimiseks

## [1.31.0] — 2026-08-07
**Andmebaasi muudatused:** `sql/039_worker_pay_extra_scope.sql` (jooksutatud),
`sql/040_worker_pay_additive.sql` — **jooksuta see**, Wivo kinni. 039 oli vale
lahendus ja 040 parandab selle ära; 039 jääb alles, sest jooksnud migratsiooni
ei muudeta.

Suurem osa sellest versioonist on **töötasud**. Kolm viga liigutasid raha vale
inimesele või vale summas ja ükski neist ei olnud ekraanil näha.

**Tasureegel sobitatakse iga tööosa kaupa, mitte töö kaupa**
- Reegel valiti `job.too` järgi, mis on **ainult esimene tööosa**. Kroonid + sild
  ühel tööl tähendas, et sillareeglit ei vaadatud kunagi ja krooni määr korrutati
  kõigi hammastega. 2 krooni à 15 € + 3-lüliline sild à 25 € andis 75 €, mitte 105 €
- Iga tööosa saab nüüd oma reegli ja summeeritakse. Sama reegli alla kuuluvad
  osad koondatakse enne maksmist, nii et fikseeritud "200 €/töö" jääb üheks
  makseks ükskõik mitut osa ta katab
- Protsendireegel jagatakse hammaste osakaalu järgi. Kaks protsendireeglit eri
  tööosadel maksid varem mõlemad täishinnast — töö oleks makstud kaks korda välja
- Diagnostika ütleb nüüd ka **osalist** puudujääki: "Osa tööosi jääb tasustamata —
  Sild". Varem oli see nähtamatu, sest üks reegel kattis töö niikuinii
- **Segatööde summad muutuvad.** Vaata jooksva perioodi töötasud üle enne
  kinnitamist. Kinnitatud väljamaksed on kaitstud — need on koopiad

**Lisanduv tasu ja reegli nimi** (`sql/040`)
- Uus lipp **"Lisandub"**: tasu makstakse tootmistasu **kõrvale**, mitte selle
  asemel. Ilma selleta ei saanud öelda "igeme disain 9 €/hammas All-on-X-i peale",
  sest ühe tööosa kohta võidab täpselt üks reegel — 9 € oleks makstud kaare
  tasu asemel
- Lisanduvus on **lipp**, mitte "mille eest" väärtus. Igeme disain ON disain;
  kui ta peaks end "lisateenuseks" kuulutama, ei jääks tavalisel disainireeglil
  enam kohta. Kolm küsimust, kolm välja: *kuidas arvutatakse* (Liik), *mille eest*
  (töö/disain/muudatus), *kas lisandub*
- Reeglil on nüüd **nimi**, mis kandub palgalehe reale. Kolm ühesugust "Lisatasu"
  rida ei ütle kellelegi midagi; "Igeme disain 27 €" ütleb

**Üks reegel, mitu töötüüpi**
- "Ainult töö tüübile" rippmenüü asemel on kiibirida, kus saab valida mitu.
  Sama hinna jaoks ei pea enam kirjutama kümmet ühesugust reeglit
- Salvestatakse olemasolevas `work_type` veerus, eraldajaks `|` — sama eraldaja,
  mida materjalikulude võtmed juba kasutavad. Migratsiooni ei olnud vaja ja vana
  ühe nimega reegel käitub täpselt nagu enne

**Muudatusel on oma teostaja ja disainija**
- Palgamootor andis **iga** muudatuse töö `assigned_to` inimesele. Kui ümbertegemise
  võttis keegi teine, maksti originaali tegijale
- Mõlemas muudatuse redaktoris on nüüd Teostaja ja Disainija, vaikimisi "Sama mis
  tööl". `revisions` on JSONB, migratsiooni ei olnud vaja
- Töö tsükkel viskas inimese välja enne muudatusteni jõudmist, kui ta ei olnud
  töö enda teostaja ega disainija — kolmas inimene oli palgaarvestusele nähtamatu
- Muudatuse **disaini** eest ei makstud varem üldse; nüüd makstakse, aga ainult
  kui disainireeglil on "Katab ka muudatused". Ümbertegemine on vaikimisi
  tasustamata ja disain ei ole erand

**Kiirtöö kordaja tuleb Seadetest**
- Kahes kohas oli **arvutuses** kõvakodeeritud 2: muudatuse lisamisel ja täisekraanil
  salvestamisel. Labor, kellel on seades 1,5, arveldas kiirmuudatusi topelthinnaga
- Sildid näitasid samuti alati "2×", ka siis kui hind oli teine. Seitse kohta
  loevad nüüd `settings.kiirtooKordaja`

**Valmimiskuupäev on muudetav; Väljastus käib Valmis-oleku külge**
- `valmis_kuupaev` on kuupäev, mille järgi palka makstakse, ja seda ei saanud
  vormil üldse muuta — 30. juulil valminud tööd ei saanud augustisse tõsta
- Töö vormil on nüüd **"Valmis" plokk**, mis ilmub ainult Valmis-etapis ja hoiab
  koos valmimiskuupäeva ja väljastuse. Kuupäev täidetakse etapile liikumisel
  nähtavalt, mitte vaikselt salvestamisel
- **Väljastus kadus uue töö vormist.** Loodav töö on definitsiooni järgi laboris —
  samm, millel on üks võimalik vastus, õpetab mõtlematult edasi klõpsima

**Üks kuupäev kõigile perioodifiltritele**
- Ülevaade luges `kuupaev` (saabumine), Rahandus ja töötasud `valmis_kuupaev`
  (valmimine). Sama "See kuu" nupp andis kahel lehel eri vastuse ja kumbki ei
  öelnud, kumba ta mõtleb
- Nüüd on `jobPeriodDate()` failis `types/job.ts` ja seda kasutavad kõik kolm:
  valmimiskuupäev, siis tähtaeg, siis saabumiskuupäev
- **Ülevaate numbrid nihkuvad.** Juulis saabunud, augustis valminud töö liigub
  juulist augustisse

**"See nädal" statistikas**
- Uus periood mõlemal statistikalehel, esmaspäevast — sama nädal mis tahvlil,
  tabelifiltris ja palgaarvestuses
- Perioodil ei olnud **ülemist piiri**: "See kuu" tähendas "1. kuupäevast alates
  lõpmatuseni". Aasta peale nähtamatu, seitsme päeva peale mitte

**Muudatuse leht sai originaali funktsioonid**
- Tüübinupp muudatuse lehel **lülitas sisse-välja**, nii et teine "Sild" kustutas
  esimese. Mitut silda ei saanud muudatusele üldse märkida
- Uus ühine `WorkItemsField` teenindab mõlemat muudatuse redaktorit: nummerdus,
  `+` teise sama tüübi lisamiseks, `×` eemaldamiseks, silla lüliti, tööosade
  kaupa materjal
- **Muudatuse vaates ei näidatud hambaid üldse mitte**, kui tööl oli mitu tööosa:
  tööosade plokk oli peidetud muudatuse taha ja lame hambaloend töö tööosade arvu
  taha. Mõlemad kukkusid välja ja ekraanile ei jäänud midagi
- Hambakaardil oli **kaks eri nummerdust**: kiip luges tüübi sees ("Sild 4"),
  hambakaart üle kogu nimekirja (5). Nüüd loevad mõlemad sama moodi ja number
  ilmub ainult siis, kui tüüp päriselt kordub
- Muudatuse täisekraanil oli tühi kolmas veerg, mis võttis veerandi laiusest ja
  lükkas hambakaardi kerimise taha

**"Lisa uus töö" — juhendatud vorm**
- Uue töö loomine näitas kõiki välju korraga. Nüüd on kuuesammuline vorm:
  töö tüüp → hambad → materjal ja toon → tootmine → patsient ja tellija → kontroll
- Pärast loomist antakse töö üle olemasolevale Muuda-lehele
- Loogika on `shared/wizard/` all, sõltuvusteta ja testitud

**Töötasudel on testid**
- `earnings.ts` oli rakenduse rahaliselt raskeim puhas moodul ja tal ei olnud
  ühtegi testi. Nüüd on 34, sealhulgas regressioonid vanale käitumisele
- `vitest.config.mts` lisatud, sest ilma `@shared` aliaseta ei saanud `src/` all
  üldse testida

**Väiksemad**
- `PayrollView` võrdles `scope !== 'revision'`, mida `RateScope`-s ei ole — tingimus
  oli alati tõene ja "Katab ka muudatused" kastike ilmus ka muudatusreeglitele
- `WorkerSelect` tõsteti `JobDetailPanel`-ist välja: see kontroll otsustab, kes saab
  raha, ja kaks veidi erinevat koopiat liigutaksid seda vale inimesele
- Surnud `WorkItemsEditor.tsx` kustutatud (ei olnud kusagil kasutusel)

## [1.30.0] — 2026-08-05
Andmebaasi muudatusi ei ole. `clinic_settings.pricing` saab kaks uut välja,
mis tekivad iseenesest (jsonb).

**CSV eksport — Tööd, Arved, Kliendid, Väljamaksed**
- Eksporti ei olnud varem üldse. Litsentsimudelis on see kohustuslik: iga
  ostja küsib "kas ma saan oma andmed kätte"
- Kirjutatud Eesti Exceli jaoks: **semikoolon** eraldajaks (komaga fail avaneb
  ühe veeruna), **BOM** (muidu "Tõnu Käär" → "TÃµnu KÃ¤Ã¤r"), **komakoht komaga**
  (muidu loeb Excel summa tekstina)
- Tabel ekspordib **filtreeritud** read, mitte kõik — filtreeritud vaatest
  kõige eksportimine on see, kuidas raamatupidajale läheb vale kuu
- Töötasud annab kaks faili: väljamaksed kokku ja read eraldi. Teine on vastus
  küsimusele "miks see number selline on", mida küsitakse kuid hiljem

**Üldkulud — brutomarginaalist saab kasum**
- Uus **Seaded → Hinnad → Üldkulud kuus**: rent, liisingud, tarkvara, side
- Rahandus jagab need perioodile päevade järgi (30,44-päevase keskmise kuu
  alusel, et veebruar ei paistaks märtsist odavam — rent on sama)
- Kui üldkulud on sisestatud, muutub tulemuse pealkiri "Kate" → **"Kasum"**.
  Kui neid ei ole, jääb "Kate": nulli lahutamine ja tulemuse kasumiks nimetamine
  oleks sama vale mis marginaal, mis tööjõudu ignoreerib

## [1.29.0] — 2026-08-05
Andmebaasi muudatusi ei ole.

**Litsentsivõti**
- Ed25519-ga allkirjastatud võti, formaadis `WIVO1.<payload>.<allkiri>`. Sees on
  kellele, pakett, kasutajate arv ja aegumiskuupäev
- **Kontroll toimub arvutis kohapeal, ilma internetita.** Labor ei tohi seisma
  jääda sellepärast, et võrk kadus — aegumine on võtme sees ja allkiri tõestab,
  et keegi pole seda muutnud
- **14 päeva armuaega.** Aegunud võti ei lukusta rakendust kohe: kollane hoiatus,
  siis kirjutuskaitse. Lugemine jääb alati alles. Labor, kes ei saa juba tehtud
  tööd arveldada, ei uuenda litsentsi vaid vihastab
- Kirjutuskaitse jõustub `usePermissions().can()` sees — ühes kohas, kust kogu
  rakendus niikuinii kirjutusõigust küsib
- Seaded → Litsents näitab seisu ja võtab uue võtme vastu
- Võti käib ettevõtte, mitte arvuti külge — sama võti iga töökoha peale

**Sinule (mitte kliendile):**
```
node scripts/make-license.mjs keygen
node scripts/make-license.mjs sign --name "Labor OÜ" --plan labor --months 12
```
`keygen` jookseb ÜKS kord. `license-private.pem` on gitignore'is — varunda seda
nagu pangaparooli. Avalik võti läheb `src/main/license.ts` sisse; kuni see on
tühi, litsentsi ei kontrollita ja iga build on arendusversioon.

## [1.28.0] — 2026-08-05
**Andmebaasi muudatused:** `sql/035_customers.sql`, `sql/036_customers_realtime.sql`
(eraldi, omaette), `sql/037_features.sql`. Jooksuta Supabase SQL editoris, Wivo kinni.

Faas 1: WivoLab hakkab olema laboritoode. Labor müüb kliinikutele, mitte
patsientidele — ja tarkvara teab seda nüüd ka.

**Kliendid**
- Uus vaade Patsientide ja Arvete vahel: tellijakliinikud, kellele labor töid teeb
- Nimi, registrikood, KMKR, aadress, kontakt, e-post, maksetähtaeg ja arveldusviis
  (töö kaupa või kuu koondarve)
- Arhiveerimine on esmane; kustutada saab ainult klienti, kellel pole ühtegi tööd
  ega arvet, sest kustutamine jätaks kogu ta ajaloo nimetuks

**Tööl on nüüd tellija**
- Tellija (klient), tellija enda juhtumi viide, ja väljastuse staatus
  (Laboris / Teel / Üle antud) koos üleandmise kuupäevaga
- Torustik lõpeb "valmis" peal, mis ütleb, et pink on lõpetanud — mitte et
  kliinikul on töö käes. Need on eri päevad

**Arved saavad olla kliendi nimel**
- Arve vormil on saaja lüliti: Klient või Patsient
- Kliendi valimisel tulevad kandidaadiks kõik selle kliiniku tellitud tööd,
  sõltumata patsientidest; rea kirjeldusse läheb tellija enda viide
- Arvete nimekiri näitab saaja liiki ikooniga
- **Ükski olemasolev arve ei muutu.** `patsient` väli tähendab nüüd "nimi, kellele
  dokument on adresseeritud" ja uus `bill_to_kind` ütleb, mis liiki see nimi on —
  iga vana rida on 'patient', mis ta oligi

**Kliiniline režiim — vaikimisi VÄLJAS**
- Patsiendikaart ja visiitide broneerimine on nüüd lipu taga. Labor haldab töid,
  mitte patsiente, ja ravikaart on GDPR-i eriliigiline andmestik, mida ei ole
  mõtet koguda, kui seda vaja ei lähe
- **Midagi ei kustutata.** Olemasolevad patsiendid ja visiidid on andmebaasis alles
  ja tulevad tagasi kohe, kui režiimi sisse lülitad:
  **Seaded → Kalender → Kliiniline režiim**

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
