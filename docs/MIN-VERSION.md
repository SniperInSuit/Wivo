# Minimum app version

**Built on `testing`. Ships with 2.1.** Not applied anywhere yet. Kevin's steps are in §8.
Kevin applies migrations in the SQL Editor, test copy first (CLAUDE.md). **Kevin sets the minimum only after every machine runs 2.1**: every build before 2.1 sends no version, so a minimum set earlier refuses all their saves.

**Decisions (Kevin, 2026-11-03):**
- Old builds may still read; only saves are refused.
- A required restart: a 60-second countdown, at most three postponements of 15 minutes each. Never while a form has unsaved input or an upload, download or print is running.
- On the desktop, the "Update Wivo" message has a "Restart now" button.

## Why

In 2.0.1, people still on an older build created jobs whose producer and designer silently went missing. An updated app saved them correctly; the old one didn't. The desktop app installs updates at its next launch, so a machine left open for days keeps saving with old code.

The goal: a build that is too old may still be opened and read, but it can't save. It says "Update Wivo", and gets the update as fast as possible.

## What this is, and what it is not

**This guards against old builds losing data. It is not a security control.**

- The app version comes in a request header, which anyone can set to anything.
- Someone who wants to bypass it, with the public key and their own sign-in, can. What they can then do is still limited by RLS, the second factor (sql/098), the permissions (sql/102) and every other rule.
- So the version check never decides *who* may do something, only whether a well-behaved app is new enough to do it correctly.
- If it fails or is misconfigured, it must never let anyone do more than RLS allows. At worst it refuses saves until Kevin lowers the minimum.

## 1. Every request carries the app version

- **Desktop and phone** create the Supabase client with two global headers:
  - `x-wivo-version`: the build's version, `__APP_VERSION__`. It is fixed at build time from package.json, so in a built app it is the real version. (In `npm run dev` it is the version when dev started, which is good enough there.)
  - `x-wivo-client`: `desktop` or `phone`. This is for logs only; nothing decides on it.
- **supabase-js sends global headers on every request:** PostgREST, Storage, Edge Functions (`functions.invoke`), Auth.
- **The Edge Functions** that call the database *as the user* (`account-security`, `team-account`, `file-link`) pass the caller's `x-wivo-version` on, so a function call from an old build is treated the same way.
- **CORS:** the browser asks before sending a custom header.
  - The three functions the app calls (`account-security`, `team-account`, `file-link`) allow both headers (`_shared/appVersion.ts`). A test fails if a function the app calls doesn't. Without that, every function call from the new app would fail.
  - `public-booking` (`_shared/cors.ts`) is called by the public booking page, not by the app, so it is unchanged.
  - Supabase's own API (PostgREST, Storage, Auth) answers with the headers asked for, as it already does for `x-client-info`. **This is checked first on the test copy**, see the spike in §7.

## 2. The database refuses saves from builds below the minimum

### The setting

`public.app_min_version`, a new table (sql/104):

| column | |
|---|---|
| `id` | uuid |
| `org_id` | uuid, **nullable**. Null means every organisation (the normal case); an organisation's own row raises the minimum for that organisation only, to try a raise on one clinic first |
| `min_version` | text such as `2.0.4`, checked to have that shape |
| `required` | boolean: desktops also restart by themselves to update (§4) |
| `note` | text: why, for whoever reads the table later |
| `updated_at`, `updated_by` | |

Rules for the table:
- one global row and at most one row per organisation (unique on `coalesce(org_id, …)`);
- RLS: nobody but the service role may write;
- members may read the global row and their own organisation's;
- the MFA policy (`ensure_mfa_policies()`), a leak test, and `lock_anon_functions()` at the end, as CLAUDE.md requires.

**No rows means the check is off.** That is the state after 104 runs, so applying the migration changes nothing until Kevin sets a minimum.

**Raising it** is one statement in the SQL Editor, with no code change and no deploy:

```sql
insert into public.app_min_version (org_id, min_version, required, note)
values (null, '2.0.4', false, 'producer/designer fix')
on conflict on constraint app_min_version_one_per_org
do update set min_version = excluded.min_version, required = excluded.required, note = excluded.note, updated_at = now();
```

Lowering it, or deleting the row, switches it back off at once.

### The check

`public.pre_request()` becomes PostgREST's `db_pre_request`, in place of `require_mfa_for_api()`. It runs both checks:

