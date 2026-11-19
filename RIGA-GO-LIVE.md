# Riga go-live: the release that makes Riga the first clinic

**Decided (Kevin, 2026-11-19):**
- **Tallinn no longer uses Wivo. Riga is the first real customer.**
- `testing` is merged into `main` in one large release.
- **Production (`wrtucsfmpbwekugzzzxw`) is neither migrated nor changed.**
  It holds Tallinn's data until the handover, and is then deleted (part D).
- **The licence carries the address with the publishable key. There is no
  separate connection code** (Kevin, 2026-11-19; part B1).
- **The order of building:** plan 3 (docs/WORKFLOW-STAGES.md) first, then
  part B.

This file is the order of the release. docs/ARCHITECTURE-INSTANCES.md §9
(phase 1) is what has to be built before it. docs/ROADMAP.md is what Riga gets
after it.

**Status: plan, approved (Kevin, 2026-11-19). Nothing in part B is built yet.**

---

## What this decision changes in the other plans

- **"Before phase 1: 2.1 on production" is cancelled**
  (ARCHITECTURE-INSTANCES.md §9). sql/102–118 never reach production.
- **A push to `main` no longer means "production's database".** The `main`
  branch still publishes the desktop app (GitHub Releases) and the phone app
  (Cloudflare Pages `wivo`). It is no longer tied to one database. CLAUDE.md's
  "Branches" section has to say so in the release commit.
- **Installs at Tallinn update too.** electron-updater updates every machine
  that has Wivo installed. After this release a machine at Tallinn opens on
  "Connect Wivo to your clinic" and no longer reaches production. If Tallinn
  wants to see its data in the app before the handover, that has to happen
  before the release. The handover itself does not need the app (part C).

---

## A. Today: the address is built into the app

- `.github/workflows/build.yml`, step "Create .env file", writes
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the repository's
  secrets into `.env`. Those secrets are **production's**, which is Tallinn.
- `electron-vite build` bakes both values into the renderer bundle.
  `src/renderer/src/lib/supabase.ts` builds the client from them when the app
  loads.
- The licence (`shared/license/token.ts`, v2) can name the API addresses it is
  valid for (`api: string[]`). Today that field **only restricts**:
  `supabaseTarget` (`lib/testCopy.ts`) refuses a built-in address the licence
  does not list. It never supplies the address.
- **Licensing is not enforced at all** while `LICENCE_PUBLIC_KEYS`
  (`src/main/license.ts`) is empty. With no keys, `licensedApiOrigins()`
  returns nothing, so the restriction is off too.
- The phone app (`vite.mobile.config.ts`) gets the same two values from the
  `wivo` project's environment variables in the Cloudflare dashboard. The web
  app has no main process, so it reads no licence.

**So a release built today would connect to Tallinn's production by default.**
That is what part B removes.

---

## B. After: the build carries no address, and the licence names it

### B1. How a release finds its clinic's project

1. **The release contains no project address and no key.** In `production`
   mode (a packaged build), `supabaseTarget` ignores `VITE_SUPABASE_*`, even
   if something baked them in.
