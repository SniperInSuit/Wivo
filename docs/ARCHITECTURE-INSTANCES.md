# Clinic instances: every clinic in its own Supabase project, owned by the clinic

Status: **plan.** Kevin's decisions of 4 November 2026 are in (§10). The update design was reworked for 100 clinics: pulled, no tokens to Wivo, automatic installs (§5). **Waiting for Kevin's OK** on §10's items 7 and 8 before building. Nothing is built.

This replaces the assessment of 3 November 2026, which is kept unchanged at the end ("Superseded").

---

## 0. The decision, and what it changes

**Kevin's decision (2026-11-04):**
- **Every clinic has its own Supabase project, in its own Supabase account.** The clinic owns and manages that account.
- **Wivo never sees or touches the contents after setup.**
- **New migrations and functions reach each clinic with Wivo updates.**
- **Our own clinic stays on its current project.**
- **The first partner is a clinic in Riga** with its own Supabase account. Their lawyer requires the separate database, and that is not negotiable.

The partnership with Riga works across the two projects:
- **Shared jobs:** we scan; they do the technician work and the print files; we print and mark the job done.
- **The rest:** files, the job's chat, notifications, and stock lent with a deadline (buy or return).
- **Their own statistics.**

**What it changes:**
1. **The spec's locked decision** ("all hosted organisations in one Supabase project, RLS keeps them apart") is replaced. `wivo-2.0-spec.md` was changed on 4 November 2026: the old line is struck through, and the new one is "one Supabase project per clinic, owned by the clinic; partnership through the direct bridge".
2. **No Wivo infrastructure in the data path.** The superseded plan put a Wivo hub between instances, and options A–C of its §3b gave Wivo standing access. Both are out:
   - partners talk to each other directly (§1);
   - updates are signed packages that each clinic's project pulls and applies itself, approved by the clinic or installed automatically (§5). No clinic ever sends Wivo a token.
3. **What stays the same:**
   - one codebase and one app;
   - the same migrations everywhere;
   - the access rules (RLS, sql/098 second factor, sql/116–118).

   Each project runs its own copy.
4. **What Wivo still runs, none of it holding clinic data:**
   - the app's code and the update packages, signed and published for every clinic alike (5a);
   - the phone app's static site (Cloudflare);
   - licences (signed tokens, `shared/license`).

---

## 1. The partner bridge between two projects

### 1a. Direct link or Wivo relay