1. `require_mfa_for_api()`, unchanged (sql/098).
2. `require_app_version()`, which:
   - acts only for a signed-in user (`role = authenticated`). The anon key and the service role (cron, Edge Functions with the service key) are never checked;
   - acts only when there is a minimum for the caller's organisation (its own row, else the global one);
   - acts only on **saves**:
     - `POST`, `PATCH`, `PUT` or `DELETE` on a table or view;
     - `POST /rpc/<function>` where that function is `volatile`, meaning it can change something. A `stable` or `immutable` function is a read (`job_files`, `team_accounts`, `deleted_jobs`, `has_mfa`, …), so reading through RPCs keeps working. The volatility is looked up in `pg_proc` by name;
   - lets through a short allow-list a too-old build needs in order to update or leave. Today that is `save_push_subscription`, so an old phone keeps its notifications; anything else only if a test shows it is needed;
   - refuses when `x-wivo-version` is **missing** or **below** the minimum, compared as numbers part by part, so 2.0.10 is above 2.0.9.
3. **The refusal** is `raise sqlstate 'PT426'` with:
   - message "Update Wivo: this version can no longer save. Close and reopen Wivo, or reload the page.";
   - hint `update_required`;
   - detail: the minimum.

   PostgREST turns `PTxyz` into HTTP `xyz`, so the app gets **426 Upgrade Required**, with the message in its body.

`anon_allowed_functions()` changes from `require_mfa_for_api()` to `pre_request()`, because PostgREST now calls `pre_request()` for anonymous requests too. `sql/test/anonFunctions.test.ts` changes with it.

**Storage uploads** (TUS) don't pass through PostgREST, so they aren't checked directly. Every upload starts with `register_job_file` (volatile), which is refused, so an old build can't add files either.

**Realtime and reading** are untouched. An old build sees current data and is told to update the moment it tries to save.

### In the app

- `describeError()` turns `update_required` (or HTTP 426) into the translated "Update Wivo" message, so every screen that already shows save errors says it.
- The first 426 in a session also:
  - **desktop:** asks the updater to check now (`wivo:check-remote-update`) and shows the restart banner as soon as the update is ready (§4);
  - **phone:** reloads (§5).

## 3. Telling builds apart

`__APP_VERSION__` is already in both builds (`electron.vite.config.ts`, `vite.mobile.config.ts`).

- The desktop and the phone share a version number, because a release bumps package.json once.
- A push to `main` without a version bump updates the phone but not the desktop, with the same number on both. That's harmless here: the check compares numbers, not builds.
- The minimum is only raised to a number that has been released on both.

## 4. Desktop: "Restart to update"

What exists: `UpdateBanner` (corner toast) shows "Update ready … applied at the next launch" with a "Restart now" button, and the updater installs at the next launch (`src/main/updater.ts`).

The change:

- **When an update has been downloaded,** the corner notice now reads **"Restart to update"**, "Wivo X.Y.Z is downloaded. Restart now, or it is applied the next time you start Wivo", with **Restart now**. As built, it stays a corner notice rather than a top banner, so it doesn't push the screen down; the "Update Wivo" message below is the top banner. The button uses the existing `installNow` (`quitAndInstall(true, true)`).
- **A save refused for the version (426):** a banner at the top, "Update Wivo: this version can no longer save…". It has **Restart now** once the update is downloaded; until then it says "Getting the update…" and asks the updater at once (`components/UpdateRequired.tsx`).
- **A required release:** the running version is below a minimum marked `required` (§2), and the update is downloaded. Then Wivo restarts by itself, but only when nothing is open:
  - **no form with unsaved input:** a small registry (`useBlocksRestart()`) that the job form, the new-job wizard, the remake editor, the invoice form, settings with unsaved changes and Team's add-member dialog switch on while open;
  - **no upload in the queue** (`uploadQueue`), no file download running, no print running;
  - **checked again every 30 s;**
  - **a 60-second visible countdown first** ("Wivo restarts in 60 s to update to X.Y.Z", with "Restart now" and "Wait 15 min (n left)"). "Wait" postpones it by 15 minutes, at most three times; after that only "Restart now" is offered. If something is opened during the countdown, the countdown stops and it waits again.
- **Where the "required" flag comes from:** the same row in `app_min_version`, read on start and every 30 minutes with the update check (the read is allowed, §2). So marking a release as required is the same SQL statement with `required = true`. No release metadata and no new build are needed.
- The rule at the top of `updater.ts` stays: an update must never stop somebody working. Every failure still ends with the app open on the installed version, and saves refused with the clear message.

The logic is kept in pure functions so it can be tested: `shouldAutoRestart(running, minimum, required, downloaded, blockers, postponed)` and the countdown.

## 5. Phone: reload to the new version

The phone app is a web page. A fresh start already loads the newest `index.html` (`sw.js` fetches pages from the network first), so an old build mostly means a phone app left open in the background for days.

