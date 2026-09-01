# Mis edasi

**Seis: v1.52.0 · 01.09.2026 · haru `main`, commit `fc318b5`**

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

### 1. E-post TÖÖTAB — aga testaadressi peal

Arved lähevad välja `treialbusiness@gmail.com` peale, **mitte patsientidele**.
Kaks päris kirja on saadetud ja kohale jõudnud (2026-0005, 2026-0006), PDF-iga.

**Kui eemaldad Seadetes testaadressi, hakkavad kirjad minema päris patsientidele
juba järgmisel täistunnil.** Enne seda tasub veenduda, et:

- patsientidel on e-posti aadress täidetud (`patients.email`)
- kirja tekst Seadetes on sinu sõnadega, mitte vaikimisi oma
- kiri ei lähe rämpsu (kontrolli oma domeeni SPF/DKIM)

### 2. Ajastus on sees

`sql/052` jooksutatud, `pg_cron` töö `wivo-send-invoices` iga tunni 7. minutil.
Kontroll:

```sql
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'wivo-send-invoices')
 order by start_time desc limit 5;
```

Väljalülitamine on kahes kohas: Seadetes „Automaatne saatmine" välja, või
`update cron.job set active = false where jobname = 'wivo-send-invoices'`.

### 3. Seadetes täitmata (avaliku poole jaoks)

- **Seaded → Kliinik → „Veebilehe tunnus"** — ilma selleta `/services` päris
  kataloogi ei tagasta
- **Seaded → Patsiendi hinnakiri** — vähemalt üks avalikuks märgitud teenus

## ✅ Valmis ja commit'itud

| Versioon | Mis |
|---|---|
| 1.52.0 | PDF manus, `=20` parandus, `sql/052` tunnine ajastus |
| 1.51.x | Allon4 hammaste kitsendamine; saatja diagnostika |
| 1.50.0 | Kirja tekst seadistatav (`mailTemplate`) |
| 1.49.0 | **Arvete saatja** `send-invoices`, deploy'tud ja tööle saadud |
| 1.48.0 | E-posti õigused ja kaitsed (`sendGuard`), `sql/051` |
| 1.47.0 | `invoiceDoc` — arve sisu ühte kohta, `sql/050` |
| 1.46.x | Kogusehinnad — mitu krooni, teine hambahind |
| 1.45.x | Maksegraafik: `sql/049`, arve vormil, vaade Arvete lehel |
| 1.44.x | Osamaksed jätsid töö 1/5 makstuks; abutmendi kood nõustajas |
| 1.41–1.43 | Rahapoole lepitamine: muudatuste kulu, arvemaksed, palgaread |


**Migratsioonid `sql/`** — jooksutatud kuni **052**. Kõik tehtud.

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
