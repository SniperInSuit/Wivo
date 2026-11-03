# Automatic database migrations: the plan

Status: **plan only, nothing built.** Written on 3 November 2026, on branch `testing`, after migration 097. Kevin reads this before anything is built. Claude never connects to production. Every command below that touches a real project is run by Kevin, or by GitHub Actions after Kevin approves.

**The goal:**
- A push to `testing` applies new migrations to the test copy by itself, then deploys the Edge Functions.
- A release on `main` waits for Kevin to press **Approve** in GitHub. Then it applies the migrations to production and deploys the functions.
- Only after that succeeds are the desktop update and the phone app published.
- Nobody pastes SQL by hand again.

---

## 0. Where things are today

- **98 hand-pasted SQL files** (`sql/000`–`sql/097`).
  - No database records which ones ran.
  - Settings → Database guesses by probing columns, and its list stops at 064.
  - Production got them out of order: 000–082, then 083 and 084, then 088–091, then 085–087 (RUN-3).
  - 092–097 exist only on `testing`. Which of them the test copy has is not written down anywhere: the comparison in step 1 will show it.
- **The test copy drifted once already.** After a restore it lacked 12 triggers and the Storage policies (RUN-3). The policies were re-applied; whether the triggers were is not recorded. It also lacked foreign keys (found 2026-11-03: none on `invoices` or `invoice_lines`, so PostgREST could not embed lines in invoices); `sql/107` puts back every foreign key the migrations define and changes nothing where they exist.
- **Some things live outside the `public` schema**, so a plain schema dump of `public` misses them:
  - 3 Storage policies and 2 buckets (sql/072, 073, 079);
  - the `on_auth_user_created` trigger on `auth.users` (sql/012);
  - 16 tables in the `supabase_realtime` publication;
  - 4 cron jobs (sql/052, 059, 067, 077);
  - the extensions `pgcrypto`, `pg_cron` and `pg_net`;
  - the Vault secrets `wivo_service_role_key` and `wivo_functions_url`.
- **sql/052 writes production's functions URL into the invoice cron job.** sql/052 and sql/056 put a key into Vault. Neither may be replayed anywhere as it is.
- **CI:** `.github/workflows/build.yml` runs only on a push to `main`. It ignores `sql/**` and `*.md`, builds the desktop app, and publishes it when the version in `package.json` changed. No tests run in CI.
- **The phone app** is built by Cloudflare Pages itself from Git:
  - `wivo` builds from `main`, at app.wivodent.com;
  - `wivo-test` builds from `testing`.
  - Nothing in GitHub can make it wait for the database.
- **Edge Functions** are deployed by hand: `send-notifications`, `account-security` (not deployed anywhere yet), `file-link`, `send-invoices` and `public-booking`.
  - **`public-booking` must be deployed with `--no-verify-jwt`, but `supabase/config.toml` does not say so.** An automatic deploy of every function would break it. This is fixed before anything deploys automatically (step 2e).
- **This Mac:** Supabase CLI 3.0.0; no `pg_dump`, `psql` or Docker. Production and the test copy run Postgres 17.

---

## 1. The baseline

The aim: one file, `supabase/migrations/20261103000000_baseline.sql`, that rebuilds production's schema exactly. It is recorded as **already applied** on production and the test copy, and never run there. From then on, new migrations go only in `supabase/migrations/`.

### 1a. Compare first (read-only, schema only)

One read-only query, a single `SELECT` over the system catalogs, describes every object Wivo owns, one line per object:
- tables with their RLS flags, and columns with type, not-null and default;
- constraints, indexes and enums;
- functions: arguments, return type, SECURITY DEFINER, `search_path`, and an md5 hash of the body;
- views (hash of the definition);
- triggers on `public`, `auth.users`, `auth.mfa_factors` and `storage.objects`, including whether each is enabled;
- policies on `public` and `storage`;
- grants to `anon`, `authenticated` and `service_role`, and EXECUTE rights;
- realtime tables, buckets, extensions;
- cron jobs: name, schedule, active, and **an md5 of the command, never the command itself**;
- Vault secrets: **names only**.

