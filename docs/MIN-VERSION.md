# Minimum app version

Plan only. Nothing is built yet. Branch: `testing`. Next migration: `sql/104`.
Kevin applies migrations in the SQL Editor, test copy first (CLAUDE.md).

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
  - Our Edge Functions list their allowed headers, so `x-wivo-version` and `x-wivo-client` are added to `account-security`, `team-account`, `file-link` and `_shared/cors.ts`. Without that, every function call from the new app would fail.
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

- **When an update has been downloaded,** the toast becomes a clearer **banner** at the top: "Wivo X.Y.Z is ready. Restart to update" with a **Restart** button. It can be dismissed, and it comes back on the next launch or the next version. The button uses the existing `installNow` (`quitAndInstall(true, true)`).
- **A required release:** the running version is below a minimum marked `required` (§2), and the update is downloaded. Then Wivo restarts by itself, but only when nothing is open:
  - **no form with unsaved input:** a small registry (`useBlocksRestart()`) that the job form, the new-job wizard, the remake editor, the invoice form, settings with unsaved changes and Team's add-member dialog switch on while open;
  - **no upload in the queue** (`uploadQueue`), no file download running, no print running;
  - **checked again every 30 s;**
  - **a 60-second visible countdown first** ("Restarting to update in 60 s… Wait"). "Wait" postpones it by 10 minutes, at most three times. After that it restarts when the next form closes.
- **Where the "required" flag comes from:** the same row in `app_min_version`, read on start and every 30 minutes with the update check (the read is allowed, §2). So marking a release as required is the same SQL statement with `required = true`. No release metadata and no new build are needed.
- The rule at the top of `updater.ts` stays: an update must never stop somebody working. Every failure still ends with the app open on the installed version, and saves refused with the clear message.

The logic is kept in pure functions so it can be tested: `shouldAutoRestart(running, minimum, required, downloaded, blockers, postponed)` and the countdown.

## 5. Phone: reload to the new version

The phone app is a web page. A fresh start already loads the newest `index.html` (`sw.js` fetches pages from the network first), so an old build mostly means a phone app left open in the background for days.

- **On start and every time the app comes back to the screen** (`visibilitychange`), once signed in, it reads the minimum. If its own version is below it, it reloads.
- **Loop guard:** at most one reload per 10 minutes, kept in `sessionStorage`. If the reloaded page is still too old (Cloudflare hasn't finished publishing, or the phone is offline), it shows a full-width notice "Update Wivo: reload the page" with a button instead of reloading again.
- **A 426 from any save** does the same.
- Nothing typed is lost to a reload. The app is checked on start and when it returns, so a half-written chat message is the one thing a reload could drop. The check waits while the chat box or the camera is open.

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

## Open questions for Kevin

1. **Reads from an old build:** this plan lets them through, so a stuck machine can still look things up. Or should an old build be blocked entirely, reads included?
2. **The 60-second countdown and three postponements** for a required restart: are those the right numbers for the lab?
