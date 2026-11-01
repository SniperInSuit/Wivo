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
