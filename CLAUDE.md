# Wivo (Workly repo)

Electron + React + TypeScript desktop app with a Supabase/Postgres backend.

## Read first
- wivo-2.0-spec.md: Wivo 2.0 build plan (in Estonian). Its locked decisions are final.
- docs/VISION.md: the long-term product vision (consultation to procedure day), its build order and its locked rules.
- HANDOFF.md, NEXT.md, Testing.md: current state and testing notes.
- docs/night-run/INSTRUCTIONS.md: rules for unattended runs.

## Branches
- `main` = production: the desktop release, the phone app at app.wivodent.com (Cloudflare Pages project `wivo`) and the production database. A push to `main` with a new version in package.json publishes the desktop update to every machine (.github/workflows/build.yml).
- `testing` = the test site wivo-test.pages.dev (Cloudflare Pages project `wivo-test`) and the test copy database.
- **Only these two branches.** No hotfix-*, release-* or other branches, and no worktrees.
- **A small fix with no database change:** make it directly on `main`, then cherry-pick it onto `testing`. Leave the folder on `main` and tell Kevin "ready to push main". After Kevin has pushed, switch the folder back to `testing`.
- **Anything with a migration:** only on `testing`, tested on the test copy, and released later by merging `testing` into `main`.
- **A release:** the version bump in package.json is the last commit on `main`. A push to `main` without a version bump updates the phone app (Cloudflare) but not the desktop.
- **Kevin does every push.** Claude never pushes.
- **Every `supabase` command gets `--project-ref`.** There is no default project: never run `supabase link`. (Until the commit that stops tracking `supabase/.temp` reaches `main`, checking out `main` puts production's ref back in `supabase/.temp/project-ref`.)
- Only a push to `main` runs GitHub Actions. Cloudflare Pages is set in its dashboard, not in this repo: `wivo-test` must have `testing` as its production branch, and `wivo` must not build preview deployments of other branches (a preview of `wivo` would run with production's settings).

## Rules
- Migrations are numbered SQL files in sql/ (next one is 113_...). Only add new files. Never edit or delete existing ones. A migration that changes the schema also regenerates the read-only check (sql/checks/, `WRITE_SCHEMA_CHECK=1 npx vitest run --mode unit sql/test/schemaCheck.test.ts`); sql/test/schemaCheck.test.ts fails until it does.
- Every new table gets org_id and RLS in the same migration, plus an RLS leak test, and ends with `select public.ensure_mfa_policies();` (sql/098: nothing without the second factor; sql/test/requireMfa.test.ts fails for a table without it).
- Every migration that adds a function ends with `select public.lock_anon_functions();` (sql/101: the anon key runs nothing but `require_mfa_for_api()`; a function that must run before sign-in goes into `anon_allowed_functions()` with the reason; sql/test/anonFunctions.test.ts fails otherwise).
- The app uses only the anon key. The service-role key lives only in Edge Functions.
- Every request from the app carries `x-wivo-version` (docs/MIN-VERSION.md). An Edge Function the app calls allows it in its CORS headers (`APP_ALLOWED_HEADERS`) and passes it on when it calls the database as the user (`callerVersionHeaders`); `supabase/functions/_shared/appVersion.test.ts` fails otherwise. A database function that only reads is declared `stable`: a `volatile` one counts as a save and is refused to builds below the minimum.
- Every export leaves an audit entry before the file is made (sql/106): a CSV goes through `auditedCsvExport` (lib/exportAudit), recording the row count and the filters in use, never the rows; free text and names only as "set". `lib/exportAudit.test.ts` fails for a screen that makes a CSV any other way.
- Never tell people using Wivo to run SQL: no screen or message names a migration file, the SQL editor or a database command. A database that lacks something gets a neutral message (`app.notAvailableYet`, `app.contactSupport`); `shared/i18n/noSqlInstructions.test.ts` fails otherwise.
- All UI text goes through i18n keys. English is the source language, Estonian and Russian are translations.
- Everyday work never connects to the production Supabase project: local Supabase, the PGlite tests or a test copy only.
- Test mode (`npm run dev:test`, `config/test-copy.env`: tracked, the test copy's URL and public anon key only, never a secret; config/testCopyEnv.test.ts fails otherwise) accepts only the test copy, by its ID (`TEST_REF`), and refuses production by its ID (`PRODUCTION_REF`), both hard-coded in src/renderer/src/lib/testCopy.ts; every request to any other Supabase address is refused before it is sent, and test mode keeps its own session and userData folder. If either project ever changes, update its ID in the same change.
- Production changes happen only in a session Kevin explicitly starts for that purpose. Everything is tested on a test copy first.
- Until automated migrations exist (docs/MIGRATIONS.md), Kevin applies every migration himself in the Supabase SQL Editor, in order: the test copy first, production later. Claude writes the migration, the exact steps and the read-only checks, and never connects to the test copy or production, nor sets up a connection to either.
- Never push, merge or force anything.
- Wivo is not a medical device: no feature may recommend or rank treatment based on patient data.
- No personal data crosses borders between clinics (lawyer's locked decision). A partner organisation sees only job information, never who the patient is: no name, personal code, contacts, birth date, medical card, visit notes or prices, through any view, RPC, file, notification or e-mail. Full visibility is off (sql/092); free text a partner reads may not name the patient.
