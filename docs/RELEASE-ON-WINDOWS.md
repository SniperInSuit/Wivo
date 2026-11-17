# Väljalase ja võtmed Windowsis

**Seis: uuring, 18.11.2026. Midagi ei ole muudetud** — Kevin ütles „kirjuta,
mida muuta tuleb, aga ära veel midagi muuda".

Põhjus: Mac ei lae. Küsimus: kas `scripts/yubikey/setup-key.mjs` ja
release-tööriist töötavad Windowsis.

---

## 1. Lühivastus

**Väljalase ei käi Macist ega ühestki Kevini masinast.** Ta käib GitHub
Actionsis, **`runs-on: windows-latest`** (`.github/workflows/build.yml:12`).
Mac ei ole kunagi olnud build-masin.

Macis pidi toimuma **üks seanss**: nelja YubiKey seadistamine
(`setup-key.mjs`). Ja hiljem see, mida veel olemas ei ole: väljalaske
allkirjastamine võtmega C või D.

| Mis | Kus see täna käib | Vajab Maci? |
|---|---|---|
| Töölauaäpi build ja pakendamine (NSIS) | GitHub Actions, Windows | **ei** |
| GitHubi väljalase, allalaadimislink | GitHub Actions | **ei** |
| `.exe` koodiallkirjastamine | **ei toimu üldse** — workflowis ei ole sertifikaati | — |
| Migratsioonid | Kevin, brauseris (edaspidi psql, docs/DEMO-SETUP.md) | ei |
| **YubiKeyde seadistamine** | tegemata, pidi Macis | **ei pea** — vt §2 |
| **Väljalaske allkirjastamine võtmega** | **tööriista ei ole veel kirjutatud** | vt §3 |
| Litsentsi allkirjastamine | `scripts/make-license.mjs`, praegu failivõtmega | ei |

---

## 2. `setup-key.mjs` Windowsis: mis töötab ja mida muuta

Käisin kõik neli skripti läbi (`setup-key.mjs`, `arrival-test.mjs`,
`attestation.mjs`, `setup-plan.mjs` + mõlemad Pythoni failid). **Platvormist
sõltuvat koodi neis praktiliselt ei ole:**

- failiteed käivad läbi `path.join` ja `os.homedir()` → Windowsis
  `C:\Users\fullg\wivo-yubikey-setup\A-38272275\…`, toimib;
- `openssl`-i, `security`-t, `/dev/tty`-d ega ühtegi Maci tööriista **ei
  kasutata** — ahela kontroll on puhas JS (WebCrypto);
- PIV-käsud käivad `ykman`-i kaudu, mis on Windowsis olemas;
- `ykman script` jooksutab Yubico enda sisseehitatud Pythoniga
  `setup-device.py` — see ei vaja eraldi Pythonit, ka Windowsis mitte.

### Mida muuta tuleb

Neli kohta. **Kolm esimest on kaks minutit tööd, neljas on otsus.**

| # | Fail | Mis |
|---|---|---|
| 1 | `scripts/yubikey/setup-key.mjs:69` | veateade ütleb `Run: brew upgrade ykman`. Windowsis ei ole brew'd. Peab ütlema mõlemat teed. |
| 2 | `scripts/yubikey/arrival-test.mjs:50` | sama tekst, sama parandus. |
| 3 | `setup-key.mjs:66, 91, 207` ja `arrival-test.mjs:47, 60` | `spawnSync('ykman', …)` **ilma `shell`-ita**. Kui ykman on Windowsis `.exe` (MSI ja pipx mõlemad teevad `.exe`), siis see töötab. Kui ta satub olema `.cmd`/`.bat` shim, annab Node `ENOENT`, mis näeb välja nagu „ykman puudub". Kindel lahendus: lubada käsu nimi üle kirjutada (`WIVO_YKMAN` keskkonnamuutuja täisteega) ja veateates seda mainida. |
| 4 | `scripts/make-license.mjs`, `keygen` | `writeFileSync(…, { mode: 0o600 })` — **Windows ignoreerib `mode`-i**. Privaatvõtme fail saab päritud ACL-id. Kui litsentside allkirjastamine jääb Windowsi, siis kas `icacls`-iga õigused kitsamaks, või — parem — **failivõtit ei kasutata üldse ja allkiri tuleb YubiKeylt**, mis ongi plaan. |

**Ükski neist ei takista proovimist.** Nad kõik tulevad välja esimese
jooksutamise ajal ja ükski ei riku võtit.

### Windowsi oma lõksud, mida koodis ei paista

1. **Smart Card teenus peab töötama.** `SCardSvr` (Smart Card) on Windowsis
   vaikimisi käsitsi käivituv. Kui ta seisab, ütleb ykman „Failed connecting to
   the YubiKey", mis ei vihja teenusele.
2. **Keegi teine ei tohi kaarti kinni hoida.** Yubico Authenticator, YubiKey
   Smart Card Minidriver või Windows Hello võivad PIV-ühenduse ainuõigusega
   hõivata. Sulge Yubico Authenticator enne.
