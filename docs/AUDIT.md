# Audit log: recording edits to jobs, work items, teeth, patients, permissions and files

Status: **built on `testing`** (`sql/114_audit_edits.sql`). It is not applied anywhere yet; Kevin applies it to the test copy first (§6).

Found on the test copy: adding teeth to a job left no entry. Only file views and exports showed up.

The cause: **the audit log never recorded an edit.** It recorded what happens around a job: opening it, moving its stage, sharing it, files, exports and deleting it. It did not record a change to the job's own contents, and the same was true for patients.

---

## 0. Decisions (Kevin, 2026-11-04)

1. **One entry per save.** A stage changed in the same save as other fields is part of that save's entry.
2. **Also recorded:** creating a job, and creating and deleting a patient.
3. **A job's price and paid status** are recorded old → new.
4. **The patient's tooth chart:** one entry per click.
   - The log stays append-only: stored entries are never updated or merged.
   - The audit log screen groups consecutive clicks by the same person on the same patient into one row that expands.
5. **In this step:** permission changes (who granted or removed which permission for whom) and file deletion, because both matter for security and for medical records.
   - **Later:** invoices, payments, payroll and price lists.
6. **The audit log is append-only for everyone, owners included,** with a test.

---

## 1. What was audited before sql/114, and what sql/114 adds

| Area | Audited before | Added by sql/114 | Still not audited |
|---|---|---|---|
| **Jobs** | Opening a job, on the desktop or the phone (sql/078). A partner opening a shared job (sql/071). Delete and restore (sql/089, 102). Share and unshare (sql/071). A question on the job's thread (sql/071, 080). The job table's CSV (sql/106). | **Creating a job. Every edit to its fields.** | |
| **Work items** | Nothing. | **Adding, removing or changing an item:** its work type, teeth, material, machine, implants, abutments and designer. | |
| **Tooth chart** | Nothing. | **The job's teeth** (the work items' teeth, the loose teeth and a remake's teeth). **The patient's own chart:** every status set or cleared. | |
| **Patients** | The full patient export (sql/074). The marketing contacts CSV (sql/106). | **Creating, editing and deleting a patient.** | Opening a patient card. |
| **Stages** | Every stage move of a job by a signed-in person, wherever it is made (sql/071, 078). A remake's stage moves (sql/087). | **A remake's stage changed in its form.** That path skipped the stage move. | Changes to the stage settings. |
| **Assignments** | Nothing; changes only sent a notification (sql/095). | **The job's technician and designer, each work item's designer, and a remake's technician and designer.** | |
| **Prices** | The remake repricing CSV (sql/106). | **A job's price, design price, extras and cost overrides** (old → new). Its extra costs, as "changed". | The price lists in Settings. Clients' own prices. A partner's price on a share. Pay rates. |
| **Payments** | The CSVs of invoices, payouts and payout lines (sql/106). | **A job marked paid and its payment date.** | Invoices, payments, payment plans and payroll payouts (§0, decision 5). |
| **Permissions** | Nothing. | **Each permission switch on the Team page and the technician preset:** who granted or removed which permission for whom. **A member's role** changed by an owner (technician, admin, owner). | |
| **Files** | Upload and download (sql/072). Viewing previews (sql/073). | **Deleting a file.** | |

Also audited before, outside this list:
- partnership steps;
- stock overrides;
- authenticators added, removed or reset;
- accounts deleted.

Still not audited:
- removing a member from the team (their permissions being removed is recorded);
- the clinic's settings;
- changes made in the SQL Editor (nobody is signed in there, the same as stage moves).

---

## 2. What sql/114 records

### 2.1 In the database, inside the save

Triggers on `jobs`, `patients`, `patient_teeth`, `worker_permissions` and `profiles` write the entry in the same save. `delete_job_file` writes its own entry.

- **Every way of saving is covered:** the job form, the board, bulk actions, the CSV import, the phone, older app builds and any future screen.
- **Recording starts once sql/114 is applied.** The app update is only needed to *read* the new entries well (§2.6).
- **Only what a signed-in person does.**
- **Nothing that merely follows from another change.** When a patient, client or member is deleted, the database empties their links on jobs. A deleted patient's chart and a deleted account's permissions go with them too. Those are part of the deletion's entry, not separate edits.
- **A save never fails because of the log.** If two versions can't be compared (unexpected data), the save goes through, and the entry says "edited (details could not be read)".

