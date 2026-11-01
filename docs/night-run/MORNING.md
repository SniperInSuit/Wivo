# Morning: night run 1–2 November 2026

Phase 0 and Phase 1 of `wivo-2.0-spec.md` are built, tested and committed on
`main` (not pushed). 1,204 tests pass, including every migration replayed from
an empty database and tenant-isolation tests over every table. You applied
the migrations to **production** during the night; two independent reviews
then found problems, and every confirmed one is fixed in a new migration
(083–088) with a test that reproduces it. Start with section 1.

Reading list: `PROGRESS.md` (checklist with commits) · `DECISIONS.md` (D1–D14) ·
`phase0-report.md` · `chat-inventory.md` · `review-068-079.md` · `review-080-084.md`.

---

## 1. Do first: production, in this order

### 1.1 Run the remaining migrations
In the SQL editor, one file at a time, each followed by `notify pgrst, 'reload schema';`:

| File | Why now |
|---|---|
| **083** | **"Add worker" has done nothing since 068**: the account was created but never joined the clinic. Also: deleting a worker with audit rows failed; a worker could give themselves rights through a second account; founding a clinic could fail on a name clash; a removed founder could rejoin as owner. |
| **084** | Partner-side fixes (thread scoping, partner permissions, 90-day read-only cap…). Required before the first partnership. |
| **085** | Second-review fixes: the Add-worker window down to 2 minutes, payroll permission scoping, job-code edge cases (10 000th job), thread history. |
| **086** | Add worker with a one-time invite token: the new account joins at creation, nothing to race. |
| **087** | Revision stages through the same gate as job stages (rules, audit, notifications, partner hand-over). |
| **088** | File names for the `file-link` function (1.4 below). |

You said 082 is in. If anyone was "added" tonight, after 083: `select full_name, clinic_id from profiles where clinic_id is null;` and add them again.

### 1.2 Check the live data
```sql
select name, code_prefix from clinics;                   -- your job-code prefix (change it in SQL if you want another)
select count(*) from jobs where clinic_id is null;      -- 0 (068 adopted orphans)
select count(*) from jobs where job_code is null;       -- 0 (070 numbered every job)
select p.full_name, wp.permission from worker_permissions wp      -- no rows: no grant
  join profiles p on p.id = wp.profile_id                          -- was switched off by 083
 where wp.clinic_id is distinct from p.clinic_id;
```

### 1.3 Put `jobs.updated_at` back
Numbering every job (070) was an UPDATE, so the `jobs_updated_at` trigger stamped
every job with the migration time. The app shows it as the patient's "last
modified" and the date of legacy revisions. The old values are in the backup:
1. `select updated_at, count(*) from jobs group by 1 order by 2 desc limit 3;`
   — the top row (count ≈ all jobs) is the migration time **T**.
2. From the backup taken before you ran the migrations (Database → Backups),
   export `select id, updated_at from jobs;` to CSV and import it as table
   `jobs_updated_at_backup`.
3. Then:
   ```sql
   alter table jobs disable trigger jobs_updated_at;
   update jobs j set updated_at = b.updated_at
     from jobs_updated_at_backup b where j.id = b.id and j.updated_at = 'T';
   alter table jobs enable trigger jobs_updated_at;
   drop table jobs_updated_at_backup;
   ```

### 1.4 Before anyone installs the new build
- **Two-factor sign-in is mandatory in the new build.** Authentication → Sign In / Providers →
  Multi-Factor → **TOTP** on (it is on by default). Every user scans a QR code
  at their next sign-in and cannot skip it. Tell the staff to have Google or
  Microsoft Authenticator ready. Locked out (lost phone): Authentication →
  Users → the user → remove the MFA factor.
- **Storage → Settings → upload limit to 500 MB.** The project default is 50 MB; full-arch scans fail above it.
- **Release:** bump the version as usual; nothing tonight touched `package.json`'s version.

---

## 2. Switching features on (when you want them)

**E-mail notifications and bug-report e-mails** (075–077, 079)
1. Vault: `select vault.create_secret('https://<project-ref>.functions.supabase.co', 'wivo_functions_url');`
   (077 reads the URL from here, unlike 052, so no test copy can ever call production)
