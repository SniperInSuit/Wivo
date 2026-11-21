# Backlog

Work Kevin has agreed to, not yet scheduled, and the steps saved for the live release. Each item says who decided it and when. The larger plans have their own files (docs/STOCK.md, docs/AGREEMENTS.md, docs/TOUR.md §5).

## Before the live release

1. **Deploy `send-invoices` to production, then run its dry run** (Kevin, 2026-11-09).
   - The fix is on `main` (4c8b170): a draft is never e-mailed, nor an invoice marked Paid; an invoice goes out once marked Sent, and a payment plan's instalments on their dates.
   - **Until the deploy, automatic sending stays off in production.**
   - The steps:
     1. on the test copy: the deploy, two test invoices (one draft, one marked Sent) and the dry run;
     2. then production: the same deploy, in a session Kevin starts for it.

## After Riga's start (Monday 23.11.2026)

1. **A database block: no CT or X-ray on a shared job until the partner gets a cleaned copy** (Kevin, 2026-11-20).
   - **Why:** DICOM headers are no longer cleaned: every file, CT and X-ray included, is stored exactly as uploaded (commit 4560a98, 2026-11-20). A CT on a shared job would reach the partner with the patient's name in its header, and the rule "a partner never learns who the patient is" (sql/092, lawyer's decision) would then hold only through a warning and a person's tick.
   - **Decided:** photo and STL cleaning stays as it is for Monday. The Riga partner module is **off**, so no CT or X-ray can reach a partner at the start.
   - **To build (a migration, on `testing` only):** the database refuses a `ct` or `xray` file on a job that is shared with a partner (and refuses sharing a job that already has one), until a cleaned copy exists to send the partner. The screens say it in plain words (`app.notAvailableYet`-style, no SQL named), in en/et.
   - **Before the partner module is switched on for any clinic.** Not before the full security review (by 2026-12-07) has looked at it.

2. **From the short security check before Riga's build (2026-11-21), for the full review (by 2026-12-07).** Nothing here blocks Monday. Checked and found sound: RLS and leak tests on the six tables of sql/122 (another clinic reads and writes nothing, nothing without the second factor), `can_move_stage` / `move_job_stage` / `guard_stage_change`, `files.write`, the stage bar and quick assign (the app only calls the RPCs; every one asks `may_edit_job_stages` or `can_move_stage` in the database), Storage for `ct` and `project` (the upload slot goes through `may_upload_job_file`, a partner adds only print and design), and `dist:riga` (two public values, secret scan, no `.env` in the package, updates refused while `UPDATE_SOURCES` is empty). A test now also checks that another clinic's owner cannot call the stage functions.
   1. **Money and the patient's name for stage people.** Being on a stage of a job (not skipped) gives read access to the whole `jobs` row through the API: `hind`, `disain_hind`, `makstud`, `makse_kuupaev`, the prices in `extras` and `revisions`, `patsient` (free text), and the job's files (a CT's DICOM header names the patient). That includes IT and anyone else without `jobs.read`, `patients.read` or `payments.read`. The screens hide money without `payments.read`, so this needs the person's own login, the second factor and a hand-made API call. It is the known gap "money on jobs" (docs/PERMISSIONS.md), made wider: it used to reach the job's technician and designers only. **Fix:** the `job_money` release (docs/PERMISSIONS.md). Until then: put on stages only people the clinic would let see the job's price and patient.
   2. **The orderer can put anyone of the clinic on a stage** (`may_edit_job_stages`: the doctor who ordered the job, with `jobs.write`). That person then reads the job (point 1) and is paid from the stage's pay kind. Decided in sql/123 (§2.4) and in the audit log ('stage_edit'); the review should confirm the choice, or limit it to people who already have `jobs.read` or `jobs.write`.
   3. **`jobs.template_id` can be changed after creation** by anyone with `jobs.write`. It does not change the job's stages, but a stage added later (`add_job_stage`) takes its pay kind from the new template (sql/124 trigger). Small; fix by refusing the change after insert, like `ordered_by` (`guard_job_orderer`), in the next migration.
   4. **Remakes still move by a direct update of `revisions`** with `jobs.write`, without the §5 rule (decided in sql/123). Review whether that is still wanted once the stage people are in use.
   5. **The old file key `license-private.pem`** is still in the repository folder on Kevin's Mac (gitignored, not packaged, no longer trusted by the app since the YubiKey setup). Delete it or move it to offline storage.

## Agreed, not scheduled

1. **Show on each invoice when it was e-mailed, and when sending failed** (Kevin, 2026-11-09).
   - `send-invoices` already records both on the invoice (`sent_at`, `send_error`). Neither is shown today: the list shows only the status.
   - **On the invoice:** "E-mailed 9 Nov 14:07 to …", or "Sending failed 9 Nov 14:07: …" with the reason in plain words, and that the next hourly run tries again.
   - **In the list:** a mark on e-mailed invoices and on failed ones, and a filter for failed ones.
   - No database change. About half a day, desktop and phone.
