# Broneerimisvorm kliiniku kodulehele

Üks `<script>`, mis paneb kliiniku lehele visiiditaotluse vormi. Taotlus maandub
Wivos **Taotlused** lehel; registratuur helistab ja teeb päris visiidi.

Vorm **ei broneeri aega**. Ta küsib aega. Kalender jääb Wivo (või Dentase) sisse
ja midagi ei jõua sinna ilma, et keegi selle üle vaataks — vt `sql/059`.

---

## Enne kui midagi tööle hakkab — neli sammu

### 1. Kliinikule slug

Wivo → **Seaded → Kliinik → Avalik aadress (slug)**. Näiteks `minu-kliinik`.

See ongi opt-in: ilma slugita ei ole kliinik veebist adresseeritav ja funktsioon
vastab 404-ga. Wivo teeb slugi kirjutamisel ise korrektseks (`slugify`).

### 2. Lubatud aadressid

**Ainult need lehed, kus vorm päriselt on.** `*` ei ole valik: see marsruut
kirjutab päris kliiniku postkasti, ja brauseri päritolukontroll on üks väheseid
asju, mis seisab selle ja iga interneti lehe vahel.

```bash
supabase secrets set \
  PUBLIC_BOOKING_ORIGINS="https://minukliinik.ee,https://www.minukliinik.ee,http://localhost:3000" \
  IP_HASH_PEPPER="$(openssl rand -hex 32)"
```

`www` ja ilma on brauseri jaoks **kaks eri päritolu** — kui leht töötab mõlemat
pidi, peavad mõlemad nimekirjas olema. `localhost:3000` on proovilehe jaoks;
võta see enne päris kasutust välja.

`IP_HASH_PEPPER` on rämpsupiirangu jaoks. IP-d ennast ei salvestata kunagi —
ainult räsi, ja ilma pepperita oleks räsi tagasi arvutatav.

### 3. Funktsiooni deploy

```bash
supabase functions deploy public-booking --no-verify-jwt
```

`--no-verify-jwt` on siin **õige**: alternatiiv on panna anon-võti avalikku
lehte, mis annaks maailmale töötava PostgREST-i pääsu. Päritolunimekiri ja
piirangud on väiksem pind.

*(NB: `send-invoices` deploy'takse ILMA selle liputa — ta saadab kirju kliiniku
enda aadressilt ja peab jääma autenditud pinnaks.)*

### 4. Kontrolli, et vastab

```bash
curl -s -H "Origin: https://minukliinik.ee" \
  "https://<ref>.functions.supabase.co/public-booking/services?clinic=minu-kliinik" | jq
```

Ootus: `{"ok":true,"data":{"clinic":{...},"services":[...]}}`.

- `404 UNKNOWN_CLINIC` → slug on kirjutamata või kirjaviga
- vastus ilma `access-control-allow-origin` päiseta → `Origin` ei ole nimekirjas
- `services: []` → hinnakirja ei ole avaldatud. **Vorm töötab ikka**, ainult
  teenusevalikut ei tule

---

## Lehele panemine

```html
<div id="wivo-broneering"></div>
<script
  src="https://minukliinik.ee/wivo-booking.js"
  data-wivo-base="https://<ref>.functions.supabase.co/public-booking"
  data-wivo-clinic="minu-kliinik"
  data-wivo-target="#wivo-broneering"></script>
```

`wivo-booking.js` tuleb panna kliiniku enda serverisse (Framer: Assets;
WordPress: teema kaust; või ükskõik milline staatiline hosting).

### Kui faili üles laadida ei saa

Paljud lehetegijad lubavad ainult HTML-plokki kleepida, mitte `.js` faili lisada.
Siis pane kogu faili sisu otse `<script>` sisse — muudatusi ei ole vaja, sest
seadistus loetakse `document.currentScript` pealt ja see töötab ka reasisese
skriptiga:

```html
<div id="wivo-broneering"></div>
<script
  data-wivo-base="https://<ref>.functions.supabase.co/public-booking"
  data-wivo-clinic="minu-kliinik"
  data-wivo-target="#wivo-broneering">
/* siia kogu wivo-booking.js sisu */
</script>
```

Miinus: uuendamiseks tuleb tekst uuesti kleepida. Kui `src` on võimalik,
kasuta seda.

