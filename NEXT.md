# Mis edasi

**Seis: v1.45.2 · 01.09.2026 · haru `main`, commit `037a241`**

See fail kirjutatakse iga töö lõpus üle. Siin on alati see, mida ma viimases
vestluses ütlesin — et uus arvuti või uus vestlus ei alustaks nullist.

`HANDOFF.md` on arendaja püsireeglid ("ära kunagi tee X"). See fail on
hetkeseis: mis on tehtud, mis ootab sind, mis on blokeeritud.

---

## 🔴 Sinu käes

### ✅ LAHENDATUD 01.09.2026 — `@shared/` import töötab

Edge-funktsioon on deploy'tud ja vastab. **Plaani suurim tundmatu on kadunud:**
`supabase functions deploy` pakib kaasa impordi, mis väljub funktsiooni
kaustast. Üleslaadimise nimekiri näitas otse:

```
Uploading asset (public-booking): shared/portal/publicQuote.ts
Uploading asset (public-booking): shared/portal/publicService.ts
```

Ja funktsioon käivitub — `GET /public-booking/services` ilma `?clinic=`
parameetrita annab `{"ok":false,"error":{"code":"UNKNOWN_CLINIC",…}}`, HTTP 400.
Deno lahendab impordid mooduli laadimisel, seega katkine import oleks andnud
boot-vea, mitte struktureeritud vastuse.

**Tähendab:** `shared/billing/invoiceDoc.ts` ja `sendGuard.ts` saab saatja otse
importida. Genereeritud koopia varuplaani (`_shared/generated/`) EI OLE VAJA.

Tegemata on veel: `supabase secrets set` (origins + pepper + SMTP), ja
`public_slug` Seadetes, ilma milleta `/services` päris kataloogi ei tagasta.

### 1. (vana) Edge-funktsiooni deploy

Kirjutatud ja commit'itud **18. augustil**, mitte kordagi deploy'tud. Käsud:
`supabase/functions/README.md`. CLI on masinas (`2.78.1`, scoop), aga **sisse
logimata** — `~/.supabase/` all ei ole access-tokenit.

```bash
supabase login
supabase secrets set \
  PUBLIC_BOOKING_ORIGINS="https://sinu-leht.framer.website" \
  IP_HASH_PEPPER="$(openssl rand -hex 32)"
supabase functions deploy public-booking --no-verify-jwt
```

**Mitte kunagi `supabase db push`** — tahaks 49 käsitsi jooksutatud `sql/` faili
omanikuks saada.

See deploy **tõestab plaani suurima tundmatu**: kas `functions deploy` pakib
kaasa impordi, mis väljub funktsiooni kaustast (`@shared/` → `../../shared/`).
Nii visiiditaotluste postkast kui arvete automaatne saatmine sõltuvad sellest.
Kukub → varuplaan README-s.

### 2. Otsus: e-posti teenus

Maksegraafiku viimane pool (arve läheb ise välja) vajab kahte asja, mida repos
**üldse ei ole**: ajastajat (`pg_cron`) ja e-posti teenust. Roadmap ütleb
Resend/Postmark, Edge Functioni kaudu, **mitte kunagi kliendipoolne SMTP**.
Vali teenus, siis saab A2 ette võtta.

### 3. Seadetes täitmata (avaliku poole jaoks)

- **Seaded → Kliinik → „Veebilehe tunnus"** — nt `fullgevity`
- **Seaded → Patsiendi hinnakiri** — vähemalt üks avalikuks märgitud teenus

---

## ✅ Valmis ja commit'itud

| Versioon | Mis |
|---|---|
| 1.45.2 | Maksegraafikute vaade Arvete lehel |
| 1.45.1 | Maksegraafik arve vormil: arve päev, tähtaeg, eelvaade |
| 1.45.0 | `payment_plans` andmemudel, `sql/049` |
| 1.44.1 | Osamaksed jätsid töö 1/5 makstuks; `shared/billing/instalments.ts` |
| 1.44.0 | Abutmendi kood nõustajas ja hammaste kaupa |
| 1.43.x | Palgarida nimetas tööd, mille eest ei makstud; ühtlased sildid tahvlil |
| 1.42.x | **Arvega tasutud töö jäi igaveseks „maksmata"** — `paidForJob` ei näinud arvemakseid |
| 1.41.x | **Muudatuste kulu läks patsiendi arvele** kuues kohas; „Laekumata" kaart |
| 1.40.x | Mudel on lipp, mitte töötüüp; `mudeliHind` jõuab lõpuks hinda |
| 1.39.0 | Kiirtöö kordaja töötaja kohta + mudeli tasureegel, `sql/048` |
| 1.38.x | Avalik `/services` edge-funktsioon, patsiendi hinnakiri, `sql/047` |

**Migratsioonid `sql/`** — jooksutatud kuni **049** *(sina kinnitasid 049
01.09.2026; 048 kiirtöö/mudel kinnitatud varem)*.

---

## 🟡 Teadaolevad võlad

- **3 punast testi** `shared/wizard/workTypeRules.test.ts`-is. Olid katki juba
  enne kõiki neid muudatusi — `Kroonisild` klassifitseeritakse iseendaks, test
  ootab `Kroon`. **Ainus punane asi repos.**
- **`periodMetrics` „käive" liidab muudatuste hinnad juurde.** Ülejäänud
  rahapool ütleb, et muudatuse kulu on labori oma ega lähe kliendi arvele.
  Otsustamata, kas käive peab järgnema.
- **`sql/044` 1. samm on jooksutamata** — vanad tähtajad võivad vajada
  ajavööndi nihutamist.
- **Litsentsivõtit ei saa väljastada** — `LICENCE_PUBLIC_KEY` on tühi, praegused
  build'id ei kontrolli litsentsi üldse. `docs/onboarding-audit.md`.
- **Värskest andmebaasist ei saa Wivot püsti panna** — ükski migratsioon ei loo
  `jobs` tabelit ja viis veergu puuduvad `sql/`-ist.
- **Nõustajas on Kiirtöö ja Mudel teineteist välistavad**, töö lehel mitte.
  Nõustajast ei saa luua kiirtööd, millel on ka mudel.

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

---

## Järgmised faasid

Plaan `aga-kui-klient-maksab-spicy-hippo.md`, faas A1 on **valmis**.

- **A2 — automaatne saatmine.** `invoices.sent_at` + `send_error`,
  `supabase/functions/send-invoices/`, `pg_cron` päevane kutse. Blokeeritud
  e-posti teenuse valiku taga. Kontrolli ka, kas `patients` tabelil on üldse
  e-posti väli — `customers.email` on olemas, patsiendil võib puududa.
- **B1–B3 — visiiditaotluste postkast.** `sql/050_visit_requests.sql`,
  `POST /request` olemasolevas funktsioonis, postkast Wivos. Blokeeritud
  deploy taga. **Eraldi tabel, mitte `visits` uus staatus** — põhjused plaanis.
- **B4 — widget** kliiniku lehel, alles pärast B1–B3.

**GDPR hoiatus B kohta:** Wivo-native postkast salvestab patsiendi nime ja
telefoni **meie baasi**, mida vana Dentase-plaan teadlikult vältis. Vaja
säilitustähtaega (pg_cron kustutab tagasilükatud read), privaatsusteadet ja
300-tähemärgist piiri vabal tekstiväljal.
