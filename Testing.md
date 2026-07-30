Test in this order — it's sequenced so a failure early explains failures later, rather than you chasing three symptoms of one cause.

1. Clinic settings sync — do this first
Everything downstream reads these, and if the first-run seeding went wrong, prices and colours will be wrong everywhere else.

Open Seaded → Valikud. Are your work types, colours and prices there — or did it reset to defaults? (Defaults = seeding failed, stop and tell me.)
Green banner at the top of clinic sections saying settings apply clinic-wide? Orange means it fell back to local — read what it says.
Change a work type colour → calendar cards and legend repaint together.
Seaded → Kasutajaliides → Teksti suurus at 125%: whole UI scales, no scrollbars, job panel still fits the window.
If you have a second computer or login: change a price there, confirm it appears here without a restart.

2. Calendar
Muudatused show as their own cards on their own deadline day, navy badge.
Filter icon next to Esmaspäev → work type list shows your configured types, not raw text like "D14 abutmendile kroon".
Patient filter has a search box; red dots mark matching days; the 1/N arrows jump and scroll.
3. Invoicing — the most critical untested path
Create an invoice for a test patient. Number should be 2026-0001.
Pick lines from unbilled work → check net / KM / total are right (those are computed by a database trigger, so this is the real test).
Change the KM % on the invoice → totals restate.
Prindi / salvesta PDF → your clinic details, reg code, IBAN present; missing-field banner if not.
Record a partial payment → tasumata drops correctly. Then pay the rest → status flips to Makstud on its own.
Open the create form again → that job must no longer be offered (double-billing guard).
Create a second invoice → number goes to 0002.


4. Payroll
Set a rule for yourself: 15 €/hammas. Assign yourself as Teostaja on a finished job.
Töötasud → line appears with correct teeth × rate.
Add a work-type rule (e.g. Allon4 = 200 €/töö) → on an Allon4 job it must beat the per-tooth rule.
Add a disain rule and set yourself as Disainija → it adds on top.
Kinnita väljamakse → lines vanish from unpaid, appear as välja makstud.
Now change your rate → the already-paid amount must not move.
5. Rahandus
Statistika → Rahandus. Coverage warnings should be honest ("12/20 tööl on teostaja").
Kate = arveldatud − tööjõud − materjal.
Muudatuste kahju splits by reason.
Expect this tab to be mostly zeros until steps 3 and 4 have produced real data — that's correct behaviour, not a bug.

Known gaps, so you don't report them as faults: no refunds or credit notes (your call, deliberate); overheads aren't in the margin so it's gross, not profit; pipeline.write doesn't grant a real edit since clinic settings are owner-only writes.

For feedback, the most useful format is: which step, what you expected, what happened — screenshots for anything visual. If something throws, the message text matters, since a 42501 is a permissions problem and a PGRST is a schema problem and they need different fixes.

Start with steps 1 and 3. If the settings banner is orange or the invoice number comes out wrong, send that immediately and stop — both would mean something structural I should fix before you spend time on the rest.