# Morning notes (draft, finished at the end of the run)

## Needs you

### First: the migrations you already applied
You ran the SQL on **production** during the night (23:34), including 082.
There is no permanent test project, by your decision (DECISIONS.md D14). Three files were committed late:
**080** (23:30), **081** (23:33) and **082** (23:35). If your run started
before those, run them now, in order, each followed by
`notify pgrst, 'reload schema';`. **082 matters most:** it repairs "Duplicate
job" in the app you have installed today (with 070 live, a duplicate carried
the original's job code and was refused).

Quick checks on the live database:
```sql
select name, code_prefix from clinics;                    -- your prefix; change it now if you want another
select count(*) from jobs where clinic_id is null;       -- 0 (068 adopted orphans: one clinic exists)
select count(*) from jobs where job_code is null;        -- 0 (070 numbered every job)
select jobname, schedule from cron.job;                  -- wivo-send-notifications exists (077)
```
Not yet done by applying the SQL: the Vault secret for 077, deploying the
e-mail function, Resend, TOTP — the sections below.

### Run sql/083 now (production fixes from the review)
Fixes things broken or exploitable on production today: **"Add worker" did
nothing since 068** (the worker ended up on the clinic-setup screen; if you
added anyone tonight, check `select full_name, clinic_id from profiles where
clinic_id is null;` and link them again after 083), deleting a worker with
audit rows failed, a worker could grant themselves rights through a second
account, founding a clinic could fail on a name clash, a removed founder could
rejoin as owner. Details: review-068-079.md.

### Run sql/085 (second review) after 084
Tightens the "Add worker" window to 2 minutes and to owners who are in a clinic,
fixes payroll permission scoping, thread history, job-code edge cases.
Details: review-080-084.md. Then check that 083 switched off no grant you rely
on — this should return no rows:
```sql
select p.full_name, wp.permission from worker_permissions wp
  join profiles p on p.id = wp.profile_id where wp.clinic_id is distinct from p.clinic_id;
```
The CSV import never worked against the database (it sent no clinic); the new
build fixes that.

### Run sql/084 before the first partnership
Partner-side fixes from the same review (thread scoping, partner permissions,
the 90-day read-only cap, and more — review-068-079.md). No partnership
exists on production, so nothing in it was exploitable there yet; apply it
before creating one. Note: partner staff now need `jobs.read` (to see shared
jobs) and `jobs.write` (to move stages, add files) in THEIR organisation's
Workers → permissions, like any other job.

### Raise the Storage upload limit
Storage → Settings → Upload file size limit: the project default is 50 MB,
the `job-files` bucket allows 500 MB. Raise it to 500 MB or full-arch scans
fail at 50 MB.

### Restore `jobs.updated_at` (the job-code backfill in 070 rewrote it)
Numbering every job in 070 was an UPDATE, and the `jobs_updated_at` trigger
stamped every job with the migration time. The app shows that time as the
patient's "last modified" and as the date of legacy revisions. The old values
are in last night's backup:
1. All jobs touched by 070 share one exact timestamp:
   `select updated_at, count(*) from jobs group by 1 order by 2 desc limit 3;`
   — the top row (count ≈ all jobs) is the migration time, call it T.
2. From the backup taken BEFORE you ran the migrations (Database → Backups,
   or a restore into a throwaway project), export `select id, updated_at from jobs;`
   as CSV and import it into production as a new table `jobs_updated_at_backup`.
3. In the SQL editor:
   ```sql
   alter table jobs disable trigger jobs_updated_at;
   update jobs j set updated_at = b.updated_at
     from jobs_updated_at_backup b
    where j.id = b.id and j.updated_at = 'T';   -- only rows nobody has edited since
   alter table jobs enable trigger jobs_updated_at;
   drop table jobs_updated_at_backup;
   ```

### sql/068 (tenant isolation) — already applied
Closes the cross-tenant holes in phase0-report.md §2. Check in the app: you can
still log in, see jobs, add a worker, remove and restore a worker.

### sql/069 (chat hardening) — already applied
Nothing to check in the app; `sql/test/chat.test.ts` is the check.

### Five core protections (dashboard, ~15 min)
Production project, then the test project:
1. **SSL:** Project Settings → Database → SSL Configuration → *Enforce SSL on
   incoming connections* → on.
2. **Network restrictions:** Project Settings → Database → Network Restrictions →
   allow only your own IP(s) (and later the Hetzner backup VM). The app is not
   affected: it uses the HTTPS API, not direct Postgres.
3. **Dashboard MFA:** your account → Account preferences → Security → enable an
   authenticator app. Then Organization → Settings → *Require MFA* for members.
4. **User MFA:** Authentication → Sign In / Providers → Multi-Factor →
   enable **TOTP** (not phone). The in-app enrolment is a Phase 1 item.
5. **Leaked passwords:** Authentication → Policies (Password security) →
   *Prevent use of leaked passwords* → on; minimum length 12.
Then run **Advisors → Security Advisor** on both projects. The schema lints it
checks are already tests (`sql/test/securityAdvisor.test.ts`); what remains
should be only these Auth settings, which this list fixes.

