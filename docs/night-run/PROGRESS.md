# Night run progress

Started Sun 1 Nov 2026 22:17 EET. Scope: Phase 0 completely, then Phase 1 in the
spec's order. No Phase 1b or later. Commit hashes are added as tasks finish.

Status: `[x]` done · `[~]` partly done (see note) · `[ ]` not started ·
`[→]` needs Kevin (steps in MORNING.md)

## Phase 0: pre-flight

- [ ] Chat feature: inventory, then finish or fix (`chat-inventory.md`)
- [x] Migrations: a fresh database builds from `sql/` with no manual steps
      (PGlite replay test; two migrations still need a pasted key on a real
      project, see phase0-report.md §1) — c30c703
- [ ] RLS audit: every table has RLS; Security Advisor clean
- [ ] Five core protections: network restrictions + SSL, dashboard MFA, user MFA,
      leaked-password protection, no service-role key in the app
- [ ] i18n foundation: English is the source language, existing Estonian moved
      into the `et` locale, no hard-coded UI text left in code
- [ ] Restore test with current data (backup restored into the test project)

## Phase 1: partnership, files, notifications

Organisations and sharing
- [ ] `organization`, `org_member`, `partnership`, `job_share`; existing data
      becomes the Tallinn organisation
- [ ] New-job form: assigning a stage to a partner creates a `job_share`; case
      type (lab work / referral); consent mark for referrals
- [ ] `partner_job_view`, search, menu restriction on shared jobs
- [ ] `move_job_stage` + `stage_transition`; partner moves its own stage
- [ ] "Question" as a flag on the card, not a column

Creating a partnership
- [ ] `partnership_invite` + invite flow (hashed one-time code, 7 days, attempt
      limit, both admins confirm, suspend/end, every step audited)

Files
- [ ] `job_file`, private bucket, TUS background upload, SHA-256, versions,
      soft delete
- [ ] Previews: STL → PNG, photo thumbnails
- [ ] Client-side cleaning: DICOM header scrub, EXIF GPS removal, file name →
      job code
- [ ] Folder watcher in Electron: scanner export folder → "Unsorted" → job
- [ ] Patient export: PDF + ZIP of their files, download logged

Communication and notifications
- [ ] Comments and questions on a job, on top of chat
- [ ] Notifications: realtime badges, e-mail via Resend (code + link only)
- [ ] Audit log

Other
- [ ] Languages: English primary, Russian for Riga, Estonian from existing
- [ ] Technician pay shown large on the job (from the existing rule engine)
- [ ] MFA for all users

Bug reports
- [ ] "Report a bug" button → `bug_report` (no screenshot unless the user adds one)
- [ ] `bug_report` row + e-mail to Kevin
- [ ] Sentry in Electron with patient data filtered out
