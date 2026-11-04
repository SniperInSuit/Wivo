# Audit log: recording edits to jobs, work items, teeth and patients

Status: **plan only, waiting for Kevin's OK.** Nothing is built. If approved, it is migration `sql/114`, on `testing`, applied by Kevin to the test copy first.

Found on the test copy: adding teeth to a job left no entry. Only file views and exports showed up.

The cause: **the audit log never recorded an edit.** It records what happens around a job: opening it, moving its stage, sharing it, files, exports and deleting it. It does not record a change to the job's own contents, and the same is true for patients.

---

## 1. What is audited today

Read from the migrations on `testing` (9618048). An entry is a row in `audit_log` (sql/070): who (`user_id`), when (`at`), the action, the object (`job:<id>`, `file:<id>`, …) and a small `detail`.

| Area | Audited today | Not audited |
|---|---|---|
| **Jobs** | Opening a job, on the desktop or the phone (`view`, sql/078). A partner opening a shared job (sql/071). Delete and restore (sql/089, 102). Share and unshare with a partner (sql/071). A question on the job's thread (sql/071, 080). The job table's CSV (sql/106). | **Creating a job.** **Any edit to its fields**: teeth, work type, material, shade, dates, client, notes, description. |
| **Work items** (`jobs.work_items`) | Nothing. | **Adding, removing or changing an item**: its work type, teeth, material, machine, implants, abutments and designer. |
| **Tooth chart** | Nothing. | **The job's teeth**: the work items' teeth and the loose teeth (`jobs.hambad`). The same in a remake. **The patient's own chart** (`patient_teeth`): every status set or cleared. |
| **Patients** | The full patient export (sql/074). The marketing contacts CSV (sql/106). | **Creating, editing or deleting a patient.** Opening a patient card. |
| **Stages** | Every stage move of a job by a signed-in person, wherever it is made (the board, the form, a bulk change or a partner), with from → to (sql/071, 078). A remake's stage moves (sql/087). | Changes to the stage settings (the list of stages and who may move between them). |
| **Assignments** | Nothing. Changes only send a notification (sql/095). | **The job's technician and designer, each work item's designer, and a remake's technician and designer.** |
| **Prices** | The remake repricing CSV (sql/106). | **A job's price, design price, extras, extra costs and cost overrides.** The price lists in Settings. Clients' own prices. A partner's price on a share. Pay rates. |
| **Payments** | The CSVs of invoices, payouts and payout lines (sql/106). | **A job marked paid and its payment date.** Invoices (created, sent, status). Payments recorded. Payment plans. Payroll payouts. |
| **Files** | Upload and download (sql/072). Viewing previews (sql/073). | **Deleting a file** (`delete_job_file`). |

Also audited today, outside this list:
- partnership steps;
- stock overrides;
- authenticators added, removed or reset;
- accounts deleted.

Also not audited:
- changes to team permissions;
- removing a member from the team;
- the clinic's settings;
- changes made in the SQL Editor (nobody is signed in there, so they are not recorded, the same as stage moves today).

**This plan covers the rows in bold for jobs, work items, the tooth chart and patients.** It also covers assignments, a job's prices and its paid status, because those are fields of the job and change in the same save.

Invoices, payments, payment plans, payroll, price lists, permissions, file deletion and opening a patient card are left for a later step (§7, decision 5).

---

## 2. The proposal

### 2.1 Where it is recorded: in the database

Triggers on `jobs`, `patients` and `patient_teeth` write the entry inside the same save. They follow the same pattern as today's stage-move trigger (sql/078).

- **Every way of saving is covered:** the job form, the board, bulk actions, the CSV import, the phone, older app builds and any future screen. Nothing in the app can skip it.
- **Recording starts once Kevin applies sql/114**, even before the app update. The update is only needed to *read* the new entries well (§2.5).
- **Changes nobody is signed in for** (the SQL Editor, a future server job) are not recorded. That is the same rule as stage moves today. Nothing like that edits jobs or patients today.

### 2.2 What one entry holds