2. **The licence carries the connection** (decided, Kevin, 2026-11-19). The v2 payload's `api` changes from
   a list of addresses to a list of connections, each with the address and
   the project's publishable (anon) key:

   ```json
   "api": [{ "url": "https://<riga-ref>.supabase.co", "key": "sb_publishable_…" }]
   ```

   Both values are public. They go into the licence because it is **signed by
   Wivo** (YubiKey C or D). A connection code could be faked to send staff to
   a look-alike project (§6d's worry). A licence cannot be faked without the
   key.

   No v2 licence has been issued to anyone yet, and none can verify in a
   packaged build, so the field can still change without a v3.
3. **The app connects to the first connection in the licence.** The list
   exists for the move to Riga's own server (docs/OWN-SERVER.md): during the
   move a licence can name both the cloud and the server, and the order
   decides which one is used. `make-license.mjs renew` keeps the list, as it
   already keeps `org`, the address and the modules.
4. **Without a valid licence, the app opens on "Connect Wivo to your clinic".**
   The person pastes the licence or opens the licence file. The screen shows
   the clinic's name from the licence and asks them to confirm it. No request
   goes to any Supabase host before that. After the licence is installed, the
   app reloads, because the client is built once when the app loads.
5. **A packaged build with no licence keys connects nowhere** (fail closed).
   Today an unenforced build accepts any well-formed token without checking
   its signature. That is fine while the token only restricts. Once the token
   supplies the address, an unsigned token would decide where the app
   connects, so this has to be closed.
6. **A packaged build refuses `PRODUCTION_REF`** in every mode, even if a
   licence names it, until production is deleted (part D). Then the check
   stays, so the deleted project's ref is never used again.
7. **The phone.** The owner's desktop shows the licence as a QR code and as
   text on the Licence page. The phone app at `app.wivodent.com` reads it,
   checks the signature in the browser (WebCrypto Ed25519) against the same
   keys, shows the clinic's name to confirm, and stores the connection in the
   browser. The phone app is then the same static build for every clinic, as
   §6d planned. The licence holds no secret, so a staff phone holding it
   exposes nothing; RLS and MFA are what protect the data.
8. **The development modes do not change.** `npm run dev` reads `.env`, which
   points at local Supabase and refuses production as it does now.
   `npm run dev:test` reads `config/test-copy.env` and talks only to the test
   copy.

**What it costs:** about 2 days of building, plus one test session of
Kevin's: a desktop and a phone against project B with a licence, a licence
for the wrong project, no licence at all, and a build with the secrets still
set.

**What it depends on:** the licence keys C and D in `LICENCE_PUBLIC_KEYS`.
That means `scripts/yubikey/setup-key.mjs` has to have run (phase 1, slice 1).
**Without the keys there is no go-live:** a test key is refused in a packaged
build, and that refusal stays.

### B2. The CI secrets

- **The "Create .env file" step is removed** from `build.yml`. The build gets
  no Supabase value from anywhere.
- **A test guards it.** It fails if `build.yml` writes any `VITE_SUPABASE_*`
  value, and if a `production`-mode target takes an address from the
  environment.
- **Kevin deletes the secrets** `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` in GitHub → Settings → Secrets and variables →
  Actions, **before** pushing the release. If the step was missed somewhere,
  it then writes empty values rather than Tallinn's.
- **Kevin deletes the same two variables** in the Cloudflare dashboard for
  the `wivo` project, also before the push. A push to `main` builds the phone
  app straight away.
- `wivo-test` keeps the test copy's values until the test copy is deleted
  (D4).
- **The old installers stay on GitHub Releases** (v2.0.4 and earlier). They
  carry production's address and anon key. RLS and MFA protect production
  until it is deleted; deleting the project ends it. Deleting the old
  releases is not needed, but it is possible once production is gone.

---

## C. Handing over Tallinn's data

Wivo processed Tallinn's data for Tallinn. At the end, the data goes back to
the clinic and Wivo's copies are deleted.

1. **The lawyer confirms first:**
   - who at Tallinn receives the data (by name and role) and how;
   - whether the archive format (below) is enough, or whether a format they
     ask for has to be added;
   - how long Wivo may keep anything after the handover, if anything;
   - what the receipt has to say.
2. **Kevin makes the export** with `scripts/export-clinic.mjs`, against
   production, in a session he starts for that purpose (CLAUDE.md). It is read
   only by construction. It gives one encrypted `.7z` archive containing:
   - the whole database (`pg_dump`);
   - every table again as CSV, for reading without a database;
   - every Storage file;
   - a README with row counts and SHA-256 hashes.
3. **Kevin checks the archive** before it leaves: it opens with the password,
   the row counts in its README match the export run, and the Storage files
   are all there.
4. **The archive and the password go by different channels.** For example,
   the archive on a USB stick or through a link, and the password by phone or
   in person.
5. **Tallinn confirms** that the archive opens and that the data is complete,
   and **signs a receipt**: the date, the archive's SHA-256, and what it holds
   (row counts, no content).
6. **Kevin deletes his own copy of the archive** once the receipt is signed,
   unless the lawyer says otherwise in step 1.

---

## D. Deleting production and the test copy (after the handover and the lawyer's OK)

**Not before both:** Tallinn's signed receipt (C5) and the lawyer's written
OK to delete.

1. **Check what holds Tallinn's data** besides the two projects, and write it
   down:
   - the test copy (`jhqyvancrzykxhzwnost`): **it was made from production
     and holds real data** (Kevin, 2026-11-19), so it is deleted with it (D4);
   - Kevin's own machines: exports, CSVs, `.env` files with production's
     address, `supabase/.temp`, and the GitHub Desktop stash `stash@{0}`
     (`supabase/.temp/linked-project.json`);
   - the e-mail provider production sent through (logs and recipients);
   - anything else the check finds.
2. **Delete production** (`wrtucsfmpbwekugzzzxw`) in the Supabase dashboard:
   Project Settings → General → Delete project. Its backups go with the
   project. Before deleting, check in the dashboard that no point-in-time
   recovery or branch outlives it.
3. **Revoke access to it:** any personal access tokens Kevin made for it, and
   any API key or webhook that pointed at it (e-mail, push).
4. **Delete the test copy** (`jhqyvancrzykxhzwnost`) the same way. It was
   made from production and holds real data, so this is not optional. Before
   testing continues:
   - **a new test project with demo data only:** a fresh project, every
     migration applied (`scripts/fresh-schema.mjs`), then `sql/demo/seed.sql`.
     No row comes from production or from any clinic;
   - **`TEST_REF` changes in the same change** as the new project
     (CLAUDE.md): `src/renderer/src/lib/testCopy.ts`, `config/test-copy.env`
     (its URL and anon key), and the `wivo-test` variables in the Cloudflare
     dashboard. `config/testCopyEnv.test.ts` and `testCopy.test.ts` check the
     ref and the key against each other;
   - CLAUDE.md's "test copy" then means the new test project, and the line
     that says the test copy holds real data is removed.
5. **Delete what D1 found** on Kevin's machines and elsewhere.
6. **A deletion record,** kept by Wivo: what was deleted, where, when and by
   whom, and the lawyer's OK. It holds no personal data.
7. **CLAUDE.md is updated:** production is gone, `PRODUCTION_REF` stays
   refused (B1.6), and Riga's project is not a project Claude ever connects
   to, as production was.

---

## The release, in order

1. **Phase 1 is built and tested on `testing`** (ARCHITECTURE-INSTANCES.md
   §9). Licence keys C and D are set up and in `LICENCE_PUBLIC_KEYS`, and
   `PINNED_ROOTS` is set.
2. **Part B is built on `testing`,** and Kevin's test session for it passes.
3. **Riga's project is set up** with the setup tool (§6b), and Riga's licence
   is issued, carrying Riga's connection (B1.2).
4. **The GitHub secrets and the Cloudflare `wivo` variables are deleted**
   (B2), right before step 5's push: after part B has passed its test on
   `testing`, never earlier. Until part B is on `main`, the app on `main`
   still reads its address from the build, so a push to `main` without the
   values would publish a desktop and a phone app with no address at all.
5. **`testing` is merged into `main`.** The version bump in `package.json` is
   the last commit. Kevin pushes it.
6. **On Riga's machines:** install, paste the licence, confirm the clinic's
   name, sign in. Phones: scan the QR from the owner's Licence page.
7. **Handover to Tallinn** (part C), whenever the lawyer has answered. It does
   not wait for the release, and the release does not wait for it.
8. **Deleting production and the test copy** (part D), after C5 and the
   lawyer's OK.
