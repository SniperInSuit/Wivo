# Wivo — Handoff Notes

## Current version: 1.23.0

> **Migration rule:** never edit a migration that has already been run — an applied
> migration is history, and editing it changes nothing in the database. Add a new numbered
> file instead.
>
> **Process rule:** every change ships as a new version — bump `package.json` **and** add a
> `CHANGELOG.md` entry. The changelog is the audit trail.
>
> **Trust rule:** this app now holds money. Prefer a number that admits what it
> cannot see over one that looks complete and is wrong.

---

## Read this first: invariants and traps

Everything below was learned by breaking it. Each line is a decision that will
look arbitrary until the day someone undoes it.

### Storage and settings

- **`workTypeList()` must SPREAD the stored object, never rebuild it field by
  field.** It rebuilt from `nimi`/`hex`/`match` only between 1.7.13 and 1.17.0,
  silently deleting every field added to `WorkType` afterwards (`hind`,
  `soodushind`, `hinnaTyyp`, `pilt`, `kulud`) on every load. Prices survived a
  session and vanished on restart. **The same trap applies to any loader that
  normalises a stored shape** — normalise the fields that need it, spread the rest.
- `localStorage` is a **cache** for clinic settings, not the source of truth. It
  exists so the first paint is right and the app survives offline.
- A setter that changes a clinic-owned field must declare its column:
  `setSettings(fn, ['work_types'])`. Undeclared = local only, silently. When
  adding a settings field, decide clinic vs user and update `COLUMN_OF`.
- Writes send **only changed columns**. Pushing the whole row is how one person's
  calendar edit overwrites another's price change.
- Read work-type colours through **`useWorkTypes()`**, never by importing the
  config: the hook subscribes to the store, a direct import does not re-render
  when a colour changes.
- Work-type list ORDER is match order — "Implantkroon" must sit above "Kroon".
- `ClinicSettingsSync` keys on **`profile.clinic_id`**, never on the fetched
  clinic object. `fetchClinic` returning null made a failed request and "no
  clinic" indistinguishable, and one failed request disabled sync entirely.

### Money

- **Invoice lines COPY description and price at billing time.** Never re-derive a
  line from its job; an issued document must not restate itself.
- **`vat_rate` is stored ON the invoice.** Never read it from settings at render
  time, or a rate change restates every historical document.
- Invoice totals are computed by a **DB trigger** (`recalc_invoice_totals`). The
  client never writes `net_total` / `vat_total` / `gross_total`.
- Invoice numbers come from **`next_invoice_number(clinic)`**, which takes a row
  lock. Never number client-side — two workstations would pick the same one.
- **Default VAT is 0% and employer tax is 0%, deliberately.** The app must not
  assert a tax rate. Estonian rates as of mid-2026 were ~33.8% employer
  (33% sotsiaalmaks + 0.8% töötuskindlustus) and 24% VAT, but dental work has
  exemption questions — that is the owner's call with their accountant.
- Read job money through **`lib/jobPayments.ts`**, never from `makstud` alone —
  the flag cannot express a part payment. Jobs flagged paid *before* part
  payments existed have no rows, so the helper falls back to the flag. Keep that.
- A part payment writes a `payments` row but **must not** set `makstud`.
- Marking a job paid goes through `useMarkJobsPaid()` + `MarkPaidDialog`, so the
  method is recorded. The finance stats read the rows, not the flag.
- Instalment invoices are generated **up front** (n documents, dated monthly). Do
  not turn this into a recurring rule: nothing runs while a desktop app is
  closed. Only instalment 1 carries `job_id`, so a job is never billed twice.
