# Stock, materials, shades and lots

Status: **plan, for Kevin's OK** (C1, 2026-11-05). Nothing is built.

**What it is:**
- **one catalog** of the clinic's equipment, materials and products;
- **shades** that are the material's own, with the clinic's table for matching them to VITA;
- **stock in useful units,** with lots;
- **a job that shows what it uses** from stock, and **a lot that shows which jobs it went into;**
- **goods receipt** from the supplier's invoice and the boxes' codes;
- **partner stock** on an open statement.

Later, the treatment-plan calculator uses the same catalog (§9).

---

## 0. What exists today, and what is wrong with it

**Materials, machines and shades are free text:**
- **Materials:** a list of names in `clinic_settings.materials`, with prices and costs keyed by name (`material_prices`, `material_costs`, and `"material|machine"` for a machine's own cost).
- **Machines:** a list of names (`clinic_settings.machines`, default Pro2 and Midas). Capsule machines and the default machine are in `pricing`. Nothing says what kind of machine each one is.
- **Shades:**
  - **the material's shades** come from a table in the code (`MATERIAL_SHADES`, types/job.ts): Crown HT gets A1, A2, A3, BL1, BL2; Ceramic Crown A1–A3; **OnX Tough 2 only A1 and A2.** A material the clinic adds gets none, and nothing in Settings changes this;
  - **the material's shade is saved inside the material's name** on the job ("Crown HT A1"), on each work item and on each remake;
  - **the tooth shade** (`varv`, the 17 VITA codes in config/vita.ts) and **the stump shade** (`kondivarv`, ND1–ND9) are separate fields. Free text is allowed in both.

**Stock is a lot ledger for implants, abutments, bone and membranes** (sql/093, 094, 096):
- **`stock_item`:** one row per lot, with a lot code and expiry, both required. It has no serial, cost, unit, barcode or supplier. A product is only its spelling (`product_key`).
- **`stock_movement`:** an append-only movement list: in, use, return, buy, adjust, write-off.
- **Warnings:**
  - a minimum per product (`stock_threshold`);
  - expiry and consignment due dates are flagged **one month ahead, hard-coded;**
  - what fires: a count on the sidebar and the stock-warning sound.

  **There are no stock notification settings** and no stock notification in the bell, e-mail or push.
- **Inventory counts** on a schedule (sql/094).
- **Using an expired lot** needs an admin's override, with a reason (sql/096).
- **Stock never leaves for a job by itself:**
  - someone opens the lot and clicks "Use on a job";
  - nothing is reserved;
  - the job page shows no stock;
  - materials (resin, capsules, discs) aren't in stock at all.
- **A capsule count** is entered on a job at the done stage, only to price it (`materjali_yhikud`, sql/063).

**Suppliers and goods receipt don't exist:** no supplier table, deliveries, invoice reading or barcode scanning. The phone's camera only takes job photos.

**Partner stock** (sql/093):
- the clinic holding the goods records them, with the partner as owner;
- the partner is never notified, and sees only totals;
- nothing makes a statement or an invoice.

**Found along the way, and fixed by this plan because the catalog uses ids instead of names:**
1. **Renaming a material or machine** changes only the list. Its prices, costs and the jobs keep the old name.
2. **A material's price is looked up by its exact name, but its cost by the start of the name.** So "Crown HT A1" gets its cost but no price in a quote.
3. **A job's cost** uses only the job's first machine and its first work item's material, although each work item has its own.
4. **Editing a stock item's text** changes its product key and loses its minimum.
5. **The settings live in two places,** the clinic's row and the computer's local storage.

---

## 1. Equipment (Settings → Equipment)

**The clinic lists the machines and devices it really uses.**

| Kind | Examples | What it uses, and how |
|---|---|---|
| Resin printer | SprintRay Pro 2, Pro 95 | **Resin**, by the tank fill: the clinic enters the fill volume for each resin it uses in that printer |
| Capsule printer | SprintRay Midas | **Capsules**, in pieces |
| Mill | a 5-axis mill | **Discs or blocks**, in pieces |
| CEREC | Primemill | **Blocks**, in pieces |
| Furnace | a sintering furnace | nothing from stock |
| Scanner | an intraoral or lab scanner | nothing from stock |
| Instrument kit | a surgical kit | nothing from stock: a reusable instrument is **equipment, not stock** |

- **Each machine** has a name, its kind, its maker and model, and whether it is in use. A machine no longer used is retired, never deleted, so old jobs still name it.
- **Each machine lists the materials it uses,** with the "how" from the table: tank fill volume, capsules, discs or blocks.
- **A machine's own cost for a material** (today's `"material|machine"` cost) moves here.
- **Jobs keep naming their machine,** by id from now on, so a rename reaches every job.

