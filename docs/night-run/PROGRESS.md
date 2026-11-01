# Night run progress

Started Sun 1 Nov 2026 22:17 EET. Scope: Phase 0 completely, then Phase 1 in the
spec's order. No Phase 1b or later. Commit hashes are added as tasks finish.

Status: `[x]` done · `[~]` partly done (see note) · `[ ]` not started ·
`[→]` needs Kevin (steps in MORNING.md)

## Phase 0: pre-flight

- [x] Chat feature: inventory, then finish or fix (`chat-inventory.md`; backend
      hardened by sql/069 and tested; the job-thread UI is Phase 1 comments) — 0f550c1
- [x] Migrations: a fresh database builds from `sql/` with no manual steps
      (PGlite replay test; two migrations still need a pasted key on a real
      project, see phase0-report.md §1) — 16874b3
- [x] RLS audit: every table has RLS; Security Advisor clean (catalogue lints as
      tests; 5 cross-tenant holes closed by sql/068; hosted advisor run → MORNING) — 98d2db6
- [→] Five core protections: network restrictions + SSL, dashboard MFA, user MFA,
      leaked-password protection, no service-role key in the app (service key:
      verified absent; the other four are dashboard settings → MORNING.md)
- [x] i18n foundation: English is the source language, existing Estonian moved
      into the `et` locale, no hard-coded UI text left in code (2,713 keys; guard
      test; per-user language waits for Phase 1 organisations) — 256493d
- [→] Restore test with current data (needs the production backup → MORNING.md)

## Phase 1: partnership, files, notifications

Organisations and sharing
- [x] `organization`, `org_member`, `partnership`, `job_share`; existing data
      becomes the Tallinn organisation (sql/070; `clinics` is the organisation,
      DECISIONS D9; plus job codes D10, audit_log, stage_transition) — 80db025
- [x] New-job form: assigning a stage to a partner creates a `job_share`; case
      type (lab work / referral); consent mark for referrals (share_job RPC in
      sql/071; section in the wizard's production step) — 7258ead
- [x] `partner_job_view`, search, menu restriction on shared jobs (sql/071 +
      "Partner jobs" screen: search by code, read-only detail, hand-over only,
      thread) — 85d4f73
- [x] `move_job_stage` + `stage_transition`; partner moves its own stage (sql/071;
      the partner's "›" hand-over button; owner rules also enforced on direct
      updates by trigger) — 85d4f73
- [x] "Question" as a flag on the card, not a column (open_questions() + flag on
      board cards and partner rows) — 85d4f73

Creating a partnership
- [x] `partnership_invite` + invite flow (hashed one-time code, 7 days, attempt
      limit, both admins confirm, suspend/end, every step audited): database
      and RPCs in sql/070 — 80db025; Seaded → Partnerships screen — 4aee9f9

Files
- [x] `job_file`, private bucket, TUS background upload, SHA-256, versions,
      soft delete (sql/072; downloads only via an audited 2-minute grant; own
      TUS client with resume; Files section in both job panels) — 9c05bd8
- [x] Previews: STL → PNG, photo thumbnails (made on the uploader's machine;
      sql/073; viewing them is one audited grant per job) — c20ef3b
- [x] Client-side cleaning: DICOM header scrub, EXIF GPS removal, file name →
      job code (lib/fileClean.ts: JPEG, HEIC, PNG, WebP GPS; DICOM; tested on
      synthetic files) — 9c05bd8
- [x] Folder watcher in Electron: scanner export folder → "Unsorted" → job
      (main reads only inside the chosen folder; same clean/upload path) — 99e8ed5
- [x] Patient export: PDF + ZIP of their files, download logged (sql/074 one
      audit row + grants; PDF by Electron printToPDF with JS off; own ZIP
      writer; treatment plans join in Phase 4) — 5ece0af

Communication and notifications
- [x] Comments and questions on a job, on top of chat (job thread RPCs on the
      chat tables; thread in the job panel and the partner panel) — 85d4f73
- [x] Notifications: realtime badges, e-mail via Resend (code + link only)
      (sql/075–077; the other side only, never the actor; no patient data in a
      row; Edge Function send-notifications; per-user e-mail toggle; deploying
      the function + secrets → MORNING) — 443044f
- [x] Audit log (sql/070 append-only table; every share, partner view,
      download, upload, export, partnership step and stage move — board moves
      too — and every job opened; Seaded → Audit log for admins) — 137ac64

Other
- [~] Languages: English primary, Russian for Riga, Estonian from existing —
      English source + complete Estonian (Phase 0); language is now a user
      setting with an organisation default (follows the person); Russian is
      wired and falls back to English, translation itself deferred per the
      spec's open-question default (DECISIONS D6) — 3efa00f
- [x] Technician pay shown large on the job (from the existing rule engine:
      the same calculateEarnings, asked "if this were done today"; RLS decides
      who sees whose pay) — 5a1f7d0
- [x] MFA for all users (mandatory TOTP enrolment + code at sign-in; steps aside
      if the project has TOTP off; built early, DECISIONS D12) — 639b354

Bug reports
- [x] "Report a bug" button → `bug_report` (no screenshot unless the user adds one)
      (sql/079: platform table, RLS with no policy — clinics file, nobody reads;
      errors scrubbed of e-mails, phones and personal codes) — 0a117ef
- [x] `bug_report` row + e-mail to Kevin (same per-minute sender, to
      BUG_REPORT_TO; deploying → MORNING) — 0a117ef
- [x] Sentry in Electron with patient data filtered out (both processes, only
      with a DSN; shared/privacy/scrub.ts tested; EU region → MORNING) — 141b635
