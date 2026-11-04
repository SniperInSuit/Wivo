# Permissions: who sees money, who deletes, a technician's defaults

Built on `testing`: sql/102 and the app. Not applied anywhere yet.
Kevin applies the migration in the SQL Editor, test copy first (CLAUDE.md).

## The rule

A technician sees their own jobs and their own pay. They don't see the clinic's revenue or other people's pay.

- Owners and organisation admins (`org_role` owner or admin) keep full access.
- Everyone else has what the owner granted in Team.

In the database, `has_perm_or_admin(perm)` means `has_perm(perm)` (an owner has every permission) or an organisation admin. In the app, `decidePermission()` in `shared/permissions.ts` gives the same answer.

| Permission | Opens | Enforced by the database |
|---|---|---|
| `jobs.read` | all of the clinic's jobs (without it: own jobs only); Clients in the menu and clients' full details (**since 118**). Jobs and Table show without it, with the person's own jobs | yes |
| `jobs.write` | create and edit jobs (that it can see); add or change clients, together with `jobs.read` (since 118) | yes |
| `jobs.delete` **(new)** | delete a job, the list of deleted jobs, restore | yes; owners and admins always |
| `payments.read` | invoices, invoice lines, payments, payment plans; clients' full details for invoicing (since 118); every price and payment on screen | **yes, since 102**; owners and admins always |
| `payments.write` | make and change those; number an invoice; mark paid | **yes, since 102**; owners and admins always |
| `payroll.manage` | everyone's pay: rates, hours, payouts and pay and tax settings; the costs on a job; material costs | yes; pay and tax settings **since 117**. Owners always; admins only with this permission (Kevin, 2026-11-04: one rule for all pay data) |
| `stock.read` / `stock.write` | stock | yes |
| `patients.*`, `visits.*` | patients and calendar | patients: writing |
| `visits.write` | booking requests: reading, adding, changing, deleting; Requests in the menu | **yes, since 116**; owners and admins always |
| `stats.read` | Statistics in the menu | app only |
| `settings.read`, `pipeline.write` | (barely used) | – |

Own jobs and own pay need no permission: the database returns a person's own jobs and their own rates, hours and payouts.

## The menu

One rule for the desktop menu and the phone: `menuAllows()` in `shared/permissions.ts`.

- **Overview and Payroll:** everyone. They show the person's own numbers and own pay; Payroll shows everyone's with `payroll.manage`.
- **Jobs and Table:** every member of the clinic. The database returns a member's own jobs with no permission:
  - jobs where they are the technician or the designer;
  - jobs where they designed one of the work items.

  `jobs.read` widens this to every job, and `jobs.write` lets them edit the jobs they see. The phone's job lists follow the same rule.
- **Clients:** `jobs.read`. A client's page counts all of the clinic's work with them, so with only one's own jobs it would show the wrong counts.
- **The rest, each with its permission, as the database decides:**
  - Calendar: `visits.read`;
  - Requests: `visits.write`;
  - Patients: `patients.read`;
  - Invoices: `payments.read` (owners and admins always);
  - Statistics: `stats.read`;
  - Stock: `stock.read`.

What each default role sees in the menu:

| Role | Menu |
|---|---|
| Owner | everything |
| Technician with the defaults (`jobs.write`, `stock.read`, `stock.write`) | Overview, Jobs, Table, Payroll, Stock (own jobs only) |
| Organisation admin with the technician defaults | the technician's, plus Invoices |
| Member with nothing granted | Overview, Jobs, Table, Payroll (own jobs, read only) |

Tests: `shared/permissions.test.ts` (the menu for each role) and `sql/test/technicianJobs.test.ts` (what the database returns and lets them edit).

### Without `jobs.write`: read only

Someone who sees a job but lacks `jobs.write` sees it read only, on the desktop and the phone. Nothing is offered that the database would refuse:
- no "New job" and no CSV import;
- no dragging on the board and no stage arrows;
- no bulk stage or bulk assign in Table;
- no "Add job" on a calendar day;
- in the job: no Edit, no remake, no copy, no finished-date pencil and no cost overrides; notes can't be added or deleted;
- files can't be added, replaced or deleted. That includes attachments in the job's chat, the phone's camera and Unsorted → Attach, because an upload needs `jobs.write` (sql/072).

