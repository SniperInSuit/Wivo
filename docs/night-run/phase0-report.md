# Phase 0 report: what exists and what is missing

The spec's Phase 0 acceptance asks for a written report. Each section below is
one Phase 0 item.

## 1. Migrations: a fresh database from `sql/`

**Result: passes.** All 68 migrations (`000` to `067`) apply in order on an
empty database, with no manual steps, in about 1.5 s. This is now a test
(`sql/test/freshDb.test.ts`) and runs with `npm test`.

How: there was no test database anywhere ("migrations are run by hand in the
Supabase editor and there is no test database to point at"). The replay runs in
PGlite with a shim for the Supabase parts. Details and limits: DECISIONS.md D3.

Findings:

- **Two migrations need a secret pasted in before they run.** `052_invoice_cron`
  and `056_fix_cron_key` stop with an error until `<SERVICE_ROLE_KEY>` is
  replaced. That is deliberate (a silent 401 every hour was worse), but it means
  a fresh database cannot be built "without manual steps" on a real project.
  The harness substitutes a fake key. A real fix (key set once by a setup step,
  not inside a migration) is listed in MORNING.md.
- **Both hard-code the production project URL**
  (`wrtucsfmpbwekugzzzxw.functions.supabase.co/send-invoices`). Run on the test
  project, they schedule an hourly call from the test database to the
  production function. With the test project's key it gets a 401, so nothing
  is sent, but it is noise in the production logs and a trap if keys are
  ever mixed up.
- **Ten migrations are not safe to paste twice.** They `create policy` without
  dropping first: 012, 014, 016, 017, 018, 019, 020, 022, 027, 035. Harmless
  on a fresh database (each runs once), but re-running one by hand on an
  existing database stops at the first policy. This is not a spec requirement,
  so it is a note, not a fix (old migrations cannot be edited).
- **The test suite is now fully green on Node 20.** Three test files had always
  failed at load ("native WebSocket not found") because supabase-js needs a
  global WebSocket. A test-only stand-in (`vitest.setup.ts`) fixed it: 47 tests
  that never ran now run, 974 in total.

## 2. RLS audit

**Result: every table has RLS, and every cross-tenant hole found is closed by
`sql/068_tenant_isolation.sql`.** Not yet applied to any real database (see
MORNING.md).

How: the policies were not just read, they were run. `sql/test/rlsTenantIsolation.test.ts`
builds two tenants (Tallinn, Riga) on the migrated database and, for EVERY
table in `public`, makes one Tallinn row and tries to read, update and delete
it as a Riga owner, a Riga worker and anon. A table added later is covered
automatically. `sql/test/securityAdvisor.test.ts` runs the Security Advisor's
catalogue lints (all ERROR-level ones plus two lower) as a test.

What was already right: all 23 tables had RLS and at least one policy, there
are no views, every `SECURITY DEFINER` function pins `search_path`, and 22 of
23 tables did not leak a row to the other tenant in the generic test.

Holes found (each was a failing test first):

| # | Hole | Severity on a shared project |
|---|---|---|
| 1 | `profiles_update_own` let a user change their own `role` and `clinic_id`. A worker could make themselves owner, or move into any clinic and read all of its jobs and patients. | Critical |
| 2 | `clinic_read` let every signed-in user read every clinic: name, address, registry code, IBAN. | High (business data) |
| 3 | jobs, patients, patient_teeth, visits, profiles: `or clinic_id is null` made orphan rows everybody's. `jobs_update` (and patients, visits) had no WITH CHECK, so a user could set their own row's clinic to null and publish it to every tenant. | High |
| 4 | The "removed workers" list was every user with no clinic on the whole project, and any owner could pull such a user into their clinic. | Medium |
| 5 | The clinic setup wizard claimed every orphan row for the new clinic. | High on a shared project, a no-op today |

Also fixed: a new clinic's founder stayed `worker` in it (only the very first
user on a database became owner), and three functions had no fixed
`search_path` (advisor WARN).

What 068 does to existing data: if the database has exactly one clinic (the
current production database), rows with no clinic are given to it and
previously removed workers are remembered as removed from it. With two or more
clinics nothing is guessed; a NOTICE reports how many orphans remain.

Not fixed tonight, noted: invoices, invoice lines, payments and customers are
tenant-isolated but not permission-checked (any member of the clinic can write
them). That is a within-tenant rule, not a leak, and changing it changes who
can invoice. It belongs with the permission model, not with this audit.

## 3. Five core protections

| Protection | State | Who |
|---|---|---|
| No service-role key in the app | **Verified.** `.env` holds only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; the only JWT in the built bundle decodes to `role: anon`; `service_role` appears in `src/` only in a comment explaining why it must not be there. The key is used only inside Edge Functions (`supabase/functions`). | Done |
| Network restrictions + SSL enforcement | Dashboard setting | Kevin (MORNING.md) |
| Dashboard MFA | Dashboard / account setting | Kevin (MORNING.md) |
| User MFA (TOTP) and leaked-password protection | Auth settings in the dashboard. The in-app enrolment for users is the Phase 1 item "MFA for all users". | Kevin (MORNING.md) |

Note on network restrictions: they limit direct Postgres connections only.
The app talks to PostgREST over HTTPS, so restricting the database to known IPs
does not affect it. The IPs to allow are yours and, later, the Hetzner backup VM.

## 4. Restore test with current data

Needs the production backup and the test project, both outside what this run
may touch. Exact steps are in MORNING.md. Today the restore is database-only:
the app stores no files in Supabase Storage yet (no `storage.from(...)` anywhere,
no buckets in `sql/`). Files join the restore test when Phase 1's `job_file`
goes live.
