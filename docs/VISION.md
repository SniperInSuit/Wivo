# Wivo: product vision

Where Wivo is going after 2.0. The build plan for each step lives in its own spec; this file is the direction and the rules that do not move.

## The closed loop: from consultation to procedure day

1. **Consultation.** The doctor builds treatment packages live with the patient: teeth, procedures, materials, shades. Wivo prices them from the clinic's price list.
2. **Decision.** The patient picks one package and pays the booking fee. That payment books the procedure.
3. **Stock.** Wivo reserves what the chosen package uses from the clinic's stock. It shows which needed items are missing from stock.
4. **Ordering.** Missing items are ordered in one click from verified suppliers in a marketplace. Prices are calculated automatically.
5. **Lab work.** Partner lab jobs are created straight from the plan.
6. **Procedure day.** Everything is scheduled to arrive in time for it: stock, ordered items, lab work.

No step is retyped. What the doctor builds with the patient drives the booking, the stock, the orders and the lab.

## Build order

Each step must be useful on its own, before the next one exists.

| # | Step | Useful on its own because |
|---|---|---|
| 1 | **Treatment calculator and booking fee** | The doctor prices options in front of the patient; the fee turns a "yes" into a booking. |
| 2 | **Automatic stock reservation from the chosen package** | Stock stays honest and the clinic sees what is missing before the day, not on it. |
| 3 | **Partner lab job created from the plan** | No lab order is typed twice; the lab gets the job when the patient says yes. |
| 4 | **Supplier marketplace** | Missing items are ordered in one click, at calculated prices, from verified suppliers. |

## Locked rules

These are not revisited per feature. A feature that needs one changed stops and asks.

**Wording (MDR).** Always "treatment plan builder" or "price calculator", never "generator", in the app, on the website and in sales material. Under MDR the intended purpose also comes from how a product is marketed. The doctor builds the plan; Wivo only prices it.

**"Missing" means missing from stock.** Never clinically missing from a plan. Wivo never suggests clinical items, procedures or materials. It counts what the doctor chose against what the clinic holds.

**Money.** Suppliers invoice the clinic directly. Wivo takes its commission separately. Wivo never holds or forwards funds between parties. If payments ever go through Wivo, they go through a regulated payment provider.

**Neutrality.** Wivo stays supplier-neutral:
- the marketplace has written verification criteria;
- ranking is transparent;
- paid placement is clearly labelled;
- a clinic's purchase data is never sold or shown to suppliers.

**No personal data crosses borders between clinics.** Partners see job information only, never who the patient is (lawyer's decision, 2 November 2026; enforced by sql/092). A lab job created from a plan carries the work, not the patient.

These sit alongside the locked decisions in wivo-2.0-spec.md (Estonian), which still hold. In particular: Wivo does not recommend, rank or derive treatment from patient data.

## Ecosystem

Where the companies around Wivo are heading, so features are built in the right place. **Nothing here is built now.** A feature for one of these companies starts only when Kevin asks for it, with its own spec.

| Company | What it is | How it relates to Wivo |
|---|---|---|
| **Wivo** | The clinic and lab management software: this repository. | Supplier-neutral. Any lab, supplier or clinic can use it. |
| **WivoLab** | A separate distribution company. It supplies Wivo clinics with premium but cheaper solutions for cases: implants, designs, materials. | A supplier and partner in Wivo like any other (rule b). |
| **The third company** (name not decided; shortlist: WivoChair, WivoShift, WivoGo) | Fully equipped, fully supplied clinic rooms that dentists book by the hour or by the day, together with patient cases that are ready to treat. Dentists pick the cases that fit them, do the work and earn their share: "Uber/Bolt for dentists". | It would run on Wivo and be supplied by WivoLab. In Wivo it is a customer like any other (rule b). |
| **Later ideas** | WivoHub (a community product) and WivoSpace (events). | Not planned. |

### Guardrails

These are locked rules, like those above. A feature that needs one changed stops and asks.

**a. Data walls.**
- A clinic's data in Wivo is never used by WivoLab or the third company, and never shared with them, unless that clinic explicitly opts in.
- The licence agreement will say so.
- No report, export, statistic or "insight" built for a sister company reads another clinic's data without that clinic's opt-in.
- The opt-in is per clinic, recorded and revocable. This is the same rule as a clinic's purchase data never being shown to suppliers (Neutrality, above).

**b. No back door.** The sister companies are ordinary Wivo customers or partners, with the same rights and rules as anyone else. That means:
- no special roles, no service key, no direct database access;
- no hidden data flows and no feature only they can see;
- the same partnership model, RLS, second factor and audit log;
- in the marketplace, the same verification criteria, transparent ranking and labelling as any other supplier. Being a sister company earns no placement.

**c. Open question for the lawyer, before the third company starts:**
- who is the healthcare provider for the patient (the activity licence for the room);
- who is liable for the treatment;
- who is the data controller for the patient's data. That includes what a dentist who books a room may see, and how the "no personal data crosses borders between clinics" rule applies when the dentist, the room and the patient's clinic are different parties.

  Nothing for the third company is built before these answers.

**d. Separate, optional modules.**
- Features that serve the sister companies (booking rooms, a case marketplace, a dentist's share of a case) are separate modules, switched on per organisation. They are never part of the core.
- A clinic that never uses them sees no trace of them and loses nothing.
- The core never depends on them.
