# Mis edasi

**Seis: v1.48.0 · 01.09.2026 · haru `main`, commit `a073e95`**

See fail kirjutatakse iga töö lõpus üle. Siin on alati see, mida ma viimases
vestluses ütlesin — et uus arvuti või uus vestlus ei alustaks nullist.

`HANDOFF.md` on arendaja püsireeglid ("ära kunagi tee X"). See fail on
hetkeseis: mis on tehtud, mis ootab sind, mis on blokeeritud.

---

## ✅ Suurim risk on maas — `@shared/` import töötab

`supabase functions deploy` **pakib kaasa impordi, mis väljub funktsiooni
kaustast**. Üleslaadimise nimekiri näitas otse:

```
Uploading asset (public-booking): shared/portal/publicQuote.ts
Uploading asset (public-booking): shared/portal/publicService.ts
```

Ja funktsioon käivitub: `GET /public-booking/services` ilma `?clinic=`
parameetrita annab `{"ok":false,"error":{"code":"UNKNOWN_CLINIC",…}}`, HTTP 400.
Deno lahendab impordid mooduli laadimisel — katkine import oleks andnud
boot-vea, mitte struktureeritud vastust.

**Tähendab:** `shared/billing/invoiceDoc.ts` ja `sendGuard.ts` saab saatja otse
importida. Genereeritud koopia varuplaani (`_shared/generated/`) **ei ole vaja**.

---

## 🔴 Sinu käes

### 1. Jooksuta `sql/051_email_settings.sql`

Lisab `clinic_settings.email` — saatmise seaded ja õigused. Ilma selleta ei
salvestu E-posti vahekaart.

*(049 maksegraafik ja 050 saatmise seis on juba jooksutatud.)*

### 2. Täida Seaded → Kliinik → E-post

Veebimajutus, kinnitatud pildilt:

| | |
|---|---|
| SMTP server | `mail.elkdata.ee` |
| Port | **465** (SSL/TLS — 25 ja 587 on Supabase'is blokeeritud) |
| Saatja | `info@fullgevitydental.ee` |

**Jäta lülitid esialgu välja ja pane testaadressiks oma isiklik e-post.**
Testaadress võidab päris saaja üle alati — esimest nädalat saab vaadata ilma
et ükski patsient kirja saaks.

### 3. Saladused Supabase'i

```bash
supabase secrets set \
  SMTP_HOST="mail.elkdata.ee" SMTP_PORT="465" \
  SMTP_USER="info@fullgevitydental.ee" SMTP_PASS="..." \
  PUBLIC_BOOKING_ORIGINS="https://sinu-leht.ee" \
  IP_HASH_PEPPER="$(openssl rand -hex 32)"
```

**Parool ainult siia, mitte kunagi seadetesse** — `clinic_settings` on loetav
igale kliiniku liikmele.

### 4. Seadetes täitmata (avaliku poole jaoks)

- **Seaded → Kliinik → „Veebilehe tunnus"** — ilma selleta `/services` päris
  kataloogi ei tagasta
- **Seaded → Patsiendi hinnakiri** — vähemalt üks avalikuks märgitud teenus

---

## ✅ Valmis ja commit'itud

| Versioon | Mis |
|---|---|
| 1.48.0 | E-posti õigused ja kaitsed: `sendGuard`, Seaded → E-post, `sql/051` |
| 1.47.0 | Arve sisu ühte kohta (`invoiceDoc`), `sql/050` saatmise seis |
| 1.46.x | Kogusehinnad — mitu krooni, teine hambahind |
| 1.45.x | Maksegraafik: `sql/049`, arve vormil, vaade Arvete lehel |
| 1.44.1 | Osamaksed jätsid töö 1/5 makstuks; `shared/billing/instalments.ts` |
| 1.44.0 | Abutmendi kood nõustajas ja hammaste kaupa |
| 1.43.x | Palgarida nimetas tööd, mille eest ei makstud; ühtlased sildid tahvlil |
| 1.42.x | **Arvega tasutud töö jäi igaveseks „maksmata"** |
| 1.41.x | **Muudatuste kulu läks patsiendi arvele** kuues kohas |
| 1.40.x | Mudel on lipp, mitte töötüüp |
| 1.39.0 | Kiirtöö kordaja töötaja kohta + mudeli tasureegel, `sql/048` |

**Migratsioonid `sql/`** — jooksutatud kuni **050**. **051 ootab.**

---

## 🟡 Teadaolevad võlad

- **3 punast testi** `shared/wizard/workTypeRules.test.ts`-is. Olid katki juba
  ammu — `Kroonisild` klassifitseeritakse iseendaks, test ootab `Kroon`.
  **Ainus punane asi repos.**
- **`periodMetrics` „käive" liidab muudatuste hinnad juurde.** Ülejäänud
  rahapool ütleb, et muudatuse kulu on labori oma ega lähe kliendi arvele.
  Otsustamata, kas käive peab järgnema.
- **Põrkeid ei näe.** Jagatud majutuse SMTP-l ei ole webhooke: `sent_at`
  tähendab „server võttis vastu", mitte „inimene sai kätte". Seda vahet ei tohi
  UI-s ära kaotada.
- **`sql/044` 1. samm on jooksutamata.**
- **Litsentsivõtit ei saa väljastada** — `LICENCE_PUBLIC_KEY` on tühi.
- **Värskest andmebaasist ei saa Wivot püsti panna** — ükski migratsioon ei loo
  `jobs` tabelit.
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

---

## Järgmised faasid

Plaan `aga-kui-klient-maksab-spicy-hippo.md`. **Faas A1 valmis.**

- **A2 — saatja.** `supabase/functions/send-invoices/` denomaileriga pordile
  465, importides `invoiceDoc` ja `sendGuard` otse `shared/`-ist. Siis
  `pg_cron` + `pg_net` päevane kutse — projekti **esimene `create extension`
  väljaspool `pgcrypto`-t**. Blokeeritud punktide 1–3 taga.
- **B1–B3 — visiiditaotluste postkast.** `sql/052_visit_requests.sql`
  *(number nihkus, 050 ja 051 on võetud)*, `POST /request` olemasolevas
  funktsioonis, postkast Wivos. **Deploy enam ei blokeeri.**
- **B4 — widget** kliiniku lehel, alles pärast B1–B3.

**GDPR hoiatus B kohta:** Wivo-native postkast salvestab patsiendi nime ja
telefoni **meie baasi**, mida vana Dentase-plaan teadlikult vältis. Vaja
säilitustähtaega (pg_cron kustutab tagasilükatud read), privaatsusteadet ja
300-tähemärgist piiri vabal tekstiväljal.
