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
| `jobs.read` | all of the clinic's jobs (without it: own jobs only); Jobs, Table and Clients in the menu | yes |
| `jobs.write` | create and edit jobs (that it can see); add or change customers | yes |
| `jobs.delete` **(new)** | delete a job, the list of deleted jobs, restore | yes; owners and admins always |
| `payments.read` | invoices, invoice lines, payments, payment plans; every price and payment on screen | **yes, since 102**; owners and admins always |
| `payments.write` | make and change those; number an invoice; mark paid | **yes, since 102**; owners and admins always |
| `payroll.manage` | everyone's pay; the costs on a job; material costs | yes |
| `stock.read` / `stock.write` | stock | yes |
| `patients.*`, `visits.*` | patients and calendar | patients: writing |
| `stats.read` | Statistics in the menu | app only |
| `settings.read`, `pipeline.write` | (barely used) | – |

Own jobs and own pay need no permission: the database returns a person's own jobs and their own rates, hours and payouts.

## What sql/102 changes

1. **Money.**
   - `invoices`, `invoice_lines`, `payments` and `payment_plans`: reading needs `payments.read`, writing needs `payments.write`.
   - `invoice_counters` and `next_invoice_number()` need `payments.write`.
   - `recalc_invoice_totals()` is run only by the invoice-line trigger. Before this, it checked nothing.
2. **Customers.** Adding, changing or removing one needs `jobs.write`. Every member still reads them, because a job shows its customer.
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

## Later, not built: prices on the job row

Even with all of the above, a technician who reads their own job through the API sees its price. These fields live on the job row:
- `hind`, `disain_hind`, `extras` (with prices);
- the revisions' `price` inside `revisions`;
- `makstud` and `makse_kuupaev`.

Realtime sends them too. The price list a technician needs to create a job (`work_types`, `material_prices`, `pricing`) is readable by every member as well.

To hide them:
1. **Move the money fields off the job row**: a `job_price` table (one row per job, `org_id`, RLS on `payments.read`, MFA policy, leak test). Or keep them on the row with column privileges for `authenticated`, plus a security-definer read for `payments.read`.
2. **Price on the server**: a trigger works out the price from the price list when a job is created or its work changes. Then a technician with `jobs.write` never sends or reads a price, and `pricing`, `material_prices` and the prices inside `work_types` can join the private settings.
3. **App**: the job form, the wizard's price summary, the board and every export read prices only through the new path.
4. **Partners already see no price** (`partner_job_view`); keep it that way.

This touches the job form, the wizard, the board, invoicing (invoice lines are made from job prices) and the payroll rules that use prices. It's its own change, with its own migration and tests.