**It reads no table data, and its output contains no data and no secret values.**

**Kevin runs it in the SQL editor, once on production and once on the test copy.**
1. Paste the query below.
2. Run it. This first run gives one line per kind of object: a count and a hash. That is small enough to paste in chat.
3. Then replace the last line, as the comment says, and run it again to get every object. Use "Download CSV", once for production and once for the test copy, and send me the two files.

```sql
-- Wivo schema fingerprint. Read-only: one SELECT over the catalogs. No table
-- data, no secret values (cron commands are hashed, Vault gives names only).
with objs(kind, name, detail) as (
  select 'table', c.oid::regclass::text, 'rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  union all
  select 'column', c.oid::regclass::text || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod)
         || case when a.attnotnull then ' not null' else '' end
         || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
         || case when a.attidentity <> '' then ' identity' else '' end
         || case when a.attgenerated <> '' then ' generated' else '' end
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
     and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint', conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
  union all
  select 'index', i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid)
    from pg_index i join pg_class c on c.oid = i.indrelid where c.relnamespace = 'public'::regnamespace
  union all
  select 'enum', t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t join pg_enum e on e.enumtypid = t.oid
   where t.typnamespace = 'public'::regnamespace group by t.typname
  union all
  select 'function', p.oid::regprocedure::text,
         'returns=' || pg_get_function_result(p.oid) || ' definer=' || p.prosecdef
         || ' volatile=' || p.provolatile::text || ' config=' || coalesce(array_to_string(p.proconfig, ','), '')
         || ' body=' || md5(p.prosrc)
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'execute', p.oid::regprocedure::text,
         'anon=' || has_function_privilege('anon', p.oid, 'execute')
         || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'view', c.oid::regclass::text, md5(pg_get_viewdef(c.oid)) || ' ' || coalesce(array_to_string(c.reloptions, ','), '')
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
  union all
  select 'trigger', t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal
     and (n.nspname = 'public' or (n.nspname, c.relname) in (('auth', 'users'), ('auth', 'mfa_factors'), ('storage', 'objects')))
  union all
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
         cmd || ' to=' || array_to_string(roles, ',') || ' ' || permissive
         || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '')
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'grant', table_name || ' ' || grantee, string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
   group by table_name, grantee
  union all
  select 'realtime', schemaname || '.' || tablename, '' from pg_publication_tables where pubname = 'supabase_realtime'
  union all
  select 'bucket', id, 'public=' || public || ' limit=' || coalesce(file_size_limit::text, '')
         || ' mime=' || coalesce(array_to_string(allowed_mime_types, ','), '')
    from storage.buckets
  union all
  select 'cron', jobname, schedule || ' active=' || active || ' command_md5=' || md5(command) from cron.job
  union all
  select 'extension', extname, extversion from pg_extension
  union all
  select 'vault', name, '' from vault.secrets
)
-- First run: one line per kind. For the full list, replace this last line with
--   select kind, name, detail from objs order by kind, name;
select kind, count(*) as objects, md5(string_agg(name || ' | ' || detail, E'\n' order by name)) as fingerprint
  from objs group by kind order by kind;
```

**On my side, with no connection to anything real:** I run the same query in the PGlite replay of `sql/`, twice: up to 091 (what production should be) and up to 097 (what the test copy may be). The shim has no real `cron`, `vault` or extension versions, so those three kinds are compared by name only.

The result answers three questions:
1. Is production equal to `sql/000`–`091` replayed in order? RUN-3 expects yes.
2. How does the test copy differ: which of 092–097 does it have, and is the drift (missing triggers) still there?
3. Is there anything on production that no file explains (for example, made by hand in the dashboard)?

