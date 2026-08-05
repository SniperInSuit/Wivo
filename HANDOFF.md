# Wivo — Handoff Notes

## Current version: 1.30.0

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

- Revision reasons are a LIST (`reasons`), read through `revisionReasons()` —
  never `rev.reason`, which is the pre-1.24.0 shape kept only for reading. In
  stats: COUNT each reason, but SPLIT money between them, or a revision with two
  causes doubles the loss total.
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

### Pricing

- **`shared/pricing/quote.ts` is the ONLY implementation.** The job form, the
  repricer and (later) the web order form all call `quoteJob()`. This replaced
  two copies that had already drifted: with `hambaHind = 0` the form stamped
  **0 €** and the repricer refused. Refusing is right — see the Trust rule.
- Build the price book with **`priceBookOf()`**, never by hand. Two callers
  assembling it themselves is the same divergence through the back door.
- **Every work item is priced separately.** Both old copies read the
  denormalised `too`/`hambad`, so 10 crowns + 4 bridges was quoted as one type
  across 14 teeth. A job with no `work_items` yields one legacy item and is
  quoted exactly as before.
- `quote.unpriced` non-empty means **do not write a price**. `production` still
  holds what could be worked out, for display only.
- Anything in `shared/` has **zero dependencies** — no React, no Supabase, no
  npm. That is what lets a Deno edge function, a browser and the Electron main
  process all import it. `main`/`preload` use a RELATIVE path, not `@shared`
  (the alias is renderer-only); relative imports bundle fine. The rule that
  matters is the zero-dependency one: an npm dependency in `shared/` would be
  externalised out of the packaged main bundle by `externalizeDepsPlugin()` and
  crash at require time.
- `npm test` runs the quote tests. They exist because this code handles money.

### Auth and people

- `useClinicProfiles` **must** filter on `clinic_id`. Belt and braces: since
  `sql/034` the `profiles_read` policy is clinic-scoped too, but the client
  filter also excludes removed people (clinic_id null), whom the policy still
  allows so history keeps its names.
  Use `useProfileNames` only for labelling existing history.
- **Do not enable Supabase anonymous sign-in.** It mints a real `auth.uid()`,
  and `handle_new_user()` would accumulate junk `profiles` rows for every
  visitor. Public surfaces go through an edge function holding the service key,
  never through an anon session.
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

- **`__APP_VERSION__` is a BUILD-TIME constant and goes stale in dev.** Never show
  it as "the app's version" — use `useAppVersion().running`, which reads
  package.json through the preload bridge on every check. The stale constant sent
  debugging down the wrong path twice; that is why the sidebar no longer uses it.
- The update toast compares the version captured at boot against the file on
  disk. It is NOT an auto-updater — nothing is downloaded.
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

## WivoLab — the repositioning (v1.26 → v1.30)

The product narrowed from solo-clinic management back to its original idea:
**workflow management for a dental LABORATORY**. A clinic-side product
(WivoDental) comes later and the two connect. The full plan, including pricing
and the competitive read, is at
`~/.claude/plans/task-notification-task-id-bpqvowmnm-tas-parsed-spring.md`.

### Delivered

**Faas 0 — one price engine, four money bugs (1.27.0)**
`shared/pricing/` now holds the only implementation. Fixed: `extras` reaching no
total anywhere, `toRow()` dropping `fixedCostsPerJob`/`lisateenused`, the two
copies disagreeing at `hambaHind = 0`, `work_items` never being priced, and
`profiles_read` being project-wide.

**Faas 1 — customers and B2B invoicing (1.28.0)**
`customers` table, jobs carry a customer + the practice's own reference +
delivery status, invoices can be addressed to a customer, and the clinical half
went behind a flag.

**Licensing (1.29.0)** — Ed25519, offline, 14-day grace.

**Exports and overheads (1.30.0)** — CSV out of every list, monthly overheads.

### Migrations to run, in order

Supabase SQL editor, **Wivo closed**. Everything through `033` was already run.

23. `034_profiles_read_scope.sql` — `profiles_read` scoped to the caller's clinic
24. `035_customers.sql` — customers, `jobs.customer_id`/`customer_ref`/`delivery_status`, `invoices.customer_id`/`bill_to_kind`
25. `036_customers_realtime.sql` — **run alone**, see the deadlock note in the file
26. `037_features.sql` — `clinic_settings.features`

Each file ends with a verification query. Run them.

---

## Licensing — what you have to do

`LICENCE_PUBLIC_KEY` in `src/main/license.ts` is **set**, so this build enforces
licensing. `license-private.pem` is in the repo root, gitignored, mode 600.
**Back it up.** Losing it means every key you have issued stops verifying the
moment you ship a build with a different public key.

Issue a key:
```
node scripts/make-license.mjs sign --name "Labor OÜ" --plan labor --months 12
```

A five-year Labor+ key for this machine was already issued and should be pasted
into Seaded → Litsents. Without a key the app is read-only.

Enforcement is one line in `usePermissions().can()`: every `.write` permission
and `payroll.manage` return false once the grace window closes. **Any future
write path that does not ask `can()` will not be gated** — that is the trade for
having it in one place instead of forty.

---

## What's next

### Immediately outstanding
- **Run the four migrations above.** Nothing from 1.27–1.30 works fully without
  them. The app will show empty customer lists and fail on `features` reads.
- **Run Seaded → Hinnad → tööde ümberhindamine in PREVIEW** against real data.
  Mixed-work-item jobs get a different price now (the sum of their items rather
  than one type across all teeth). Review before writing. Issued invoices are
  safe by construction — their lines are copies.
- **Enter overheads** (Seaded → Hinnad → Üldkulud kuus) or Rahandus keeps
  reporting contribution rather than profit, correctly labelled but less useful.

### Faas 2 — public job-status link
Design is in the plan. **Supabase Pro is NOT required for this**, contrary to an
earlier draft: Edge Functions, `pg_cron` and `pg_net` are all on the free tier.
Pro is only needed for Faas 4's file uploads (1 GB free vanishes in a week of
real scans). The free tier's one real risk is a project pausing after 7 idle
days — irrelevant for a lab using the app daily.

You will still need: a Cloudflare account, a domain, and the Supabase CLI (for
`functions deploy` and `secrets set` ONLY — never `db push`, which would want to
take ownership of the 37 hand-run files in `sql/`).

### Smaller, no external setup
- Customers from the free-text `patients.kliinik` field — a one-off import with
  a preview, same shape as `RepriceJobsSection`. Not built; worth it only if
  those names are actually populated in your data.
- i18n. Every string is Estonian, inline. Blocks the Baltics.
- Job attachments. No file storage exists at all yet.

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
