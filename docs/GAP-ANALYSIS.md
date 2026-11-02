# Wivo gap analysis

**Date:** 2026-11-02 · **Branch:** `2.1` (privacy work committed in `3fb2287`, not yet applied to any database)

**What was compared:** every phase of `wivo-2.0-spec.md` (0, 1, 1b, 2, 3, 4,
Sounds, Hiljem/Later, Testimine/Testing, Avatud küsimused/Open questions), the
open items in `docs/night-run/*.md` (PROGRESS, DECISIONS, MORNING, RUN-2,
RUN-3, phase0-report, chat-inventory, the three review files), `HANDOFF.md`
and `NEXT.md`. Each claim was checked against `sql/`, `src/`, `shared/` and
`supabase/functions/`, not taken from the docs alone. Where something can
only be confirmed in a dashboard or on production (secrets, settings), the
evidence is the run document and that is said.

Status: **done** = built and in the code; **partial** = some of it is built,
or built but not switched on; **missing** = nothing in the code.

Naming note (DECISIONS D9): the spec's `organization` is the existing
`clinics` table and `org_member` is `profiles`, exposed as views of those
names in `sql/070`.

---

## Phase 0: pre-flight

| Feature | Status | Evidence | What's still missing |
|---|---|---|---|
| Chat inventory; finish or remove | done | `sql/065`–`069`, `sql/test/chat.test.ts`, `docs/night-run/chat-inventory.md` | General group/direct chat screen not built (out of spec scope; job threads use the tables). |
| Fresh database from migrations, no manual steps | partial | `sql/test/freshDb.test.ts` (PGlite replay), `scripts/fresh-schema.mjs` | `052`/`056` still need a pasted service key on a real project (phase0-report §1). Replay on a real throwaway project and compare with production not done (RUN-3 fix list #4). |
| RLS audit; Security Advisor clean | done | `sql/068_tenant_isolation.sql`, `sql/test/rlsTenantIsolation.test.ts`, `sql/test/securityAdvisor.test.ts` | 167 lint warnings (mostly unindexed foreign keys) on a fresh project (RUN-3 fix list #3). |
| Five core protections | partial | Service key absent: phase0-report §3. Leaked-password protection and dashboard MFA on: RUN-3 "Before staff use" #2. User MFA: `src/renderer/src/components/Auth/MfaGate.tsx` | Network restrictions and enforced SSL are not recorded as done anywhere. |
| i18n foundation (English source, no hard-coded text) | done | `shared/i18n/en.ts`, `et.ts`, `shared/i18n/noHardcodedText.test.ts` | E-mail templates, CSV headers, invoice-line text keep Estonian literals by design (D8). |
| Restore test with current data | partial | Test copy restored on 2 Nov (RUN-3 "Schema comparison") | Restore missed 12 triggers; no row/file-count comparison recorded; files not part of it. |

## Phase 1: partnership, files, notifications

| Feature | Status | Evidence | What's still missing |
|---|---|---|---|
| `organization`, `org_member`, `partnership`, `job_share`; data under Tallinn | done | `sql/070_organizations_partnership.sql` | — |
| New-job form: stage to partner creates `job_share`; case type; referral consent | done | `share_job` in `sql/071`, `src/renderer/src/components/NewJobWizard/NewJobWizard.tsx` | Full visibility is being switched off on 2.1 (see privacy section). |
| `partner_job_view`, search by code, menu restriction | done | `sql/071_partner_access.sql`, `src/renderer/src/components/Partners/PartnerJobsView.tsx` | Listing is not audited per list, only opening (review-068-079 #19, by decision). |
| `move_job_stage` + `stage_transition` | done | `sql/071`, `sql/084`, revision stages `sql/087`, `Settings/StageTransitionsSection.tsx` | — |
| "Question" as a flag on the card | done | `open_questions()` in `sql/071`, fixed in `sql/085` | — |
| Partnership invite flow (hashed code, 7 days, both admins, audit) | done | `sql/070`, `sql/084`, `Settings/PartnershipsSection.tsx` | Wivo's own approval is SQL only (`platform_approve_partnership`, `sql/070`), no admin console. |
| `job_file`, private bucket, TUS, SHA-256, versions, soft delete | done | `sql/072`, `src/renderer/src/lib/tusUpload.ts`, `lib/uploadQueue.ts`, `components/Files/JobFiles.tsx`, `supabase/functions/file-link` | Old grant read policy still to be dropped once all clients use `file-link` (MORNING §2). |
| Previews: STL → PNG, photo thumbnails | done | `sql/073`, `src/renderer/src/lib/previews.ts` | Thumbnails still use the grant path, not `file-link` (MORNING §5; not re-verified). |
| Client-side cleaning: DICOM, EXIF GPS, file name → job code | done | `src/renderer/src/lib/fileClean.ts`, `register_job_file` in `sql/072` | Extended on 2.1 (privacy section). |
| Folder watcher → "Unsorted" → job | done | `src/main/watchFolder.ts`, `watchFolderCore.ts`, `components/Unsorted/UnsortedView.tsx` | — |
| Patient export: PDF + ZIP, logged | done | `sql/074`, `components/Patients/PatientExport.tsx` | Treatment plans join once Phase 4 exists. |
| Comments and questions on chat; files on comments | done | `sql/071`, `sql/080`, `components/Partners/JobThread.tsx` | — |
| Notifications: realtime badges | done | `sql/075`, `sql/076`, `components/NotificationBell.tsx`, `hooks/useNotifications.ts` | — |
| Notifications: e-mail via Resend (code + link only) | partial | `supabase/functions/send-notifications/index.ts`, `_shared/mail.ts`, `sql/077` | `RESEND_API_KEY`, `NOTIFY_FROM`, `BUG_REPORT_TO` not set on production; deferred to later this week (RUN-3 #1). No e-mail goes out. |
| Audit log | done | `sql/070` (append-only), `sql/078`, `Settings/AuditLogSection.tsx` | — |
| Languages: English, Russian, Estonian; per-user with org default | partial | `shared/i18n/ru.ts` (10 lines, empty), `components/LanguageSync.tsx` | Russian translation not done and not offered in the switch (D6). |
| Technician pay shown large on the job | done | `components/JobDetail/JobPayCard.tsx` | — |
| MFA for all users (TOTP) | done | `components/Auth/MfaGate.tsx`, `lib/mfa.ts` | Database-wide aal2 enforcement only on partnership/admin RPCs (D12). Hardware keys for admin accounts: no admin accounts exist yet. |
| "Report a bug" → `bug_report`, no screenshot by default | done | `sql/079_bug_reports.sql`, `components/BugReportButton.tsx`, `sql/test/bugReport.test.ts` | — |
| Bug report e-mail to Kevin | partial | `send-notifications/index.ts:105` | `BUG_REPORT_TO` not set on production. |
| Sentry in Electron, patient data filtered | partial | `src/main/sentry.ts`, `src/renderer/src/lib/sentry.ts`, `shared/privacy/scrub.ts` | Off without a DSN at build time (D13); no record that a DSN (EU region) is set. |
| Acceptance: partner cannot read unshared rows/files (automated) | done | `sql/test/partnerAccess.test.ts`, `rlsTenantIsolation.test.ts`, `scripts/leak-check.mjs` (ran clean on production, RUN-3) | — |
| Acceptance: new shared job → badge and e-mail within a minute | partial | Badge and push: `useNotifications.ts`, `sql/090` | E-mail off (above); real phone test pending (RUN-3 #6). |

## Phase 1b: phone (PWA)

| Feature | Status | Evidence | What's still missing |
|---|---|---|---|
| PWA from same code, Cloudflare Pages, same login + MFA | done | `vite.mobile.config.ts`, `src/renderer/src/mobile/`, `src/renderer/mobile-static/`; live at app.wivodent.com (RUN-3) | Full Content-Security-Policy not added (RUN-2 §6). |
| Home: my jobs, search by code | done | `mobile/MobileHome.tsx`, `mobile/jobLists.ts` | — |
| Job view: info, files, chat | done | `mobile/MobileJob.tsx` | — |
| Camera onto the job, no gallery, no GPS | done | `mobile/PhoneCamera.tsx` (D20) | Android check with two camera apps pending (RUN-3 #7). |
| Chat on the phone | done | `mobile/MobileJob.tsx`, `Partners/JobThread.tsx` | — |
| Push notifications, e-mail as fallback | partial | `sql/090`, `sql/091`, `supabase/functions/_shared/vapid.ts`; VAPID set on production (RUN-3) | E-mail fallback inactive (Resend). Real end-to-end test pending (RUN-3 #6). |
| Shorter session, remote sign-out | done | `mobile/session.ts`, `Settings/SignOutOthersSection.tsx` | Server-side session time-box is optional and not set (RUN-2 §6). |

## Phase 2: stock and inventory

| Feature | Status | Evidence | What's still missing |
|---|---|---|---|
| `stock_item`, `stock_movement` (stock from movements) | missing | No table in `sql/`; no stock UI | Tables, RLS, leak test, UI. |
| Expiry and lot mandatory on manual entry | missing | — | Constraint + form. |
| Consignment: 3-month default, red a month before, use/return/buy out | missing | — | All. |
| Use on a job reduces stock and links lot to job/patient | missing | — | All. |
| Partner sees own goods in the other org's stock; `share_stock` | missing | Only the flag `partnership.share_stock` exists (`sql/070:298`) | RLS for owner_org ≠ location_org, partner stock view. |
| Minimum quantity warning | missing | Sound registered only (`lib/soundCore.ts:28`) | Warning logic, badge, sound wiring. |
| Inventory: schedule, red bar, count with reasons, history | missing | — | `inventory_schedule`, `inventory_count` + rows, UI. |

## Phase 3: modules, billing, admin console

| Feature | Status | Evidence | What's still missing |
|---|---|---|---|
| `module_price`, `org_module`, `seat_module`, `has_module()`, `has_seat_module()` | missing | Not in `sql/` | Tables, functions, use in RLS/RPCs. |
| Modules: base licence, statistics, stock, extra storage, calculator | missing | Statistics page exists ungated by module (`components/Dashboard/`, permission `stats.read` in `hooks/usePermissions.ts`). Licence is client-side only and not enforced: `LICENCE_PUBLIC_KEY = ''` (`src/main/license.ts:33`) | Database-enforced modules; server-side licence. |
| Monthly platform invoice (seats × base + modules + storage; setup fee; reverse charge) | missing | `send-invoices` Edge Function is the clinic's own invoicing to its customers, not platform billing | `platform_invoice` + rows, generator, VAT mode. |
| Partner monthly summary (completed shared jobs × agreed price) | partial | `job_share.partner_price` stored (`sql/070:369`, `share_job` in `sql/071`) | The summary itself. |
| Admin console: separate site, hardware-key login, Edge Functions only | missing | No admin site under `web/` (only `web/embed`); no `platform_admin` | All. |
| Admin: clinics overview (seats, modules, storage, last activity, version) | missing | — | All. |
| Admin: modules on/off per clinic or seat | missing | — | All. |
| Admin: automatic monthly invoices, draft first, payment status | missing | — | All. |
| Admin: licences (issue, extend, revoke) | partial | `scripts/make-license.mjs`, `shared/license/token.ts`, `Settings/LicenseSection.tsx` (Ed25519) | No `license` table, no revocation, public key empty. |
| Admin: bug reports and Sentry errors in one list with status | partial | `bug_report` table with status column (`sql/079`), readable by nobody by design | Admin list, status changes, Sentry import. |
| Admin: usage counters (`usage_daily`) | missing | — | All. |
| Admin: `admin_audit_log` | missing | — | All. |
| Support access only with clinic consent, time-limited, logged | missing | — | All. |
| Organisation export (rows + files + manifest), import into clean instance | missing | Only per-patient export exists (`sql/074`) | All. |
| Quarterly export/import round-trip test | missing | — | All. |
| Leaver rules, deletion after transfer, deletion register | missing | A service-role DELETE stays a real delete as the exit path (D16, `sql/089`) | Process, register table, re-apply on restore. |
| First round-trip with Tallinn's real data | missing | — | Needs export first. |

## Phase 4: treatment record, treatment calculator, booking fee

### Treatment record by tooth

| Feature | Status | Evidence | What's still missing |
|---|---|---|---|
| Visit note: tooth entries (FDI, surface, procedure, text) + general text (`visit_note`, `visit_tooth_entry`) | missing | Neither table exists. Today: one free-text field `patients.ravikaart` (`components/Patients/RavikaartPanel.tsx`) and visits (`sql/007_visits.sql`, `Patients/VisitsPanel.tsx`) | Tables, RLS, leak test, entry UI. |
| Tooth history timeline (entries, jobs, X-rays, components, plans) | missing | — | Needs the tables above, `job_file.teeth`, `patient_component`. |
| "Open the whole visit" | missing | — | — |
| Search and filters (tooth, surface, procedure, doctor, date) | missing | — | — |
| Quick entry (saved phrases, copy previous note) | missing | — | — |
| Signed note immutable; amendments with reason (`visit_note_amendment`) | missing | — | — |
| Share one entry with a job (`visit_note_share`) | missing | — | Also an open follow-up of the 2.1 privacy work. |
| `job_file.teeth` | missing | `sql/072` has no `teeth` column | Column + tagging UI. |
| Tooth chart in two layers (crown, root) | partial | `patient_teeth` with one 4-state status per tooth (`sql/003`), `Patients/ToothStatusPanel.tsx`, derived from jobs (`Patients/derive.ts`) | Two layers, new states. |
| `patient_component` (implant, abutment, bone; maker, system, size, lot) | missing | — | All. |
| Component created automatically from stock use | missing | — | Needs Phase 2. |
| "Done elsewhere" manual entries | missing | — | — |
| `prosthesis` linked to its implants | missing | — | — |
| `tooth_state_event` (chart state = latest event) | missing | — | — |

### Treatment calculator and booking fee

| Feature | Status | Evidence | What's still missing |
|---|---|---|---|
| `treatment_package` + `treatment_package_line`, several per patient | missing | Not in `sql/` | Tables, RLS, leak test. |
| Price from price list, manual override, running total | missing | Building blocks: patient price list `clinic_settings.public_services` with per-tooth tiers (`sql/047`), `shared/portal/publicCalculator.ts`, `Settings/CalculatorEditor.tsx`; lab price book `shared/pricing/priceBook.ts` | The doctor-side calculator itself. |
| Presentation view, packages side by side, PDF | missing | PDF pattern exists (patient export, `PatientExport.tsx`) | All. |
| Patient chooses → `booking`, fee 500 € default (configurable) | missing | Fee and Montonio exist for web booking requests only: `sql/059`, `sql/061` (`makse_staatus`, `makse_summa`, `montonio_uuid`), `supabase/functions/_shared/montonio.ts`, `public-booking` | `booking` table tied to a package. |
| Paid → appointment confirmed, implants reserved, material ordered | missing | — | Needs `booking`, stock `reserve`, order flow. |
| Reserved goods cannot be used in daily work | missing | — | Needs Phase 2. |
| Structured decision reason per chosen package | missing | — | — |
| Outcome linked to job: redo with reason, complication, follow-up | partial | Redo reasons exist (`components/JobDetail/RevisionBlock.tsx`) | Complication, follow-up. |
| Patient consent for anonymised development use (off by default) | missing | — | Field with date and who marked it. |

## Sounds

| Feature | Status | Evidence | What's still missing |
|---|---|---|---|
| `notify-new-work` (job shared, files added) | done | `hooks/useNotifications.ts:51`, `sql/090` | — |
| `notify-handoff` (stage handed over) | done | `hooks/useNotifications.ts:51` | — |
| `notify-stock-warning` | missing | Registered and file present (`lib/soundCore.ts:28`, `public/sounds/notify-stock-warning.wav`); no call site | Event (Phase 2). |
| `notify-booking-confirmed` | missing | Registered and file present; no call site | Event (Phase 4). |
| `ui-tab`, `ui-tick` | partial | Wired in `lib/sound.ts:139,144` | No recordings in `src/renderer/public/sounds/`. |
| `ui-move` (card moved with ‹ ›) | missing | File present; no `playSound('ui-move')` anywhere | One call at the ‹ › handlers. |
| Other sounds (message, mention, sent, upload done, error, pick-up/drop, toggles) | done | `Partners/JobThread.tsx:48–75`, `lib/uploadQueue.ts:100,128`, `Board/BoardColumn.tsx:57,68`, `lib/sound.ts:134–147` | Loudness script not run (no ffmpeg, D15). |

## Later (Hiljem)

| Feature | Status | Evidence | What's still missing |
|---|---|---|---|
| Ratings and bonuses | missing | — | All. |
| Automatic stock replenishment | missing | — | Needs Phase 2. |
| Statistics module (own + shared-jobs view) | partial | Own statistics: `components/Dashboard/` | Shared-jobs view, module gating. |
| Phone extras: QR code on job sheet, "Unsorted" on phone | missing | No QR code in `src/`; Unsorted is desktop only | All. |
| Viewers: 3D (STL/PLY) and 2D X-ray, display only | missing | Only static STL → PNG previews (`lib/previews.ts`). The 3D odontogram is a chart, not a file viewer | Viewers. |
| Scanner cloud integration | missing | — | Scanner still unknown (open question). |
| Italian | missing | — | — |
| Treatment AI engine | missing | Out of Wivo by the spec (separate MDR product) | Only data collection belongs here (Phase 4). |
| Patient portal | missing | Removed by decision (`HANDOFF.md` "Legal / compliance") | Needs pentest and strong eID first. |
| Per-clinic encryption keys for files | missing | — | — |
| Broker instance (cross-instance partner network) | missing | One access layer is in place (`sql/071`: partners only via `partner_jobs` and RPCs), which the spec requires for this later | Hub itself. |

## Testing (Testimine)

| Feature | Status | Evidence | What's still missing |
|---|---|---|---|
| RLS leak tests, two orgs, every table and bucket, every migration | done | `sql/test/rlsTenantIsolation.test.ts`, `files.test.ts`, `partnerAccess.test.ts`, run on every `npm test` | — |
| API self-check with a Riga token | done | `scripts/leak-check.mjs`; ran clean with `--production` (RUN-3) | Re-run after 092 is applied. |
| Admin boundary test (no patient fields, no platform-table access) | missing | No admin console to test | — |
| Backup: nightly sync to Hetzner, quarterly restore test | missing | No backup script in `scripts/` or `.github/workflows/`; backups only on Kevin's Mac (`~/WivoBackups/`, RUN-3 fix list #5) | Hetzner VM, `rclone`/`pg_dump` job, external disks, restore drill. |

## Open items from the run documents (not spec features)

| Feature | Status | Evidence | What's still missing |
|---|---|---|---|
| Announcements / "What's new" | done | Commit `97f56d3`, `components/WhatsNew.tsx`, `release-notes/2.0.0/en.md`, `et.md`, `CHANGELOG.md` | — |
| Cross-border privacy (lawyer's decision: no personal data between clinics) | partial — built on 2.1, not applied | See next section | Not applied to any database; follow-ups below. |
| Desktop sign-out local, button label | partial | `scope: 'local'` (RUN-3 "Desktop app"); label is still "Sign out" (`shared/i18n/en.ts:2255`) | Say "(this device)" (RUN-3 fix list #2). |
| Close compatibility paths (old `profiles_read` policy, grant read policy) | missing | SQL in MORNING §2, not in any migration | A new migration once every computer runs 2.0. |
| Montonio account verification | missing | `NEXT.md` "Ootab sind" #2; `MONTONIO_ENV=sandbox` until then | Needed for any real fee, including the booking fee. |
| Accounting package (locked period, VAT by rate, export file) | missing | `NEXT.md` §1; two known number debts (`periodMetrics`, `kulu_yle`) | Fix the two debts first, then the export. |
| Ops cleanup: delete test copy, revoke `sbp_` tokens, reset DB password, align GitHub accounts | missing | RUN-3 "Cleanup" #8–11 (cannot be verified from code) | Kevin's dashboard steps. |
| Node.js 22 | partial | CI uses Node 22 (`.github/workflows/build.yml:29`) | Local machine still on Node 20 per RUN-3 fix list #7. |

---

## Cross-border privacy work on branch 2.1 (committed in `3fb2287`, not applied to any database)

Lawyer's locked decision (2 November 2026): no personal data crosses borders
between clinics; a partner sees only job information. Written by another agent
on `2.1`, not committed and **not applied to any database**.

| Part | Status | Evidence |
|---|---|---|
| Full visibility off, referrals included (constraints `job_share_partial_only`, `partnership_partial_only`) | built on 2.1, not applied | `sql/092_partner_no_identity.sql` §1 |
| `partner_jobs` never returns name or contacts | built on 2.1, not applied | `sql/092` §2 |
| Owner staff cannot save the patient's name or a personal code into partner-visible text (SQLSTATE `WV001`); app message | built on 2.1, not applied | `sql/092` §2–3, `components/Patients/errors.ts:45` |
| Redaction ("•••") of everything a partner reads | built on 2.1, not applied | `sql/092` §4 |
| Leak test across all partner endpoints | built on 2.1, not applied | `sql/test/partnerNoIdentity.test.ts` (296 lines) |
| File scrubbing: all EXIF/XMP/IPTC, DICOM patient module, STL/PLY/OBJ names | built on 2.1, not applied | `src/renderer/src/lib/fileClean.ts`, `fileClean.test.ts` |
| Upload warnings for PDFs, photos, X-rays on shared jobs | built on 2.1, not applied | `src/renderer/src/lib/sharedUpload.ts` |

**Open follow-ups:**
- Age is still an exact number (`patient_age int`, `sql/071:264`); an age band is proposed.
- Staff names of the other organisation are visible in threads and file lists (`author_name` in the thread functions, `sql/071:469`, `sql/092:420`).
- 3MF metadata and OBJ object/group names (`o`, `g` lines) are not scrubbed.
- Shared visit entries (`visit_note_share`) do not exist yet (Phase 4).
- To ship: test-copy run, then production in a session Kevin starts, then `scripts/leak-check.mjs --production` again.

---

## Prerequisites for the vision

The vision is a closed loop from consultation to procedure day: the doctor
prices options, the patient chooses and pays a booking fee, stock is reserved,
the lab job is created, and anything missing is ordered.

### What each step needs

| Step | Needs (missing or partial items) | What already exists to build on |
|---|---|---|
| **1. Treatment calculator and booking fee** | `module_price`/`seat_module`/`has_seat_module()` to gate the calculator per seat (spec: enforced in the database); `treatment_package` + lines; presentation view + PDF; `booking` table; booking-fee refund rule (open question, lawyer); Montonio account verified; Resend live if the patient gets a confirmation e-mail (time only, MDR); `notify-booking-confirmed` wiring | Patient price list with per-tooth tiers (`sql/047`, `shared/portal/publicCalculator.ts`); tooth picker / odontogram; Montonio order + signed-token verification (`supabase/functions/_shared/montonio.ts`, `shared/portal/montonioClaims.ts`) and fee states on `visit_requests` (`sql/061`); visits calendar (`sql/007`) |
| **2. Automatic stock reservation from the chosen package** | All of Phase 2 core: `stock_item`, `stock_movement` with `reserve`/`release`, mandatory expiry/lot; `has_module(org,'stock')`; reserved goods blocked from daily use; `release` on cancellation with reason | Package lines carry `stock_category` (once step 1 exists) |
| **3. Partner lab job created from the plan** | 2.1 privacy work applied (`sql/092`), so a job made from a plan cannot carry the patient's identity; shared visit entries (`visit_note_share`) if the partner should see a clinical note; `job_file.teeth` for per-tooth files; resolve age band and other-org staff names | `jobs` + `share_job` RPC (`sql/071`), `move_job_stage`, job files and threads, partner roles incl. `supplier` (`sql/070:316`) |
| **4. Supplier marketplace** | Admin console (to verify suppliers and switch modules; today approval is SQL only); supplier catalogue and prices (new tables); purchase orders and the `buy` stock movement; minimum-quantity logic (to know what is missing); e-mail (Resend) for order notices; platform billing (`platform_invoice`) if Wivo charges for the marketplace | Partnership model with a `supplier` role (`sql/070`); Montonio helper if payment is taken in-app |

### Proposed build order for the missing items

1. **Finish and apply the 2.1 privacy work (`sql/092`)** — every later step shares jobs with partners, so the identity rule must be in place first.
2. **Turn on e-mail (Resend secrets)** — a configuration step, and steps 1, 3 and 4 all send notices.
3. **Modules core (`module_price`, `org_module`, `seat_module`, `has_module`, `has_seat_module`)** — the calculator and stock are paid modules, and the spec requires the gate in the database before the features ship.
4. **Stock core (`stock_item`, `stock_movement`, expiry/lot rules, RLS for consignment)** — package lines reference stock categories and booking must reserve, so the tables must exist before the calculator is wired to them.
5. **Treatment package + lines + doctor-side calculator** — vision step 1; reuses the `sql/047` price list and the calculator logic.
6. **Presentation view and PDF** — the patient chooses from it; reuses the patient-export PDF path.
7. **`booking` with Montonio fee (after account verification)** — reuses `_shared/montonio.ts` and the `sql/061` payment-state pattern; refund rule stays manual until the lawyer answers.
8. **Paid booking → reserve stock, confirm visit, `notify-booking-confirmed`** — vision step 2; closes the loop between payment and stock.
9. **Lab job from the chosen package (+ `job_file.teeth`)** — vision step 3; creates `jobs` + `share_job` from package lines.
10. **Stock warnings, consignment, inventory counts, `notify-stock-warning`** — needed to know what is missing before anything can be ordered.
11. **Admin console minimum (platform_admin, admin_audit_log, module toggles, supplier verification)** — vision step 4 needs a trusted way to verify suppliers; SQL-only approval does not scale.
12. **Supplier catalogue, purchase orders, `buy` movement** — vision step 4 itself.
13. **Treatment record by tooth, then `visit_note_share`** — not on the critical path of the loop, but blocked by the Dentas question (replace or complement); build after that is answered.
14. **Platform invoices, org export and deletion register, Hetzner backups** — needed for selling to more clinics and for GDPR exit, independent of the loop; the Hetzner backup should not wait (backups exist only on one Mac today).

---

## Open questions (spec) and their state

| Question | State |
|---|---|
| Scanner and export format | Unanswered; default (STL, PLY, OBJ) in use (`src/main/watchFolderCore.ts`). |
| Riga users and roles | Unanswered; default (5) not needed by code. |
| Russian at Riga launch | Default applied: launch in English, Russian wired but empty (`shared/i18n/ru.ts`). |
| Booking-fee refund terms | Unanswered (lawyer). Blocks the booking step only for refunds. |
| What the statistics module contains for Riga | Unanswered. |
| Stock and extra-storage prices | Unanswered; nowhere to put them yet (`module_price` missing). |
| Shared instance or own Supabase for Riga | Default applied: shared instance, RLS isolation. |
| Legal basis for using plan data in development | Unanswered; nothing is collected. |
| Does Wivo replace Dentas or complement it | Unanswered; default "complements". Must be answered before the treatment record by tooth. |

---

## Uncertainties

- Production settings (secrets, SSL, network restrictions, Sentry DSN) cannot be seen from the repo; their status comes from RUN-3/MORNING.
- Whether `main` with the 2.0.0 bump has been pushed was not checked (git was not touched).
- The "thumbnails still use the grant path" note is from MORNING.md §5 and was not re-traced in `JobFiles.tsx`.