| Atribuut | Kohustuslik | Mis |
|---|---|---|
| `data-wivo-base` | jah | Funktsiooni aadress, ilma lõpukaldkriipsuta |
| `data-wivo-clinic` | jah | Slug sammust 1 |
| `data-wivo-target` | ei | CSS-selektor, vaikimisi `#wivo-broneering` |
| `data-wivo-title` | ei | Pealkiri vormi kohal |

### Kujundus

CSS-muutujatega, faili puutumata:

```css
.wv {
  --wv-accent: #7c3aed;   /* nupp ja fookus */
  --wv-ink:    #1b2733;
  --wv-muted:  #64748b;
  --wv-line:   #dfe5ec;
  --wv-bg:     #ffffff;
  --wv-radius: 4px;
}
```

Kirjatüüp päritakse lehelt (`font-family: inherit`) — vorm ei too kaasa ühtegi
välist fonti ega teeki.

---

## Proovimine

```bash
cd web/embed
npx serve .
# ava http://localhost:3000/test.html
```

Ava **päris pordilt, mitte `file://` pealt**. `file://` saadab `Origin: null`,
mille nimekiri õigustatult tagasi lükkab, ja siis paistab katki asi, mis
tegelikult töötab.

`test.html`-is on kontrollnimekiri: idempotentsus, sõnumi pikkus, piirang.

---

## Mis juhtub, kui midagi katki läheb

| Olukord | Mida vorm teeb | Miks |
|---|---|---|
| Teenuste nimekiri ei laadi | Vorm ilmub **ilma** valikuta, vaikselt | Katkine hinnakiri ei tohi takistada inimest aega küsimast |
| Saatmine aegub | **Ei korda automaatselt** | Automaatne kordamine on see, kuidas ühest inimesest saab registratuuris viis rida |
| Inimene vajutab uuesti | Sama idempotentsusvõti | Võti tekib lehe **avamisel**, mitte saatmisel. Server hoiab ühe rea |
| Bot täidab peidetud välja | Saab sama `200`, rida ei teki | Talle ütlemine, et ta jäi vahele, on tasuta info järgmise kirjutajale |
| Üle 6 taotluse tunnis | `RATE_LIMITED` | Loetakse **tabelist**, mitte mälust: mälupõhine ämber nulliks iga külmkäivitusega |

---

## Mida see vorm teadlikult EI tee

- **Ei ütle patsiendile midagi peale „taotlus saadud".** Ei numbrit, ei staatust,
  ei jälgimislinki. Link, mis ütleks „teie taotlus kinnitati", oleks patsiendile
  vaade tema enda ravile — see on MDR-i piir, mida see toode ei ületa.
- **Ei broneeri aega.** Ta ei tea kalendrit ega luba kellaaega.
- **Ei küsi isikukoodi ega terviseandmeid.** Lisainfo väli on 300 tähemärki ja
  ütleb otse, et terviseandmeid sinna kirjutada ei ole vaja. Piir on ka serveris
  (`sql/059`), sest vorm on avalik kood ja sellest saab mööda.

## Andmekaitse, lühidalt

Salvestatakse: nimi, telefon, e-post (kui antud), soovitud aeg, sõnum, IP räsi.
Tagasi lükatud ja rämpstaotlused **kustuvad ise 90 päeva pärast**
(`purge_visit_requests`, öösel 03:20). Kinnitatud taotlused jäävad alles — nende
juurde kuulub päris visiit.

Lisa kliiniku privaatsusteatesse rida selle vormi kohta. Wivo ei tee seda sinu
eest ja see on kliiniku kui vastutava töötleja kohustus.
---

## Visiiditasu (Montonio)

Vabatahtlik. Vaikimisi tasu ei küsita ja kliinik, kes seda ei taha, ei pea
midagi tegema.

**Miks tasu:** omaniku sõnastuses „et mitte raisata kellegi aega ja ainult
kindlad inimesed tulevad". Läheb ravi hinna sisse, kui töö läheb suuremaks.

### 1. Montonio võtmed

`partner.montonio.com` → Sandbox võtmed esimeseks. Siis:

```bash
supabase secrets set   MONTONIO_ACCESS_KEY="..."   MONTONIO_SECRET_KEY="..."   MONTONIO_ENV="sandbox"
```