- **Refunds / credit notes are OUT OF SCOPE** (owner's decision). The
  positive-only constraint on `payments.amount` is deliberate — do not "fix" it
  with negative rows.
- Only drafts can be deleted; issued invoices are cancelled (`tuhistatud`).

### Payroll

- `lib/earnings.ts` is the **single** implementation. The preview, the payout
  writer and the finance dashboard all call it, so what someone is shown and
  what they are paid cannot diverge.
- Payout lines are **copied** at payout time. Correct a wrong payout by deleting
  and redoing it — deleting returns its lines to the unpaid pool automatically.
- `RateKind` is a billing method ONLY (`tund | hammas | too | protsent | kuu`).
  Scope is `applies_to` (`too | disain | muudatus`). "Design" is a kind of work,
  not a way of paying for it.
- A revision-specific rule wins; `pay_revisions` on the job's rule is only the
  fallback when none exists. Rework is unpaid by default.
- Only work in the DONE stage earns. There are no negative lines anywhere in
  this system, so paying early would need a claw-back that does not exist.
- **`valmis_aeg` is a DEADLINE; `valmis_kuupaev` is when it was finished.**
  Payroll periods use the latter. Revisions carry their own in the JSONB.
- `profiles.toosuhe`: `tootaja` (gross wage, employer tax applies) vs `ettevote`
  (purchase invoice, **no** employer tax). Adding employer tax to a contractor's
  invoice invents a liability the clinic does not have.
- `diagnoseEarnings()` runs ALWAYS, not only when a total is zero — a partial
  result (4 jobs assigned, 1 line) looks identical to a correct one otherwise.

### Auth and people

- `useClinicProfiles` **must** filter on `clinic_id`. `profiles_read` lets any
  signed-in user select every profile in the project, so an unfiltered query
  offers removed people and other clinics' staff as assignable.
  Use `useProfileNames` only for labelling existing history.
- **Creating another user MUST go through `createSignupClient()`.** `signUp` on
  the main client signs the new user in and swaps the owner's session.
- Username login: `<username>@example.com` (override `VITE_USERNAME_DOMAIN`) is
  SYNTHETIC and must never be shown — use `displayIdentity()`. Do **not** use
  `.invalid` or `.local`: GoTrue rejects them outright. Consequence: those
  accounts cannot self-reset a password, and usernames are unique project-wide.
- `admin_set_worker_password()` and `admin_delete_worker()` are the **only**
  places that write to the `auth` schema (bcrypt via pgcrypto). Not a
  Supabase-supported interface — if a GoTrue upgrade breaks logins, check these
  first.
- Removing a worker UNLINKS the profile (`clinic_id = null`) and clears
  permissions; it cannot delete the account (needs `service_role`, which must
  never ship in a client). Permanent delete is refused if any history exists.

### UI

- **No bare `vh`/`vw` inside `#root`.** The UI scale is a CSS `zoom`, so viewport
  units are measured unzoomed and painted scaled — they overflow. Use
  `.h-panel` / `.max-w-dialog`, or divide by `--ui-scale`.
- Calendar mode/scale/"today" are lifted to `App` and rendered into
  `TopBar centerSlot`. The top bar takes a `ReactNode` slot so it stays ignorant
  of calendar concepts; any view can use it.
- Every total that depends on an optional field reports its **coverage**
  (`labourCoverage`, `materialCoverage`). Do not remove these to tidy the cards:
  a margin that silently ignores unassigned jobs reads as good news and is fiction.
- `lib/repriceJobs.ts` MIRRORS the job form's auto-calc. Change one, change both.

---

## What this session delivered (v1.7.9 → v1.23.0)

### Clinic settings → database (1.7.15)
Done before invoicing on purpose: invoices are built on these prices, and they
were per-machine localStorage. `sql/019`, `lib/clinicSettings.ts`,
`components/ClinicSettingsSync.tsx`. `PipelineContext` became a module store so
the sync layer can reach it.

### Invoicing and payments — Phase 4 (1.8.0, 1.21–1.23)
`invoices` / `invoice_lines` / `payments` / `invoice_counters`, Arved view, A4
print → system PDF, partial payments, payment methods everywhere "makstud" can be
set, instalment invoices, per-patient payment tracking.

### Worker pay — Phase 4b (1.9.0, 1.13–1.15, 1.19–1.20)
`worker_rates` / `work_hours` / `worker_payouts` / `worker_payout_lines`,
`jobs.assigned_to` + `designed_by`, the rules engine, automatic hours, employer
tax, employee-vs-contractor, `payroll.manage` delegation, password reset and
permanent delete.

### Financial statistics (1.10.0, 1.17.0)
`lib/finance.ts` + Statistika → Rahandus: revenue, labour, material, consumables,
margin, per-work-type margin, revision loss by reason, payment-method split.

### Pricing model (1.7.12–1.7.14, 1.11.0, 1.17.0)
Editable machines/materials/work types; per-job **or** per-tooth pricing;
discount prices; work-type images; consumable costs; bulk reprice.

### Calendar, UI, misc
Revisions on the calendar, text size (CSS zoom), filter popover with match
navigation, work-type colours settings-owned, calendar header moved to the top
bar, job-type card picker, bulk assignment in Tabel.

---

## Migrations to run (in order)

Supabase SQL editor, **Wivo closed**.

1–9. `sql/010` … `sql/018` — through Phase 3 (jobs fields, auth, clinics, RLS, permissions)
10. `019_clinic_settings.sql` — clinic config out of localStorage
11. `020_invoices.sql` — invoices, lines, payments, numbering
12. `021_legacy_payments.sql` — **OPTIONAL**, read its header first
13. `022_worker_pay.sql` — rates, hours, payouts
14. `023_material_costs.sql` — material cost (margin)
15. `024_worker_pay_scope.sql` — pay scope, auto hours, employer tax
16. `025_job_completed_date.sql` — `jobs.valmis_kuupaev`
17. `026_revision_pay_scope.sql` — revisions get their own rate
18. `027_payroll_permission.sql` — `payroll.manage` + `can_manage_payroll()`
19. `028_worker_engagement.sql` — `profiles.toosuhe`
20. `029_username_login.sql` — `profiles.username`
21. `030_reset_worker_password.sql` — owner sets a worker's password
22. `031_delete_worker.sql` — permanent delete, refused if history exists

**Supabase Auth settings:**
- Enable Email provider (Authentication → Providers → Email)
- **Disable "Confirm email"** — REQUIRED, not cosmetic. With it on, every worker
  signup mails a synthetic address and hits the built-in SMTP limit of a couple
  of messages per hour ("Email rate limit exceeded").
- Site URL: the Supabase project URL, not localhost

---

## Testing status

`Testing.md` holds the risk-ordered manual test plan.

Exercised by the owner so far: clinic settings sync, calendar, work types and
prices, payroll rules and the zero-earnings diagnostics, worker accounts and
removal. **Not yet exercised end to end:** invoice numbering under concurrency,
the print view on a real printer, instalment invoices, and the finance dashboard
against a full month of real data.

Everything in this session is typecheck- and build-clean only. None of it has run
against production volumes.

---

## What's next

### Open, in rough order of value
- **Payroll export for the accountant** — period totals per person, CSV. The
  payout data can currently only be read on screen.
- **Overheads** (rent, equipment, software) so the margin becomes profit rather
  than gross margin.
- **`pipeline.write` means nothing right now** — clinic settings are owner-only
  writes with no column-level policy. Either give it a proper policy or make
  pipeline editing owner-only honestly.
- Drag-to-assign on the board (bulk assign in Tabel already exists).
- Recurring monthly invoices per referring dentist rather than per patient.
- Move `kasutajaNimi` fully to `profiles`.

### Backlog
- Supabase email templates (branding, Estonian, custom SMTP)
- Calendar filter persistence
- Global search (Cmd+K)
- Deadline alerts / notifications

---

## Legal / compliance

- **Patient portal: REMOVED** — giving patients access to health data would
  classify as a Medical Device under EU MDR. Software stays staff-only.
- **GDPR Art. 9** — ravikaart, allergiad etc. are special category data. Auth +
  RLS protect them.
- **RLS is active** — every table is clinic-isolated. The anon key cannot read data.
- **MDR does NOT apply** — production tracking and invoicing for clinic staff is
  not a medical device.
- **Tax rates are the clinic's responsibility.** The app ships them at 0 and says
  so; it never guesses a rate on the owner's behalf.