### 2.2 What one entry holds

| Part | Content |
|---|---|
| who, when | `user_id` and `at`, as for every entry |
| action | `create`, `edit`, `delete` (a patient), `permission`, `file_deleted` |
| object | `job:<id>`, `patient:<id>`, or `user:<id>` for permissions |
| detail | A job: `job_code`, then `changes`, `work_items` and `remakes`. A patient: `changes`. A tooth: `tooth` and `changes`. Permissions: `granted`, `removed` or `role`. A file: `file`, `type` and `version`. |

Example: in one save, a technician adds tooth 22 and a crown item, changes the material and fixes the description.

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

Settings → Audit log shows one row:

> Mari Tamm · Edited · TAL-26-0142 · Teeth 11,21 → 11,21,22 · Material Zirkoon → E.max · Description changed · Added: Kroon 22

### 2.3 Which fields show old → new, and which only "changed"

**The rules are one list in the database:** `audit_field_rules()` in sql/114. A column or key the list doesn't name is recorded only as "changed", so new content can never enter the log by accident. `sql/test/auditEdits.test.ts` fails when `jobs`, `patients` or `patient_teeth` has a column the list doesn't name, so each new column gets a decision.

The tables below give each column's database name and what it is.

**Jobs**

| Old → new | Only "changed" | Not recorded |
|---|---|---|
| **Teeth and work:**<br>• `too`: work type<br>• `materjal`: material<br>• `varv`: shade<br>• `kondivarv`: stump shade<br>• `masina`: machine<br>• `hambad`: loose teeth<br>• `kiirtoo`: rush<br>• `mudel`: model<br>• `materjali_yhikud`: material units<br><br>**People:**<br>• `assigned_to`: technician<br>• `designed_by`: designer<br>Stored as member ids; the screen shows names.<br><br>**Dates and delivery:**<br>• `kuupaev`: received<br>• `valmis_aeg`: deadline<br>• `valmis_kuupaev`: finished<br>• `delivery_status`<br>• `delivered_at`<br><br>**Links, by id:**<br>• `customer_id`: client<br>• `patient_id`: patient<br><br>**Money:**<br>• `hind`: price<br>• `disain_hind`: design price<br>• `makstud`: paid<br>• `makse_kuupaev`: payment date<br>• `extras`: services from the clinic's list, with their prices<br>• `kulu_yle`: cost overrides<br><br>**Old remake columns:**<br>• `rev_hambad`<br>• `rev_varv`<br>• `uus_valmis`<br><br>**The stage** (`status`): only alongside other changes (§2.4) | • `patsient`: the patient's name on the job<br>• `kirjeldus`: description<br>• `muudatused`: old change notes<br>• `customer_ref`: client's reference<br>• `print_id`, `disain_id`, `mudel_id`: print, design and model ids, typed by hand<br>• `extra_costs`: their names are typed<br>• `markused`: notes. Recorded as "note added" or "notes changed", with no text. | • `id`, `clinic_id`, `job_code`, `created_at`, `updated_at`<br>• `deleted_at`, `deleted_by`: delete and restore have their own entries |

**Work items**, matched by their id and named by their work type and teeth (for example "Kroon 11,21"):
- **added or removed;**
- **changed, old → new:** work type, teeth, bridge, implant teeth, material, machine, abutment (`kruvi`, `kruvid`), designer and designed teeth. A designer is shown as "as on the job", "nobody" or the member's name.
- **only "changed":** the item's note.

**Remakes** (`revisions`), matched by their id and named by their number ("Remake 2"):
- **added or removed;**
- **changed, old → new:** reasons, teeth, broken teeth, shade, stump shade, material, deadline, price, rush, model, billable, new parts and capsules, technician, designer, finished date and stage. Their work items follow the rules above.
- **only "changed":** the note, extra costs, and the print, design and model ids.

**Patients**

| Old → new | Only "changed" |
|---|---|
| `turundusnousolek`: marketing consent (allowed, declined or not asked) | everything else:<br>• `nimi`: name<br>• `synniaeg`: birth date<br>• `telefon`: phone<br>• `email`: e-mail<br>• `arst`: doctor<br>• `kliinik`: referring clinic<br>• `ravikaart`: medical card<br>• `allergiad`: allergies<br>• `eelistused`: preferences<br>• `lougad`: jaws<br>• `markmed`: notes<br>• `markused`: dated notes<br>• `varvi_eelistus`: shade preference<br>• `lougaliiges`: jaw joint<br>• `nousoleku_aeg`: consent time |

