# One Supabase project per clinic: an assessment

Read-only assessment, 3 November 2026, on branch `testing` after migration 097. No code was changed.

**The idea being assessed:**
- Every clinic has its own Supabase project, and the clinic pays for it.
- Wivo runs a central license server and an admin console: organisations, modules, invoices, and switching modules off when an invoice is unpaid. Wivo never sees patient data.
- Partnerships exchange shared jobs between instances, and trigger notifications on both sides.

## Summary

1. **This changes a locked decision.**
   - `wivo-2.0-spec.md` says: "Hosted multi-organisation instance… All hosted organisations are in one Supabase project and RLS keeps them apart".
   - The open question on Riga has the default "shared instance, separated by RLS".
   - The spec's locked decisions are final until Kevin changes them. So adopting this means a written spec change first.
   - The spec already foresees the pieces: a `home_instance` field, "one access layer", and, under "later", a **relay instance** (partner network hub). That hub holds the partnership registry and the shared jobs, uses signed requests and a versioned API, sits in the EU, and is the data processor for both clinics.
2. **About half of the code assumes one database, but it is contained.** Everything a partner does goes through `partner_job_view` and a small set of RPCs (sql/071, sql/072, sql/084, sql/092). Those RPCs read and write the owner's rows directly, in one transaction. That is the part that has to become a message exchange.
3. **The UI is mostly ready.** The partner screens never read tables directly (`hooks/usePartners.ts`). If `partner_job_view` and the RPCs keep their names and shapes, but are backed by a local mirror instead of the owner's tables, the screens need little or no change.
4. **"Wivo never sees patient data" is only technically true if Wivo has no access to the clinic's project.**
   - In every option where Wivo runs the migrations and deploys for the clinic, Wivo has full technical access. "Never sees" is then a promise backed by contract and audit, not by the technology.
   - This is the central trade-off in section 3.
5. **Recommended order:**
   1. License server and admin console.
   2. Automated migrations.
   3. The partner exchange through a hub.
   4. "Own instance" as an option.

   Steps 1 and 2 pay off even with the one shared instance that exists today. Rough total: **5–7 months** of one full-time developer-equivalent (section 4).

---

## 1. What assumes a single database today, and what already points toward instances

### 1a. Single-database assumptions