## 2. Materials and their shades

**Each material has:**
- a name, its maker, its kind (resin, capsule, disc, block, other), and the machines that use it (§1);
- its prices and costs, as today, moved from `clinic_settings`;
- **a supplier lead time** in days: how long an order takes to arrive;
- **its own shades** (below);
- **its shade-matching table** (below).

**The material's shades:**
- **The clinic ticks which VITA classical shades the material comes in:** A1–D4, plus the bleach shades BL1–BL4 where the material has them.
- **It can add custom shades** that aren't VITA (for example a maker's "Translucent").
- **Room for other shade systems later** (VITA 3D-Master, Chromascop): each shade belongs to a system, and today there are two, VITA classical and custom.

**The shade-matching table, "requested VITA shade → material shade to use":**
- one row for each VITA shade, editable by the clinic;
- **the default is the same name,** where the material has that shade;
- for OnX Tough 2, the doctors' finding is entered by the clinic: **VITA A1 → OnX B1, VITA A2 → OnX A1.**
- **Wivo ships no matching of its own.** It is the clinic's knowledge, in the clinic's table. That keeps it within the locked rule: Wivo only looks the shade up in the clinic's table. It never derives anything from patient data, and the technician decides.

**On a job:**
- **The requested shade** is the job's tooth shade (`varv`), as today: what the doctor asked for, in VITA.
- **The material shade used** is saved **next to** each work item's material, no longer inside its name.
- **The form suggests the match** from the table when the material and the requested shade are chosen, and says so ("A1 requested → B1, from your table"). **The technician can change it.**
- **The job shows both** ("Requested A1 · OnX Tough 2 B1"), and so do the label, the print and a shared job (§8).

## 3. Stock in useful units, never falsely exact

**Pieces** for what is counted: capsules, discs, blocks, implants, abutments, bone, membranes.

**Resin, by the tank fill:**
- **What a clinic sees:** a resin's stock is shown as **"about N tank fills left"** for the machine it's used in. It is worked out from the bottles and that machine's fill volume for that resin (§1). Never millilitres, never decimals.
- **"Filled the tank":** a button on the machine, also on the phone. It takes **one fill** from that resin's open bottle. When the open bottle runs out, the next is opened, the one that expires first.
- **Inventory counts:**
  - closed bottles are counted in pieces;
  - an open bottle is counted in fills ("about 3 fills") or a simple fraction (¼, ½, ¾);
  - the result is shown as **approximate.**

**Wivo learns each job type's resin use:**
- each press of "Filled the tank" tells Wivo that one fill was used since the last press on that machine;
- the jobs printed on that machine with that resin in between are known: those that reached the clinic's printing stage in that time. The clinic picks which stage means "printed";
- across many fills, Wivo works out each job type's average use, for example **"about 20 crowns per fill"**;
- **until it knows, it says so:** "Not known yet: 2 of the 5 fills needed";
- the figure is a range, never exact, and it gets better with each fill.

**It feeds the costs:**
- **the cost of a fill:** the bottle's cost price (§4) divided by its fills;
- **a job's material cost:** its learned use times the cost of a fill;
- **until the use is learned,** the cost comes from the clinic's price list, as today, and the job and Statistics say which one they used ("learned from 12 fills" or "from your price list");
- the margin figures in Statistics and Finance use the same.

## 4. Lots

**Each lot records:**
- **the lot code;**
- **the expiry,** required, as today;
- **a serial number,** where there is one. An item with a serial is one piece;
- **the dates received and opened;**
- **its use-by after opening:** the material says how many days a bottle lasts once opened, so the date follows from the day it was opened;
- **the supplier;**
- **its cost price,** from the delivery (§7). Seen only by those who see material costs today: the owner, admins and Manage payroll (sql/102).

**Suggesting a lot:** wherever a lot is chosen, **the one that expires first** comes first, counting the use-by after opening.

**Warnings,** for low stock, expiry, use-by after opening, the partner's due date, and a delivery that is late:
- **Today there are no stock notification settings** (§0), only the sidebar count and the sound, a month ahead.
- **Proposed:**
  - a Stock section in the notification settings: how far ahead to warn (default one month, as today), and the bell, e-mail and push like other notifications;
  - who gets them: those with Manage stock.