Every difference is listed, and Kevin decides on each one before step 1b.

### 1b. The baseline file

**Source:** production's own schema dump, which is "matches production exactly" taken literally. It is checked against the PGlite replay of `sql/000`–`091`.

**Kevin runs this on his Mac.** It installs the Postgres client tools only (no server, no Docker), and it is read-only: the session is forced read-only, and `pg_dump` only reads.

```sh
brew install libpq                                   # client tools only
export PATH="$(brew --prefix libpq)/bin:$PATH"
pg_dump --version                                    # must be 17 or newer
mkdir -p ~/WivoBackups/schema

# Host and user: Dashboard → Connect → "Session pooler" (port 5432).
# The user looks like postgres.wrtucsfmpbwekugzzzxw.
read -rs PGPASSWORD && export PGPASSWORD             # production's DB password; not shown, not saved
PGOPTIONS='-c default_transaction_read_only=on' pg_dump \
  "host=<SESSION_POOLER_HOST> port=5432 dbname=postgres user=postgres.wrtucsfmpbwekugzzzxw sslmode=require" \
  --schema-only --schema=public --no-owner \
  -f ~/WivoBackups/schema/production-public-$(date +%F).sql
unset PGPASSWORD

# Before sending: must print 0 (no JWT, no secret key, no Resend key)
grep -cE 'eyJ[A-Za-z0-9_-]{20,}|sb_secret_|re_[A-Za-z0-9]{20,}' ~/WivoBackups/schema/production-public-*.sql
```

Kevin tells me the path, and I read the file locally. **Schema only: no rows leave production.**

**What the baseline contains:**
1. The dump of `public`, cleaned of anything Supabase itself owns and recreates on its own.
2. A hand-written tail for what lives outside `public`, taken from the migrations and checked against the fingerprint:
   - the extensions;
   - the 2 buckets, inserted with `on conflict do nothing`;
   - the 3 Storage policies;
   - the `auth.users` trigger;
   - the 16 realtime tables;
   - the 4 cron jobs.
3. **The deliberate differences from production.** The baseline only ever runs on a new, empty project, never on production or the test copy:
   - **cron jobs read their URL and key from Vault.** Production's invoice job has production's URL written in (sql/052). A fresh project must never call production.
   - **No Vault values.** The baseline checks that `wivo_service_role_key` and `wivo_functions_url` exist, and stops with a clear message if they do not. They are set by hand per project, as today.
   - **No data:** no backfills, no clinic rows.

**How we know it is right:**
- A test replays the baseline in PGlite and compares its fingerprint with production's. Production's fingerprint is committed as `supabase/baseline.fingerprint.json`: catalog descriptions and hashes, no data, no secrets.
- The PGlite replay of `sql/000`–`091` must give the same fingerprint, apart from the differences approved in 1a.
- If the cleaned dump will not run in PGlite (Supabase-specific statements), the fallback baseline is `sql/000`–`091` joined in order, with the key placeholders and the hard-coded URL replaced by Vault reads. It is just as checkable against production's fingerprint.

### 1c. 092–097 move to `supabase/migrations/`

They are copied unchanged (`sql/` stays as a read-only archive), with versions that keep the old number visible:

```
supabase/migrations/20261103000000_baseline.sql
supabase/migrations/20261103000092_partner_no_identity.sql
supabase/migrations/20261103000093_stock.sql
supabase/migrations/20261103000094_inventory.sql
supabase/migrations/20261103000095_team_notifications.sql
supabase/migrations/20261103000096_expiry_override_admins.sql
supabase/migrations/20261103000097_account_security.sql
```

New migrations after that are made with `npx supabase migration new <name>`: a UTC timestamp, always later than the newest.

The PGlite test harness switches to replaying `supabase/migrations/` (baseline + the rest), so **what the tests replay is exactly what gets deployed.**

### 1d. Recording the baseline as applied: `supabase migration repair`