| Part | Content |
|---|---|
| who, when | `user_id` and `at`, as for every entry |
| action | `create` or `edit`. Deleting a patient uses `delete`, which already exists for jobs. |
| object | `job:<id>` or `patient:<id>` |
| detail | For a job: `job_code` and the changes. For a patient: the changes only. |

Example: a technician adds tooth 22 and a crown item, changes the material and fixes the description, all in one save:

```json
{
  "job_code": "TAL-26-0142",
  "changes": {
    "hambad":    { "old": "11,21", "new": "11,21,22" },
    "materjal":  { "old": "Zirkoon", "new": "E.max" },
    "kirjeldus": "changed"
  },
  "work_items": [
    { "item": "Kroon 22", "change": "added" }
  ]
}
```

Settings → Audit log shows it as one row:

> Mari Tamm · Edited · TAL-26-0142 · Teeth 11,21 → 11,21,22 · Material Zirkoon → E.max · Description changed · Added: Kroon 22

### 2.3 Which fields show old → new, and which only "changed"

**The rule is an allow-list.** A field that is not listed for old → new is recorded only as "changed". So a column added later can never put its content into the log by accident. A test fails when `jobs`, `patients` or `patient_teeth` gains a column that the rules don't name, so each new column gets a decision.

The tables below give each column's database name and what it is.

**Jobs**

| Old → new | Only "changed" | Not recorded |
|---|---|---|
| **Teeth and work:**<br>• `too`: work type<br>• `materjal`: material<br>• `varv`: shade<br>• `kondivarv`: stump shade<br>• `masina`: machine<br>• `hambad`: loose teeth<br>• `kiirtoo`: rush<br>• `mudel`: model<br>• `materjali_yhikud`: material units<br><br>**People:**<br>• `assigned_to`: technician<br>• `designed_by`: designer<br>Stored as member ids; the screen shows names.<br><br>**Dates and delivery:**<br>• `kuupaev`: received<br>• `valmis_aeg`: deadline<br>• `valmis_kuupaev`: finished<br>• `delivery_status`<br>• `delivered_at`<br><br>**Links, by id:**<br>• `customer_id`: client<br>• `patient_id`: patient<br><br>**Money:**<br>• `hind`: price<br>• `disain_hind`: design price<br>• `makstud`: paid<br>• `makse_kuupaev`: payment date<br>• `extras`: services from the clinic's list, with their prices<br>• `kulu_yle`: cost overrides | • `patsient`: the patient's name on the job<br>• `kirjeldus`: description<br>• `muudatused`: old change notes<br>• `customer_ref`: client's reference<br>• `print_id`, `disain_id`, `mudel_id`: print, design and model ids, typed by hand<br>• `extra_costs`: their names are typed<br>• `markused`: notes. Recorded as "note added" or "notes changed", with no text. | • `id`, `clinic_id`, `job_code`, `created_at`, `updated_at`<br>• `deleted_at`, `deleted_by`: delete and restore have their own entries<br>• `status`: the stage, see §2.4 |

**Work items**, matched by their id:
- **added or removed:** the item's work type and teeth;
- **changed, old → new:** work type, teeth, bridge, implant teeth, material, machine, abutment (`kruvi`, `kruvid`), designer and designed teeth;
- **only "changed":** the item's note.

**Remakes** (`revisions`), matched by their id:
- **added or removed;**
- **changed, old → new:** reasons, teeth, broken teeth, shade, stump shade, material, deadline, price, rush, model, billable, new parts and capsules, technician, designer, and work items (by the same rules as above);
- **only "changed":** the note and extra costs.

A remake's stage is recorded by the remake stage move (sql/087), as today.

**Patients**

| Old → new | Only "changed" |
|---|---|
| `turundusnousolek`: marketing consent (yes, no or not asked) | everything else:<br>• `nimi`: name<br>• `synniaeg`: birth date<br>• `telefon`: phone<br>• `email`: e-mail<br>• `arst`: doctor<br>• `kliinik`: referring clinic<br>• `ravikaart`: medical card<br>• `allergiad`: allergies<br>• `eelistused`: preferences<br>• `lougad`: jaw notes<br>• `markmed`: notes<br>• `markused`: dated notes<br>• `varvi_eelistus`: shade preference<br>• `lougaliiges`: jaw joint<br>• `nousoleku_aeg`: consent time |