## 5. A new job uses stock

**Choosing the machine** shows the materials it uses and their stock:
- **whether there is enough;**
- **how much this job uses:**
  - pieces for capsules, discs, blocks, implants and abutments;
  - for resin, "about 1/20 of a fill" once learned, or "not known yet";
- **what is left after it;**
- **which lot and whose stock** it comes from: our own, or a partner's (§8).

  The lot that expires first is suggested, and the technician can choose another.

**Implants and abutments** come from the catalog too:
- each tooth's abutment code (today free text, `kruvi` and `kruvid`) becomes a choice of product and lot;
- free text stays possible for something not in stock.

**Empty stock only warns, never blocks:**
- "Not enough OnX Tough 2: about 1 fill left; the supplier takes 5 days";
- the job is still created.

**Reserving and taking off,** done by the database so every device does it the same way:
- **creating the job reserves** what it uses;
- **the job reaching its done stage takes it off** (a "use" movement for each lot, linked to the job);
- **cancelling or deleting the job frees** what it reserved. Restoring it reserves again;
- **a reservation is not a movement.** It is kept in its own table, so the movement list stays what really happened;
- **stock shows two numbers:** on the shelf, and free (on the shelf minus reserved).

## 6. Used and in use

- **Every lot and item shows the jobs it went into,** and the jobs it is reserved for.
- **A job shows its lots:** product, lot, expiry, serial, and whose stock.
- **The list shows the last 3 months by default.** The clinic can change the period in Settings.
- **The history itself is kept for good.** The period only changes what is listed first.
- **Who sees it:**
  - the lot's jobs show their job codes;
  - the patient is reached through the job, only by those who may see the job, and in the clinic's own project only.

  That is the trail a recall needs (a manufacturer recalls a lot: which patients have it), and the implant card the patient is given.

## 7. Goods receipt, in one flow

**1. The supplier's invoice becomes an expected delivery:**
- **On the desktop,** drop in a photo or PDF of the invoice. Wivo reads:
  - the supplier, the invoice number and the date;
  - each line: article code, name, quantity and unit price.
- **Each line is matched** to the catalog by the supplier's article code or the product's barcode number (GTIN), or offered as a new product, with its kind and unit.
- **Reading the invoice happens on the computer or through the clinic's own AI account, never through Wivo:**
  - **an e-invoice file** (the Estonian e-invoice or Peppol format) is read exactly, on the computer, with no AI;
  - **a PDF** with text is read on the computer. Its lines are then sorted out by the clinic's own AI account, if the clinic has one, or checked by hand;
  - **a photo** goes to the clinic's own AI account, if it has one, or the lines are typed;
  - **the AI key is the clinic's,** entered in Settings and kept on that computer only (the system's keychain), never in the database and never sent to Wivo;
  - a supplier's invoice names no patient.
- **A person always checks the lines** before anything is expected.

**2. Ticking off the boxes:**
- **On the phone,** scan each box's code. Implant boxes carry a GS1 or HIBC code (the EU's device identifier), which gives the product, lot, expiry and serial.
- **Each scan ticks off its line,** and Wivo warns about:
  - a **wrong** item (not on the invoice);
  - a **missing** one (on the invoice, not scanned);
  - an **extra** one (more than invoiced);
  - a **short expiry** (closer than a set time, default 6 months).
- **On the desktop,** a USB barcode scanner does the same.
- **Without an invoice,** scanning alone works too: the boxes become the delivery, and the prices are added later or left out.
- The phone app runs in the browser, and the iPhone's browser has no built-in barcode reader, so the reader is a small library shipped with the app.

**3. Confirming:**
- the stock is added, with its lots and cost prices, **linked to the invoice** (supplier, number, date, and the file if the clinic keeps it);
- confirming needs Manage stock;
- **prices** are seen and entered only by those who see material costs (§4). Anyone else with Manage stock can scan and confirm the boxes, and the prices wait for someone who sees costs.

**The example, our first supplier invoice:**
- **Prama RF Zirti implants in five lengths:**
  - five lines, matched or added as five products, one per length;
  - each box scanned for its lot, expiry and serial.
- **The surgical kit:**
  - Wivo offers it as **equipment** (§1), not stock;
  - its cost is recorded with the equipment.

## 8. Partner stock: consignment at our place