`migration repair --status applied <version>` writes one row into `supabase_migrations.schema_migrations`, creating that table if it is missing. It runs no migration and changes nothing else. It is still a write, so for production it happens only after Kevin's approval.

| Project | Marked as applied |
| --- | --- |
| Production `wrtucsfmpbwekugzzzxw` | `20261103000000` (the baseline) only. 092–097 stay pending, and arrive with the first release through the new flow. |
| Test copy `jhqyvancrzykxhzwnost` | the baseline, plus exactly those of 092–097 that the 1a comparison shows are already there |

**How (recommended):** a one-off GitHub workflow, `migration-repair` (run by hand):
- inputs: the project and the versions;
- it uses the same environment and secrets as the deploy, so production waits for Kevin's Approve;
- it prints `supabase migration list` before and after;
- nobody pastes anything and nothing runs from this Mac.

**The same by hand, if Kevin prefers:**

```sh
read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN
read -rs SUPABASE_DB_PASSWORD && export SUPABASE_DB_PASSWORD
npx supabase link --project-ref wrtucsfmpbwekugzzzxw
npx supabase migration list                          # read-only: before
npx supabase migration repair --status applied 20261103000000
npx supabase migration list                          # after: the baseline shows as applied
npx supabase db push --dry-run                       # read-only: must list exactly 092–097, nothing else
unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD
npx supabase link --project-ref jhqyvancrzykxhzwnost # leave the CLI pointed at the test copy
```

**If the test copy drifted** (missing triggers or policies), it gets a one-off repair SQL generated from the difference. That SQL runs on the test copy only, through the same dispatch workflow; it is not a migration, because production does not need it. Afterwards its fingerprint must equal the production fingerprint plus the 09x files it has.

---

## 2. GitHub Actions

### 2a. The project list (so a second instance is one line)

`supabase/projects.json`, read by every workflow:

```json
{
  "test-copy":  [{ "ref": "jhqyvancrzykxhzwnost", "functions": ["send-notifications", "account-security", "file-link"] }],
  "production": [{ "ref": "wrtucsfmpbwekugzzzxw", "functions": ["send-notifications", "account-security", "file-link"] }]
}
```

- A first job turns the list into a matrix; the database and function steps run once per entry.
- On production the entries run **one at a time** (`max-parallel: 1`), and **the first failure stops the rest**. No app is published unless every instance succeeded.
- Each entry names its functions. Only listed functions are deployed, so a function that is not live today (for example `public-booking`, or `send-invoices` while invoices are off) is never switched on by accident.
- **Kevin confirms the list per project before the first run** (section 5).
- A unit test checks the file:
  - no production ref appears under `test-copy`;
  - the production ref is the same as `PRODUCTION_REF` in `lib/testCopy.ts`;
  - every listed function has its `verify_jwt` setting in `config.toml`.

### 2b. Secrets: GitHub environment secrets only, added by Kevin