2. Resend: verify the domain, create an API key.
3. `supabase secrets set RESEND_API_KEY=… NOTIFY_FROM="Wivo <noreply@…>" APP_LINK="<link>/job/{id}" BUG_REPORT_TO=<your address>`
4. `supabase functions deploy send-notifications` — it now refuses anyone without the service key.
5. Check: `curl -X POST "$URL/send-notifications?dry=1" -H "Authorization: Bearer $SERVICE_KEY"`.
APP_LINK: there is no web app yet; the download page is the honest link until the PWA (Phase 1b).

**Short-lived download links**: `supabase functions deploy file-link`. Downloads
then get a 60-second link signed on the server after the audited check. The
app falls back to the old path until it is deployed.

**Partnerships**: both admins need MFA; invite in Seaded → Partnerships; you
approve each one as Wivo: `select platform_approve_partnership('<id>');`.
Partner staff need `jobs.read` / `jobs.write` in their own Workers permissions.

**Sentry**: an organisation in the **EU region**, an Electron project; put the DSN in
`.env` as `MAIN_VITE_SENTRY_DSN=` and `VITE_SENTRY_DSN=`, rebuild. Without them
no Sentry code ships. Also turn on Sentry's own data scrubber and IP-address
storage off.

**Once every computer runs the new build**, close the two compatibility paths:
```sql
-- Add worker: the old link-after-signup window (086 replaced it)
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles for select using (
  id = auth.uid() or clinic_id = public.my_clinic_id()
  or (clinic_id is null and removed_from = public.my_clinic_id()));
-- Downloads only through file-link (thumbnails stop until previews move too)
-- drop policy if exists "job_files_select" on storage.objects;
```

---

## 3. Phase 0 items that need the dashboard or a backup

**Five core protections** (~15 min). Service-role key: verified absent from the app.
1. Database → SSL: *Enforce SSL* on.
2. Database → Network Restrictions: only your IPs (the app uses HTTPS, unaffected).
3. Your account → Security: authenticator; Organization → *Require MFA*.
4. Auth → Multi-Factor: TOTP on (1.4).
5. Auth → Password security: *Prevent leaked passwords* on, minimum 12.
Then **Advisors → Security Advisor**: its schema lints already pass as tests
(`sql/test/securityAdvisor.test.ts`); only these Auth settings should remain.