| Area | What the code does today | Why it breaks across instances | Where |
| --- | --- | --- | --- |
| **Users and sign-in** | One `auth.users` table for everyone. `profiles.clinic_id` is the user's organisation, and every policy goes through `my_org_id()` / `my_clinic_id()`. Partner users sign in to the **same** project as the owner. | A Riga user cannot sign in to Tallinn's project, and Tallinn's PostgREST cannot check Riga's token. Cross-instance calls cannot be "as the user". They must be "instance A acting for its user", which instance B trusts. | sql/012, sql/070 |
| **Partnerships** | `partnership.org_a` / `org_b` and `job_share.owner_org` / `partner_org` are foreign keys to `clinics(id)`: both organisations must be rows in the same database. Invite codes are looked up across all organisations (`partnership_invite.code_hash`, rate limiting per organisation). Wivo's approval is `platform_approve_partnership()`, run in the SQL editor. | The other organisation is not a row in your database. The partnership must exist on both sides (or in a hub), and the invite code needs a lookup outside either instance. | sql/070 |
| **Partner reads** | `partner_jobs()` / `partner_job_view` (SECURITY DEFINER) join `job_share` to the **owner's** `jobs` table and return redacted fields. `open_partner_job` writes a `view` audit row into **both** organisations' audit logs. | The partner's database has no owner `jobs` rows to join. It needs a local copy (mirror) of the partner-visible fields, kept up to date by the owner. | sql/071, sql/084, sql/085, sql/092 |
| **Stage moves** | `move_job_stage` (sql/084): the partner's call locks and updates the **owner's** `jobs` row, checks `assigned_stages` and `stage_transition`, and writes audit rows for both organisations, all in one transaction. The same goes for `move_revision_stage` (sql/087). | There is no shared transaction across two databases. A move becomes a request: the partner proposes, the owner decides, and the partner learns the outcome later (or is rejected). | sql/084, sql/087 |
| **Comments and questions** | `post_job_comment` stores the partner's message in the **owner's** `messages` table, and `job_thread` reads it from there (redacted for the partner). | Messages have to be sent and stored on both sides, or always read from the owner over the network. | sql/080, sql/092 |
| **Files** | One `job-files` bucket. The `job_file` row lives with the owner, including the partner's own print and design uploads (`uploaded_by_org`). Upload is allowed through `upload_slot_open`. A download needs a `file_download_grant`, then `file-link` signs a 60-second URL with the service key. | The partner's upload has to land in the owner's Storage, or in a hub and then be pulled. Download grants and signed URLs only work in their own project. Files are large (scans), so the transfer must be resumable. | sql/072, sql/073, sql/088, `functions/file-link` |
| **Notifications** | `notify_org(p_org, …)` inserts notification rows for **another** organisation's users, for example `on_file_added_notify` telling the partner about the owner's upload. Each project has its own realtime publication, `pending_pushes`, e-mail queue and `send-notifications` cron. | Instance A cannot insert into instance B's `notification` table. Each side must create its own notifications when it receives an event. | sql/075, sql/076, sql/090, sql/095 |
| **Realtime** | Realtime is per project, and the partner view has no realtime channel of its own: React Query refetches when invalidated. | No realtime across instances. The partner's mirror table can be added to its own instance's publication, so the partner sees updates live once they arrive. | sql/046, sql/066, sql/076, `usePartners.ts` |
| **Consignment stock** | `stock_item.owner_org` is a foreign key to `clinics`. `partner_stock()` lets the owner of the goods read totals from the location organisation's stock. `set_partnership_share_stock` writes audit rows for both sides. | The same pattern as jobs: the location instance has to send totals to the owner's instance. | sql/093, sql/094 |
| **Audit to both sides** | Many RPCs call `audit()` for both organisations in one transaction. | Each side logs its own half when it sends or receives an event. The audit row records the remote actor as the remote instance reported it. | sql/070 onward |
| **Job-code prefixes** | `free_code_prefix` keeps the 3-letter prefix (`TAL-26-0042`) unique by checking **all** `clinics` rows. Partners search by job code. | Uniqueness across instances needs a central registry: the license server. | sql/070, DECISIONS D10 |
| **Platform data in the clinic database** | `bug_report` is in the clinic project, and so is the partnership approval. The spec puts `platform_admin`, `license`, `platform_invoice`, `usage_daily` and `admin_audit_log` in the same project ("only Edge Functions see them"). | With one project per clinic, the platform tables must live in a separate Wivo project. | sql/079, spec "Platform" |
| **Which project the app talks to** | The desktop app has one project URL and anon key built in at build time (`build.yml` writes `VITE_SUPABASE_URL` into `.env`). The phone app is one Cloudflare Pages build. The test-mode guard knows exactly one production ref (`PRODUCTION_REF` in `lib/testCopy.ts`). | N instances need the app to find its instance **at run time**, for example sign-in → the license server answers "your organisation lives at URL X with public key Y". | `lib/supabase.ts`, `lib/testCopy.ts`, `.github/workflows/build.yml` |
| **Cron, Vault, function secrets** | `sql/052` writes production's functions URL into the invoice cron job. `sql/077` reads `wivo_functions_url` from Vault. `WIVO_SERVICE_SECRET_KEY`, VAPID keys and the Resend key are set by hand per project. | Every instance needs its own values. A hard-coded URL in a migration would call the wrong project; `scripts/fresh-schema.mjs` already has to unschedule it for that reason. | sql/052, sql/056, sql/077, RUN-4 |
| **Migrations** | 98 SQL files (000–097), pasted by hand into the SQL editor. The database has **no record** of which ones have run. Settings → Database guesses by probing columns, and its list stops at 064. | Nothing tells a runner what an instance needs next. | `sql/`, `Settings/MigrationStatus.tsx` |

