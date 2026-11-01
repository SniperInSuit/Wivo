# Morning notes (draft, finished at the end of the run)

## Needs you

### Apply sql/068 (tenant isolation) to the test project, then production
Closes the cross-tenant holes in phase0-report.md §2. Run it in the SQL editor,
then `notify pgrst, 'reload schema';`. Check after: you can still log in, see
jobs, add a worker, remove and restore a worker.

### Apply sql/069 (chat hardening) after 068
Same procedure. Nothing uses the chat yet, so there is nothing to check in the
app; `sql/test/chat.test.ts` is the check.

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
2. Restore into the **test** project (never the other way): `psql "$TEST_URL" < prod.sql`.
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

### Apply sql/070 (organisations, partnerships, job codes, audit log)
After 069. Your clinic gets a job-code prefix from its name (check
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

### Apply sql/072 (job files) and check Storage
Creates the private `job-files` bucket (500 MB per file) and its policies. After
applying: open a job → Files → add a photo → it uploads with a progress bar →
Download opens it. In Storage the object sits at `<clinic id>/<job id>/<file id>`.
Known gap: HEIC photos (iPhone default) are uploaded as they are — their GPS is
not removed yet. JPEGs are cleaned; ask staff to send JPEG until HEIC is done.

### Notifications: apply sql/075, 076, 077 and deploy the e-mail function
1. Run 075 → 076 → 077 in order (077 needs pg_cron + pg_net, as 052 did).
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

### Bug reports: apply sql/079, set BUG_REPORT_TO
079 creates `bug_report` (no app user can read it — see it in the Table Editor
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

### Leak check against the TEST project (spec: release condition)
Once 068–079 are applied on the test project: create two organisations
there (a Tallinn copy and "Riga"), a Riga user, one Tallinn job that is NOT
shared, then run
`SUPABASE_URL=… SUPABASE_ANON_KEY=… RIGA_EMAIL=… RIGA_PASSWORD=… TALLINN_ORG_ID=… TALLINN_JOB_ID=… node scripts/leak-check.mjs`.
It reads every table the migrations create and calls the partner RPCs and
Storage as Riga; exit code 0 means nothing leaked. It refuses to run against
the production URL.