There is no personal-code column today. If one is added, it is "changed" only by default.

Creating a patient records only that it was created. Deleting a patient records only that it was deleted. Neither records any field.

**The patient's tooth chart** (`patient_teeth`): one entry per change, under `patient:<id>`. It records the tooth number and its status old → new. The status comes from a fixed list; "cleared" counts as a status. The tooth's note is "changed" only.

**Value limits:**
- each old or new value is cut at 120 characters;
- tooth lists are compared sorted and without repeats, so "21,11" after "11,21" is no change;
- an empty text and no value are the same.

### 2.4 One entry per save, and none when nothing changed

- **One save, one entry.** The job form sends the whole job in one update (`useUpdateJob`). One update means one row-trigger call, which writes one entry listing every field that changed.
- **Nothing changed, no entry.** Pressing Save on an unchanged job, or the app writing back the same values, records nothing. The comparison follows the rules in §2.3.
- **The stage and other changes in the same save** become **one** `edit` entry that includes "Stage Design → Milling".
  - Today's stage-move trigger writes its own entry only when the stage is the only change, as a drag on the board does.
  - The audit log's "Stage move" filter finds both kinds of entry, so every stage move is still found.
- **Moving to the done stage** sets the finished date at the same moment. That date belongs to the stage move, so it doesn't add an edit entry.
- **Delete, restore, share and a remake's stage move** keep their own entries. They are not repeated as edits.
- **Bulk actions:** one entry per job, because each job is its own save. This covers bulk assign, bulk stage and remake repricing.
- **The CSV import:** one `create` entry per job.
- **The patient's tooth chart:** each click is a save, so one entry per tooth.

### 2.5 Reading them

On Settings → Audit log, the new actions get labels and a detail line, as in §2.2. The fields' names are translated (English and Estonian; Russian falls back to English).

- **Names:** technicians and designers are shown by name, from the team list. A member who has left shows as "former member".
- **Patients:** shown as "Patient" and a short id, with a button that opens the card for someone allowed to see patients. The log itself never holds the name.
- **Searching:** the existing search (person, action, job code, dates) works unchanged.
- **The CSV export** of the log carries the same detail line.
- **Older app builds** list the new entries with a plain label until they update.

---

## 3. Privacy

- **A job by its code, a patient by their id. Never a name.**
  - The patient's name stored on a job (`patsient`) is recorded only as "changed".
  - So is every free-text field that could name someone: description, notes, references and typed ids.
  - A test fails if any entry's detail contains a patient's name, phone or e-mail, after edits that change exactly those fields.
- **In the clinic's own data, under the same rules as today's log.**
  - The entries are rows in `audit_log`, with the clinic as `org_id`.
  - Only the clinic's owners and admins can read them, with the second factor (sql/070, 098). They read through the same search (sql/105).
  - Technicians, other clinics and the public key get nothing; tests check each of them.
- **Partners get nothing from edits.** Only the job's own clinic can edit a job (RLS on `jobs`). The entry goes to that clinic alone: unlike a share or a stage move, the partner gets no copy.
- **The Wivo admin console never sees them.**
  - The console doesn't exist yet (docs/GAP-ANALYSIS.md, Phase 3).
  - The rule to build it by: the console's functions do not read `audit_log`, not even counts. Its daily figures (docs/ARCHITECTURE-INSTANCES.md) never include audit rows.
  - A test lists every database function that reads `audit_log`. It fails if one doesn't require a member of the same clinic.
  - The honest limit today: Wivo owns the Supabase project, so the dashboard and the SQL Editor can read any table. ARCHITECTURE-INSTANCES.md (Phase 0) says the same: "never sees" is a rule in code and policy, not yet a technical wall.

---

## 4. How much the log grows

An estimate, for a lab of about five people. These numbers are assumptions; the query below gives the real ones.

| Each month | Entries |
|---|---|
| Jobs created (about 10 a working day) | 220 |
| Job saves that change something (about 5 a job: assignment, teeth or material fixes, price, delivery, paid, a note) | 1,100 |
| Remakes (about 20, two saves each) | 40 |
| Patients created and edited | 300 |
| Patient tooth chart clicks | 100 |
| **Total** | **about 1,800, call it 2,000** |