| Environment | Who can use it | Required approval | Secrets |
| --- | --- | --- | --- |
| `test-copy` | branches `testing` and `main` (main only reads the migration list, see 2d) | none | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_JHQYVANCRZYKXHZWNOST` |
| `production` | branch `main` only | **Kevin** (required reviewer), "prevent self-review" off so Kevin can approve his own push | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_WRTUCSFMPBWEKUGZZZXW` |
| `production-publish` | branch `main` only | none (it runs only after the approved job succeeded) | `CLOUDFLARE_API_TOKEN` (Pages: Edit only), `CLOUDFLARE_ACCOUNT_ID`, and variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` for the phone build |

- **Naming.** The password secret is `SUPABASE_DB_PASSWORD_<REF IN CAPITALS>`. The workflow reads it as `secrets[format('SUPABASE_DB_PASSWORD_{0}', matrix.ref)]`, so a new instance needs only its line in `projects.json` and its secret.
- **Never in the repo, never in logs:**
  - Secrets reach the CLI only as environment variables (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`), never as command-line arguments or inside a URL.
  - No `--debug`, no `set -x`. GitHub also masks secret values in logs.
  - Nothing is written to artifacts.
  - The existing repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` stay as they are for the desktop build.
- **The access token is not limited to one project.** A Supabase personal access token can do anything its account can do, in every project. So the test-copy token could reach production too. Options, in order of preference:
  1. A separate Supabase account for CI (`wivo-ci`), added to the organisation as a **Developer** (no billing, no project deletion), with its own token. If the test copy can live in a separate Supabase organisation, the test token then cannot see production at all.
  2. Kevin's own token in both environments, relying on the workflow refusing any production ref outside the `production` job.

  This is Kevin's decision (section 5).
- **The pooler.** GitHub's runners have no IPv6, and the direct database address is IPv6 only, so the CLI must use the session pooler. `supabase link` records the pooler and `db push` uses it. This is checked on the first test-copy run; if it fails, the URL is built from the pooler host with the password from the environment, never printed.

### 2c. Push to `testing`: `.github/workflows/test-copy.yml`

Runs on every push to `testing` that changes `supabase/**`, `src/**`, `shared/**` or `package*.json`.

1. **checks** (no secrets):
   - `npm ci`, `npm test`. This includes the PGlite replay of `supabase/migrations/` and the leak tests.
   - `tsc` for the renderer.
   - **The migration rules** (section 3):
     - every file in `supabase/migrations/` was created once and never changed afterwards (`git log` over the file has one commit);
     - versions only increase;
     - no file contains a key pattern;
     - no file writes a `functions.supabase.co` address.
2. **database** (environment `test-copy`, one matrix entry per test ref, needs `checks`):
   - `supabase link --project-ref <ref>`;
   - `supabase migration list` and `supabase db push --dry-run`, both written to the job summary;
   - `supabase db push`;
   - `supabase migration list` again, which must show nothing pending.
3. **functions** (same environment, needs `database`): `supabase functions deploy <name> --project-ref <ref>` for each listed function. The `verify_jwt` setting comes from `config.toml`.
4. **Test phone site** (optional; recommended later): switch `wivo-test` from Cloudflare's Git build to a `wrangler pages deploy` here too, so the test site also waits for its database. Until then `wivo-test` keeps building by itself, which is acceptable for a test site.

### 2d. A release on `main`: `.github/workflows/build.yml` grows into the release flow

"A release" = a push to `main` where the version in `package.json` changed. This is the rule `build.yml` already uses. `paths-ignore` stops ignoring `supabase/**`.

```
checks ──► plan ──► production database  ──► production functions ──► publish desktop
                     (environment: production,                    └──► publish phone
                      waits for Kevin's Approve)
```

1. **checks:** as on `testing`, plus the version gate.
   - If the version did not change, the database, function and publish jobs do not run (the build still runs, as today).
   - **If the version did not change but `supabase/migrations/` or a listed function did, the run fails.** A database change never slips out without a release, and is never silently skipped.
2. **plan** (no approval; reads the test copy):
   - It lists the migrations production does not have yet, from Git: the files added since the last successful production run. A tag `deployed/production` is moved after each successful run. Each file's full SQL goes into the job summary.
   - It also lists the functions to deploy.
   - **It checks that every one of those migrations is already applied on the test copy** (`supabase migration list` against the test copy, environment `test-copy`). If one is not, the run stops. This enforces "every migration runs on the test copy before main".
   - **Kevin reads this summary when he presses Approve.**
3. **production database** (environment `production`: **waits for Kevin's Approve**), per production ref:
   - `supabase db push --dry-run`, written to the job summary. **Its list must equal the plan's list exactly, or the job stops before writing anything.** This catches a change on production between plan and approval.
   - `supabase db push`, then `supabase migration list` (nothing pending).
4. **production functions** (environment `production`, same approval, needs the database job): `supabase functions deploy` for the listed functions, after the database, because new function code may call new database functions.
5. **publish desktop** (needs both production jobs): the existing Windows build, then `electron-builder --publish`, publishing the release and the stable download link. **Unchanged, except that it waits.**
6. **publish phone** (environment `production-publish`, needs both production jobs):
   - `npm run mobile:build` with the production `VITE_*` variables;
   - `npx wrangler pages deploy dist-mobile --project-name wivo --branch main`.
   - **Before this works, Kevin switches off automatic production deployments for the `wivo` Pages project** (Cloudflare → `wivo` → Settings → Builds → Branch control). Otherwise Cloudflare would still publish on its own the moment `main` is pushed, before the database is migrated.
7. After success, the tag `deployed/production` moves to this commit.

**Other rules for the release:**
- `concurrency: production` on the database, function and publish jobs, never cancelled midway: two releases never migrate at once.
- **If the database job fails:** nothing is published, and the run says which migration failed. Postgres has already rolled that migration back as a whole, because `db push` runs each file in a transaction. Earlier files in the same push stay applied; the fix is a new migration (forward only).
- **If the function deploy fails:** nothing is published. Re-running the job deploys again; deploys are safe to repeat.
- **Rejected or never approved:** nothing happens on production, and the run expires. The next release starts over.
- **Rolling back:** never by editing or deleting a migration. A new migration undoes the change. Supabase's own backups are the last resort (2f).

**A sketch of the approved job** (not final; secrets only through `env`):

```yaml
production-database:
  needs: [checks, plan]
  if: needs.checks.outputs.release == 'true'
  environment: production
  concurrency: { group: production, cancel-in-progress: false }
  strategy: { matrix: { project: '${{ fromJSON(needs.checks.outputs.production) }}' }, max-parallel: 1, fail-fast: true }
  runs-on: ubuntu-latest
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    SUPABASE_DB_PASSWORD: ${{ secrets[format('SUPABASE_DB_PASSWORD_{0}', matrix.project.ref)] }}
  steps:
    - uses: actions/checkout@v5
    - uses: supabase/setup-cli@v1
      with: { version: 3.0.0 }
    - run: supabase link --project-ref "${{ matrix.project.ref }}"
    - run: supabase db push --dry-run | tee dry-run.txt >> "$GITHUB_STEP_SUMMARY"
    - run: node scripts/same-as-plan.mjs dry-run.txt "${{ needs.plan.outputs.migrations }}"
    - run: supabase db push
    - run: supabase migration list
```

### 2e. Before anything deploys by itself

- **`config.toml`:** add `[functions.public-booking] verify_jwt = false`. Today only the README says so. The other functions keep their present setting. `account-security`, `team-account`, `send-notifications` and `send-invoices` already say `false` (each checks its caller itself), and `file-link` uses the default (`true`).
- **Function secrets** (VAPID, Resend, `APP_LINK`, `WIVO_SERVICE_SECRET_KEY`) stay set by hand per project, as today. **The workflows never set them,** so no function secret passes through GitHub.
- **The warning in `config.toml` stays:** the workflows never run `supabase config push`, `db reset`, `db pull` or `db dump`.

### 2f. No data in GitHub; backups stay in Supabase

- No workflow runs `pg_dump`, `db dump` or any query that returns rows. Logs and summaries contain migration names, the SQL of the files from the repo, and CLI status. The schema fingerprint is made once, by Kevin, in the SQL editor (1a).
- **Backups stay in Supabase:** its daily backups, and point-in-time recovery if production's plan has it. Kevin checks once, in Dashboard → Database → Backups, that production has daily backups.
- **Before the first automated production release** (the one carrying 092–097), Kevin can take his usual backup to `~/WivoBackups/`, as in RUN-3, by his choice.

---

## 3. Rules for CLAUDE.md (proposed wording; to be added when this is built)

> **Migrations**
> - New migrations go only in `supabase/migrations/`, made with `npx supabase migration new <name>`. `sql/` is a frozen archive: never edited, never deleted, never added to.
> - **Add now, remove later.** A migration only adds what the release that needs it uses: new tables, new nullable or defaulted columns, new functions, new policies. Removing, renaming, narrowing a type, tightening a constraint or changing a function's arguments comes in a **later** release, once no app still in use needs the old shape. Desktop apps update on their own schedule, so for at least one release the database must work with both the new app and the one before it. A function whose arguments change gets a new signature next to the old one; the old one goes in a later release.
> - **Every migration runs on the test copy before `main`.** The `testing` workflow applies it; the release workflow refuses any migration the test copy does not have.
> - A migration file is never changed after it is pushed. A fix is a new migration.
> - No keys, passwords or project URLs in a migration. Cron jobs read their URL and key from Vault.
> - Each migration replays in the PGlite tests. Every new table gets `org_id`, RLS and a leak test in the same change (unchanged rule).
> - A migration runs in one transaction. Things that cannot (`create index concurrently`, adding an enum value that is used in the same file) get a file of their own, and the PR says so.
> - Production migrations are applied only by the release workflow, after Kevin presses Approve. Nobody pastes SQL into production. This replaces "Migrations are applied in order by Claude with Kevin's approval".

---

## 4. Building it, in order (after Kevin approves this plan)

1. The fingerprint query in PGlite, and a script that compares two fingerprint CSVs and lists the differences. No connection to anything.
2. **Kevin:** runs the fingerprint on production and the test copy, and sends the CSVs. **Kevin and Claude** go through the differences.
3. **Kevin:** makes the schema dump (1b) and sends the path. **Claude:** writes the baseline, `baseline.fingerprint.json`, the copies of 092–097, and the harness switch. Tests prove the baseline equals production's fingerprint.
4. **Claude:** `projects.json`, its test, the `config.toml` line for `public-booking`, the two workflows and `migration-repair`, and the CLAUDE.md rules. Committed on `testing`; nothing pushed.
5. **Kevin:**
   - creates the three GitHub environments and adds the secrets;
   - sets himself as required reviewer on `production`;
   - (optionally) creates the `wivo-ci` Supabase account;
   - switches off automatic production deployments for `wivo` on Cloudflare.
6. **Kevin:** pushes `testing`.
   - The first run repairs the test copy (dispatch), then applies whatever of 092–097 it lacks, then deploys the functions.
   - We check the job summaries, then the test copy's `migration list`.
7. **Kevin:** runs `migration-repair` for production, approves it, and checks `migration list`: only the baseline applied, with 092–097 pending.
8. **The first release on `main`** carries 092–097 and the functions, after Kevin approves. Then the desktop and phone publish.

The build (steps 1, 3 and 4) is about **2–3 days** of work, not counting waiting for Kevin's steps.

---

## 5. Decisions for Kevin

1. **The CI access token:** a separate `wivo-ci` Supabase account with the Developer role (recommended), or Kevin's own token. Can the test copy move to its own Supabase organisation?
2. **Which functions are live, per project.** These become the `functions` lists in `projects.json`. Is `public-booking` deployed on production? `send-invoices` has its own key check now (the service key only, as send-notifications), so it can be listed wherever invoices are on.
3. **The phone app:** switch `wivo` to being published from the workflow, with Cloudflare's automatic production deploys off. Without that, the phone app cannot wait for the database. `wivo-test` too, or later?
4. **The repair:** through the `migration-repair` workflow (recommended), or by hand with the CLI commands in 1d.
5. **Test copy drift:** a one-off repair SQL for the test copy (recommended), or rebuild the test copy's schema from the baseline.
6. **The first automated production release** carries 092–097: partner privacy, stock, inventory, team notifications, the expiry override for admins, and Security. When should it go out, and with a manual backup first?