### 1b. What already points toward instances

- **`clinics.home_instance`** (sql/070, default `'wivo-eu-1'`), and **globally unique UUIDs** for every organisation and job. The spec says why: "so partnerships and shared jobs later work across instances without renumbering ids".
- **"One access layer"** (sql/071 header, spec):
  - A partner reaches shared jobs only through `partner_job_view` and RPCs, never through tables.
  - The UI follows the rule: `hooks/usePartners.ts` "never call `.from('jobs')`".
  - Keeping those names and swapping what is behind them is exactly the relay idea.
- **The privacy filter runs at the owner, before anything leaves.**
  - `partner_visible_text`, `redact_identity` and `identity_terms` (sql/092) read the owner's own patients to find names and personal codes.
  - The `WV001` guards refuse identity in partner-visible text at write time.
  - So the owner's instance can build an outbound payload that is already clean. Neither the hub nor the partner ever needs the patient tables.
- **Files are already shaped for syncing.**
  - They are cleaned before upload: EXIF, DICOM and STL headers (`lib/fileClean.ts`).
  - Each file has a `sha256`, is versioned, and is never replaced (no UPDATE or DELETE policy on Storage).
  - Uploads are resumable (`lib/tusUpload.ts`).
  - So "send file X, version 3, hash H" is well defined, and a retry is safe.
- **The audit log is append-only and per organisation.** Each side logging its own half fits.
- **`shared/license/token.ts`:**
  - Ed25519-signed tokens (`WIVO1.<payload>.<sig>`), checked offline, with the private key outside the app (`scripts/make-license.mjs`) and 14 days of grace.
  - That is the right primitive for "the license server says which modules this organisation has".
  - Today the payload has no organisation, instance or modules (`name, plan, seats, iat, exp`), and enforcement is off (`LICENCE_PUBLIC_KEY` is empty in `src/main/license.ts`; the key is to be restored).
