# Brändifailid

Siin on **originaalid**. Siia ei impordita koodist midagi — Vite pakib ainult
selle, mida keegi `import`-ib, nii et see kaust ei lähe rakendusse kaasa.

| Fail | Mis |
|---|---|
| `Wivo Logo 2000.png` | Logo originaal, 2000 × 2000 |

## Miks ta siin on

`src/renderer/src/assets/Wivo Logo.png` oli sama 2000 × 2000 fail, **2,09 MB**,
ja teda kuvatakse kahes kohas: külgribal 50 px ja sisselogimisel 64 px. See on
üle kolmekümne korra rohkem pikslit kui ekraanile jõuab, ja ta läks kaasa iga
paigaldusega ning laaditi mällu igal käivitusel.

Rakenduses olev koopia on nüüd **256 × 256, 64 KB** — endiselt kahekordne varu
kõige suurema kasutuskoha jaoks. Originaal jääb siia, sest trükiseks või uue
suuruse genereerimiseks on teda vaja, ja git ajaloost väljakaevamine ei ole
vastus.

**Paigaldaja ikoon on eraldi fail** — `build/icon.png`. Seda siin ei puudutatud.