3. **FIDO puudutavad käsud nõuavad Windowsis tõstetud õigusi.** `setup-key.mjs`
   jooksutab `ykman config usb --disable …` (`setup-plan.mjs:130`), mis võib
   FIDO liidest puutuda. **Käivita kogu seadistus administraatori
   PowerShellist** — ja kui mingi samm küsib õigusi, pane kirja, milline.
4. **Võtme taaskäivitus konfiguratsioonimuutuse järel** on skriptis juba
   arvestatud (`pause(3000)`). Windowsis võib USB-seadme uuesti ilmumine võtta
   kauem; kui mõni samm kukub „seadet ei leitud" peale, siis see arv on koht,
   kuhu vaadata — mitte viga, vaid liiga lühike paus.

### Mida teha esimese asjana, kui Mac ei tule nädala jooksul tagasi

Kolm käsku, selles järjekorras, **enne kui ühtegi rida koodi muudetakse:**

```powershell
winget install --id Yubico.YubiKeyManagerCLI -e   # kui ykman veel puudub
ykman --version                                   # peab olema ≥ 5.4.0
node scripts/yubikey/arrival-test.mjs A           # võti A sees, teised väljas
```

**Versioon on kontrollitud:** winget pakub `Yubico.YubiKeyManagerCLI` **5.9.2**,
ja nõue on 5.4.0 (`scripts/yubikey/keys.mjs`, `MIN_YKMAN` — Ed25519 PIV-is).
Seega Windowsis olev ykman on uuem kui see, mida skript nõuab.

**Miks just saabumistest ja mitte seadistus:** ta teeb ja kustutab ühe
äraviskamise võtme ning jätab PIV sellisena, nagu ta tehasest tuli — seega ta
tõestab, et ykman, PIV, attestatsioon ja failiteed töötavad Windowsis,
**ilma et midagi püsivat juhtuks**. Kui ta läbib, siis on `setup-key.mjs`
sama masinvärk ja seadistus võib järgneda.

---

## 3. Release-tööriist

**Teda ei ole veel olemas** — ja see on selle uuringu kõige olulisem leid.

Olemas on:

- **vorming**: `shared/release/release.ts` (sertifikaadid, revokatsioonid,
  manifest, indeks, app-token; Ed25519 WebCrypto kaudu, ilma sõltuvusteta);
- **kontroll rakenduses**: `src/main/releaseCheck.ts`;
- **allkirjastamine võtmega**: `scripts/yubikey/setup-device.py`, aga ainult
  seadistuse sees (sertifikaadid ja testallkirjad).

Puudu on skript, mis võtab valmis `.exe`/manifesti ja laseb võtmel C või D
sellele alla kirjutada. Kui ta kirjutatakse, siis **kirjutatakse ta
Windowsi-esimesena** — see tähendab kolme asja:

1. ainus väline sõltuvus on `ykman` (nagu praegu), mitte `openssl`;
2. ükski tee ei ole kõvakodeeritud ega POSIX-kujuline (`path.join`,
   `os.homedir()`);
3. salajane miski ei tule käsurealt ega keskkonnamuutujast — varjatud küsimus,
   nagu `fresh-schema.mjs` ja `demo-seed.mjs` juba teevad. Windowsi
   PowerShelli ajalugu on fail kettal.

Nii ei teki Maci-sõltuvust, mida pärast ümber tõsta.

---

## 4. Mis Windowsis päriselt halvem on

Aus nimekiri, et otsus ei oleks ainult „saab küll".

| | Mac | Windows |
|---|---|---|
| ykman PIV | töötab, üks protsess kaardi küljes | töötab, aga **mitu tarkvara võitleb kaardi pärast** (§2) |
| Õigused failidele | `chmod 600` toimib | `mode` ignoreeritakse, vaja ACL-i |
| Tõstetud õigused | `sudo` ainult kui vaja | FIDO käsud **nõuavad administraatorit** |
| Terminal | üks | PowerShell / Git Bash erinevad (`$env:` vs `export`) |
| Koodiallkirjastamine (`.exe`) | ei saa teha | **saab teha** — kui sertifikaat kunagi tuleb, on Windows õige masin |

Viimane rida on see, mis otsuse ära otsustab: **töölauaäpp on Windowsi
rakendus**. Kui tema allkirjastamine kunagi tuleb, siis see käib Windowsis
niikuinii. Macil ei ole selles ahelas rolli, mida ta ainsana täidaks.

---

## 5. Soovitus

1. **Ära oota Maci.** Jooksuta `arrival-test.mjs A` Windowsis — see on ohutu ja
   see vastab küsimusele lõplikult.
2. Kui ta läbib: tee §2 kolm parandust (veateated + `WIVO_YKMAN`) ja seadista
   kõik neli võtit Windowsis, järjekorras A, B, C, D.
3. **Alles siis** läheb avalik võti `LICENCE_PUBLIC_KEYS`-i (`testing`-usse,
   mitte `main`-i) ja litsentsi allkiri tuleb failivõtme pealt ära.
4. Release-tööriist kirjutada Windowsi-esimesena (§3).

Kuni sammuni 3 kehtib see, mis on kirjas docs/DEMO-SETUP.md §7: **pakendatud
build ei võta testvõtit vastu**, nii et mooduleid saab näidata ainult
dev-buildist.