- **Edge Functions that check keys themselves** (`_shared/serviceAuth.ts`, sql/097's `account-security`): one project's `sb_secret` key, compared in constant time and fail-closed. The same pattern serves "an instance proves who it is to the hub".
- **`scripts/fresh-schema.mjs`** builds a fresh database from `sql/` in one go. `sql/test/harness.ts` replays every migration on every test run. Together they are the start of an automated migration pipeline.
- **The spec's export package** (Phase 3, not built): every row of one organisation plus its files, with a manifest of counts and hashes, imported into a clean instance on the same version. That is the tool for moving a clinic out of the shared instance into its own.

---

## 2. What a cross-instance partner exchange needs

### 2a. Shape: a hub, not instances calling each other

- **Direct, instance to instance:**
  - Every pair of instances must know, trust and reach each other, and handle each other's versions.
  - With N instances that is N² trust relationships.
  - A partner that is offline blocks the sender.
- **Through a hub (the spec's relay instance):**
  - Each instance trusts only the hub.
  - The hub holds the partnership registry and a mailbox per instance.
  - It translates between API versions.
  - It stores only what a partner may see anyway: job fields after redaction, files after cleaning, comments, stage events.
  - It sits in the EU and is the data processor for both clinics.

**Recommendation: the hub.** It also lets partners in the same instance keep working exactly as today. The exchange is only used when `home_instance` differs.

### 2b. Authentication between instances

- **Every instance gets an Ed25519 key pair** when it is set up. The private key lives only in that instance's function secrets. The public key and the instance URL are registered with the license server or hub: `instance_id`, `url`, `public_key`, `schema_version`, `api_version`.
- **Every call is signed.** A short-lived signed token (JWT `EdDSA`) carries:
  - `iss` = instance;
  - `aud` = hub;
  - `iat` / `exp` (≤ 60 s);
  - `jti` (an id that is never accepted twice).

  The hub checks it against the registry, refuses a reused `jti`, and does the same thing in the other direction. TLS throughout. mTLS is possible but not needed if every message is signed.
- **Users never cross over.**
  - Instance A says "on behalf of org A, user u (display name, role technician)".
  - Instance B authorises **the organisation**: an active partnership, a shared job, an assigned stage, and the user's role as A reported it.
  - B's audit log records the remote actor as reported, marked as remote.
  - Every permission check that today uses `auth.uid()` on the partner side becomes "a valid signature from the instance the partnership names".
- **Activating a partnership** is the same seven steps as today: invite code, both admins with MFA, Wivo approval. The code is resolved at the hub, so neither instance looks up the other's organisations. The hub's registry entry links `org_a@instance_x` with `org_b@instance_y`.

### 2c. Jobs, files, stage moves, comments

- **Ownership.** The owner's instance is the **source of truth** for a job. The partner's instance keeps a **mirror**: a `shared_job_mirror` table with exactly the fields `partner_jobs()` returns today. `partner_job_view` reads the mirror when the job is remote, and `partner_jobs()` when it is local. The UI does not change.
- **Delivery: outbox and inbox in each instance.**
  1. A trigger or RPC writes an event into `exchange_outbox` in the same transaction as the change. Nothing is lost if the network is down.
  2. A sender (pg_cron plus an Edge Function, like `send-notifications`) posts batches to the hub.
  3. The receiving instance pulls from the hub and applies each event exactly once (`event_id` is unique in `exchange_inbox`).
  4. Each job has its own sequence number, so events for one job apply in order.
  5. Retries with back-off, a dead-letter state, and an admin view of anything stuck.
- **Events, version 1:**

  | Event | From → to | Contents |
  | --- | --- | --- |
  | `share.created` / `share.ended` | owner → partner | the job's partner-visible fields (as `partner_jobs()` returns them, already redacted), the assigned stages, the role |
  | `job.updated` | owner → partner | the changed partner-visible fields only |
  | `stage.move_requested` | partner → owner | job, from, to, the actor as reported |
  | `stage.moved` / `stage.move_rejected` | owner → partner | the outcome, with a reason when rejected |
  | `comment.posted` / `question.resolved` | both ways | the body, already filtered by `partner_visible_text` at the sender |
  | `file.added` | both ways | `job_file` metadata, `sha256`, type, version, and a short-lived fetch URL from the hub |
  | `stock.summary` | location → owner of goods | `partner_stock()` totals, when `share_stock` is on |
  | `partnership.changed` | hub → both | paused, ended, read-only until, `share_stock` |

- **Stage moves become request and answer.** The owner's instance runs the same checks as `move_job_stage` today (`assigned_stages`, `stage_transition`, partnership active), then answers. The partner's UI shows "waiting for the owner" until the answer arrives: seconds when both are online, later when one is offline. The owner always wins a conflict: a move that is stale by then is rejected with the current stage.
- **Files.**
  - The sender uploads the cleaned file to the hub's bucket (resumable, as `tusUpload.ts` does today) and announces it.
  - The receiver pulls it into its own Storage, checks the `sha256`, and confirms. The hub then deletes its copy after a set time.
  - The partner's print and design files reach the owner the same way.
  - The 60-second signed download link (`file-link`) keeps working inside each instance, on the local copy.
  - Large scans make the hub's storage and bandwidth the main running cost of the exchange.
- **Privacy at the border.**
  - What goes into the outbox is built by the owner's instance with the sql/092 functions, and the files were cleaned at upload.
  - **The hub validates as well:** it rejects any event whose text matches the identity patterns it can check (a personal-code pattern) and any file that is not on the allowed list, so one instance's bug does not become the other clinic's data.
  - A cross-instance leak test is a release condition, just like the RLS leak tests today. Two instances plus a hub in test: nothing identifying arrives on the partner side through any event.

### 2d. Notifications

- Each instance creates its **own** notifications when it **applies** an incoming event. For example, applying `file.added` calls the local `notify_org` for the local organisation. Push, e-mail and the bell then work as today, per instance, with that instance's `send-notifications`.
- The sender never writes into the other side's tables. The kinds and texts stay as they are (sql/075, sql/090, sql/095).
- Latency is the outbox delay plus the receiver's pull interval: about a minute with pg_cron, seconds with a webhook from the hub that wakes the receiver.

### 2e. Versioning: instances on different schema versions

- **The envelope:** `{ api: 1, type: 'stage.move_requested', type_version: 1, event_id, job_id, seq, sent_at, from_instance, payload }`.
- **Rules for changes:**
  - Within an API version, changes only **add** optional fields. Receivers ignore fields they do not know. Unknown event types are stored and acknowledged, not failed.
  - A breaking change is a new `type_version`. The hub converts between the newest version and the one before it for as long as any registered instance still speaks the older one.
- **Capabilities in the registry.** Each instance reports `schema_version` and `api_version` on every heartbeat. The hub only sends what the receiver supports, and the license server sets a **minimum supported version**: an instance below it is paused for exchange (not for its own work), and told why.
- **Database migrations stay local.** A migration in one instance never requires the same migration elsewhere at the same moment. Only the event contract is shared, and it changes slowly.
- **Contract tests** in this repo: recorded event fixtures for every supported version, replayed against the current receiver. A `job.updated` from the version before must still apply.

---

## 3. Getting migrations and function deploys to N instances safely, and who can see clinic data

### 3a. What has to exist in every option

1. **A migration ledger in each instance:** `wivo_schema_migration (version, file, sha256, applied_at, applied_by)`. A migration is applied only if its checksum matches the repo, never twice, and in order. Today's hand-run files have no such record. The first step is a **baseline**: an instance that matches migration 097 is marked as having run 000–097.
2. **Expand, then contract.** Desktop apps update on their own schedule, and instances migrate in waves, so for a while every migration must work with the app version before it:
   - add first; switch the app over;
   - remove only in a later release.
   - (Several migrations this year renamed or replaced functions in place. That stays safe only if the old name keeps working for one release.)
3. **Version gating in the app.**
   - The app reads `wivo_schema_migration` (or one RPC) at sign-in and refuses with a clear message if its instance is too old or too new for it.
   - Today's `MigrationStatus` probe guesses. A ledger answers exactly.
4. **Rollout in waves:** CI (the PGlite replay, all tests) → the Wivo test instance → one canary clinic → everyone, with a stop button. Each wave records the ledger state of each instance.
5. **Functions and secrets per instance.**
   - `supabase functions deploy … --project-ref <ref>` for each instance, and each instance's own `WIVO_SERVICE_SECRET_KEY`, VAPID keys, e-mail key and Vault values (`wivo_functions_url`, the service key).
   - Migration 052's hard-coded production URL must go: crons read their URL from Vault (as sql/077 already does) and never from a migration.
6. **Backups per instance** (the spec: a nightly sync to Hetzner Helsinki, started from an EU server), and a quarterly restore test per instance. With N instances these are N jobs, and they need monitoring.

### 3b. Who runs them, and who can see clinic data

| Option | How migrations and deploys arrive | Who technically has access to patient data | Notes |
| --- | --- | --- | --- |
| **0. Today: one shared instance** | Kevin or Claude applies each migration once. One deploy. | **Wivo has full access** (owner of the project, service key, dashboard). Clinics are separated by RLS. Supabase is Wivo's subprocessor. | Simplest. The admin console's "never sees" is a rule in code and policy, not a technical wall. |
| **A. One project per clinic, in Wivo's Supabase organisation** (Wivo bills the clinic) | A central runner (CI with the Supabase Management API) loops over all projects. | **Wivo has full access** to each project. Isolation between clinics is stronger: a bug in RLS cannot leak across clinics, because they are different databases. | Supabase bills Wivo per project's compute; Wivo passes the cost on. A clinic leaves through export. |
| **B. Project in the clinic's own Supabase organisation, with Wivo given access** (a member role, or an OAuth app grant) | The same central runner, using credentials the clinic granted. | **Wivo has full access as long as the clinic allows it.** The clinic can revoke it, and then also receives no updates. Supabase is the clinic's subprocessor. | Matches "the clinic pays". The clinic must keep its own Supabase account (MFA, region eu-west-1, billing). Access works through the Management API or a member role, and in practice it includes reading the data. |
| **C. The clinic's project pulls signed updates** (an agent in the instance fetches migration and function bundles signed with Wivo's key, checks the signature, applies them) | Pull, on the clinic's schedule or automatically. | **In practice, Wivo.** Code that Wivo signs runs with owner rights in the clinic's database, so whoever holds the signing key could read data. Wivo has no standing login, and every applied bundle is logged in the clinic's ledger. | Less standing access, the same trust in the end. Supabase cannot run arbitrary DDL from an Edge Function without a database connection string stored in that instance, which is itself a privileged secret. Complex. |
| **D. The clinic runs updates itself** (a CLI or a "Update database" button for the clinic's own admin) | The clinic, whenever it chooses. | **Only the clinic** (and Supabase as its processor). Wivo has no technical access. | The only option where "Wivo never sees patient data" is technically true. Versions drift; support is harder; the minimum-version rule (2e) pauses partner exchange for old instances. |

Across all four options:
- The **license server and admin console** see only business data: organisations, seats, modules, invoices, storage, version, error counts. Each instance sends this as a daily heartbeat (the spec's `usage_daily` counts, never rows). They never need a connection into a clinic's database.
- The **hub** sees what partners may see, and no more: redacted job fields, cleaned files, comments, stage events. It is a processor for both clinics, under a data-processing agreement.
- **Support access** to a clinic's data, as the spec requires: "only with the clinic's consent, temporary and logged every time". In options A and B this is a policy on access Wivo already has. In D it means the clinic grants access temporarily.
- The spec's **per-clinic encryption keys for files** would make files unreadable even to someone with Storage access. It is the main way to make A–C closer to D for files. It does not help for table rows.

**Module switches when the clinic owns the database.**
- When an invoice is unpaid, Wivo cannot reliably switch a module off inside a database the clinic controls: the clinic's admin could change any row.
- The workable design:
  - The license server issues a **signed entitlement** per organisation: `shared/license` version 2, with `org_id`, `instance`, `modules`, `seats` and `exp` about 35 days ahead.
  - The instance stores it, and `has_module()` reads it.
  - The **app** checks the signature, as `src/main/license.ts` does today.
- Unpaid means the license server stops renewing, and after `exp` plus 14 days' grace the module is off in the app.
- Against a determined clinic that edits its own database, this is enforcement by contract plus app-side friction. That is the same honest standard `license.ts` already states for the desktop app.

---

## 4. Phases, with rough sizes

Sizes are rough weeks for one full-time developer-equivalent, including tests and test-copy rounds. They assume the current pace and quality bar (leak tests as release conditions, a test copy before production).

### Phase A: license server and admin console (4–6 weeks)

Useful immediately, also with the one shared instance (which becomes instance `wivo-eu-1` in the registry).

- **A separate Supabase project, `wivo-platform`.** It is never a clinic database. It holds `platform_admin`, `organisation_registry` (org id, name, `home_instance`, code prefix, so job-code prefixes become globally unique), `instance_registry`, `module_price`, `org_module`, `seat_module`, `platform_invoice` with its lines, `license` / `entitlement`, `usage_daily` and `admin_audit_log`.
- **The admin console:**
  - a separate site with a separate sign-in, using a hardware-key MFA;
  - it talks only to platform Edge Functions;
  - views: organisations, modules on and off per organisation or seat, invoice drafts, then sending them (reusing `invoicePdf.ts` and Resend), payment status, storage, version, errors.
- **`shared/license` version 2:** entitlements per organisation, signed by the license server. In the instance, `has_module()` and `has_seat_module()` are used in RLS and RPCs (spec Phase 3). The app checks the signature, and enforcement turns on once the public key is restored.
- **A heartbeat from each instance:** a daily signed post with counts only (seats, storage, version, module events).
- **Moving the partnership approval** out of the SQL editor and into the console.
- Tests:
  - the admin boundary: no patient field in any platform response, and no clinic token can read platform tables;
  - entitlement signature tests;
  - invoice arithmetic.

### Phase B: automated migrations and deploys (3–5 weeks)

- The migration ledger, the baseline for the existing production and test copy, and a runner. It starts as a CI job with an approval step per wave (option A or B in 3b).
- Expand-then-contract written into the migration rules (CLAUDE.md), and a check in CI that each migration applies on top of the previous release's schema.
- Version gating in the app, replacing the guessing in `MigrationStatus`.
- Function deploys and secrets per instance, from the registry. No URL written into any migration (052's job reads Vault).
- **The app finds its instance at run time:**
  - sign-in → the license server returns the instance URL and public anon key for that organisation;
  - the desktop no longer bakes one URL in at build time;
  - the phone app reads the same thing at start;
  - the test-mode guard checks "not a production instance" against the registry instead of one hard-coded ref.
- Backups and restore tests driven by the registry.

### Phase C: the partner exchange through a hub (8–12 weeks, the largest risk)

- The hub, as a project of its own: registry, mailboxes, file staging, version translation, identity validation.
- Per instance:
  - a key pair;
  - outbox and inbox tables, with their own sender and receiver;
  - `shared_job_mirror` and mirrors for thread and files;
  - `partner_job_view`, `job_thread`, `job_files`, `move_job_stage`, `post_job_comment` and `partner_stock` routed to the mirror or the exchange when the partner is remote, unchanged when it is local.
- Stage moves as request and answer; the UI shows "waiting for the owner".
- Notifications created by the receiver; both audit logs written by each side for its own half.
- Tests:
  - contract tests per event version;
  - two-instance-plus-hub integration tests;
  - **a cross-instance leak test as a release condition**;
  - offline and replay tests (the same event twice, events out of order, a partner offline for a day).
- Legal: the hub's data-processing agreement with each clinic, and its place in the partnership steps.

### Phase D: "own instance" as an option (4–6 weeks)

- **Provisioning:**
  1. create the project (Wivo's organisation or the clinic's, per the decision in 3b) in eu-west-1;
  2. apply the schema through the runner;
  3. deploy the functions;
  4. set secrets and Vault;
  5. schedule the crons;
  6. register the instance and its key.
- **Moving an existing clinic out** of the shared instance: the spec's export package (every row by `org_id`, files under `org/`, a manifest with counts and hashes), imported into the new instance. Then the round-trip check, the deletion from the shared instance, and the deletion register. Its shared jobs with partners switch from local to the exchange at a planned moment.
- Support access with consent; per-instance monitoring in the console (version, last heartbeat, backup status, exchange backlog).
- Documentation for the clinic: what it pays Supabase for, what Wivo can and cannot see in the chosen option, and how updates arrive.

**Total: about 19–29 weeks (5–7 months).** Phase C is the uncertain part. A and B can ship and be used before C starts, and C can be postponed until a real customer requires its own instance.

---

## Decisions for Kevin

1. **The locked decision.** Does "every clinic its own project" replace "one shared hosted instance, RLS keeps them apart", or become an option next to it? (Recommended: an option. The shared instance stays the default, and the spec is updated to say so.)
2. **Whose Supabase organisation owns a clinic's project, and does Wivo keep standing access?** (Options A–D in 3b.) This decides whether "Wivo never sees patient data" is a technical fact or a contractual promise. Say it accurately to clinics either way.
3. **Do partners in the same instance also go through the hub?** Same-instance stays the fast path; everyone through the hub is one code path, but slower.
4. **The minimum supported version, and how long the hub translates the version before it.** (Suggested: one version back, for a set time.)
5. **Where the hub runs and who pays for its storage and bandwidth.** Scans dominate.
6. **Invoicing for module switches:** how long the entitlement lasts and how much grace there is before a module turns off (today's licence grace is 14 days).