### Restore test (Phase 0, ~30 min)
1. Dashboard (production) → Database → Backups → download the latest daily
   backup, or `pg_dump --no-owner --no-privileges "$PROD_URL" > prod.sql` from
   a trusted machine.
2. Restore into a throwaway project (never the other way): `psql "$TEST_URL" < prod.sql`.
3. Row counts must match. Run this on both and compare:
   ```sql
   select table_name,
          (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text::int as rows
     from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by 1;
   ```
4. Point a dev build at the test project (`.env`), log in, open a job, an
   invoice and the payroll page.
5. No Storage files exist yet, so there is nothing to compare there.
6. Afterwards the test project holds real patient data: delete it or restrict
   access to the same people who can see production.
Note: sql/052 and sql/056 schedule a cron call to the PRODUCTION function URL.
After restoring, run `select cron.unschedule('wivo-send-invoices');` on the test
project so it does not call production every hour.

### sql/070 (organisations, partnerships, job codes, audit log) — already applied
Your clinic gets a job-code prefix from its name (check
`select name, code_prefix from clinics;` and change it now if you want another,
before codes are printed anywhere) and every existing job gets a code in
creation order. Approving a partnership as Wivo, until the admin console exists:
`select platform_approve_partnership('<partnership id>');` in the SQL editor.

### Two-factor sign-in (before anyone logs in to the new build)
Turn on TOTP first: Authentication → Sign In / Providers → Multi-Factor → TOTP.
With it on, every user is asked to scan a QR code at their next sign-in and
cannot skip it; from then on each sign-in asks for the 6-digit code. With it
off, the app lets people in without a second factor (and partnership steps
refuse, because the database requires aal2 for them).
Test: sign in → QR screen → scan with Google/Microsoft Authenticator → code →
app opens. Sign out, sign in → only the code is asked.

### sql/072 (job files) — already applied; check Storage
Created the private `job-files` bucket (500 MB per file) and its policies. After
applying: open a job → Files → add a photo → it uploads with a progress bar →
Download opens it. In Storage the object sits at `<clinic id>/<job id>/<file id>`.
GPS is removed from JPEG, HEIC (iPhone default), PNG and WebP photos before
upload. HEIC photos get no thumbnail (Chromium cannot decode HEIC); they still
upload and download normally.

### Notifications: 075–077 applied; now the Vault secret and the e-mail function
1. (077 needed pg_cron + pg_net; if it failed, enable them and run it again.)
2. Vault, once per project (production and test each get their OWN URL):
   `select vault.create_secret('https://<project-ref>.functions.supabase.co', 'wivo_functions_url');`
3. Resend: verify the sending domain, create an API key.
4. `supabase secrets set RESEND_API_KEY=... NOTIFY_FROM="Wivo <noreply@your-domain>" APP_LINK="<link to the app>/job/{id}"`
5. `supabase functions deploy send-notifications`
6. Check: `curl -X POST "$URL/send-notifications?dry=1" -H "Authorization: Bearer $SERVICE_KEY"`
   → `{"ok":true,"dry":true,"sent":N}`.
Acceptance test (spec): share a job with the Riga test org → bell badge in Riga
within seconds, e-mail within a minute. APP_LINK: there is no web app yet; a
link to the download page or the PWA (Phase 1b) is the honest choice for now.

### Bug reports: 079 applied; set BUG_REPORT_TO
079 created `bug_report` (no app user can read it — see it in the Table Editor
or via the service role) and the private `bug-reports` bucket. Then
`supabase secrets set BUG_REPORT_TO=<your address>` and redeploy
`send-notifications` (it e-mails new bug reports every minute too).
Test: sidebar → Report a bug → write something → Send → row in `bug_report`,
e-mail within a minute. With a screenshot attached the e-mail says so; the
image stays in the bucket.

### Sentry (optional, when you want it)
Create the Sentry organisation in the **EU data region** (spec: data in the
EU), one project of type Electron. Put the DSN in `.env` as both
`MAIN_VITE_SENTRY_DSN=` and `VITE_SENTRY_DSN=` and rebuild. Without them the
build contains no Sentry at all. In Sentry → Project settings → Security &
Privacy, also turn on "Data scrubber" and "Prevent storing of IP addresses"
as a second wall behind `shared/privacy/scrub.ts`.

### Leak check against production (spec: release condition)
Needs a second organisation with a user in it — the real Riga organisation
once it exists, or a test one with no patients. Then, with one Tallinn job
that is NOT shared with it:
`SUPABASE_URL=… SUPABASE_ANON_KEY=… RIGA_EMAIL=… RIGA_PASSWORD=… TALLINN_ORG_ID=… TALLINN_JOB_ID=… node scripts/leak-check.mjs --production`
It reads every table the migrations create and calls the partner RPCs and
Storage as that user; every write it tries must be refused. Exit code 0 means
nothing leaked.

### A throwaway project, for the restore test only
`TEST_SERVICE_ROLE_KEY=<that project's service key> node scripts/fresh-schema.mjs > fresh.sql`
gives one file that builds the whole schema (000 … newest) in a single paste
into its SQL editor — the service key filled in for 052/056, and the invoice
cron (which points at production) unscheduled at the end. It refuses the
production key. Restore the backup into it, compare the counts, delete it.
