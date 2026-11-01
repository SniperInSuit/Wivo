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