**The lawyer's answer (L6, docs/ARCHITECTURE-INSTANCES.md):**
- partner stock is held at the borrowing clinic, as consignment;
- taking an item needs no approval, and the partner is notified;
- **whoever takes an item is responsible for it from that moment.**

**Taking:**
- as using our own stock (§5), with Manage stock, **no approval;**
- **who took it and when** are recorded in our log;
- **the partner is notified:** the product, the lot, the quantity and when. Never the job or the patient.
- **Staff names crossing to the partner** wait for the lawyer's question 7. Until then the partner sees our clinic, not the person.

**The open statement, which both sides see:**
- **each item taken goes onto it,** at the price agreed for that product;
- **an item returned unused within the agreed deadline drops off it,** as a credit line, so the statement stays a true record;
- **the period is agreed** (a day, a week or a month), with the prices and the deadline. Until agreements exist (the agreements plan), the lender sets them on the partnership.

**At the end of each period:**
- **the lender's Wivo makes an invoice draft** from the statement;
- the lender checks it, and **Wivo sends it** from the lender's own e-mail;
- **payments happen outside Wivo.**
- **First, fix "automatic e-mail sends drafts"** (docs/TOUR.md §5, item 2). Otherwise the draft would go out before the lender checks it.

**What changes from today (sql/093):**
- the partner is notified and sees the statement, not only totals;
- the buy-out becomes the statement's invoice.

  Across two projects, the same happens through the bridge: docs/ARCHITECTURE-INSTANCES.md §3 is changed to match.

**Shared jobs carry the shades and the lots:**
- the bridge sends the requested shade and the material shade, and the lots used (product, lot code, expiry, serial);
- none of it is personal data;
- §2a of docs/ARCHITECTURE-INSTANCES.md lists them. **Phase 2's first message format should include them,** so they don't need a second version.

## 9. Later: the treatment-plan calculator

The same catalog answers what the calculator needs (docs/VISION.md, build order 1–4):
- **what each machine and material can make:** the machine's materials (§1) and the work types;
- **its cost:** lot cost prices and learned use (§3–4);
- **its lead time:** the supplier's (§2) plus the lab's own time.

Kept possible by:
- **stable ids** for products, materials and machines;
- **reservations already tied to a job,** so they can be tied to a plan instead.

The calculator only counts what the doctor chose against what the clinic holds. **It never suggests.**

## 10. Moving what exists, without losing anything

