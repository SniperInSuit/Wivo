# Testijuhend: töövoo mallid (ülesanne 2c), ~20 minutit

Testkoopia, `npm run dev:test` testlitsentsiga. **Enne:** migratsioonid 122, 123 ja 124 on testkoopias tehtud (NEXT.md, „Kevini osa"), `schema_check.sql` ja `trigger_check.sql` andsid null rida. Vajad **kahte kontot** (A = omanik, B = tehnik, teises aknas või teise brauseriga telefonis) ja ühte KT-kausta (DICOM-failid). Testkoopias on päris andmed: ära ava patsiente, kasuta ainult uusi töid.

Ülal peab olema punane testkoopia bänner. Kui seda pole, **peata** (see pole testkoopia).

## 0. Ettevalmistus (2 min)
1. Litsents: Seaded → Litsents on „kõik moodulid". Kui ei, kleebi token (docs/MODULES-AND-RATINGS.md).
2. Seaded → Tiim: kontrolli, et B on olemas rolliga tehnik. *Näed:* B nimi ja õiguste nimekiri.

## 1. Rollid (3 min)
1. Seaded → Tiim → vali B. Leia **„Pane roll"**. Vali **Arst** → kinnitusdialoog „Asendada selle inimese õigused rolli „Arst" õigustega?" → Jah. *Näed:* õiguste linnukesed vahetuvad. 
2. Vali **Juhataja**. *Näed:* `Töö lugemine` ja `Patsientide lugemine` pole sees (juhataja/raamatupidaja/IT ei näe töid ega patsiente).
3. Vali **Tehnik**. Seejärel anna B-le käsitsi `Failide lisamine` juurde (files.write). *Näed:* linnuke jääb pärast lehe uuendamist.

## 2. Mall (4 min)
1. Seaded → Töö etapid → alla „Töövoo mallid". *Näed:* vaikemall „Default" märkega „vaikimisi".
2. **Uus mall**, nimi „Test kroon". Lisa etapid „Lisa etapp…" (nt Skaneerimine, Disain, Print, Viimistlus). 
3. Viimistlusel: märgi **Valikuline (lüliti töö loomisel)**. Disainil vali **Palk → Disain** ja lisa B „Inimesed:" alla. 
4. Pane Prindile reegel „Ainult siis, kui: prinditud mudel". Pane **Viimistlusele samuti reegel**: *Näed* punast viga „Etapp Viimistlus on valikuline ja sellel on reegel. Võib olla kas üks või teine." Salvestus on blokeeritud. Eemalda reegel.
5. Proovi veel: sama palgaliik („Disain") teisele etapile → viga „Palgaliik „Disain" on nii etapil … kui ka …". Eemalda.
6. **Salvesta mall**. *Näed:* mall nimekirjas, vigu pole. Uuenda leht (Cmd/Ctrl+R): mall on alles.

## 3. Töö lisamine mallist (3 min)
1. Üleval **Uus töö**; täida patsient (**testpatsient, mitte päris**), töö, hambad; neljandas sammus **Töövoog**.
2. Vali mall „Test kroon". *Näed:* „Selle töö etapid" eelvaade; Viimistlus on lülitina, vaikimisi nagu mallis.
3. Prioriteet „Mudel" (eelmises sammus): *Näed* „Prinditud mudel: jah (valitud prioriteet Mudel)" ja Print on eelvaates. Muuda tagasi tavaliseks: Print kaob.
4. Lõpeta. *Näed:* töö tahvlil esimeses etapis (Skaneerimine).
5. **Töö-vormiga loodud töö:** ava olemasolev töö → Muuda → Salvesta, lülitades **Mudel** sisse. Kui mall kasutab reeglit „prinditud mudel", ilmub Print töö etappidele (vajab, et töö on tehtud mallist).

## 4. Etapid töö juures ja liigutamine (3 min)
1. Ava uus töö. *Näed:* paneel **Etapid**: iga etapp, „Tehtud" / „Töö on siin" / „Vahele jäetud", inimesed („inimest pole määratud" kui puudub).
2. Klõpsa **Edasi: Disain**. *Näed:* Skaneerimine „Tehtud" (kes, millal), töö on Disainis. Seejärel **Tagasi: Skaneerimine**: Skaneerimine pole enam tehtud.
3. **Jäta vahele** Viimistlus, siis **Võta tagasi**. **Muuda inimesi** → vali B → **Salvesta inimesed**. 
4. **Lisa etapp** → vali etapp „Pärast: …" → ilmub järjekorda.
5. Märkus: tahvlil lohistamine on endiselt otse-uuendus ega küsi `can_move_stage`-i; seda ei testi. IT-roll liigutab ainult paneelist.

## 5. „Alustasin" (1 min) — konto B
1. B kontol (teises aknas): ava töö, mille Disain on praegune etapp ja B on selle inimene. *Näed:* nupp **Alustasin**. Vajuta. *Näed:* „Alustas B, nüüd".
2. Vajuta uuesti A-ga: ei vahetu, esimene jääb.
3. B ei tohi nuppu „Edasi" näha etapil, kus ta pole inimene (kui töö pole ta oma).

## 6. Teavitused (2 min)
1. B kellukeses (töö loomisel, kus B oli etapil): „Uus töö {kood}: sina oled etapis Disain". **E-kirja sellest ei tule.**
2. A liigutab töö B etappi: B kellukesse „Töö {kood} on nüüd etapis Disain" (+ e-kiri, kui `notify_email` sees).
3. B Oma seaded → Teavitused: lülita sisse **„Saada mulle e-kiri iga etapi kohta…"**. A liigutab töö edasi → B kellukesse „Töö {kood} liikus etappi …". *Teavituses pole patsienti.*
4. A lisab B-d teise etappi (Muuda inimesi) → „Sind lisati töö {kood} etappi …".

## 7. Failid (2 min)
1. Töö → Failid → **Lisa failid**, vali KT-faili tüüp „KT". *Näed:* üleslaadimine; allpool märkus, et röntgeni- ja KT-failid salvestatakse täpselt nagu üles laaditi.
2. **Lisa kaust** → vali DICOM-kaust. *Näed:* tüüp KT automaatselt; **üks ZIP**, edenemisriba. Lae alla ja ava: failid on **identsed** originaaliga (võrdle `shasum`-iga mõnel failil: ZIP-i sees baitide-täpselt samad).
3. B-ga (files.write antud, B on etapi inimene): lisa foto → õnnestub. B ei saa faili kustutada ega uut versiooni panna.
4. Jagatud töö (kui partner on): DICOM-i lisamisel hoiatus „Röntgen ja KT: fail salvestatakse täpselt sellisena…".

## Mida teada anna
Iga samm, kus „Näed" ei kattu, ekraanipilt + töö kood. Eriti: salvestuse viga mallis, nupp, mis ei peaks olema, teavitus mille keegi ei saanud.

## Telefon (eraldi, 5 min; `npm run dev:test` ei käivita telefoni)
Telefoni vorm on koodis, kuid testkoopias proovitakse seda pärast Cloudflare'i `wivo-test` deployd. Siis: **Uus töö** (nupp avalehe otsas, ainult kui on `jobs.write`), patsient, töö, hambad, materjal, tähtaeg, prioriteet „Mudel" ja **Töövoog**; töö avaneb. Töö juures: etapid, **Alustasin**, **Edasi/Tagasi**, foto. Etappe ei lisa, ei jäta vahele ega muuda inimesi (töölaua töö).