**Restore test** (~30 min, spec Phase 0). Needs somewhere that is not production:
1. Create a throwaway Supabase project and restore the latest backup into it:
   `psql "$THROWAWAY_URL" < prod.sql` (the dump brings the schema with it).
   (`scripts/fresh-schema.mjs` builds an EMPTY schema in one paste — for a new
   software-only customer's own project, not for the restore test.)
2. Compare row counts on both:
   ```sql
   select table_name, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text::int as rows
     from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1;
   ```
3. Point a dev build at it, open a job, an invoice, payroll. Then
   `select cron.unschedule('wivo-send-invoices');` there (052 points at production), and delete the project.

**Leak check on production** (spec: release condition), once a second
organisation with a user exists (Riga, or a test one with no patients):
`SUPABASE_URL=… SUPABASE_ANON_KEY=… RIGA_EMAIL=… RIGA_PASSWORD=… TALLINN_ORG_ID=… TALLINN_JOB_ID=<an unshared job> node scripts/leak-check.mjs --production`
— reads every table and calls the partner RPCs and Storage as Riga; exit 0 = nothing leaked.

---

## 4. What is done

| Spec item | Where | Commit |
|---|---|---|
| **Phase 0** | | |
| Fresh database from `sql/` with no manual steps (tested on every `npm test`, PGlite) | sql/test/freshDb | 16874b3 |
| RLS audit: every table has RLS; Advisor lints as tests; 5 cross-tenant holes closed | sql/068 | 98d2db6 |
| Chat inventory; 6 rule gaps closed; finished, not removed | sql/069, chat-inventory.md | 0f550c1 |
| Five protections: service key verified absent; dashboard steps above | phase0-report §3 | 5091283 |
| i18n: English source (2,700+ keys), complete Estonian, Russian wired; guard test | shared/i18n | 256493d |
| **Phase 1** | | |
| organization / org_member (on `clinics` / `profiles`), partnership, job_share, job codes, audit log | sql/070 | 80db025 |
| Partner access layer: partner_job_view, search, move_job_stage, stage_transition, questions | sql/071 | 4b54ad0 |
| New-job form: stages to a partner, case type, referral consent | wizard | 7258ead |
| Partner jobs screen, hand-over, question flag, job thread | app | 85d4f73 |
| Partnership invite flow (hashed code, 7 days, rate limit, both admins + Wivo, audited) | sql/070 + Seaded | 4aee9f9 |
| MFA for all users (TOTP) | app | 639b354 |
| Job files: private bucket, TUS resumable, SHA-256, versions, soft delete, audited downloads | sql/072 | 9c05bd8 |
| Previews: STL → PNG, photo thumbnails | sql/073 | c20ef3b |
| Client cleaning: DICOM scrub, GPS off JPEG/HEIC/PNG/WebP, job-code file names | lib/fileClean | 9c05bd8, fd4fd89 |
| Scanner folder watcher → Unsorted → job | Electron | 99e8ed5 |
| Patient export: PDF + ZIP, logged | sql/074 | 5ece0af |
| Comments & questions on chat, files on comments | sql/071, 080 | 85d4f73, b7cfa2d |
| Notifications: realtime bell, Resend e-mail (code + link only) | sql/075–077 | 443044f |
| Audit log: full coverage + admin screen | sql/078 | 137ac64 |
| Language as a user setting with organisation default | app | 3efa00f |
| Technician pay, large, on the job | app | 5a1f7d0 |
| Report a bug → bug_report + e-mail, no screenshot unless added | sql/079 | 0a117ef |
| Sentry with patient data filtered | app | 141b635 |
| **Reviews** | | |
| First review (27 findings): fixes | sql/083, 084 | 41e0e34, 52df269 |
| Second review (9 findings + CSV import): fixes | sql/085 | e885d5f |
| Add worker by invite token; revision stages; server-signed download links | sql/086–088 | 682852a, 860a6ff, bc4058f |

## 5. What is not done

- **Russian translation.** Wired and falls back to English; not offered in the
  switch until translated (spec default: Russian within the first month). D6.
- **Hard-deleting a job** removes its file rows (the stored files stay) and its
  shares without an "unshare" audit row. Needs your decision: refuse deleting
  jobs that have files or shares, or move job deletion to soft delete.
- **Preview thumbnails** still use the grant path, not `file-link`.
- **"Partner" listing** (`partner_job_view`) is not audited per list; opening a job is.
- **Restore test, five protections, leak check on the live stack**: yours (section 3).
- **Admin console, modules, invoices to clinics**: Phase 3, not in tonight's scope.

## 6. Decisions made (details in DECISIONS.md)

D3 PGlite instead of local Supabase (no Docker here) · D4–D5 v1.109's inline
pairs converted to keys by codemod · D6 Russian not offered until translated ·
D7 Estonian default until organisations set one · D8 documents (invoice,
patient preview) keyed but in the document's language · **D9 `clinics` is the
organisation, `profiles` the membership** · D10 job codes `PREFIX-YY-NNNN` ·
D11 every partnership step needs admin + MFA on both sides; Wivo approves in SQL ·
D12 MFA built before Files (partnerships need it) · D13 Sentry 5.12, off without a DSN ·
D14 no permanent test project (your call).

## 7. How to test the new build

Restart `npm run dev` (main and preload changed; `npm install` on another machine).
- Sign in → QR code → authenticator → code → app opens. Sign out/in → only the code.
- Board: job codes on cards; "?" flag when a job has an open question.
- New job → success screen shows the job code.
- Job panel: technician pay card; **Files** (add a photo and an STL → progress →
  thumbnail → Download; New version; Delete); **Comments and questions** (ask,
  attach a file, mark answered).
- Patient → "Export for the patient" → ZIP with a PDF and their files.
- Sidebar → **Unsorted** → choose the scanner folder → attach a file to a job.
- Sidebar bottom → **Report a bug** → row in `bug_report` (e-mail once deployed).
- Seaded → Interface → language (saved to your profile); Audit log; Job stages →
  partner moves; Partnerships (create an invite with MFA).
- Workers → add a worker (after 086): they are in the clinic at once.
- CSV import now actually imports (it never sent the clinic before).