1. **Materials:**
   - each name in `clinic_settings.materials` becomes a material, with its prices and costs;
   - its shades are today's list for the three known materials, **plus every shade found on jobs for that material**, so nothing used disappears;
   - the clinic then ticks the rest (OnX Tough 2's B1, for example).
2. **Machines:**
   - each name becomes equipment;
   - capsule machines become capsule printers; the kind of the others is asked once in Settings → Equipment;
   - **"material|machine" costs** move onto the machine's materials.
3. **Prices and costs that name a material or machine no longer in the list** (renamed or deleted) are not dropped. They are listed once for the owner: "These prices name a material that isn't in your list: keep as a new material, or leave out".
4. **Stock:**
   - `stock_item` keeps every row and its id, so the append-only movements still point at them;
   - each distinct product becomes a catalog product, and each lot is linked to it;
   - minimums move from the spelling (`product_key`) to the product, which ends finding 4 in §0;
   - serial, opened date, cost and supplier are new and empty.
5. **Jobs are not rewritten** (recommended):
   - old jobs keep the material and shade text as saved, and the screen splits it where it can, as the cost calculation already does;
   - new and edited jobs save the material, the material shade and the machine by id, next to the text;
   - **so nothing is lost,** and the audit log doesn't fill with an "edit" for every old job (sql/114 records each change to a job).
6. **The old settings stay in place,** read-only, for one release. They are removed only in a later migration, after the read-only checks.
7. **Read-only checks,** for the test copy before and after: the number of materials, machines, prices, costs, lots, movements and minimums, and the stock per product. **Every number must match.**

## 11. How it is built

**New tables,** each with `org_id`, access rules, the second-factor policy and a leak test (CLAUDE.md):
- `equipment` and `equipment_material`;
- `material`, `material_shade` and `shade_match`;
- `stock_product`, with its codes (the supplier's article codes and the barcode number), and `supplier`;
- `goods_receipt` and `goods_receipt_line`;
- `stock_reservation`;
- `consignment_statement_line`.

**Changed:**
- **`stock_item`:** product, serial, opened date, cost and supplier;
- **`stock_movement`:** a new kind, "fill" (a tank fill from an open bottle). Resin is kept in millilitres inside the database and shown only as fills;
- **the job's work items:** the material, the material shade and the machine by id. They are fields in the existing JSON, as the per-item designer was, with no new column;
- **notification kinds:** low stock, expiry, use-by after opening, due date, a late delivery, and a partner's item taken.

**Database functions:**
- reserving, taking off and freeing, run as the job changes stage;
- "Filled the tank";
- learning the resin use;
- confirming a delivery;
- the statement.

  All of them end with `lock_anon_functions()`, and the ones that only read are `stable`.

**Tests:**
- a job's life (created, done, cancelled, restored) leaves exactly the right reserved and on-shelf numbers;
- learning the resin use from made-up fills gives the known answer, and says "not known yet" below the minimum;
- reading GS1 and HIBC codes, including the serial and the expiry's day "00";
- reading an e-invoice file;
- matching shades by the clinic's table and the default;
- the moving of existing data (§10), with the totals before and after;
- **the partner's notifications and statement never carry a job, a patient or a staff name** (a leak test, as for shared jobs);
- cost prices hidden from a member without the cost permission;
- every export through `auditedCsvExport`.

## 12. Decisions for Kevin

1. **Old jobs:** not rewritten, with the screen splitting old text (recommended), or a one-time rewrite that leaves an audit entry per job.
2. **Stock notifications:** there are no stock settings today (§4). Recommended: a Stock section in the notification settings, with how far ahead to warn (default a month) and the usual channels, for those with Manage stock.
3. **Reading invoices:** e-invoice files, PDFs read on the computer, and the clinic's own AI key kept on the computer (recommended), plus a USB barcode scanner on the desktop. Reading photos on the computer without AI is less reliable and comes later.
4. **"Filled the tank"** means topping the tank up to its fill line, and the fill volume is the clinic's own figure per machine and resin. Which stage means "printed" is chosen by the clinic.
5. **The partner's invoice draft** waits for the fix of "automatic e-mail sends drafts" (recommended), or statement invoices are never sent automatically.
6. **A short expiry at receipt:** warn under 6 months (proposed).
7. **Where it goes in the order of work:** after phase 2 (recommended), except that **the shade fields are decided before phase 2's message format** (§8). Slice 1 below could also come right after phase 1, because it fixes the shades Kevin's technicians meet every day.

## 13. Order of work and time

| Slice | Built in | Kevin's part |
|---|---|---|
| 1. **Equipment, materials, shades and matching:**<ul><li>the tables, Settings → Equipment and Materials;</li><li>the job form's suggested shade;</li><li>moving the settings (§10.1–3).</li></ul> | 4–5 days | Enter our machines and OnX Tough 2's shades and matching; make jobs; check old jobs read as before. Two sessions. |
| 2. **The catalog, suppliers and lots:**<ul><li>serial, opened date, use-by, cost;</li><li>the lot that expires first;</li><li>stock notifications;</li><li>moving the stock (§10.4).</li></ul> | 3–4 days | Our stock moved over with the same totals; warnings at the set times. One or two sessions. |
| 3. **Jobs and stock:**<ul><li>the machine's materials and stock on the job;</li><li>reserving, taking off, freeing;</li><li>implants and abutments from the catalog;</li><li>used and in use.</li></ul> | 4–5 days | Jobs from creation to done and cancelled, on the desktop and the phone; the lot's jobs and the job's lots. Two sessions. |
| 4. **Resin by the fill:**<ul><li>"Filled the tank";</li><li>counts in fills and fractions;</li><li>learning the use, and the costs.</li></ul> | 3 days | A week of real printing with the button pressed at each fill. One session, plus the week. |
| 5. **Goods receipt:**<ul><li>the invoice read on the computer or through the clinic's AI;</li><li>the phone's scanning and the USB scanner;</li><li>confirming.</li></ul> | 5–6 days | The Prama invoice and its boxes, end to end; a delivery without an invoice. Two sessions. |
| 6. **Partner stock on a statement,** between partners in one project. Across projects, it comes with "Stock across projects" (docs/ARCHITECTURE-INSTANCES.md §9). | 3–4 days | Take, return within and after the deadline, the statement on both sides, the invoice draft. One or two sessions. |

- **Building:** about 22–27 days. **Kevin:** about 9–12 sessions.
- **Calendar:** about 5–6 weeks at 3–4 hours of testing a day, competing with the instance phases for the same testing time.
