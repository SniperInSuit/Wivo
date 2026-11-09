# Agreements: external technicians first, partner clinics later

Status: **plan, approved** (C2; Kevin's decisions of 2026-11-09 are in §11). Built after phase 2. Nothing is built yet.

**Until then** (Kevin): the paper price list is entered as the technician's ordinary pay rules. When the agreement takes effect, those rules end the day before (§3).

**What it is:**
- **an agreement in Wivo** between the clinic and an external technician: the clinic's terms, the technician's price list, and how the prices reach pay;
- **signed by both sides** with a fresh authenticator code (the lawyer's L5), locked, timestamped and tamper-evident, downloadable as a PDF;
- **the price list becomes the technician's pay rules** from the agreement's start;
- **a job is priced by the agreement in force when the technician pressed "Start work"**, a time from the database's clock that nobody can edit;
- **a price change is a new agreement** that the other side sees, with what differs and why, and signs or declines (L7: a new agreement replaces the old one);
- **a monthly statement** for the technician to invoice from;
- **later, the same agreements between partner clinics.**

The example: an external technician sent us a price list and terms on paper.

## 0. Today

**What exists:**
- **Pay rules per person** (`worker_rates`, sql/022 onward): per hour, per tooth, per job, a percentage of the price, or a monthly salary, for the work, the design, remakes and models, each with a start and an end date.
- **A rule is picked by the job's completion date** (`jobPeriodDate`: done date, else the deadline, else the date received). Nothing records when work began.
- **A worker's employment type** (`profiles.toosuhe`): an employee (`tootaja`) or a company (`ettevote`). Payroll already keeps companies apart from payslips.
- **Payouts freeze their lines** as they were paid (`worker_payout_lines`).
- **Inviting a worker** (sql/086): a one-time token, and the new account joins the clinic as a technician at once.
- **The fresh code** is planned for approving updates (docs/ARCHITECTURE-INSTANCES.md §5b) but not built.

**What's missing:**
1. **No agreement:** prices are typed by the owner as rules, with no record of what both sides accepted.
2. **No signature,** and nothing to download.
3. **No "Start work":** a price change reaches jobs by their completion date, so work begun under the old prices is paid at the new ones.
4. **No hand-entered pay line:** only hours can be entered by hand.
5. **An invited worker gets access at once,** before anything is agreed.

## 1. The agreement

**It holds:**
- **the two parties:**
  - the clinic: name, registry code, address;
  - the technician: name, and the company they invoice from (name, registry code, VAT number if any, address, bank account). The technician fills in their own side;
- **the clinic's terms:** a text, started from the clinic's standard terms in Settings → Agreements and edited for this agreement;
- **the price list,** one line per price:
  - **what:** a work type, or any work;
  - **how:** per work type (a fixed price per job), per tooth for work on teeth, per piece for work without teeth, per hour, or a percentage of the job's price;
  - **per piece** (Kevin, 2026-11-09): splints, models, guides, and dentures per arch. A work item without teeth is one piece; a denture counts one piece for each arch it covers, upper and lower;
  - **for:** the work, the design, a remake or a model, as pay rules are today;
  - **the amount,** and whether prices include VAT;
- **how the prices reach pay:**
  - **automatically:** each job is priced from the list;
  - **by hand:** the list is the reference, and the clinic enters each job's amount, with the list's price suggested;
  - **both:** automatically, and the clinic can add a line by hand, with a note, for work the list doesn't cover;
- **the start date;**
- **the access the technician gets** once it takes effect, from the clinic's usual permissions (for example, only the jobs assigned to them);
- **its language** (English, Estonian or Russian), for the PDF's headings. The terms are the clinic's own text.

**Its life:**
1. **Draft.** Either side may prepare and edit it: the owner types in the paper price list, or the technician enters their own.
2. **Sent for signature.** The text is frozen and its hash computed. From here nothing in it changes.
3. **Signed by one side,** then **by both.**
4. **In force** from its start date, or from the second signature if that comes later. **Never earlier than the second signature,** so no job already started changes price.
5. **Replaced** when a newer version takes effect, or **ended** (§5).

**Declined:** the other side declines with a comment. The version stays in the history, a new draft is made from it, and the agreement in force, if any, stays in force.

## 2. Signing

**Signing is a fresh authenticator code** (L5), asked for at that moment, even within a session that already has the second factor.

**What the database checks, in one function:**
- the signer is a party: the technician for their side, the owner (or a member allowed to, decision 1) for the clinic's;
- the code is fresh: the session's record of the second factor (`amr` in the sign-in token) is less than 2 minutes old;
- the hash the signer saw is the hash of the frozen text, so they sign exactly what they read;
- this side hasn't signed this version already.

It records who, when (the database's clock), the hash, and when the code was entered. It leaves an audit entry and notifies the other side.

**The same fresh-code check approves updates** (phase 1, §5b). It is built once and used by both.

**Tamper-evident:**
- **the hash** is the SHA-256 of the frozen text. Each version also carries the previous version's hash, so the history is a chain: changing an old version breaks every hash after it;
- **after the first signature, the version can't be changed,** by anyone: a database trigger refuses it, and the attempt is logged;
- **each side keeps its own PDF.** It prints the hash and both signatures (names, times, "confirmed with the second factor"). A copy kept outside the clinic's database is the technician's evidence, even against someone who could edit that database;
- a check in Wivo recomputes every hash in an agreement's chain and says whether it holds.

**The PDF:**
- made on the device from the frozen text, so the desktop and the phone give the same document;
- the download leaves an audit entry before the file is made, as every export does (sql/106);
- both sides can download every version they signed.

## 3. From price list to pay

- **When an agreement takes effect, its price list becomes the technician's pay rules,** marked with the agreement version they came from.
  - Those rules can't be edited by hand: a change is a new agreement (§5).
  - The technician's earlier hand-typed rules end the day before.
- **A job is priced by the agreement recorded at its start** (§4), not by the date it was finished.
- **Finished jobs keep the prices they were paid at:** payouts freeze their lines, as today.
- **The month a job is paid in** is still decided by its done date, as in payroll today. The start decides the price; the done date decides the month.

## 4. Start work

**The button:**
- **"Start work"** on the job, for the person assigned to it, and for its designer if the designer is paid under an agreement. Each starts their own part.
- **The time comes from the database's clock,** never from the device. It is set once and can't be edited, and it is in the audit log.
- **The job shows** who started it, when, and which agreement priced it ("Started 9 Nov 10:42 by Mari · agreement v2, from 1 Nov").
- **Without an agreement in force,** an external technician's Start is refused, with the reason. An employee's jobs are priced as today.

**A job nobody started** (decision 4):
- recommended: when the assigned person first moves it on from the stage it was created in, or marks it done, it starts at that moment, marked "started by moving it";
- so every job under an agreement has a start, and nothing is guessed afterwards.

**A mistaken press, without ever editing the time** (decision 3):
- **within 10 minutes,** the person who pressed can undo it. The start is cancelled, not changed: both the press and the undo stay in the job's history and the log;
- **after 10 minutes,** only the owner (or a member allowed to sign agreements) can cancel a start, with a reason. The technician is notified;
- **pressing again** on the right job makes a new start with a new time;
- **so a time is never moved,** only cancelled and replaced by a new press, visibly. A new press after a price change would be priced by the newer agreement, which is why a late cancel needs the owner.

**A remake on the same job** (decision 5): recommended, priced by the agreement at the job's start, since its price was agreed then.

## 5. Changing prices, and ending

**A price change is a new version:**
- made from the agreement in force, with a new start date and a required **"why"**;
- **the other side sees what differs:**
  - each changed price, old → new;
  - each added or removed line;
  - each changed paragraph of the terms;
  - and the why;
- they **sign** it, or **decline with a comment**;
- **once in force, it replaces the old version from its start** (L7). Jobs started before keep the old prices.

**Ending an agreement:**
- either side may end it, as its terms allow, with an end date and a fresh code;
- after the end date, no new job can be started under it. Jobs already started keep their prices;
- the technician's access ends with it, unless the owner keeps it.

## 6. Inviting an external technician

1. **The owner prepares the agreement first:** the terms, and the price list typed in, or left for the technician to fill.
2. **The invite** (sql/086's one-time token) brings the technician into the clinic **with access to nothing but their agreement.** They set up their account and second factor as everyone does.
3. **They review it,** fill in their company details, and sign, or decline with a comment.
4. **The owner signs.**
5. **From its start, the technician gets the access chosen in the agreement.**

A technician already in the team gets an agreement the same way, from step 1, without losing access.

## 7. The monthly statement

**External technicians are contractors,** so instead of a payslip they get a statement of their work at the agreed prices, to invoice the clinic from.

**For each month, by done date:**
- each job: its **job code**, the work and the number of teeth or units, the date started and the date done, the agreement version, and the amount;
- hours, for an hourly price;
- lines entered by hand, each with its note;
- the totals, and whether they include VAT.

**No patient names** (decision 6): the statement leaves Wivo as the basis for an invoice, and the job code is enough to find the job.

**Its life:**
1. Wivo makes the draft at the month's end.
2. **The technician confirms it, or comments on lines.**
3. **The clinic finalizes it.** Its lines are frozen, as a payout's are today.
4. The technician invoices from it, and the clinic marks it paid when the invoice is settled. The money moves outside Wivo.

**Downloads,** as PDF or CSV, go through the audited export (sql/106), for the technician (their own) and those who manage payroll.

## 8. Later: partner clinics

**The same agreement, with a partner clinic as the other party:**
- prices for shared jobs;
- the lending terms and prices for partner stock on a statement (docs/STOCK.md §8);
- signed by each clinic's owner, with a fresh code.

**Across two projects** (docs/ARCHITECTURE-INSTANCES.md):
- the frozen text and both signatures travel over the bridge;
- each project stores the same text and hash, and each signature is checked by the signer's own project;
- **no patient data is in it:** prices and terms only.

It comes with partner pricing, after phase 2, and is planned then.

## 9. Who may do what, and the log

**A new permission, "Agreements"** (`agreements.manage`): prepare, send, sign for the clinic, end, and cancel a start after 10 minutes.
- **The owner always may.**
- **Members may only if the owner gives it to them;** it is off by default, the same pattern as "Install updates" (Kevin, 2026-11-09).

**Who reads an agreement:**
- the technician, their own;
- the owner, "Agreements" and "Manage payroll", since it is pay (sql/027, sql/117).

**In the audit log:** a draft made and edited, sent, each signature, declined with its comment, withdrawn, in force, replaced, ended, every PDF and statement download, every start and every cancelled start.

**Notifications:**
- awaiting your signature;
- signed;
- declined, with the comment;
- in force;
- a start cancelled;
- a statement ready to confirm.

## 10. How it is built

**New tables,** each with `org_id`, access rules, the second-factor policy and a leak test (CLAUDE.md):
- `agreement`: the clinic and the other party (a member now, a partnership later), and its end;
- `agreement_version`:
  - its number and status;
  - the frozen text and its SHA-256, and the previous version and its SHA-256;
  - the start date, in force from and replaced from;
  - the pay mode, the language, and the why;
  - declined by, when and the comment;
- `agreement_signature`: append-only; the signer, the side, the time from the database's clock, the hash, and when the code was entered;
- `job_start`: the job, the person, the time from the database's clock, how (the button or a stage move), the agreement version, and cancelled by, when and why;
- `pay_hand_line`: a line entered by hand, with its note and who entered it.

**Changed:**
- **`worker_rates`:** the agreement version a rule came from. A trigger refuses editing those rules;
- **a member's state** "agreement pending", which grants nothing but their agreement (§6);
- **the pay engine** (`lib/earnings.ts`):
  - a job started under an agreement is priced by that version's rules; the month is still the done date's;
  - a new kind of rule, per piece (§1), next to per tooth;
- **notification kinds and export kinds,** as in §9.

**Database functions:**
- the fresh-code check, shared with update approval;
- send, sign, decline, withdraw and end an agreement;
- start a job, and cancel a start;
- make and finalize a statement;
- check an agreement's chain of hashes.

  All of them end with `lock_anon_functions()`, and the ones that only read are `stable`.

**Tests:**
- signing: refused without a fresh code (older than 2 minutes, or no second factor), with another hash, twice by one side, or by someone not a party;
- a signed version can't be changed, and the chain check catches an edited old version;
- in force never before the second signature;
- a job started under v1 and finished after v2 takes effect is paid at v1's prices; one started after is paid at v2's;
- a start is set once, from the database's clock; an undo after 10 minutes is refused to the technician and allowed to the owner, with a reason;
- a pending technician reads nothing but their agreement;
- the statement holds no patient names, and its downloads leave audit entries;
- leak tests: another technician, another clinic and a partner see none of it.

## 11. Decisions (Kevin, 2026-11-09)

1. **Who signs for the clinic:** the owner, and members the owner gives the new "Agreements" permission. It is off by default, as "Install updates" is.
2. **Prices per tooth and per piece:** per tooth for work on teeth; per piece for work without teeth (splints, models, guides, and dentures per arch).
3. **A mistaken Start:** the technician undoes it within 10 minutes; later only the owner, or a member with "Agreements", cancels it, with a reason.
4. **A job nobody started:** it starts when the assigned person first moves it on.
5. **A remake on the same job:** priced by the agreement at the job's start.
6. **The statement:** job codes only, no patient names; the technician confirms or comments before the clinic finalizes it.
7. **When:** after phase 2. Until then, the paper price list is entered as ordinary pay rules.

## 12. Order of work and time

| Slice | Built in | Kevin's part |
|---|---|---|
| 1. **The agreement and signing:**<ul><li>the fresh-code check (shared with update approval);</li><li>the tables, the hash chain and the trigger;</li><li>Settings → Agreements, and the editor;</li><li>send, sign, decline with a comment;</li><li>the PDF.</li></ul> | 5–6 days | Type in the paper price list, sign as the owner and as a test technician on the test copy; download both PDFs and check the hash. Two sessions. |
| 2. **Price list to pay, and Start work:**<ul><li>the rules from the agreement, locked;</li><li>the Start button, the start by moving a job, undo and cancel;</li><li>the job shows its start and agreement;</li><li>the pay engine;</li><li>lines entered by hand.</li></ul> | 4–5 days | Jobs started before and after a price change, paid at the right prices; a mistaken press undone and cancelled. Two sessions. |
| 3. **Changes and ending:**<ul><li>a new version with what differs and why;</li><li>declining with a comment;</li><li>ending.</li></ul> | 2–3 days | A price change proposed, declined, changed and signed. One session. |
| 4. **The invite with the agreement first.** | 2 days | Invite a test technician who sees nothing until both have signed. One session. |
| 5. **The monthly statement:**<ul><li>the draft, the technician's confirmation or comments;</li><li>finalizing, PDF and CSV;</li><li>marking it paid.</li></ul> | 3 days | A month of test jobs to a statement, confirmed and finalized. One session. |
| 6. **Partner clinics,** with partner pricing after phase 2. | planned then | |

- **Building:** about 16–19 days, with per piece in slice 2. **Kevin:** about 7 sessions.
- **Calendar:** about 3–4 weeks at 3–4 hours of testing a day, after phase 2.
