# Decisions made during the night run

Each entry: what was ambiguous, what I chose, and why. Where the spec's open
questions give a default, I used it.

## D1. Run documents live in `docs/night-run/`

The instructions file is at `docs/night_run/INSTRUCTIONS.md` (underscore), but
it names `docs/night-run/` (hyphen) for PROGRESS, DECISIONS, MORNING and the
chat inventory. I followed the names given in the instructions and left the
instructions file where it is.

## D2. Commits go on `main`

"Work only on the current branch." The current branch is `main`, which is also
where every release so far has been committed. Nothing is pushed.

## D3. No Docker, Supabase CLI or Postgres on this machine → PGlite

"Fresh database from the migrations on local Supabase" cannot run here: there is
no Docker, no Supabase CLI and no Postgres binary, and installing system
software is outside what an unattended run should do. Instead the migrations
are replayed into **PGlite** (`@electric-sql/pglite`, real Postgres compiled to
WASM, runs inside Node/vitest, no server, nothing left running).

Supabase-specific pieces are provided by a small shim loaded before `sql/000`:
the `anon` / `authenticated` / `service_role` roles, `auth.users`,
`auth.uid()` / `auth.jwt()` / `auth.role()` reading the same
`request.jwt.claims` setting PostgREST sets, a minimal `storage` schema, the
`supabase_realtime` publication, and stubs for `pg_cron` and `pg_net`, which
PGlite does not have. The harness switches role and claims per query, so RLS
is tested as a real `authenticated` user, not as the superuser.

What this proves: every migration applies, in order, on an empty database, with
no manual steps, and RLS behaves as written. What it does not prove: anything
about Supabase's own services (Auth e-mails, Storage HTTP, Realtime delivery),
or the live database. The live/test-project run is listed in MORNING.md.

New dev dependency: `@electric-sql/pglite`. Test-only; it is not bundled.

## D4. The v1.109.0 inline pairs did not meet the spec; converted to keys

v1.109.0 (same day) shipped `t('Salvesta', 'Save')`: Estonian first, both
languages inline. The spec's locked language rules and CLAUDE.md require i18n
KEYS, English as the source language, Estonian and Russian as translations,
and English as the fallback. Locked decisions win, so every call was converted.

## D5. How: a one-off AST codemod, not hand edits

3,134 calls in 153 files. A TypeScript-AST codemod turned each pair into a key
plus catalog entries: plain text → `"…"`; templates with data only →
`"… {name} …"` with the values passed as params; templates whose WORDING
depends on a value (124 plurals and conditionals) → a function message per
language, `({ n }: Params) => …`, so each language keeps its own plural rule.
Two dynamic calls (revision reasons, debt-bucket unit) were rewritten by hand.

Proof it changed nothing visible: the typecheck accepts every key (keys are
typed), and the existing 1,007 tests — many of which assert exact Estonian
output — pass unchanged, because Estonian is still the default.

Key names are `namespace.camelCaseOfTheEnglish`, generated. They are ugly in
places (`settingsPage.d`), but they are stable ids, not prose: renaming 2,700
keys by hand at night would be risk for no user-visible gain.

## D6. Russian: catalog exists and falls back to English; not offered in the switch yet

Spec open question default: "launch in English, Russian within the first
month". `shared/i18n/ru.ts` exists and is wired; every key falls back to
English. The language switch offers only Eesti / English until there is Russian
to show — offering "Русский" that displays English would look broken.

## D7. Default language stays Estonian until organisations exist

With nothing chosen, the app shows Estonian (`DEFAULT_LANG`), because the only
organisation that exists today works in it. The spec makes the default the
organisation's own; that needs `organization.default_language` (Phase 1).

## D8. Documents are keyed too, but render in the document's language

The invoice print view and the patient-portal preview in Settings show text
the RECIPIENT reads. They now use keys (`invoiceDoc.*`, `publicServices.*`)
rendered with `translate('et', …)` instead of the interface language, per the
spec's "language and country rules are separate". E-mail templates, CSV export
headers and invoice line descriptions still hold Estonian literals: they are not
interface text, they are content with its own language, and moving them is a
separate job (noted in MORNING.md).

## D9. `organization` = the existing `clinics` table; `org_member` = `profiles`

The spec asks for `organization` and `org_member`, "exact names and types to
fit the existing schema", and existing data under the Tallinn organisation.
`clinics` already IS the tenant: every row in every table hangs off
`clinic_id`, every policy goes through `my_clinic_id()`, and `profiles.clinic_id`
already means "one user belongs to one organisation". A second tenant table
would mean migrating every row and rewriting every policy, the riskiest change
possible, for a name.

So: `clinics` gets `country`, `default_language`, `home_instance`
(globally unique UUIDs were already the ids) and `code_prefix`; `profiles` gets
`org_role` (owner, admin, doctor, technician, assistant) and `language`. Views
named `organization` and `org_member` expose them under the spec's names, with
the caller's rights. New tables use the column name `org_id` (spec), which
references `clinics(id)`. The existing Tallinn clinic row is the Tallinn
organisation; no data moves.

## D10. Job codes

The spec relies on a "job code" (partner search, file names, e-mails with
"only the code and a link") that did not exist. Added `jobs.job_code`:
`<org prefix>-<yy>-<number>` (e.g. `TAL-26-0042`), numbered per organisation per
year, set on insert and backfilled for existing jobs in creation order. The
prefix is unique per organisation, so a code is unique across partners.

## D11. Partnership approval and MFA

Every partnership step requires an org admin (owner or `org_role` admin) signed
in WITH MFA (`aal2` in the JWT), on both sides — the spec says it for the
inviter; requiring it of both is the conservative reading. Until users have MFA
(Phase 1 item), invites cannot be created: the UI says so.
"Initially a Wivo admin also confirms" is `platform_approve_partnership(id)`,
executable only by the service role / SQL editor (there is no admin console yet,
Phase 3). Steps in MORNING.md.

## D12. MFA built before Files, out of the spec's listed order

The spec lists "MFA for all users" late in Phase 1, but the partnership steps
(early in Phase 1) require an admin signed in with MFA. Without MFA in the app,
no partnership could ever be created. So MFA was built right after the
partnership screens.

How "for all users" is enforced: after sign-in, a user with no authenticator
must enrol one before the app opens; a user with one must enter a code
(Supabase aal2). If the project does not have TOTP enabled yet, the app lets
people in rather than locking everyone out, and says so. Turning TOTP on is in
MORNING.md. Database-level enforcement on every table (a restrictive aal2
policy) would lock out everyone who has not enrolled at the moment it is
applied, so it is not in a migration tonight; partnership and admin RPCs
already require aal2 in the database.

## D13. Sentry: @sentry/electron 5.12.0, off without a DSN

New dependency for the spec's "Sentry in Electron". 5.12 rather than the
latest 8.x: 5.x is the line whose support for Electron 32 (this app) is
established; moving to 8.x belongs with the next Electron upgrade.
Both processes initialise it only when a DSN is set at BUILD time
(`MAIN_VITE_SENTRY_DSN`, `VITE_SENTRY_DSN`); without one, Vite removes the
import and the build contains no Sentry code (checked in the output).
Every event and breadcrumb goes through `shared/privacy/scrub.ts` first:
user, request bodies, `extra`, stack-frame variables, console and typed-input
breadcrumbs are dropped; URLs lose their query strings (Supabase filters live
there); text loses e-mails, phone numbers and personal codes. The bug report's
"recent errors" use the same scrubber.