**Size:**
- One entry is about 1 KB: about 0.5 KB of row, with a typical detail of 250 bytes, plus the five indexes the log already has.
- So about **2 MB a month, 25 MB a year**, per clinic like ours.
- Opening jobs (`view`) probably already writes more entries than this.

**Archiving: not needed.**
- The log is searched through its indexes, a page at a time (sql/105), so a page stays fast at millions of rows.
- At this rate, one clinic reaches a million entries in about 40 years.
- Revisit only if the whole `audit_log` passes about 5 million rows or a few GB.

**How long to keep entries is a legal question, not a storage one.**
- The log is append-only (sql/070): nothing removes entries except deleting the whole clinic.
- Any rule that removes old entries needs the lawyer's retention period first.

To see the real numbers, Kevin can run this on the test copy. It is read-only and changes nothing.

```sql
select to_char(m, 'YYYY-MM') as month,
       (select count(*) from public.jobs      where created_at >= m and created_at < m + interval '1 month') as jobs_created,
       (select count(*) from public.patients  where created_at >= m and created_at < m + interval '1 month') as patients_created,
       (select count(*) from public.audit_log where at >= m and at < m + interval '1 month')                as audit_entries,
       (select pg_size_pretty(pg_total_relation_size('public.audit_log')))                                  as audit_log_size_now
  from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
 order by m;
```

---

## 5. What gets built after the OK

**`sql/114_audit_edits.sql`** (no new table):
1. The allowed actions gain `create` and `edit`.
2. One function per table compares old and new by the rules in §2.3. These functions can be tested on their own.
3. Triggers write the entries:
   - on `jobs`: after insert and update;
   - on `patients`: after insert, update and delete;
   - on `patient_teeth`: after insert, update and delete.
4. The stage-move trigger leaves a stage change to the edit entry when other fields change in the same save. The remake stage move marks its own write so that it isn't repeated as an edit.
5. The search's "Stage move" filter also finds edit entries that include a stage.
6. The migration ends with `select public.lock_anon_functions();` and regenerates the schema check.

**The app:**
- the labels and detail line for the new actions (`lib/auditSearch.ts`);
- "former member";
- the patient link;
- i18n in English and Estonian.

**Tests:** `sql/test/auditEdits.test.ts` and the app's `auditSearch.test.ts`. They cover:
- one entry per save;
- no entry when nothing changed, including reordered teeth and empty versus no value;
- a stage plus teeth in one save makes one entry; a drag on the board makes one stage move;
- deleting makes only `delete`;
- free text and patient details appear only as "changed", and never as content;
- the name-leak test;
- partners, technicians and anon get nothing;
- the test that every column has a rule.

**Rollout:** on `testing`. Kevin applies sql/114 to the test copy and tries it there (add teeth, change a material, edit a patient, click the chart). It reaches production with the next release.

---

## 6. Order of work

1. Kevin's OK on this plan and the decisions in §7.
2. sql/114 and its tests.
3. The audit screen.
4. Kevin tests on the test copy.
5. The release.

---

## 7. Decisions for Kevin

1. **A stage change in the same save as other edits is one entry** (§2.4). Recommended: yes, it matches "one entry per save". The alternative is two entries, a stage move and an edit.
2. **Also record creating a job, and creating and deleting a patient.** Recommended: yes. Today, deleting a patient leaves no trace at all.
3. **A job's price, extras and paid status as old → new.** Recommended: yes. They are neither clinical nor personal, and "who changed the price" is a common question. The alternative is recording them as "changed" only.
4. **The patient's tooth chart: one entry per click.** Recommended: yes, each click is a save. The alternative is grouping one person's clicks on one patient within a few minutes into one entry. That needs either rewriting entries, which the append-only rule forbids, or a delay before writing.
5. **Not in this step:** invoices, payments, payment plans, payroll, price lists, permissions, file deletion and opening a patient card. Recommended: payments and invoices next, then file deletion, as a separate migration once this one is tested.
