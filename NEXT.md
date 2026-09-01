# Mis edasi

**Seis: v1.53.0 · 01.09.2026 · haru `main`**

See fail kirjutatakse iga töö lõpus üle. Siin on alati see, mida ma viimases
vestluses ütlesin — et uus arvuti või uus vestlus ei alustaks nullist.

`HANDOFF.md` on arendaja püsireeglid ("ära kunagi tee X"). See fail on
hetkeseis: mis on tehtud, mis ootab sind, mis on blokeeritud.

---

## 🔴 Esimene asi uues masinas

```bash
npm ci          # NB: lukufail on sünkroonis, vt allpool
npm test        # 418 rohelist, 3 punast (workTypeRules, ammune võlg)
npm run build
```

`.env` **ei ole gitis**. Uues masinas tuleb see käsitsi teha:
`VITE_SUPABASE_URL` ja `VITE_SUPABASE_ANON_KEY`. Projekt on
`wrtucsfmpbwekugzzzxw`.

Supabase CLI vajab uues masinas `supabase login` (brauseripõhine). Projekt on
juba lingitud selle repo kaudu; saladused elavad Supabase'is, mitte failides.

---

## 🔴 Jooksutamata migratsioonid

Kolm, järjekorras, Supabase SQL editoris **Wivo kinni**:

1. **`sql/053_patient_marketing.sql`** — turundusnõusolek patsiendil. Ilma
   selleta ei salvestu patsiendi lehel nõusoleku valik ja eksport annab alati
   0 kontakti.
2. **`sql/054_worker_net_pay.sql`** — neto/bruto valik ja isiklik maksuprofiil
   (II sammas, maksuvaba tulu). Ilma selleta ei salvestu Töötasud lehel
   „Tasureeglite summad on: Neto" valik ja kogukulu jääb töötaja maksuosa võrra
   alla.
3. **`sql/055_profile_ui_prefs.sql`** — `profiles.ui_prefs`, isiklikud
   vaateseaded. Ilma selleta töötab „Minu vaade" ainult selle masina
   localStorage'ist: valik ei sünkroonita ja konsool ütleb korra
   „vaateseadeid ei saanud salvestada".

*(049–052 on jooksutatud ja töötavad.)*

**Pärast 054 jooksutamist:** Seaded → Hinnad → Palgamaksud (tulumaks 22,
maksuvaba tulu 700, töötaja töötuskindlustus 1.6, II sammas 2) ja siis
Töötasud → iga palgalise juures „Neto (kätte)", kui kokkulepe on netos.

---

## ✅ E-post töötab — aga testaadressi peal

Arved lähevad `treialbusiness@gmail.com` peale, **mitte patsientidele**.
Kaks päris kirja saadetud (2026-0005, 2026-0006), PDF-manusega.

`pg_cron` töö `wivo-send-invoices` käivitub **iga tunni 7. minutil**.

**2. septembril väljastub maksegraafiku esimene osamakse ja peaks minema ise
välja.** See on esimene päris automaatne saatmine — vaata, kas juhtus:

```sql
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'wivo-send-invoices')
 order by start_time desc limit 5;
```

⚠ **Testaadressi eemaldamine Seadetes hakkab saatma päris patsientidele juba
järgmisel täistunnil** — mitte siis, kui sa midagi vajutad. Enne kontrolli:
patsientidel on e-post täidetud, kirja tekst on sinu sõnadega, ja kiri ei lähe
rämpsu (see selgub alles Gmailist väljapoole saates).

Väljalülitamine kahes kohas: Seaded → E-post → „Automaatne saatmine" välja, või
`update cron.job set active = false where jobname = 'wivo-send-invoices'`.

---

## ✅ Mis selles seerias valmis sai

| Versioon | Mis |
|---|---|
| 1.60.0 | **23 uut paneeli** — võlgnevuse vanus, ühikumajandus, tarne, kliendid, „Lõbus teada" |
| 1.59.x | Paneeli saab panna ka rea algusesse; joon on paneeli mõõtu |
| 1.58.x | Paneelide suurus ruutudes (1–4 × 1–6), lohistamine, „Paiguta" režiim |
| 1.57.0 | **Minu vaade** — kohandatav Statistika, 33 paneeli, valmisvaated, `sql/055` |
| 1.56.0 | Ø läbiaeg mõõtis tähtaega; visiitidel puudus ülempiir; `profitOf()` `lib/`-i |
| 1.55.0 | Jagatud `StatTile` ja `chartTheme`; kolm kuvamisviga Rahanduses |
| 1.54.0 | **Neto/bruto palk** + isiklik maksuprofiil, `sql/054` |
| 1.53.0 | Turunduskontaktide eksport + nõusolek, `sql/053` |
| 1.52.0 | PDF manus, `=20` parandus, `sql/052` tunnine ajastus |
| 1.51.x | Allon4 hammaste kitsendamine; saatja diagnostika |
| 1.50.0 | Kirja tekst seadistatav (`mailTemplate`) |
| 1.49.0 | **Arvete saatja** `send-invoices` — deploy'tud, tööle saadud |
| 1.48.0 | E-posti õigused ja kaitsed (`sendGuard`), `sql/051` |
| 1.47.0 | `invoiceDoc` — arve sisu ühte kohta, `sql/050` |
| 1.46.x | Kogusehinnad — mitu krooni, teine hambahind |
| 1.45.x | Maksegraafik: `sql/049`, arve vormil, vaade Arvete lehel |
| 1.44.x | Osamaksed jätsid töö 1/5 makstuks; abutmendi kood nõustajas |
| 1.41–1.43 | Rahapoole lepitamine: muudatuste kulu, arvemaksed, palgaread |