The job says why: "Read only: changing a job needs the permission Edit jobs". Comments in the job's chat stay open, because a comment isn't an edit.

Tests: `src/renderer/src/components/readOnlyJobs.test.tsx`.

## What sql/102 changes

1. **Money.**
   - `invoices`, `invoice_lines`, `payments` and `payment_plans`: reading needs `payments.read`, writing needs `payments.write`.
   - `invoice_counters` and `next_invoice_number()` need `payments.write`.
   - `recalc_invoice_totals()` is run only by the invoice-line trigger. Before this, it checked nothing.
2. **Customers.** Adding, changing or removing one needs `jobs.write`. Every member still reads them, because a job shows its customer. *Since sql/118: every member reads only a client's id and name; the rest, and changing clients, as in the sql/118 section.*
3. **Clinic settings.**
   - Every member reads these columns:
     - `work_types`, `visit_types`, `materials`, `material_prices`, `machines`, `pipeline_stages`;
     - `pricing`, used by the job form;
     - `calendar`;
     - `payroll`, the tax rates for their own payslip;
     - `features`.
   - The rest only through `clinic_settings_private()`:
     - `email`, `public_services`, `broneering` and `vestlus` for owners and admins;
     - `material_costs` for owners, admins and payroll managers (a job's cost lines).
   - `select *` is refused, so the app names its columns.
   - On a change from another machine, the app reads the settings again instead of trusting the realtime event.
   - On a computer where someone without access signs in, the cached material costs are blanked. The settings cache is per computer, not per person.
4. **Deleting a job** needs `jobs.delete` (it was `jobs.write`). So do the deleted-jobs list and restoring.
5. **A new technician** (an account made with the owner's invite) gets `jobs.write`, `stock.read` and `stock.write`. The list is `technician_permissions()` in the database and `TECHNICIAN_PRESET` in the app, and a test keeps them equal. Existing members keep what they have. Team → a member → **Technician defaults** sets that member to the same list, after asking first.

## In the app, on `payments.read`

These are the items you listed:
- Overview: the "Outstanding … of X € total value" card;
- Job: the "Price and payment" card (the pay card stays; it shows only the viewer's own pay);
- Statistics → Production: the Payments section, revenue by dentist and by work type, and the rush-job revenue line;
- Statistics: the whole Finance tab;
- Clients: the invoice counts.

These are extra, for the same reason. Without `payments.read` the database returns no payments, so these would show every job as unpaid or 0 €:
- the board cards' € badges;
- the job form's price block (hidden, the values are kept);
- in Table: the Price and Paid columns, the payment and debtor filters, and the price columns of the CSV export;
- the patient pages: invoices and payments, the price and paid columns of a patient's job history, "invoiced" and "unpaid" in the patient list.

Also gated:
- Clients: "New client" and editing need `jobs.write`.
- Deleting from the job panel and the table needs `jobs.delete`.
- The deleted-jobs list in Settings needs `jobs.delete`.
- "Mark paid" in the table needs `payments.write`.

## Before release: who handles invoices

When 102 runs on production, everyone who isn't an owner or admin and lacks `payments.read` loses invoices and payments, and every `jobs.write` holder loses deleting. So first, read-only on production:

```sql
-- Read-only. Every member: role, granted permissions, and what sql/102 will take away.
select c.name                                                             as organisation,
       p.full_name                                                        as member,
       p.id                                                               as member_id,
       p.role,
       p.org_role,
       coalesce(string_agg(wp.permission, ', ' order by wp.permission) filter (where wp.granted), '') as granted,
       p.role = 'owner' or p.org_role in ('owner', 'admin')               as full_access,
       coalesce(bool_or(wp.permission = 'payments.read'  and wp.granted), false) as payments_read,
       coalesce(bool_or(wp.permission = 'payments.write' and wp.granted), false) as payments_write,
       not (p.role = 'owner' or p.org_role in ('owner', 'admin'))
         and not coalesce(bool_or(wp.permission = 'payments.read' and wp.granted), false)  as loses_invoices,
       not (p.role = 'owner' or p.org_role in ('owner', 'admin'))
         and coalesce(bool_or(wp.permission = 'jobs.write' and wp.granted), false)         as loses_deleting
  from public.profiles p
  join public.clinics c on c.id = p.clinic_id
  left join public.worker_permissions wp on wp.profile_id = p.id and wp.clinic_id = p.clinic_id
 where p.role in ('owner', 'worker')
 group by c.name, p.id, p.full_name, p.role, p.org_role
 order by c.name, p.role desc, p.full_name;
```

For everyone with `loses_invoices = true` who handles invoices:
- grant `payments.read`, and `payments.write` if they make invoices or record payments;
- the clinic's owner can do it in Team today, because the current app already has both switches;
- or make that person an admin.

`jobs.delete` has no switch in the current app. After the release, grant it in Team to whoever must delete, or rely on owners and admins.

**Release order (production, in a session Kevin starts):**
1. Grant `payments.read` and `payments.write` as above.
2. Run sql/102 together with the release.
   - Old app builds read `clinic_settings` with `select *`, which 102 refuses; they keep their last local settings until they update.
   - Old builds also call `deleted_jobs()` and `restore_job()` with only `jobs.write`, which 102 refuses.

## On the test copy (Kevin)

1. In the SQL Editor, run `sql/102_money_permissions.sql`, then `notify pgrst, 'reload schema';` as a separate query.
2. Read-only checks:

   ```sql
   -- payments_select / payments_write etc. with has_perm_or_admin
   select tablename, policyname, cmd from pg_policies
    where schemaname = 'public' and tablename in ('invoices','invoice_lines','payments','payment_plans','invoice_counters','customers')
    order by 1, 2;
   -- false: a signed-in member can no longer select every column
   select has_table_privilege('authenticated', 'public.clinic_settings', 'select') as whole_row,
          has_column_privilege('authenticated', 'public.clinic_settings', 'email', 'select') as email,
          has_column_privilege('authenticated', 'public.clinic_settings', 'work_types', 'select') as work_types;
   -- only require_mfa_for_api()
   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute');
   ```

   The second query's expected answer is `false`, `false`, `true`.
3. Hand test with `npm run dev:test`:
   - **Tehnik**, with only the technician defaults:
     - no Outstanding card, no € on the board, no price card on a job, no Finance tab;
     - Payroll shows only Tehnik's own pay;
     - creating and editing a job work; deleting a job is not offered.
   - **A member with `payments.read`**: sees all of it; can't make an invoice.
   - **The owner and an admin:** everything, including Settings → e-mail and booking.
   - **Settings:** a price change on the owner's machine reaches a worker's machine. That is the realtime re-read.
   - **Team → Technician defaults:** after confirming, the switches show exactly the three permissions.

## sql/117: a colleague's pay and tax settings

Before sql/117, every member read every colleague's whole profile, former members included, and the desktop loaded it for every member (`select *`).

The five pay and tax fields on `profiles`:
- `toosuhe`: employment type;
- `tasu_arvestus`: pay basis, gross or net;
- `kogumispension_protsent`: pension percentage;
- `maksuvaba_tulu`: tax-free income;
- `kiirtoo_kordaja`: rush pay multiplier.

**Since sql/117:**
- **Column grants,** as sql/102 did for `clinic_settings`. A signed-in user reads every column of `profiles` except those five. That is what the app needs to show a colleague (name, username, role) and one's own settings.
  - `select *` is refused, so the app names its columns: `PROFILE_COLUMNS` in `lib/supabase.ts`.
  - A column added later stays hidden until it is granted.
- **`pay_settings()`** returns the five fields:
  - one's own, always;
  - for the owner and `payroll.manage`: everyone in the clinic, former members included. An admin needs `payroll.manage` too.

  This is Payroll's rule for rates, hours and payouts (`can_manage_payroll()`): one rule for all pay data (Kevin, 2026-11-04).
- **In the app,** `useClinicProfiles()` merges what `pay_settings()` returns into the profile list. So the desktop loads another person's pay settings only for someone who does payroll.
  - On a database without sql/117, it reads them from the table as before, so payroll keeps its numbers until the migration is applied.
- **Writing is unchanged:** one's own row; the owner, anyone in the clinic.
- **Not covered by sql/117:** a colleague's `language`, notification switches and `ui_prefs` (dashboard layout) stay readable. They aren't pay or tax fields, and one's own must stay readable from the table before the second factor (sql/098 lets only that read through).

Tests:
- `sql/test/profilePay.test.ts`;
- `src/renderer/src/lib/paySettings.test.ts`, which includes a scan that fails if any code reads `profiles` with `*` or reads a pay or tax field from the table.

## Deliberate choices (Kevin, 2026-11-04)

Every member can read these, on purpose:

- **Patient names on jobs.** Anyone who sees a job sees its patient's name (`jobs.patsient`) and patient link, without `patients.read`. For a technician that means their own jobs; with `jobs.read`, every job.
  - The board and the job need the name to tell the work apart.
  - `patients.read` covers the patient record itself: contacts, medical card, history, tooth chart.
- **Price lists in the clinic's settings** (`clinic_settings`: `work_types`, `materials`, `material_prices`, `pricing`). The job form needs them to price a job (sql/102).
- **Partnerships** (`partnership`): who the clinic works with, the status, the data-processing agreement reference. A shared job shows its partner.

## sql/118: a client's details only with View jobs or View payments

Before sql/118, every member read every client of the clinic whole. A job needs only to show its client's name.

**Since sql/118:**
- **Column grants,** as sql/102 and sql/117. A signed-in user reads `id`, `clinic_id`, `name` and `archived_at` of the clinic's clients. That is what the job form, the wizard, Table and Statistics show.
  - `select *` is refused.
  - A column added later stays hidden until it is granted.
- **`customers_full()`** returns the clinic's clients whole, to `jobs.read` (the Clients page) or `payments.read` (invoices), and to owners and admins always. The whole client means:
  - contact person, e-mail, CC addresses and phone;
  - address, registry code and VAT number;
  - notes, special prices and payment terms;
  - billing mode.
- **Changing clients** (add, change, archive, delete) needs `jobs.write` and `jobs.read`, which is the Clients page; admins can always. Before, `jobs.write` alone was enough through the API.
- **In the app,** `useCustomers()` reads whole rows only for `jobs.read` or `payments.read`. Everyone else gets `id`, `name` and archived (`lib/customersRead.ts`).
  - On a database without sql/118, it reads the table as before.
  - Saving a client no longer reads the row back.
- **Unaffected:**
  - the invoice e-mails (Edge Function `send-invoices`) read the client's address with the service key;
  - `price_overrides` is in no pricing code, so hiding it changes no price.

Tests:
- `sql/test/customersAccess.test.ts`;
- `src/renderer/src/lib/customersRead.test.ts`, which includes a scan that fails if any code reads a client's details from the table;
- `sql/test/moneyPermissions.test.ts`, updated for the write rule.

## Releasing sql/117 and sql/118

Builds before 2.1 read `profiles` and `customers` with `select *`, which these migrations refuse. On such a build, the person's profile doesn't load at sign-in.

sql/102 already did the same to `clinic_settings`. So on production:
- apply 102–118 together with publishing 2.1;
- set the minimum version to 2.1 (docs/MIN-VERSION.md), so desktops update and the phone reloads.

## Later release, not in 2.1: money on jobs and shares

Kevin, 2026-11-04: not in 2.1; its own release later. Until then it is a known gap (below).

**What:** a job's money fields are readable only with `payments.read` (owners and admins always) or `payroll.manage`. They are:
- `hind` (price), `disain_hind` (design price), `makstud` (paid) and `makse_kuupaev` (payment date);
- the prices inside `extras`;
- `extra_costs` and `kulu_yle` (cost overrides);
- each remake's `price` and `extra_costs` inside `revisions`;
- a share's `partner_price` (`job_share`).

**How (recommended): a separate table, `job_money`.**
- One row per job: `job_id`, `org_id`, the fields above, and the remakes' prices keyed by remake id.
- Its access rules: read with `payments.read` or `payroll.manage`; write with `payments.write`, or `jobs.write` for the price a job is created with (below).
- It gets the second-factor policy and a leak test, like every new table.
- `jobs`, `revisions` and `job_share` keep no money.

**Why not the other two ways:**
- **Column grants** (sql/102, sql/117) can't reach money inside JSON. A remake's price is inside `revisions`, and an extra's price inside `extras`, next to what everyone must see.
- **A view** that blanks the money would have to repeat every access rule of `jobs`. The app's live updates (Supabase realtime) don't work on views.

**What it breaks, and what has to change with it:**
1. **A technician's own pay.** A pay rule can be a percentage of the job price (`kind = 'protsent'`). The app works out a technician's own pay from that price, on the job's pay card and in Payroll. Without the price, the figure is wrong.
   - Fix: the database works out each person's own pay per job, and returns the amount, not the price.
2. **Pricing a new job.** The job form and the wizard work out the price in the app, and a technician with `jobs.write` sends it.
   - Fix: a trigger prices the job from the clinic's price list when it is created or its work changes. Then nobody without `payments.read` sends or reads a price.
   - Optionally, the price lists then join the private settings.
3. **Every screen and export that reads money from the job row moves to `job_money`.** That covers:
   - the board's € badges;
   - the job form's price block and the pay and cost cards;
   - Table's price and paid columns, filters and CSV;
   - the patient pages, Statistics and Finance;
   - invoicing (lines are made from job prices);
   - remake repricing and Payroll.
4. **Live updates:** screens that show money also listen to `job_money`.
5. **Older app builds** read money from `jobs` and would show no prices. The minimum version (docs/MIN-VERSION.md) goes up with this release.
6. **Moving the data:** one migration copies every job's money into `job_money` and empties it on `jobs`, test copy first. It's the biggest data move since the restore, so the read-only checks compare totals before and after.
7. **Partners:** they still see no price except their own price on a share, through the partner view.

**Size:** the largest change in this list: one migration with a data move, the pricing trigger, the server-side pay, and every money screen. Its own release.

## Known gaps (for the pentest)

What the database still lets a member read beyond what the menu and permissions suggest, on purpose for now:

1. **Money on jobs and shares** (planned above, not in 2.1). Anyone who sees a job reads its money through the API, even without `payments.read`:
   - price, design price, paid and payment date;
   - extras with prices, extra costs and cost overrides;
   - remake prices.

   Every member reads each share's partner price.
2. **A colleague's `language`, notification switches and `ui_prefs`** (dashboard layout), on `profiles`. They aren't pay or tax fields, and one's own must stay readable before the second factor (sql/117).
3. **The owner-rights functions** have not been checked one by one (next section).

## For the pentest (prompt 22): the owner-rights functions need their own pass

The checks so far (docs/AUDIT.md, sql/114–117, this file) cover each table's access rules: what a member can read with `select`.

**Database functions that run with the owner's rights** (`security definer`) don't go through those rules. Each one decides for itself whom it answers. 85 of them can be called by a signed-in user (read-only, on a database built from the migrations):

```sql
select p.proname, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
   and has_function_privilege('authenticated', p.oid, 'execute')
   and pg_get_function_result(p.oid) <> 'trigger'
 order by 1;
```

**The pentest also tries each known gap above, as a member without the permission.**

**The pentest checks each one against the permission it should need,** as a member without that permission, as another clinic and as a partner.

**First, the ones that return data,** because they can hand over rows that the tables' rules would refuse:

| Kind | Functions |
|---|---|
| Audit | `audit_entries`, `audit_search`, `audit_people` |
| Jobs and files | `deleted_jobs`, `job_files`, `job_file_name`, `job_thread`, `open_questions`, `request_job_previews`, `request_file_download` |
| Patients | `patient_export` |
| Partners and stock | `open_partner_job`, `partner_jobs`, `partner_orgs`, `partner_stock`, `preview_partnership_invite` |
| People and settings | `team_accounts`, `pay_settings`, `clinic_settings_private`, `app_min_version_for_me` |
| Writers that return a row | `register_job_file`, `submit_bug_report` |

**Then the writers:** that each refuses whom it should, for example `share_job`, `move_job_stage`, `admin_set_worker_password` and the stock functions.