`MONTONIO_ENV` on **sandbox kõike muud kui täpselt `live`**. See on tahtlik:
kirjaviga selles reas ei tohi hakata päris raha liigutama.

### 2. Summa andmebaasi

```sql
update public.clinic_settings
   set broneering = coalesce(broneering,'{}'::jsonb)
       || jsonb_build_object('visiiditasu', 20, 'valuuta', 'EUR',
                             'tagasiUrl', 'https://www.fullgevitydental.ee/')
 where clinic_id = my_clinic_id();
```

**Summa loetakse SIIT, mitte brauserist.** Avalik vorm, mis saaks ise hinna
nimetada, on vorm, kus kõik maksavad ühe sendi.

### 3. Mis siis juhtub

1. Patsient saadab vormi → taotlus on **kohe salvestatud**
2. Server loob Montonio tellimuse ja vorm suunab panka
3. Pangast tuleb patsient tagasi `/return` peale, Montonio ise saadab `/webhook`
4. Mõlemad kontrollivad **allkirjastatud tokenit** ja märgivad rea tasutuks
5. Wivos „Taotlused" all on rea peal silt **Tasutud 20.00 €**

**Kui makse jääb pooleli, taotlus EI kao.** Inimene küsis aega — see on kirjas,
ja registratuur näeb, et tasu on maksmata. Kaotada taotlus sellepärast, et
pangaleht katkes, oleks halvem tehing.

### Mida kontrollida enne `live`

- Sandbox'is läbi üks makse ja vaata, et Wivos tekib **Tasutud**
- Vajuta vormi saatmist kaks korda → **üks** taotlus ja **üks** makselink
- Ava `/return?order-token=jama` käsitsi → peab ütlema „ei õnnestunud
  kinnitada", mitte märkima tasutuks
- Alles siis `MONTONIO_ENV="live"` ja päris võtmed

### Mida see EI tee

- **Ei tagasta raha.** Tagasimakse tehakse Montonio partnerisüsteemis käsitsi.
  Automaatne tagasimakse on koht, kus vale rida maksab päris raha, ja seda ei
  ehita enne, kui see on läbi räägitud
- **Ei broneeri aega.** Tasu kinnitab tõsist kavatsust; aja lepib kokku
  registratuur. Päris ajavalik tuleb siis, kui kalender on Wivos
---

## Hinnakalkulaator

Patsient valib hambakaardilt hambad, valib teenuse, ja näeb hinda kohe.

**Seadistus:** Wivo → Seaded → Patsiendi hinnakiri → teenuse juures
**„Luba hamba kaupa arvutamine"**. Seal saab panna hamba hinna, kogusehinnad
(mitme hamba puhul odavam), lisavalikud (toonivalik, garantii) ja ülempiiri.
Kõrval on näidis, mis jookseb **sama funktsiooni** peal, mida veeb kasutab.

Teenus ilma selleta jääb endiselt hinnavahemikuga — kalkulaator lihtsalt ei
paku teda.

### Hambakaart, mitte 3D mudel

Kaart on **FDI numbritega**, kaks rida nuppe. 3D stseen tähendaks megabaite
teeki ja WebGL-i konteksti töö jaoks, mille kaks rida nuppe teevad telefonis
paremini — ja FDI on see numeratsioon, mida hambaarst niikuinii loeb, nii et
mida patsient valib, on see, mida kliinik näeb.

### Mida kalkulaator EI tee

- **Ei ole siduv.** Iga vastuse kõrval seisab, et täpne hind selgub vastuvõtul.
  Arst ei saa hinnastada suud, mida ta ei ole näinud
- **Ei diagnoosi.** Patsient valib, mida ta soovib. Miski ei ütle, et hammas
  *vajab* krooni — see oleks diagnoos ja hoopis teine reguleeritud toode
- **Ei arvuta brauseris.** Vidin saadab valiku ja trükib serveri vastuse. Kaks
  eri arvutust lähevad ühel päeval lahku, patsiendi ees

Taotlusega koos salvestatakse **valik ja näidatud summa** — nii nagu arve rida
salvestab hinna. Hilisem hinnamuutus ei muuda seda, mida inimene nägi, ja
registratuur näeb hambaid, mitte ainult numbrit.