**Tõestatud tee peal:** `supabase functions deploy` pakib kaasa `shared/`
impordi, mis väljub funktsiooni kaustast. Genereeritud koopia varuplaani ei ole
vaja — `invoiceDoc.ts`, `sendGuard.ts` ja `mailTemplate.ts` jooksevad pilves.

---

## 🟡 Teadaolevad võlad

- **3 punast testi** `shared/wizard/workTypeRules.test.ts`-is. Ammune —
  `Kroonisild` klassifitseeritakse iseendaks, test ootab `Kroon`. **Ainus punane
  asi repos.**
- **`periodMetrics` „käive" liidab muudatuste hinnad juurde.** Ülejäänud
  rahapool ütleb, et muudatuse kulu on labori oma ega lähe kliendi arvele.
  Otsustamata, kas käive peab järgnema.
- **Põrkeid ei näe.** Jagatud majutuse SMTP-l ei ole webhooke: `sent_at`
  tähendab „server võttis vastu", mitte „inimene sai kätte".
- **`sql/044` 1. samm on jooksutamata.**
- **Nõustajas on Kiirtöö ja Mudel teineteist välistavad**, töö lehel mitte.

---

## 📍 Kus asjad on

| Mis | Kus |
|---|---|
| Maksegraafiku + postkasti plaan | `~/.claude/plans/aga-kui-klient-maksab-spicy-hippo.md` |
| Vana Dentase broneerimisplaan | `~/.claude/plans/i-have-idea-i-glowing-mccarthy.md` |
| Onboarding'u audit | `docs/onboarding-audit.md` |
| Finantsnäitajate sõnastik | `docs/finance-metrics.md` |
| Edge-funktsiooni deploy | `supabase/functions/README.md` |
| Arendaja püsireeglid | `HANDOFF.md` |

*(Plaanifailid on `~/.claude/plans/` all, MITTE gitis — uues masinas neid ei ole.
Kui neid vaja, kopeeri need üle või küsi kokkuvõtet.)*

---

## Järgmine samm — kolm valikut

Sinu enda öeldu põhjal, tähtsuse järjekorras:

### 1. Raamatupidamise pakett *(kõrgeim äriline väärtus)*

Su märkmetes on ainus konkreetne maksevalmiduse andmepunkt: tehnik ütles
**39 / 100 / 170 € kuus, tingimusel et raamatupidamise dokumendid tulevad
automaatselt**. See tingimus on täitmata.

Mõte ei ole raamatupidamine ise — see on Meriti territoorium ja päris vastutus.
Mõte on **„raamatupidajale valmis pakett"**: lukustatud periood, müügireskontro,
käibemaksu kokkuvõte määrade kaupa, laekumised, kulupool
(`material_costs`, `worker_pay`, `yldkulud`). Andmed on kõik olemas, puudub
ainult koondamine ja eksport.

### 2. Müügiblokeerijad *(enne kui Wivot kellelegi müüa)*

- **Litsentsivõtit ei saa väljastada** — `LICENCE_PUBLIC_KEY` on tühi, praegused
  build'id **ei kontrolli litsentsi üldse**. „Labor+" ja „Labor" on
  funktsionaalselt identsed, uuendusel ei ole midagi müüa.
- **Värskest andmebaasist ei saa Wivot püsti panna** — ükski migratsioon ei loo
  `jobs` tabelit ja viis veergu puuduvad `sql/`-ist. Teine kliinik ei saa
  alustada. Vt `docs/onboarding-audit.md`.

### 3. Broneerimissüsteem *(see, mida sa tahad teha)*

Plaan `aga-kui-klient-maksab-spicy-hippo.md`, faasid B1–B4. **Miski ei blokeeri
enam** — deploy on tõestatud ja `_shared/{cors,ratelimit,respond,settings}.ts`
on juba kirjutatud.

- **B1** `sql/054_visit_requests.sql` *(053 on nüüd võetud)* — eraldi tabel,
  mitte `visits` uus staatus. Põhjused plaanis.
- **B2** `POST /request` olemasolevas `public-booking` funktsioonis
- **B3** taotluste postkast Wivos, „Kinnita" avab olemasoleva `VisitForm`-i
- **B4** widget kliiniku lehel

**GDPR hoiatus:** Wivo-native postkast salvestab patsiendi nime ja telefoni
**meie baasi**, mida vana Dentase-plaan teadlikult vältis. Vaja
säilitustähtaega (pg_cron kustutab tagasilükatud read), privaatsusteadet ja
300-tähemärgist piiri vabal tekstiväljal.

### Väiksemad, välja öeldud aga tegemata

- Töö lehele **„Maksegraafik"** nupp, mis avab arve vormi selle töö ja
  patsiendiga täidetuna. Praegu tuleb Arvete alla minna ja patsient uuesti üles
  otsida — sa läksid seda ise töö lehelt otsima.
- `periodMetrics` „käive" ja muudatuste hinnad — vt võlgade nimekirja.