| | **Direct link** (each project's Edge Function, signed messages, outbox and inbox) | **Wivo relay** (store and forward, end-to-end encrypted content) |
|---|---|---|
| Data path | Tallinn's project ↔ Riga's project. Nothing else. | Both projects ↔ a Wivo server. |
| What Wivo sees | Nothing. | No content, but the metadata: who talks to whom, when, how often, and file sizes. |
| Wivo's legal position | Software vendor only. | Very likely a processor for both clinics: encrypted personal data is still personal data while someone holds the keys. A lawyer question (Q2). |
| When one side is down | The sender keeps the message in its outbox and retries for days. Paid Supabase projects don't pause, so "offline" means an outage or an error, not a closed laptop. | The relay holds it until the receiver collects. |
| Public endpoint on each clinic project | Yes: `bridge` and `bridge-pair` (1i). | No: both sides poll the relay. |
| Version differences | The sender writes to the version the receiver announced (1e). | The relay could translate, but can't see inside encrypted content, so the sender still has to. |
| Files (large scans) | The receiver copies straight from the sender's Storage. Each clinic pays its own transfer. | Through the relay's storage. Wivo pays for the bandwidth. |
| Cost and operations | Nothing new for Wivo. | A Wivo service with uptime, storage, monitoring and key handling for every partnership. |
| Complexity | Signatures, outbox, inbox, retries. | All of that, plus end-to-end encryption, key distribution and the relay itself. |

**Recommendation: the direct link.**
- It is the only option where "Wivo never sees or touches it" holds for the partnership too, metadata included.
- Supabase projects are always-on servers, and partnerships are few, so the reasons for a relay (offline peers, N² trust) are weak here.
- The price is a public endpoint on each clinic's project. 1i keeps it narrow.

### 1b. Pairing: how two owners connect

Only **owners**, signed in with the **second factor** (sql/098), can pair. The current code rules carry over (sql/070): a hashed one-time code, limited attempts, an expiry.

1. **Tallinn's owner** opens Partners → "Connect a clinic". Tallinn's project:
   - makes a key pair for this partnership (1c);
   - shows a **pairing token**: Tallinn's bridge URL, organisation id and name, the partnership's public key, and an expiry of 24 hours, signed with that key;
   - shows a separate **one-time code** (12 characters). Only its hash is stored, and it allows five attempts.
2. **The token goes to Riga's owner** by any channel, for example e-mail. **The code goes another way**, for example by phone or in person.
3. **Riga's owner** pastes the token and types the code. Riga's project:
   - makes its own key pair;
   - calls Tallinn's `bridge-pair` with Riga's URL, organisation, public key and a proof `HMAC(code, both public keys, nonce)`. The code itself never travels.
4. **Tallinn's project** checks the proof and the attempt count, and stores Riga as a pending partner.
5. **Both apps show the same safety code,** six words derived from both public keys. The owners read it to each other: in person, or on a call they started themselves. Each confirms in their own app. That defeats someone who intercepted the token and the code.
6. **Both sides become active.** Each audit log records every step (§4).

The partnership settings travel with it, as today: roles, the stages Riga may move, and stock sharing on or off. Each owner can change their own side; a change is a message (1d).

**Wivo's approval step goes away** (`platform_approve_partnership`, SQL only today). Wivo would have to see the partnership, and nothing else needs it. If cross-clinic partnering is a paid module, the licence says so, in the app.

### 1c. Keys, and how to revoke them

- **One Ed25519 key pair per partnership, per side:**
  - the private key lives in that project's Vault and is read only by the bridge functions;
  - the public key of the other side lives in `bridge_peer`.

  Ending one partnership never touches another.
- **Rotation:** each side rotates its key every 12 months, and whenever an owner asks.
  - The new public key is announced in a message signed by the old key.
  - Both keys are accepted for 7 days.
- **Revocation:**
  - "End partnership" deletes the peer's key on that side and sends `pair.ended`.
  - From then on, every message from that peer is refused, whether or not the other side ever received `pair.ended`.
- **A key that may be compromised** is never rotated through itself. The owner ends the partnership and pairs again (1b).
- **A transport layer** on every HTTP request:
  - an Ed25519 signature over method, path, timestamp, a nonce and the body hash;
  - a 5-minute window;
  - a nonce cache, so a recorded request can't be replayed.

  TLS throughout. Payload encryption isn't needed on a direct link; the content goes only to the party it's meant for.

### 1d. The message format

```json
{
  "proto": 1,
  "type": "job.updated",
  "type_v": 1,
  "id": "c8f0…",          // unique per sender; the idempotency key
  "pair": "3a1e…",        // the partnership
  "stream": "job:5b7d…",  // ordering unit: one job, one stock item, or the partnership itself
  "seq": 42,              // per stream, from 1, no gaps
  "sent_at": "2026-11-04T10:00:00Z",
  "app": "2.3.0",         // the sender's Wivo version
  "body": { … }
}
```

- **Signing:** each envelope is signed with Ed25519 over its canonical JSON (RFC 8785), so it can be checked again later, for example in the audit. One HTTP request carries up to 100 envelopes.
- **Size:** a body is at most 256 KB. Files never travel in messages (§2b).

### 1e. Versions: two clinics on different Wivo versions

- **Announcing versions:** each side sends a `hello` when pairing and after every update. It holds the app version, the protocol versions it speaks, and its message types with their `type_v`.
- **The sender writes for the receiver,** using the highest `type_v` the receiver announced. A Wivo release keeps writing and reading the previous `type_v` of every message for at least two releases (and at least 3 months), so one clinic can update later than the other.
- **Within a `type_v`, changes only add optional fields.** Receivers ignore fields they don't know.
- **An unknown `type`** is stored, acknowledged as "unsupported" and shown in the admin view (1g). It never fails silently, and never fails the batch.
- **Too far apart** (the peer below the oldest version the sender still writes): sending pauses for that partnership, and both owners see "Riga needs to update Wivo". Each clinic's own work is never paused.
- **Contract tests:** recorded envelopes of every supported `type_v` are replayed against the current receiver in CI (§8).

### 1f. Retries and ordering when one side is down

1. **The outbox:**
   - a change that a partner must hear about writes its envelope into `bridge_outbox` in the **same transaction** as the change;
   - nothing is lost if the network or the peer is down;
   - nothing is sent for a change that rolled back.
2. **The sender:** pg_cron runs `bridge-send` every minute, and a trigger wakes it at once through `pg_net`.
   - It sends each stream in `seq` order.
   - It backs off exponentially: 1 minute, doubling, up to 1 hour between tries.
3. **After 72 hours undelivered,** the partnership shows "not delivered" to both owners (1g), with the oldest stuck message.
   - Sending goes on; nothing is dropped.
   - After 30 days the owner decides: keep trying, or end the partnership.
4. **The receiver** (`bridge` endpoint) applies each stream in order.
   - A message whose `seq` is ahead of the next expected one is kept in `bridge_inbox` as waiting.
   - The receiver answers with the last `seq` it applied, so the sender resends from there.
5. **Conflicts** follow ownership: the **owner of the job** (or, for stock, the lender) decides.
   - A partner's stage move is a request (`stage.move_requested`). The owner checks it exactly as `move_job_stage` does today (assigned stages, `stage_transition`, partnership active) and answers `stage.moved` or `stage.move_rejected` with the current stage.
   - Riga's app shows "waiting for the owner" until the answer arrives.

### 1g. Idempotency, and an admin view

- **`bridge_inbox` is unique on `(pair, id)`.** A repeated envelope is acknowledged again and not applied twice.
- **Every effect is keyed by the envelope id.** A file is fetched once (by its `sha256`), and a stock movement carries the envelope id.
- **Partners → a partnership → "Messages",** for owners: what's waiting, stuck or refused, with type and time, never content. It also offers "send again".

### 1h. Rate limits

- **`bridge`:**
  - Before any signature check: requests of at most 1 MB.
  - After the signature check, per partnership: 600 envelopes a minute and 20 file fetches a minute.
  - Over the limit, the request is refused with 429 and `Retry-After`. The sender's back-off honours it.
- **`bridge-pair`:**
  - five wrong codes end that pairing token;
  - 20 attempts an hour per IP address;
  - one open pairing token per owner at a time.
- **Refusals are counted per hour** in the audit log, not one row each (§4), so an attack can't flood the log.

### 1i. The public endpoint: attack surface

Each project exposes two Edge Functions without Supabase's user check:
- `bridge`;
- `bridge-pair`, active only while a pairing token is open.

The file-fetch URLs are Storage's own signed URLs (§2b).

| Threat | Guard |
|---|---|
| Forged messages | Every request and every envelope is signed with a key from `bridge_peer`; unknown or ended peer → refused before any database write. |
| Replay | Timestamp window + nonce cache (transport); envelope id unique (`bridge_inbox`). |
| A compromised or buggy partner | It can only act on what is shared with it, through the same checks as today (`assigned_stages`, `stage_transition`, partnership active, the partner's file types `print` and `design` only). Every body is checked against a strict schema; text and files from a partner reach only the owner (sql/085). |
| Identity leaking out | The owner's project builds the outgoing envelope with sql/092's functions (`partner_jobs()` fields, `redact_identity`). The WV001 guard refuses identity in partner-visible text at the source. A leak test is a release condition (§8). |
| Flooding and cost | Size limit before parsing, rate limits after the signature, no database work for unsigned requests. **Residual risk:** each invocation of a public Edge Function is billed to the clinic, and a large flood still costs money. Check whether Supabase lets a project set firewall rules in front of an Edge Function. Monitor, and ask Supabase to block a flood if one happens. |
| SSRF through file fetches | A file is fetched only from the peer's own Storage host, as recorded at pairing, and only through the URL the peer signed for that file. |
| Stolen Vault key (someone with full access to one project) | That person already has all of that clinic's data. The key gives them only what the partner shares with that clinic. Ending the partnership revokes it. |
| Malformed or huge payloads | 256 KB per body, strict JSON schemas per `type_v`, no SQL built from strings, and file types and sizes on an allowlist. |

---

## 2. What crosses

### 2a. A shared job: the minimum

**The rule:** what the partner may see today, and nothing more.
- The owner's project sends exactly the fields `partner_jobs()` returns (sql/092), after the same redaction:
  - job code, case type, role and assigned stages, stage;
  - received date and due date;
  - work type, work items, teeth, material, shade, stump shade and description;
  - rush and model;
  - remakes;
  - the agreed partner price;
  - the patient's age.
- **Never** a name, personal code, contacts, birth date, medical card, visit notes or prices other than the partner's own (CLAUDE.md, the lawyer's locked rule).
- **Patient identity is left out by default, with no switch to send it.** `job_share_partial_only` (sql/092) stays: full visibility can't be turned on.

**Riga's project keeps a mirror** (`shared_job_mirror`) of these fields.
- `partner_jobs()` / `partner_job_view` read the mirror when the job is remote. The partner screens don't change (`hooks/usePartners.ts`).
- **Both ways:** Riga can share its own jobs with us the same way, and Riga is then the owner.
- **Their own statistics:** Riga's statistics are its own project's. The work it does on our jobs appears in its counts from the mirror, as jobs done for a partner. That's a small change to Statistics, which today counts only the clinic's own jobs.

**Messages for a job:**

| Message | From → to |
|---|---|
| `share.created`, `share.ended` | owner → partner |
| `job.updated` (the changed partner-visible fields only) | owner → partner |
| `stage.move_requested` | partner → owner |
| `stage.moved`, `stage.move_rejected` | owner → partner |
| `file.added` | both ways |
| `comment.posted`, `question.resolved` | both ways |

### 2b. Files: copies, kept on both sides

**Copies, not lasting links.** Each clinic must keep what it used and produced (2d), so a file the other side may later delete or stop sharing can't be the only copy.

1. **The sender's project announces the file** in `file.added`: the metadata from `job_file`, its `sha256`, size, type and version. The file was already cleaned at upload (`lib/fileClean.ts`: EXIF, DICOM, STL headers), as today.
2. **The receiver asks for it** with a signed `file.fetch`. The sender answers with a Storage signed URL valid for 10 minutes, for that one object.
3. **The receiver's `bridge` function streams it** into its own `job-files` bucket in chunks. Large scans use resumable uploads, as `tusUpload.ts` does in the app. The wall-clock limit of an Edge Function is several minutes, so anything bigger continues in the next run.
4. **The receiver checks the `sha256`** and records a `job_file` row in its mirror, then confirms with `file.received`. On a mismatch it fetches again; after three mismatches it stops and tells the owner.

Where files are kept:
- each in the bucket of the clinic that received or made it;
- the partner only ever adds `print` and `design` files, as today;
- the 60-second download link (`file-link`) works inside each project, on the local copy.

### 2c. Chat and notifications

**Chat:**
- A comment on a shared job is sent as `comment.posted`. Text from the owner's staff passes the WV001 check before it is saved, as today.
- Both projects store the thread: the owner's in its `messages`, the partner's in a mirror.
- A partner's message goes to the owner only, never to another partner (sql/085).
- Authors are shown by the display name the sending clinic reported, marked as the partner's.

**Notifications:**
- **The receiving project makes its own,** when it applies a message. For example, `file.added` calls the local `notify_org` for the local staff.
- Push, e-mail and the bell then work as today, from that project's own `send-notifications` and its own e-mail account (§6c).
- **Nothing writes into the other side's tables.**

### 2d. Unshare, unpair, and what each side keeps

- **Unshare** (`share.ended`):
  - The partner's mirror of that job becomes read-only. Nothing new arrives, and the partner's stage moves and uploads are refused.
  - The partner keeps what it needs for its own records: the job data it received, the files it made or received, its stage history and the chat.
  - It keeps them read-only, for the period its law requires (questions Q4 and Q5), then deletes them. The owner keeps everything, as today.
- **Unpair** (`pair.ended`, either owner):
  - all shares end as above;
  - keys are deleted;
  - from then on, nothing is accepted from that partner.
  - For **30 days** (today's `readonly_until` idea), the stock still open between the two can be settled: buy out or return. These are the only messages accepted.
- **What each side must keep** under medical-record and medical-device law is a question for the lawyer (Q4 and Q5). One example: the documentation for a custom-made device under the MDR, Annex XIII.
- **The app keeps records read-only and searchable for that period,** then a purge job deletes them. Both are recorded in the audit log (§4).

---

## 3. Stock across projects

**The lender's project is the source of truth for its goods.**
- The lender is the clinic that owns the goods. The borrower is the clinic whose shelf they are on.
- This turns sql/093 around, where the shelf's project holds the item. Across projects, the owner of the goods decides.

1. **Offering:**
   - the lender records the goods it sends as consignment items in its project: product, lot, expiry, quantity and due date, 3 months by default;
   - it sends `stock.offered`;
   - nothing about jobs or patients is in it.
2. **Receiving:**
   - in the borrower's app, offered stock appears under Stock → "From partners", from a mirror;
   - the borrower confirms what physically arrived (`stock.received`, with any difference in quantity);
   - only then can it be used.
3. **Using it:**
   - the borrower uses an item on its own job, as today: the lot is linked to the job, and through it to the patient, **in the borrower's project only**;
   - the lender is told `stock.used {item, quantity, at}`, with no job and no patient;
   - **using is never blocked** by the lender being unreachable, because a patient is in the chair. The message waits in the outbox (1f).
4. **Returning:**
   - the borrower sends `stock.returned {item, quantity, reason}`;
   - the lender confirms with `stock.return_received` when the goods arrive;
   - until then, the quantity shows as "in transit" on both sides.
5. **Buying out:**
   - the borrower asks (`stock.buyout_requested`), or the due date passes;
   - the lender confirms (`stock.bought_out`) and invoices in its own project, as today's `buy_out_stock`;
   - the item then leaves the lender's consignment.
6. **Deadlines and expiry:**
   - the due date and expiry come from the lender;
   - both sides show them, red a month before the due date (as today);
   - the lender can move the due date (`stock.due_changed`);
   - the borrower's local rule still applies: expired goods aren't used on a job without its own owner's override, which is logged;
   - goods that expire, or reach the due date unsettled, are listed for both owners to settle by return, buy-out or write-off.
7. **Conflicts:** the lender's ledger wins.
   - When the borrower reports more used than the lender has left, or uses an item the lender has already recalled or marked returned, the lender applies what it can.
   - It records the rest as **disputed**, and answers `stock.correction` with its numbers.
   - The borrower's mirror takes the lender's numbers, and both owners see the dispute until one of them settles it, usually by buy-out.
   - Each item is one stream, so its events apply in order (1f).

---

## 4. Audit on both sides

Each project writes its own half into its own `audit_log`, which is append-only for everyone (sql/114, 115):
- **Pairing:** token made, code tried (counted), paired, settings changed, key rotated, ended.
- **Every message sent and every message applied:**
  - type and envelope id;
  - the partner organisation;
  - on the owner's side, the job code; on the partner's side, the mirror's job reference;
  - the outcome: applied, rejected (with the reason), or unsupported;
  - the hash of the body.

  The content isn't copied: it is in the job, the thread or the stock record, which have their own history.
- **Files:** announced, fetched, received (hash and size), and failed.
- **Stock:** each movement made from a partner's message carries the envelope id, and disputes and corrections are logged.
- **Refusals:** bad signature, unknown peer, over the limit. Counted per hour and peer, so a flood can't flood the log.
- **The actor of a remote action** is the partner clinic plus the staff display name it reported, marked "partner". It is stored in `actor_name` (sql/115), with no local user id.
- **Settings → Audit log** filters these as their own actions: "Sent to a partner" and "Received from a partner".

---

## 5. Updates without access to the clinic's data

**Requirements** (Kevin, 2026-11-04):
- It scales to 100 clinics with **no per-clinic work for Wivo**.
- **No clinic ever sends Wivo a token.**
- **Updates are pulled, not pushed:** each clinic's Wivo sees the new signed package and applies it in its own project.
- **Database changes need no token:** the function installed at setup applies them.
- **Who approves:** the owner, or a member the owner has given the permission **"Install updates"**. Admins don't get it automatically.
- **Approving always needs a fresh second-factor code,** and the audit log records who approved which version.
- **A clinic setting, "Install updates automatically",** for after an approver has turned it on once. Every signature check still runs.

### 5a. The signed package, and where it is published

Every Wivo release that changes the database or the Edge Functions ships an **update package**, built in CI from the tagged release:

```
wivo-update-2.3.0.tar
  manifest.json      version, the oldest version it updates from, a list of files with sha256,
                     "manual_only" (true for a release that must not install by itself),
                     "auto_after" (the earliest time an automatic install may take it)
  migrations/*.sql   the migrations since the baseline (docs/MIGRATIONS.md), in order
  functions/*.zip    the Edge Function bundles; often none (5c)
  checks/*.sql       the read-only checks (schema_check.sql, …)
  manifest.sig       Ed25519 signature over manifest.json (as `shared/license`)
```

- **The signing key** is Wivo's release key, kept offline like the licence key (`scripts/make-license.mjs`). The public key is pinned in the app and in the clinic's project at setup (5b).
- **Where packages are published:** with the desktop app's releases (GitHub Releases), next to a signed index, `updates.json`. The index holds:
  - every published version with its package URL and `sha256`;
  - `auto_after`;
  - a **withdrawn** list: a version Wivo pulls back after publishing is never installed automatically, and an approver who opens it sees why.
- **The list is public and only grows.** A clinic, or its auditor, can see that it received the same package as everyone else, and read its SQL before approving. That makes a version made for one clinic visible.
- **Wivo's only work per release is publishing.** It touches no clinic.

### 5b. How each clinic's project pulls and applies it

**Who approves:**
- **The owner, or a member with the new permission "Install updates"** (`updates.install`).
  - It is not among the permissions an admin has without a grant (`ADMIN_PERMISSIONS`, sql/102). The owner gives it in Team like any other.
  - Below, "an approver" is either of them.
- **Approving always needs a fresh second-factor code:** the app asks for a new authenticator code right before the call. The function accepts only:
  - an approver;
  - with `aal2`;
  - whose `totp` time in the session's `amr` is under 5 minutes old.

**Two ways an update arrives. Neither involves Wivo beyond publishing:**
1. **Approved by hand.**
   1. A desktop app sees a new version in the index on its usual update check. To the approvers it shows "Database update 2.3.0", with the release note and the list of migrations and functions; it shows nothing to anyone else.
   2. An approver presses **Install** and enters a fresh code.
   3. The app asks the clinic's own `wivo-update` (an Edge Function installed at setup) to install that version. The function downloads the package itself from the published address and checks everything (below). The app never carries the package.
2. **Automatically,** once an approver has turned on Settings → Updates → **"Install updates automatically"**.
   - Turning it on, or off, needs a fresh code, and is recorded in the audit log.
   - A scheduled job in the clinic's own project (pg_cron, at night) asks `wivo-update` to check the index.
     - It installs the newest version that is past its `auto_after` time, not withdrawn and not `manual_only`.
     - The scheduled call authenticates with a value from the project's own Vault, as the other scheduled jobs do (sql/077). From outside, it can only ask for a check, and a check installs nothing that isn't signed and newer.
   - `auto_after` lets Wivo's own production and the clinics that install by hand go first. A release with a problem can be withdrawn before most clinics take it.
   - Each automatic install is recorded as **automatic**, naming who turned the setting on and when.
   - Approvers get a notification afterwards: "Updated to 2.3.0", or what failed.

**What `wivo-update` checks, every time, in either way:**
1. **Wivo's signature,** against the key pinned in the function's own code: not a table, not a secret. Then each file's `sha256` against the signed manifest, and the index's signature.
2. **Only a newer version:** above the highest version in the migration ledger (`wivo_schema_migration`, docs/MIGRATIONS.md), and updating from the version the clinic has.
3. **Not withdrawn.** For an automatic install, also past `auto_after` and not `manual_only`.
4. **Who:** an approver with a fresh code, or the project's own scheduled job with the setting on.

**Then, in order:**
1. **Migrations, without any token.** Every migration of the package, the ledger rows and the audit entry, in **one transaction**, through the project's own database connection (`SUPABASE_DB_URL`, which Supabase gives every Edge Function). If anything fails, nothing has changed.
   - So migrations must not contain statements that can't run in a transaction. A CI check refuses them.
2. **Edge Functions,** only if the package has any: 5c.
3. **The read-only checks** (`schema_check.sql` and the others). Their rows go to the approvers.
4. **The audit log:**
   - who approved (a person, or "automatic, setting turned on by X on date");
   - the version from and to;
   - the package hash;
   - the result.

   A refused attempt is recorded too: who or what, why, and the package hash.

**Order with the apps:**
- Migrations only add (expand, then contract: docs/MIGRATIONS.md), so the previous app version and the previous functions keep working on the new schema.
- A desktop that updated before its database says "Waiting for the database update" and works read-only. One whose database is too new for it asks to be updated.

**A clinic that doesn't update:**
- its own Wivo keeps working with the version it has;
- the bridge pauses when two partners are too far apart (1e).

### 5c. Edge Functions: what Supabase allows, and the recommendation

**A function can't redeploy functions.** Deploying needs the Supabase Management API and a credential for the clinic's account. These are the options, checked against Supabase's pages on 2026-11-04 (sources at the end of 5d):

1. **A scoped personal access token, kept in the clinic's own project.** *(Recommended.)*
   - **What Supabase offers since October 2026:**
     - a token limited to **selected projects** (one, here), with permissions chosen per capability, each read or read-write;
     - **"Edge Functions (Read-write)"** covers creating, updating, deploying and deleting functions;
     - database and SQL, API key secrets and function secrets are separate permissions, so this token gets none of them;
     - an expiry of **up to one year**;
     - the scope can't be changed afterwards: a different scope means a new token;
     - **a token never has more access than the user who made it**, and stops working when that user loses access.
   - **At setup:**
     - the owner creates one token: their project only, **Edge Functions read-write only**, the longest expiry offered (up to a year);
     - the wizard passes it straight into the project's Vault, where only `wivo-update` reads it;
     - it is never sent to Wivo;
     - the owner grants it once.
   - **When it is used:** only for function bundles inside a signed package whose hashes match. A release without function changes doesn't touch it.
   - **Renewal:** once a year, 30 days ahead, approvers are asked to make a new one. The app shows the exact choices and sends the new token from its memory straight to the Vault; it doesn't store it.
     - The same happens if the person who made it leaves the clinic's Supabase organisation, since the token then stops working.
     - Until it is renewed, migrations keep installing (they need no token). Only function changes wait, and the previous functions keep working (expand, then contract).
   - **The honest limit:** a deployed function runs with the project's service key, so whoever can deploy functions can, in effect, reach the data. No credential can deploy functions without that.
     - The token itself can't read data through the Management API: it has no database, secrets or keys permission.
     - In substance it is the same trust as the signed migrations, which already run with full rights. Only Wivo-signed bundles are ever deployed with it.
2. **A Supabase OAuth app registered by Wivo.** *(Not recommended.)*
   - Scopes are set when the app is created, and there is an Edge Functions write scope.
   - But the token exchange sends the app's **client secret** along with PKCE. So either Wivo's server takes part in every clinic's token exchange, which puts Wivo in the token's path, or Wivo's client secret is copied into 100 clinics' projects.
   - Supabase's guide also says such tokens may still give full Management API access until fine-grained control is complete.
3. **Supabase's GitHub integration**, which deploys migrations and functions when a branch changes. *(Not recommended.)*
   - Each clinic would have to connect a GitHub repository, and its updates would come from whoever can push to it.
   - That's push, not pull, and too much to ask of a clinic owner.
4. **A short-lived token for each function update,** created, used once in memory and deleted with the approver: the earlier plan. *(Kept as the fallback.)*
   - It is used when a clinic chooses not to keep any token (a setting), and while the stored token is expired or missing.
   - It needs a person, so automatic installs pause at function changes until an approver does this step.

**Keep Edge Functions few and stable, whichever option.**
- **Logic goes into the database,** where migrations deliver it without any token.
- Edge Functions stay only where the database can't do the work:
  - sending e-mail and push;
  - signed file links;
  - creating accounts through Supabase Auth;
  - the bridge endpoints;
  - `wivo-update` itself.
- A function's code reads its settings from the database (Vault), not from function secrets. A release then never needs a new function secret, which the stored token couldn't set.
- **Most releases contain no function changes.** A CI check lists the changed functions in every package, and a release note says why each changed.

**Recommendation: option 1, with option 4 as the fallback, plus few and stable functions.** Why:
- It meets all three requirements: no per-clinic work for Wivo, no token ever to Wivo, and updates pulled and possibly fully automatic.
- The stored token is the narrowest Supabase offers: one project, functions only, at most a year. It never leaves the clinic's project.
- It adds no power that the signed migrations don't already have.
- Option 4 alone would stop automatic installs at every function change, and option 2 puts Wivo in the token's path.

**This changes condition 3 of 4 November** ("the owner's token is never stored"). Under this recommendation, the narrow functions-only token is stored, in the clinic's own Vault. Broad tokens are still never stored: the setup token (6b) is used once and deleted. **Decision 3 in §10.**

### 5d. What can't be enforced technically, and must be in the contract

1. **A signed update runs with full rights in the clinic's database,** and a deployed function with the project's service key. Whoever holds Wivo's signing key could ship code that reads data.
   - Mitigations:
     - an approver approves, or turned on automatic installs knowingly;
     - packages are public and identical for every clinic (5a), and the SQL can be read before approval;
     - `auto_after` and the withdrawn list give a window to stop a bad release.
   - It stays trust. So the contract says:
     - Wivo's updates never read, copy or send clinic data;
     - the clinic has audit rights;
     - liability applies.
2. **The Wivo app runs on the clinic's computers with its users' sessions.** The same trust applies as for any desktop application, and the same clause.
3. **The clinic controls its own database.** Licence and module limits are enforced in the app (signed licence), not inside the database, as `src/main/license.ts` already states.
4. **Whoever is present at setup may see keys or passwords on screen** (§6): at Riga, Kevin. They are rotated before setup ends, and the setup record says so.
5. **Supabase, Resend and the clinic's other processors** are the clinic's contracts, not Wivo's.

**Sources checked on 2026-11-04:**
- [Scoped personal access tokens are now generally available](https://supabase.com/changelog/scoped-personal-access-tokens-ga)
- [Scope your Personal Access Tokens](https://supabase.com/blog/scope-your-personal-access-tokens)
- [Personal Access Tokens](https://supabase.com/docs/guides/platform/personal-access-tokens)
- [Scopes for your OAuth App](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes)
- [Build a Supabase Integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)
- [GitHub integration](https://supabase.com/docs/guides/deployment/branching/github-integration)

Check them again when building: Supabase changes these.

---

## 6. Setup: on site in Riga, then by each clinic itself

This builds on docs/MIGRATIONS.md (prompt 16): the baseline schema, one-click setup and the read-only checks.

### 6a. What Riga must have ready before Kevin arrives

Kevin sends this list at least two weeks ahead, and checks it on a call a few days before the visit.

1. **Access to their domain's DNS:**
   - a login to the domain registrar or DNS host, or a person who can add records on the day;
   - for the domain they will send e-mail from, for example `<their-domain>.lv`;
   - Resend asks for its sending records (SPF, DKIM, a return path), plus a DMARC record. DNS can take hours to take effect, so the records go in before the visit if possible.
2. **A Supabase account with billing:**
   - owned by the owner's own e-mail, with MFA on;
   - an organisation in the clinic's name;
   - a paid plan with a card added, because free projects pause and the bridge needs the project always on;
   - the region decided (6b, Q8).

   No project needs to exist yet; it is created on the day (6b).
3. **A Resend account,** owned by the clinic:
   - MFA on, and the EU region;
   - the sending domain added and its DNS records in place (item 1);
   - a plan that fits their volume of invites, password e-mails and notifications.
4. **People and devices:**
   - the owner's computer, with the right to install software (setup and every later update run from it);
   - an authenticator app on the owner's phone;
   - the staff list: names, e-mail addresses and roles;
   - the phones staff will use;
   - the scanner's export folder, if they use one.
5. **Choices:**
   - the clinic's three-letter code (for example `RIG`; it starts every job code);
   - the default language (the spec: English first, then Russian and Estonian);
   - the Supabase region.
6. **Paperwork:** the licence and setup terms (including §5d), and the lawyer's answers that Riga needs for its own use (Q1, Q8, Q9, Q10).

### 6b. On the day, with Riga's owner at the keyboard

**The rules:**
- Every credential is created by the owner, in the owner's accounts, on the owner's computer.
- **Kevin is not added to their organisation.**
- No token or key leaves their computer or their project.

1. **The owner creates the project** in their organisation:
   - region `eu-north-1` (Stockholm, the nearest) or `eu-central-1`, as their lawyer prefers (Q8);
   - the database password goes into their password manager. The wizard doesn't need it.
2. **The owner installs Wivo** on their computer and chooses "Set up a new clinic database". The wizard asks for:
   - the project URL;
   - **a setup token,** a personal access token the owner creates as the wizard shows it:
     - this project only;
     - Edge Functions, Edge Function Secrets and Auth Config, each read-write;
     - the shortest expiry offered.

     Kept in memory only; deleted at the end (step 8).
3. **The wizard installs, in this order:**
   1. **`wivo-update` first** (Edge Functions), with Wivo's public release key pinned in its code.
   2. **Function secrets:**
      - VAPID keys for push, generated on that computer;
      - the clinic's Resend key, pasted by the owner;
      - a one-time setup secret.
   3. **The baseline and every migration since,** applied by `wivo-update` itself from the signed package, through the project's own database connection. The setup token needs no database permission.
      - `wivo-update` accepts this first install only while the migration ledger is empty, with the one-time setup secret.
      - In the same transaction, it also creates:
        - the Storage buckets and their policies;
        - the Vault values (the functions URL and the service key, taken from its own environment, never shown or typed);
        - the scheduled jobs.
   4. **The other Edge Functions:** `bridge`, `bridge-pair`, `send-notifications`, `team-account` and the rest.
   5. **Auth settings** (Auth Config):
      - Site URL and redirect URLs;
      - SMTP through their Resend;
      - minimum password length 10;
      - MFA on;
      - no public sign-up.
   6. **The read-only checks** (`schema_check.sql`, `trigger_check.sql`, orphan users, scheduled jobs). All must return no rows before setup continues.
4. **First account:** the wizard has `wivo-update` create the owner's account and the clinic (code prefix, for example `RIG`). The owner signs in and adds their authenticator.
5. **The functions token** (5c, option 1):
   - the owner creates it as the wizard shows: this project only, Edge Functions read-write only, the longest expiry offered;
   - the owner enters a fresh code;
   - the wizard passes the token from memory to the project's Vault.

   Or the owner chooses "no stored token", and each update with function changes then asks for a short-lived one (option 4).
6. **Updates:** the owner decides whether to turn on "Install updates automatically" (5b), with a fresh code, and whom to give "Install updates".
7. **Connecting the apps and checking, with the owner:**
   - staff computers and phones join with the clinic's connection code (6d);
   - a test e-mail through their Resend;
   - a push to a phone;
   - an invite to one staff member;
   - Settings → Database shows the version.
8. **Access ends,** before setup is finished:
   1. **The setup token:** the wizard walks the owner through deleting it in Account → Access Tokens, then checks that it no longer works. The one-time setup secret is deleted with it.
   2. If any key or password was on screen, the owner replaces it: the database password in the dashboard, a secret API key by deleting it and making a new one.
   3. The owner checks Organisation → Team (only their people) and Account → Access Tokens (only the functions token, if they kept one).
   4. **A setup record**, signed by both, states:
      - what was done and which version;
      - that nothing was kept by Wivo.

      It holds no keys.
9. **Pairing with Tallinn,** owners on both sides (§1b), once the first partnership is built (§9): the safety code read aloud.

### 6c. E-mail: whose account and domain

**The clinic's own Resend account and domain.** Wivo's account (`mail.wivodent.com`) would let Wivo see every recipient and every e-mail's content: invites, password links, notifications. That is access to the clinic's data.
- Supabase Auth's SMTP and the Edge Functions (`team-account`, `send-notifications`, `send-invoices`) use the clinic's key.
- Wivo supplies the templates (`docs/auth-email-templates/`) and the texts.
- The sender name and domain are the clinic's.
- `EMAIL_ALLOW_ONLY` is never set (CLAUDE.md).

### 6d. How the clinic's apps find their project

Today the desktop has one project URL built in, and the phone app is one build for production. Instead:
- **A connection code (and QR),** shown in the owner's app: the project URL, the publishable key and the clinic's name and prefix. These are public values, but a code pointing at the wrong project could lead staff to a fake one. So the app shows the clinic's name and asks the person to confirm it.
  - The desktop stores the result per computer.
  - The phone app at `app.wivodent.com` is the same static code for every clinic, and stores the connection in the browser.
  - No Wivo server is asked: the code carries everything.
- **Test mode** (`lib/testCopy.ts`) keeps refusing production by its project ref, and still accepts only the test copy.
- **Licences** are unchanged (signed tokens), and checked in the app.

### 6e. From the second clinic on: setup without Wivo

To scale to 100 clinics with no per-clinic work for Wivo, Riga's visit is the only setup Wivo attends.
- **The wizard above is the setup.** The clinic's owner runs it alone, with:
  - the checklist (6a) as a page on Wivo's site;
  - a written guide with screenshots of every Supabase screen the wizard sends them to.
- **Each step checks itself,** and the read-only checks must pass before it goes on. A failed step says exactly what to do. It never says to run SQL (CLAUDE.md).
- **Updates arrive by themselves** (5b). Pairing is done by the owners (1b). E-mail is the clinic's own (6c). None of it involves Wivo.
- **The one per-clinic step left for Wivo is the licence** (`shared/license`): a business step, not technical access. Automating it (payment, then a licence) is outside this plan (§10).

---

## 7. What becomes of today's in-database partnership

**Kept, as the local model, and extended for a remote partner.**
- `partnership`, `job_share`, `share_stock` and the partner functions keep their names and meaning.
- **A partnership gains a kind:** `local` (the other organisation is in the same project) or `remote` (the other clinic is in another project, with `bridge_peer`).
- **On the owner's side,** `job_share` is unchanged. For a remote partner, a trigger also writes the outbox message (§1f).
- **On the partner's side,** a remote job comes from `shared_job_mirror`, and `partner_jobs()` reads it. `move_job_stage`, `post_job_comment`, `job_files` and `partner_stock()` take the remote path when the partnership is remote.
- **Local partnerships stay** for organisations in one project:
  - the test projects (§8);
  - a group running several sites in one project, if one ever does.

  With one clinic per project, local partnerships won't be used in production. The local path can be retired once that's certain, or kept: it costs little and its tests run anyway.
- **Wivo's approval** (`platform_approve_partnership`) goes, as in 1b.
- **Stock:** today's direction (the shelf's project holds the item, and the lender sees totals through `partner_stock()`) stays for local partnerships. Remote stock uses the lender-is-truth model of §3.

---

## 8. Testing

- **Never the test copy, never production.**
- **Two fresh Supabase projects,** made for this in Wivo's own organisation (for example `wivo-bridge-a` and `wivo-bridge-b`):
  - made-up data only, generated by a seed script;
  - no copy of any real clinic;
  - set up through the same setup wizard (§6), so the wizard is tested too.
- **Locally and in CI:**
  - two PGlite databases with the bridge functions' logic as plain functions;
  - two local Supabase stacks for the end-to-end runs (`supabase start` with two port sets).
- **Tests:**
  - **contract:** recorded envelopes of every supported `type_v`, applied by the current receiver (1e);
  - **the leak test across projects, a release condition:** made-up patients with names and personal codes in the owner's project; nothing identifying arrives on the partner's side through any message or file;
  - **delivery:**
    - a duplicate envelope;
    - out-of-order `seq`;
    - the peer down for a day, then back;
    - a 429;
    - a wrong signature;
    - an ended peer;
    - a replayed request;
  - **version skew:** a sender on version N and a receiver on N-1, and the reverse;
  - **stock:** use while the lender is down; over-use (a dispute); return in transit; a due date passing;
  - **updates:**
    - a signed package applied by `wivo-update`, approved by the owner and by a member with "Install updates";
    - refused:
      - a tampered package, or one already applied;
      - an approver without a fresh code;
      - an admin without "Install updates";
      - a member without the permission;
    - automatic:
      - installed at night with the setting on, recorded as automatic;
      - a withdrawn, `manual_only` or not-yet-`auto_after` version skipped;
      - the setting turned on and off only with a fresh code;
    - the functions token:
      - deploys only bundles from a signed package;
      - when it is expired or missing, migrations still install and functions wait;
      - the short-lived fallback works;
  - **setup:** the wizard on an empty project, then the checks find nothing.

---

## 9. Timing, with Kevin's testing as the limit

### How the estimate works

- **Claude writes the code, the tests and the docs,** in sessions Kevin starts. A slice (a migration, its functions and screens, its tests) is usually built within a few days of sessions, so building is rarely what everything waits on.
- **The limit is Kevin's time:**
  - reading a plan and deciding;
  - applying migrations to the test projects;
  - testing by hand on a desktop and a phone, often playing both clinics;
  - the releases.

  The estimates assume about **1–2 hours of Kevin's testing on most working days**, as in the recent rounds, and that a round's findings are fixed the same day or the next.
- **Outside both of us:** the 2.1 release, Riga's preparations (§6a), the visit date, and the lawyer's answers.
- The earlier estimate (17–21 weeks) assumed one human developer writing everything. This replaces it.

**Before phase 1: 2.1 on production.**
- Riga needs a released desktop build.
- Tallinn's project needs sql/102–118, released together with 2.1 (docs/PERMISSIONS.md, "Releasing sql/117 and sql/118").

That is Kevin's production session, and it isn't counted below.

### Phase 1: Riga on its own instance, before any partnership

**What Riga gets:** its own Wivo on its own project, set up on site, with the update path working. That covers its own jobs, stock, statistics and team. There is no partnership yet.

**Not for Latvia yet:** Payroll follows Estonian tax rules (tax-free income, the pension pillar), and invoices follow Estonian layouts and labels. Riga starts without them. If Riga needs them, they need their own plan.

| Slice | Built in | Kevin's part |
|---|---|---|
| 1. The migration ledger, the package format, the signed index (`updates.json`, with `auto_after` and the withdrawn list), the signing tool, CI building and publishing the package. Starts from docs/MIGRATIONS.md's baseline. | 3 days | Read the package format and §5: one session. |
| 2. `wivo-update`, in its three modes:<ul><li>approved by hand (an approver with a fresh code);</li><li>automatic (the project's own scheduled job, with the setting on);</li><li>first install (empty ledger, setup secret).</li></ul>Plus the "Install updates" permission, and function deploys with the stored token or the fallback (5c). | 4 days | On test project A:<ul><li>apply by hand, as the owner and as a member with the permission;</li><li>try an older, a tampered and a withdrawn package, and one without a fresh code;</li><li>turn on automatic installs and see one happen;</li><li>let the functions token expire.</li></ul>Two or three sessions. |
| 3. The desktop's update screens: "Database update ready" for approvers, Install with a fresh code, Settings → Updates (automatic on or off, the functions token's state and its yearly renewal), the fallback's guided token | 3 days | Two rounds on project A. |
| 4. The setup wizard (6b), from an empty project to passing checks, in the new order | 3–4 days | A full rehearsal on project B, as Riga's owner would do it, with a test Resend account and a test domain. Two or three rounds of 2–3 hours. |
| 5. The connection code for desktop and phone (6d), and the version gate | 2 days | Desktop and phone against project B, and production still working as before. One or two sessions. |
| 6. The setup guide for clinics without Wivo (6e): the checklist page and the guide with screenshots | 1–2 days | Read it, and follow it once on a third fresh project without help: one session of 2–3 hours. |
| 7. A desktop release with all of the above, after 2.1 | – | A release session. |

**Calendar: about 5–7 weeks** from Kevin's OK to "ready to set up Riga". After that:
- the visit, on a date agreed with Riga once §6a is ready;
- the first update after the visit then reaches Riga by itself, or with one approval by Riga's owner (5b). Kevin isn't needed for it.

### Phase 2: the first partnership, as small as possible

**Scope** (Kevin, 2026-11-04):
1. We send a job with its files to Riga.
2. Riga works on it in its own Wivo. It moves the job through the stages assigned to it, and adds its files (print, design).
3. Riga sends back the files and the status. We print and mark the job done.
4. Notifications and audit on both sides.

**Not in it:**
- **Chat.**
- **Changes to a job after it was sent:** a job that changes is unshared and sent again.
- **Stock.**
- **The admin "Messages" view:** owners see only a count of stuck messages.
- **Key rotation in the app:** a partnership can be ended and paired again.

**Size:**
- **Ten message types, version 1:**
  - `hello` and `pair.ended`;
  - `share.created` (the job's partner-visible fields and its file list) and `share.ended`;
  - `stage.move_requested`, `stage.moved` and `stage.move_rejected`;
  - `file.added`, `file.fetch` and `file.received`.
- **In each project:**
  - the tables `bridge_peer`, `bridge_outbox`, `bridge_inbox` and `shared_job_mirror`;
  - the Edge Functions `bridge` and `bridge-pair`, and a sender run by pg_cron;
  - one or two migrations.
- **In the app:**
  - pairing screens;
  - the partner screens reading the mirror;
  - files on a shared job;
  - notifications made by the receiver;
  - the audit actions.

| Slice | Built in | Kevin's part |
|---|---|---|
| 1. The bridge core: pairing (token, code, safety code), keys, the signed transport, outbox, inbox, sender, receiver, `hello`, rate limits, audit | 4–5 days | Pair project A with B, playing both owners; try a wrong code; end the partnership. Two or three sessions. |
| 2. Sharing: `share.created` and `share.ended`, the mirror behind the partner screens, stage requests and answers, notifications | 3–4 days | Send a job from A to B, move it on B, see it on A, unshare it. Two or three sessions. |
| 3. Files both ways, copied and checked | 3 days | A real-size scan from A to B, and print files from B back to A. One or two sessions. |
| 4. The leak test across projects, the delivery tests (duplicates, order, one side down) and version skew | 2–3 days, mostly automated | One full run of the real workflow on A and B: scan, technician work, print files, done. |
| 5. Release; Riga updates; Tallinn and Riga pair on a call | – | A release session; Riga's owner approves the update. |

**Calendar: about 5–7 weeks after phase 1 is released.** Building can start earlier; it is the testing that waits.

**The first real shared job also waits for the lawyer's answers** (Q3–Q6), so those questions should go out now.

### Later phases

| Phase | What | Calendar |
|---|---|---|
| 3. Chat, and changes after sending | `comment.posted`, `question.resolved`, `job.updated` | 2–3 weeks |
| 4. Stock across projects | §3 | 3–5 weeks |
| 5. Hardening | <ul><li>Key rotation in the app.</li><li>The "Messages" admin view (1g).</li><li>Monitoring per partnership.</li><li>The pentest of the new endpoints (prompt 22).</li></ul> | 2–3 weeks, plus the pentest's own schedule |
| Optional: our own production on the update path | The same packages for Tallinn's project, so the path is tested every release | 1–2 weeks |

### In short

- **Riga on its own instance:** about **5–7 weeks** after the OK, plus the 2.1 release and the visit date.
- **The first shared job:** about **5–7 weeks** after that, so about **10–14 weeks** from the OK, if the lawyer's answers are in.
- **Chat, changes after sending, and stock:** about **5–8 weeks** more.

---

## 10. Decisions

**Decided (Kevin, 2026-11-04):**
1. **The spec:** `wivo-2.0-spec.md` now says "one Supabase project per clinic, owned by the clinic; partnership through the direct bridge". The old line is struck through and dated, as are the context line and the open question about Riga.
2. **A direct link,** no relay (§1a).
3. **E-mail:** each clinic has its own Resend account and domain (6c), and the checklist of what Riga prepares is in §6a.
4. **Timing:** re-planned (§9). Riga on its own instance first, then the smallest partnership.
5. **Scale and updates:**
   - 100 clinics with no per-clinic work for Wivo, and no clinic ever sends Wivo a token;
   - updates are pulled by each clinic, and database changes need no token (5b);
   - the setting "Install updates automatically" exists, and every signature check still runs.
6. **Who approves an update:** the owner, or a member with the new permission "Install updates". Admins don't get it automatically. Approving always needs a fresh second-factor code, and the audit log records who approved which version (5b).

**For Kevin's OK:**
7. **Edge Function deploys** (5c): the recommendation is a scoped, functions-only token that the owner creates once at setup and that stays in the clinic's own Vault, renewed yearly (option 1), with the short-lived guided token as the fallback (option 4).
   - This changes condition 3 of the earlier decision ("the owner's token is never stored"), but only for that narrow token. Broad tokens are still never stored.
   - The alternative is option 4 alone: then automatic installs stop at every release with function changes.
8. **Automatic installs:**
   - off by default, so the owner turns them on at setup or later;
   - `auto_after`: proposed **3 days** after publishing, so Wivo's own production and the clinics that approve by hand go first.

**Still open:**
9. **Our own production on the update path** (an optional phase in §9). Recommended once phase 1 is built, so the path is tested every release.
10. **Retention after unsharing and unpairing** (2d), after the lawyer's answers.
11. **Stock defaults:** the due date and the 30-day settling window (phase 4).
12. **Local partnerships:** keep them for tests and multi-site groups, or retire them later (§7).
13. **Payroll and invoices for Latvia:** not in Riga's start (phase 1). If Riga needs them, a plan of their own.
14. **Licences** (6e): the one per-clinic step left for Wivo. Whether to automate it (payment, then a licence) is a separate plan.
15. **Knowing which versions clinics run:** without access, Wivo doesn't know. Options:
   - nothing at all;
   - or an anonymous daily "version only" report that the clinic can turn off.

   It would help decide when an old version may stop being supported (1e).

## Questions for the lawyer

1. **The separate database:** does a clinic-owned Supabase project, with Wivo having no access after setup, meet Riga's requirement? Is Wivo then only a software vendor (no processing) for Riga, or a processor because of setup and updates?
2. **A relay we rejected:** if Wivo ran a relay that saw only end-to-end encrypted content plus metadata (who, when, sizes), would Wivo be a processor? Would that be acceptable to Riga's lawyer?
3. **What crosses for a shared job:** job code, teeth, work, material, shade, dates, the patient's age, and the partner's price. Without a name or personal code, is this personal data of the patient, given that the owner can re-identify it? Is a contract between the two clinics needed (processor, or joint controllers), and who signs it?
4. **Scans and print files:** is an intraoral scan or a model of a patient's teeth personal data (health data) even without a name? Does the patient need to be told, or to consent, before it goes to a clinic in another country?
5. **What each side must keep, and for how long, under Estonian and Latvian law:**
   - the job data received, the files received and made, and the chat;
   - for a custom-made device: who is the manufacturer, and does MDR Annex XIII's documentation period (10 years; 15 for implantable devices) apply to the lab, to the clinic, or to both?
6. **After unsharing or ending the partnership:** may or must each side delete what it received, and when? Can the 30-day window for settling stock be kept?
7. **Staff data crossing:** the names of staff shown on the other side (who moved a stage, who wrote in the chat). What must staff be told?
8. **Where the data lives:** Riga's Supabase region (Stockholm or Frankfurt) and Resend's EU region. Supabase and Resend are US companies with EU hosting. What must Riga's contracts with them contain, and what must ours contain?
9. **Signed updates:** the update code Wivo signs runs with full rights in Riga's database. What should the contract say about it (no data access, audit rights, publishing every package, liability), and is the owner's approval of each update enough?
10. **The setup visit:** Kevin at the clinic, possibly seeing keys or passwords on screen, which are rotated before he leaves. What should the setup record and the confidentiality clause say?
11. **Support later:** if Riga asks Wivo to look at a problem in their database, what consent and logging are needed, and how long may the access last?
12. **An incident:** if a bug sends something identifying to the other clinic, who notifies whom, and within what time (GDPR's 72 hours, and Latvian rules)?
13. **Stock across the border:** consignment goods lent from Estonia to Latvia, then bought out. Is anything needed beyond the invoice, for example tax or medical-device traceability of the lot?

---

## Superseded: the assessment of 3 November 2026

Kept as it was written. The decision of 4 November 2026 (§0) replaces it: no Wivo hub, and no standing access for Wivo. Only its headings moved down two levels.

### One Supabase project per clinic: an assessment

Read-only assessment, 3 November 2026, on branch `testing` after migration 097. No code was changed.

**The idea being assessed:**
- Every clinic has its own Supabase project, and the clinic pays for it.
- Wivo runs a central license server and an admin console: organisations, modules, invoices, and switching modules off when an invoice is unpaid. Wivo never sees patient data.
- Partnerships exchange shared jobs between instances, and trigger notifications on both sides.

#### Summary

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

#### 1. What assumes a single database today, and what already points toward instances

##### 1a. Single-database assumptions

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

##### 1b. What already points toward instances

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

#### 2. What a cross-instance partner exchange needs

##### 2a. Shape: a hub, not instances calling each other

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

##### 2b. Authentication between instances

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

##### 2c. Jobs, files, stage moves, comments

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

##### 2d. Notifications

- Each instance creates its **own** notifications when it **applies** an incoming event. For example, applying `file.added` calls the local `notify_org` for the local organisation. Push, e-mail and the bell then work as today, per instance, with that instance's `send-notifications`.
- The sender never writes into the other side's tables. The kinds and texts stay as they are (sql/075, sql/090, sql/095).
- Latency is the outbox delay plus the receiver's pull interval: about a minute with pg_cron, seconds with a webhook from the hub that wakes the receiver.

##### 2e. Versioning: instances on different schema versions

- **The envelope:** `{ api: 1, type: 'stage.move_requested', type_version: 1, event_id, job_id, seq, sent_at, from_instance, payload }`.
- **Rules for changes:**
  - Within an API version, changes only **add** optional fields. Receivers ignore fields they do not know. Unknown event types are stored and acknowledged, not failed.
  - A breaking change is a new `type_version`. The hub converts between the newest version and the one before it for as long as any registered instance still speaks the older one.
- **Capabilities in the registry.** Each instance reports `schema_version` and `api_version` on every heartbeat. The hub only sends what the receiver supports, and the license server sets a **minimum supported version**: an instance below it is paused for exchange (not for its own work), and told why.
- **Database migrations stay local.** A migration in one instance never requires the same migration elsewhere at the same moment. Only the event contract is shared, and it changes slowly.
- **Contract tests** in this repo: recorded event fixtures for every supported version, replayed against the current receiver. A `job.updated` from the version before must still apply.

---

#### 3. Getting migrations and function deploys to N instances safely, and who can see clinic data

##### 3a. What has to exist in every option

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

##### 3b. Who runs them, and who can see clinic data

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

#### 4. Phases, with rough sizes

Sizes are rough weeks for one full-time developer-equivalent, including tests and test-copy rounds. They assume the current pace and quality bar (leak tests as release conditions, a test copy before production).

##### Phase A: license server and admin console (4–6 weeks)

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

##### Phase B: automated migrations and deploys (3–5 weeks)

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

##### Phase C: the partner exchange through a hub (8–12 weeks, the largest risk)

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

##### Phase D: "own instance" as an option (4–6 weeks)

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

#### Decisions for Kevin

1. **The locked decision.** Does "every clinic its own project" replace "one shared hosted instance, RLS keeps them apart", or become an option next to it? (Recommended: an option. The shared instance stays the default, and the spec is updated to say so.)
2. **Whose Supabase organisation owns a clinic's project, and does Wivo keep standing access?** (Options A–D in 3b.) This decides whether "Wivo never sees patient data" is a technical fact or a contractual promise. Say it accurately to clinics either way.
3. **Do partners in the same instance also go through the hub?** Same-instance stays the fast path; everyone through the hub is one code path, but slower.
4. **The minimum supported version, and how long the hub translates the version before it.** (Suggested: one version back, for a set time.)
5. **Where the hub runs and who pays for its storage and bandwidth.** Scans dominate.
6. **Invoicing for module switches:** how long the entitlement lasts and how much grace there is before a module turns off (today's licence grace is 14 days).