There is no personal-code column. If one is added, it is "changed" only until someone decides otherwise.

Creating a patient records only that it was created. Deleting a patient records only that it was deleted. Neither records any field.

**The patient's tooth chart** (`patient_teeth`): one entry per click, under `patient:<id>`. It records the tooth number and its status old → new (not marked, under treatment, missing or healthy). The tooth's note is "changed" only.

**Permissions:** one entry per member per save.
- **The entry:** for example `{ "granted": ["patients.read"], "removed": ["jobs.delete"] }`. The technician preset is one entry.
- **Nothing changed, no entry:** saving the same switches again records nothing.
- **A role change:** `{ "role": { "old": "technician", "new": "admin" } }`.

**A deleted file:** recorded under its job (`job:<id>`), so the job-code search finds it. It records the file's kind and version, never its name.

**How values are compared:**
- each value is cut at 120 characters;
- teeth are compared as a set, so "21, 11" after "11,21" is no change;
- an empty text and no value are the same;
- an unticked box and no value are the same;
- 100 and 100.00 are the same.

### 2.4 One entry per save, and none when nothing changed

- **One save, one entry.** The job form sends the whole job in one update, and the row trigger writes one entry with everything that changed.
- **Nothing changed, no entry.** Pressing Save on an unchanged job records nothing.
- **The stage:**
  - **alone** (a drag on the board, a bulk change, the stage move function): a stage move, as before;
  - **with other changes in one save:** part of that save's edit entry;
  - **searching:** the audit log's "Stage moved" filter finds both.
- **Moving to the done stage** sets the finished date at the same moment. That date belongs to the stage move and doesn't add an edit.
- **A remake's stage:**
  - **through the board** (`move_revision_stage`): a stage move, as before;
  - **changed in the remake's form:** part of the edit. Before sql/114, it left no entry.
- **Delete, restore, share and the stage move functions** keep their own entries. They are not repeated as edits.
- **Bulk actions:** one entry per job, because each job is its own save.
- **The CSV import:** one `create` entry per job.

### 2.5 Append-only, for everyone

- **Through the API:**
  - No API role can insert, update, delete or truncate `audit_log`: not the public key, not a signed-in owner and not the service key. Each attempt is refused with "permission denied".
  - Entries are written only by `audit()`, inside the database's own functions.
- **In the SQL Editor:**
  - An update, delete or truncate is refused too ("audit_log is append-only").
  - Only the database's own cascades get through: deleting an account empties its entries' `user_id`, and deleting a clinic removes that clinic's entries.
- **Tests:** `sql/test/auditEdits.test.ts`, "the log is append-only for everyone".

### 2.6 Reading them

On Settings → Audit log, the new actions are labelled Created, Edited, Permissions and File deleted. "Job deleted" is now "Deleted", because a patient can be deleted too.

- **The detail line** is as in §2.2, in English and Estonian. Russian falls back to English.
- **Names:**
  - technicians, designers and clients are named from the clinic's own lists;
  - someone who has left shows as "former member", a deleted client as "deleted client";
  - a member whose permissions changed is shown by name.
- **Patients** are shown as "Patient" and the first eight characters of the id, with an **Open** button that goes to the card.
- **Tooth chart clicks:**
  - consecutive clicks by the same person on the same patient form one row, for example "Tooth chart: 3 changes (16, 21)";
  - the row expands to show each click;
  - only the screen groups them: every entry stays as it was stored, and the CSV has one line per entry.
- **Older app builds** list the new entries with a plain label and no detail line until they update.

---

## 3. Privacy

- **A job by its code, a patient by their id. Never a name.**
  - The patient's name stored on a job (`patsient`) is recorded only as "changed".
  - So is every free-text field that could name someone.
  - A test fails if any entry's detail contains a test patient's name, phone, e-mail or allergy, after edits that change exactly those fields.
- **In the clinic's own data, under the same rules as before:**
  - only the clinic's owners and admins can read entries, with the second factor (sql/070, 098, 105);
  - technicians, other clinics and the public key get nothing;
  - tests check each of them.
