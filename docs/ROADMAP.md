# Roadmap: the order Riga gets Wivo in

**Decided with Riga, 2026-11-16.** They want the whole thing, but delivered
one part at a time — a new part every week or month, each one usable before
the next exists.

This file is the **order**. docs/BACKLOG.md stays the list of ideas: nothing
here is an idea, and nothing there has a date. docs/VISION.md is where the
product is going after 2.0; this is how Riga gets there.

The switch for every step below is the **licence modules**
(docs/MODULES-AND-RATINGS.md, part 1). A step is "delivered" when its module
is turned on in Riga's licence — which is also how a step can be turned back
off without a release.

---

## What everything here stands on

Two things carry every step and are not steps themselves.

| | What it is | Where |
|---|---|---|
| **Phase 1** | Riga on its own Supabase project, with its own data. No Wivo clinic shares a database with another. | docs/ARCHITECTURE-INSTANCES.md |
| **Licence modules** | A signed licence names the clinic, the allowed API address and the modules it may run. Turning a step on for Riga is a new licence file, not a release. | docs/MODULES-AND-RATINGS.md part 1 |

The licence carries the **allowed API address**, not only the organisation,
because the app checks where it may connect before it connects — and because
Riga may later move to their own server, where the address is not
`*.supabase.co` (see "Own server" below).

---

## Step 1 — work gets done (now)

The first thing Riga does with Wivo on day one. Module `jobs`, with the team
always present (the team is not in a module: `payroll` and `stock` need
people even when `jobs` is off).

- **Workers and the team.** Built.
- **Jobs and stages with SEVERAL technicians.** Not built: a job today takes
  one person as its maker and one as its designer. Riga's work passes through
  a doctor, a designer and a printer, each with their own stage. **Plan 3.**
- **A notification when a job reaches a stage.** The stage's responsible
  person is told (bell, push, e-mail, as their own settings say); with nobody
  on the stage, the owner is. **Plan 3.**
- **Files on the job** — scans, the design, the print file. STL files run to
  hundreds of megabytes, so the upload has to survive a dropped connection.
  **Plan 3.**
- **The phone**: adding a job, moving a stage, "I started", photos and files.
  Partly built; the stage work follows plan 3.
- **Russian as the fall-back language.** Separate small plan after plan 3.
  Russian is the third language: a missing string falls back to English, and
  every translation is marked for a native speaker to read before release.

**Ratings (docs/MODULES-AND-RATINGS.md part 2) come after step 1**, not
during it: who is rated has to come from the technician assigned to the
stage, and that assignment is what plan 3 builds.

## Step 2 — stock

Module `stock`. Stock and a partner clinic's stock, counted per job.

**Largely built, and untested** (docs/STOCK.md). Step 2 is therefore mostly a
test and fix step, not a build step. Nothing here is "done" until it has run
on real jobs in Riga.

## Step 3 — invoices

Module `invoices`.

- Invoices, and **recurring customers**: a customer marked as such gets a
  monthly invoice built automatically.
- The invoice goes to the customer's **saved representative**, either
  straight away or after an admin confirms it on the Invoices page. Which of
  the two is a per-customer setting.
- **Latvia's invoice requirements have to be researched first.** Wivo's
  invoice is an Estonian document today: `invoicesAvailable()` in
  `src/renderer/src/lib/country.ts` returns true only for `EE`, so invoices
  are **switched off for a Latvian clinic**. That gate opens when the Latvian
  requirements are known and built — not before.

## Step 4 — the calendar, and the rest

Module `patients` (the calendar is inside it, one piece). Everything agreed
but not in steps 1–3 lands here.

## 3.0 — the partnership system, working end to end

The partner bridge (phase 2) is **on hold, not cancelled** — the Tallinn
clinic partnership ended. 3.0 is where it comes back and is finished:
partner jobs, partner stock, and the lawyer's locked rule that no personal
data crosses between clinics (sql/092, CLAUDE.md).

## 4.0 — WivoStore

A tab where a clinic orders from partners and other clinics what they offer,
and can send an enquiry — "do you have X?" — to those who have not listed it.
This is VISION.md's supplier marketplace seen from the clinic side, and it
needs 3.0's partnership system underneath it.

---

## Own server (Riga)

Riga want one physical server with everything on it: Wivo, their website,
booking, and payments later.

**We start in the cloud, on their own account, and move to their server
later.** That order is deliberate: the move is a hosting change, and doing it
while the product is still changing weekly would mean debugging both at once.

Their current server is 17 years old (4 GB RAM, a hard disk, six VMs) and is
being replaced. The new one is Windows Server with Hyper-V, and Wivo gets a
Linux VM of its own.

**docs/OWN-SERVER.md** holds Riga's IT input and what the plan has to settle:
self-hosted Supabase, how updates reach it without the Management API, backups
with an encrypted copy off site, HTTPS that phones accept on port 443 (and
VPN-only as the alternative), the VM's exact specification, and the move out of
the cloud with a way back. **Plan only, and after the demo.**

---

## What is NOT in any step

- **Anything that recommends or ranks treatment from patient data.** Wivo is
  not a medical device (CLAUDE.md), and no step above changes that.
- **A patient-facing app** (docs/PATIENT-PORTAL.md).
- **Payments through Wivo.** If they ever happen, through a regulated payment
  provider, never Wivo holding money (VISION.md, locked).
