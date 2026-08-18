# Mis edasi

**Seis: v1.38.1 · 18.08.2026 · haru `main`, commit `62d9a9e`**

See fail kirjutatakse iga töö lõpus üle. Siin on alati see, mida ma viimases
vestluses ütlesin — et uus arvuti või uus vestlus ei alustaks nullist.

`HANDOFF.md` on arendaja püsireeglid ("ära kunagi tee X"). See fail on
hetkeseis: mis on tehtud, mis ootab sind, mis on blokeeritud.

---

## 🔴 Sinu käes — ilma nendeta ei liigu edasi

### 1. Dentase üheksa küsimust

Plaanis `~/.claude/plans/i-have-idea-i-glowing-mccarthy.md` on kopeeritav
küsimustik. **Küsimus 1 ja 5 võivad arhitektuuri ümber lükata:**

- **K1 — kes majutab maksekassa?** Kas Dentas tagastab makselingi (lihtne,
  meil pole kaupmehelepingut vaja), või oodatakse, et meie kogume makse
  (suur lisatöö)?
- **K5 — kas Dentase API on IP-piiranguga?** Edge-funktsioonidel **ei ole
  püsivat IP-d**. Kui piirab, ei tööta praegune arhitektuur üldse ja vaja on
  fikseeritud IP-ga proxy't.

Ülejäänud seitse täpsustavad. **See blokeerib Faasi 3 (broneerimine).**

### 2. Edge-funktsiooni deploy

Kirjutatud ja commit'itud, aga **mitte kordagi deploy'tud**. Täpsed käsud:
`supabase/functions/README.md`. Lühidalt:

```bash
supabase link --project-ref <ref>
supabase secrets set \
  PUBLIC_BOOKING_ORIGINS="https://sinu-leht.framer.website" \
  IP_HASH_PEPPER="$(openssl rand -hex 32)"
supabase functions deploy public-booking --no-verify-jwt
```

**Mitte kunagi `supabase db push`** — see tahaks 47 käsitsi jooksutatud
`sql/` faili omanikuks saada.

**Deploy tõestab plaani suurima mitte-Dentase tundmatu:** kas
`functions deploy` pakib kaasa impordi, mis väljub funktsiooni kaustast
(`@shared/` → `../../shared/`). Kogu „üks implementatsioon" lubadus sõltub
sellest. Kui kukub — varuplaan on README-s.

### 3. Kontroll pärast deploy'd

```bash
curl -s -H "Origin: https://sinu-leht.framer.website" \
  "https://<ref>.functions.supabase.co/public-booking/services?clinic=<slug>" | jq
```

Vaata vastus **oma silmaga** üle: seal ei tohi olla `kulud`, `material_costs`,
`material_prices`, `pricing`, `payroll`, `sisemine`. Lekketest väidab sama, aga
näe seda korra päris andmetega.

### 4. Seadetes täitmata

- **Seaded → Kliinik → „Veebilehe tunnus"** — nt `fullgevity`. Tühjaks jättes
  avalikku broneerimist ei ole.
- **Seaded → Patsiendi hinnakiri** — vähemalt üks teenus, märgitud avalikuks.
  Kui midagi puudu, ütleb vorm ise, mis.

---

## ✅ Valmis ja commit'itud

| Versioon | Mis |
|---|---|
| 1.38.1 | Avalik `/services` edge-funktsioon, kliiniku veebitunnus |
| 1.38.0 | Patsiendi hinnakiri: `shared/portal/`, `sql/047`, Seaded vahekaart |
| 1.37.0 | *(sinu oma)* disainija tööosa kaupa |
| 1.36.2 | Valmis veerg filtreeris saabumiskuupäeva järgi → kaart kadus |
| 1.36.1 | Tulu valem: osakaalud ei andnud kokku 1 |
| 1.36.0 | Nõustaja masinavalik tööosa kaupa |
| 1.35.x | Finantsnäitajate lepitamine, `jobs` realtime, materjali toon |

**Migratsioonid `sql/`** — jooksutatud kuni **047** *(sina kinnitasid 047)*.

---

## 🟡 Teadaolevad võlad

- **3 punast testi** `shared/wizard/workTypeRules.test.ts`-is. Olid katki juba
  enne kõiki neid muudatusi — `Kroonisild` klassifitseeritakse iseendaks, test
  ootab `Kroon`. Ainus punane asi repos, tasuks ette võtta.
- **`sql/044` 1. samm on jooksutamata.** Diagnostikapäring ütleks, kas vanad
  tähtajad vajavad ajavööndi nihutamist. Uued read on juba õiged.
- **Litsentsivõtit ei saa väljastada.** `scripts/make-license.mjs keygen` ei ole
  kunagi jooksnud, `LICENCE_PUBLIC_KEY` on tühi → **praegused build'id ei
  kontrolli litsentsi üldse**. Vt `docs/onboarding-audit.md`.
- **Labor+ ja Labor on funktsionaalselt identsed** — `plan` väli kantakse
  tokenisse ja mitte kusagil ei kontrollita. Uuendusel ei ole midagi müüa.
- **Värskest andmebaasist ei saa Wivot püsti panna** — ükski migratsioon ei loo
  `jobs` tabelit ja viis veergu (`masina`, `print_id`, `kiirtoo`, `disain_hind`,
  `revisions`) ei ole kusagil. Vt `docs/onboarding-audit.md`.

---

## 📍 Kus asjad on

| Mis | Kus |
|---|---|
| Broneerimisvoo plaan | `~/.claude/plans/i-have-idea-i-glowing-mccarthy.md` |
| Onboarding'u audit | `docs/onboarding-audit.md` |
| Finantsnäitajate sõnastik | `docs/finance-metrics.md` |
| Edge-funktsiooni deploy | `supabase/functions/README.md` |
| Arendaja püsireeglid | `HANDOFF.md` |
| Testimise skript | `Testing.md` |

---

## Järgmised faasid

- **Faas 3** — `POST /book` + Dentase makse. **Blokeeritud K1 ja K5 taga.**
- **Faas 4** *(valikuline)* — Smart-ID vahendaja kaudu. Makse teeb turvalisuse
  töö ära; Smart-ID jääks ainult isikukoodi mugavuse pärast.
- **Framer komponent** — alles pärast seda, kui `/services` päriselt vastab.
