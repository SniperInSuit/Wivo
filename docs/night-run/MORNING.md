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