- **On start and every time the app comes back to the screen** (`visibilitychange`), once signed in, it reads the minimum. If its own version is below it, it reloads.
- **Loop guard:** at most one reload per 10 minutes, kept in `sessionStorage` (`mobile/PhoneVersionGuard.tsx`). If the reloaded page is still too old (Cloudflare hasn't finished publishing, or the phone is offline), it shows a full-width notice "Update Wivo: reload the page" with a button instead of reloading again.
- **A 426 from any save** does the same.
- Nothing typed is lost to a reload: it waits while the camera is open, a message is being typed, or an upload is running.

## 6. Rollout (once built)

1. **Test copy:**
   - run sql/104 and `notify pgrst, 'reload config'; notify pgrst, 'reload schema';`;
   - the checks (§7);
   - deploy the three functions with the new CORS headers;
   - push `testing`.
2. Release the build that sends the header, for example 2.0.4. **Every build before it sends no header:** set the minimum only once machines run 2.0.4. Until then the table stays empty and nothing changes.
3. **Production, in a session Kevin starts:** sql/104, then the release. Later, when needed, the one-line minimum.

## 7. The steps, in order

1. **Spike on the test copy, before the rest** (Kevin runs it; a script like `check-standin-auth.sh`, never printing a key). These answers decide the details:
   - send a request with `x-wivo-version` to PostgREST, Storage and an Edge Function from a browser origin. Do the preflights pass?
   - does `current_setting('request.headers', true)` in `db_pre_request` show the header?
   - does `raise sqlstate 'PT426'` come back as HTTP 426 with the message?
2. **sql/104** and its tests (PGlite):
   - an old version, a missing one and a new one;
   - versions compared as numbers (`2.0.10` > `2.0.9`);
   - table writes refused, volatile RPCs refused, stable RPCs and reads allowed;
   - the allow-list;
   - anon and the service role untouched;
   - the organisation's own row over the global one;
   - an empty table means off;
   - the MFA check still first;
   - the table's RLS and leak test;
   - `lock_anon_functions` and the anon test.
3. **Edge Functions:** CORS headers, passing the version on, and tests.
4. **App:**
   - the two headers;
   - `update_required` in `describeError` (en, et, ru);
   - the 426 reaction;
   - the desktop banner and the required auto-restart (pure logic and tests);
   - the restart blockers;
   - the phone reload and its loop guard.
5. **Docs:**
   - HANDOFF ("every request carries x-wivo-version");
   - CLAUDE.md: a new Edge Function lists `x-wivo-version` in its CORS headers;
   - this file: from plan to built.

## 8. What is built, and Kevin's steps (test copy only)

**Built:**
- **sql/104** with tests (`sql/test/minAppVersion.test.ts`).
- **Edge Functions:** headers allowed and passed on; tests in `_shared/appVersion.test.ts`.
- **The app:**
  - headers on every call, and the 426 watch (`lib/appVersion.ts`);
  - "Update Wivo" in `describeError`;
  - desktop: `components/UpdateRequired.tsx` and the "Restart to update" text;
  - phone: `mobile/PhoneVersionGuard.tsx`;
  - the restart guard (`lib/restartGuard.ts`): forms, the camera, a message being typed, uploads; and `main/busy.ts` for downloads, prints and PDFs;
  - the decisions as pure functions with tests (`lib/updatePolicy.ts`).
- **The check script:** `scripts/check-version-header.sh`.

**Steps:**
1. **Before sql/104:** `bash scripts/check-version-header.sh --cors`. The database, storage and sign-in should PASS. The three Edge Functions FAIL until step 3.
2. Run `sql/104_min_app_version.sql`, then `notify pgrst, 'reload config'; notify pgrst, 'reload schema';` as a separate query.
3. Deploy the three functions to the test copy:
   ```sh
   supabase functions deploy file-link --project-ref jhqyvancrzykxhzwnost
   supabase functions deploy team-account --project-ref jhqyvancrzykxhzwnost --no-verify-jwt
   supabase functions deploy account-security --project-ref jhqyvancrzykxhzwnost --no-verify-jwt
   ```
4. `bash scripts/check-version-header.sh`: everything PASS, including that the database sees the header and that a refusal arrives as HTTP 426. It asks for the test copy's secret key without showing it.
5. Push `testing`. Then hand test with `npm run dev:test`, which sends the current version:
   - In the SQL Editor on the test copy: `select public.set_app_min_version('9.9.9', false, 'test');`.
     - Saving a job is refused with "Update Wivo…".
     - Lists, a job and its files still open.
     - The top banner shows.
     - On the phone (wivo-test.pages.dev), a save is refused and the page reloads once; on a second refusal within 10 minutes, the notice with "Reload" shows.
   - `select public.clear_app_min_version();`: saving works again at once.
   - **The required restart** needs an installed build and a newer release to update to, so it can only be tried with 2.1 itself on a test machine. The timing rules are covered by tests.
6. **Production, in a session Kevin starts, with the 2.1 release:** sql/104, then the functions. **Set the minimum only after every machine runs 2.1.**

## Open questions answered

1. **Reads from an old build:** allowed; only saves are refused.
2. **A required restart:** a 60-second countdown, at most three postponements of 15 minutes each, never while something is open. The desktop's "Update Wivo" message has "Restart now".