- **Partners get nothing from edits.** Only the job's own clinic can edit a job, and the entry goes to that clinic alone.
- **The Wivo admin console never sees them.**
  - The console doesn't exist yet (docs/GAP-ANALYSIS.md, Phase 3).
  - The rule to build it by: its functions do not read `audit_log`, not even counts.
  - A test lists every database function that reads `audit_log`. Today that is `audit_entries`, `audit_search` and `audit_people`, which require an owner or admin of the same clinic. Two more only look for an entry of their own and return nothing from it: `record_mfa_factors` and `audit_permissions_deleted`. A new reader fails the test until someone reviews it.
  - The honest limit today: Wivo owns the Supabase project, so the dashboard can read any table. ARCHITECTURE-INSTANCES.md (Phase 0) says the same: "never sees" is a rule in code and policy, not yet a technical wall.

---

## 4. How much the log grows

An estimate, for a lab of about five people. These numbers are assumptions; the query below gives the real ones.

| Each month | Entries |
|---|---|
| Jobs created (about 10 a working day) | 220 |
| Job saves that change something (about 5 a job) | 1,100 |
| Remakes (about 20, two saves each) | 40 |
| Patients created and edited | 300 |
| Patient tooth chart clicks | 100 |
| Permission changes and file deletions | under 20 |
| **Total** | **about 1,800, call it 2,000** |

**Size:**
- One entry is about 1 KB: about 0.5 KB of row plus the log's five indexes.
- So about **2 MB a month, 25 MB a year**, per clinic like ours.

**Archiving: not needed.**
- The log is searched through its indexes, a page at a time (sql/105), so a page stays fast at millions of rows.
- At this rate, one clinic reaches a million entries in about 40 years.
- Revisit only if the whole `audit_log` passes about 5 million rows or a few GB.

**How long to keep entries is a legal question, not a storage one.** Nothing removes entries except deleting the whole clinic. Any rule that removes old entries needs the lawyer's retention period first, and a change to the append-only rule.

Read-only, for the real numbers on the test copy:

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

## 5. What was built

**`sql/114_audit_edits.sql`** (no new table):
1. Append-only for everyone: the API roles' write rights are removed, the append-only trigger is tightened, and truncate is refused.
2. New actions: `create`, `edit`, `permission` and `file_deleted`.
3. `audit_field_rules()` and the comparison functions.
4. Triggers:
   - on jobs: create and edit;
   - on patients: create, edit and delete;
   - on the patient tooth chart;
   - on permissions: three statement triggers, one each for insert, update and delete;
   - on a member's role.
5. The stage-move trigger leaves a stage changed alongside other fields to the edit entry. `move_revision_stage` marks its write as a stage move.
6. `delete_job_file` records the deletion.
7. `audit_search`: the "Stage moved" filter also finds edits that include a stage.
8. The migration ends with `select public.lock_anon_functions();`. `sql/checks/schema_check.sql` and `trigger_check.sql` are regenerated.

**The app:**
- `lib/auditSearch.ts`: labels, the detail line, names and the chart grouping;
- `Settings/AuditLogSection.tsx`: the names, the patient's Open button and the expanding rows;
- i18n in English and Estonian.

**Tests:**
- `sql/test/auditEdits.test.ts` (33 tests);
- `lib/auditSearch.test.ts`, extended;
- `sql/test/auditSearch.test.ts`: it now rolls back its own test row instead of deleting it, since that delete is refused now.

---

## 6. Kevin's steps on the test copy

1. **In the SQL Editor:** run `sql/114_audit_edits.sql`. Then run `notify pgrst, 'reload schema';` as a separate query.
2. **Read-only checks:** run `sql/checks/schema_check.sql` and `sql/checks/trigger_check.sql`. Each should return no rows.
3. **No Edge Function deploy is needed.**
4. **Push `testing`** so the test site rebuilds with the new audit screen. On the desktop: `npm run dev:test`.
5. **Try it**, then look in Settings → Audit log:
   - add teeth and change the material on a job;
   - change the stage and the teeth in one save;
   - edit a patient's name and consent;
   - click a few teeth on a patient's chart, then expand the grouped row;
   - turn a permission on and off for a member;
   - delete a file;
   - delete a test patient.
6. **Production:** with the next release, in the same order.
