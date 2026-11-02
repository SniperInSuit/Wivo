# Run 3: the 2.0 release

2 November 2026, evening. Merged `2.0` into `main`.

## What was done

### Production database

| Step | Detail |
|---|---|
| **Backup** | `~/WivoBackups/2026-11-02/` (before migrations) and `~/WivoBackups/2026-11-02-evening/` (before today's changes). Roles, schema, data — all non-empty. |
| **Migrations applied** | 083, 084 and 088–091 were already on production (applied earlier, out of order). Today: **085, 086, 087** applied in order. All nine (083–091) are now live. |
| **Migration order on production** | 000–082 (night run 1) → 083, 084 (manual) → 088–091 (manual) → 085, 086, 087 (today). No conflicts: the two groups define disjoint objects. |
| **`updated_at` reconstruction** | 110 jobs had `updated_at` overwritten by the 070 backfill. Reconstructed from latest payment, revision completion, delivered date, or created date. Capped at the migration time. Single transaction with trigger disable/enable. |
| **Schema reload** | `notify pgrst, 'reload schema'` after each migration. |

### Leak check on production

A temporary second organisation (Riga Leak Check SIA) was created, the full
leak-check script ran with `--production`, and every table, RPC, and Storage
path came back clean. The test user, clinic, profile, and auth rows were
deleted and confirmed gone.

### Schema comparison

Production's functions, policies, columns, and constraints match the test copy
exactly. The only differences are 12 triggers on production that the test
copy's restore dropped (all from 000–082: `audit_log_append_only`,
`guard_profile_change`, `guard_stage_change`, `jobs_updated_at`, etc.).
Production has everything.

### Edge Function

`send-notifications` deployed to production with:
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (production pair, separate from test)
- `VAPID_SUBJECT=mailto:fullgevity@gmail.com`
- `RESEND_API_KEY` and `NOTIFY_FROM` not yet set (e-mail notifications not active)
- `APP_LINK` not yet set (no production phone app yet)

### Desktop app

`signOut()` changed from Supabase's default (`global`) to `scope: 'local'`.
Signing out on the desktop now ends only that computer's session. "Sign out on
all other devices" (`scope: 'others'`) stays for lost phones.

### Phone app (test copy only)

- Cloudflare Pages project **wivo-test** at `wivo-test.pages.dev`, building
  from `2.0`, pointed at the test copy's Supabase project
  (`jhqyvancrzykxhzwnost`).
- Push notifications tested and working (Apple push service, 201).
- Storage upload 403 was caused by missing `storage.objects` policies on the
  test copy (restore artifact); fixed by re-applying from the migrations.
- iPhone layout fix: `overflow: hidden` from the desktop CSS was preventing
  scrolling in the PWA. Fixed with a `.mobile` class override and safe-area
  padding on the camera overlay.

### Merge

`2.0` fast-forwarded into `main` (56 commits, no conflicts). Both branches
pushed.

### Where things are

| What | Where |
|---|---|
| Morning backup | `~/WivoBackups/2026-11-02/` |
| Evening backup | `~/WivoBackups/2026-11-02-evening/` |
| Production VAPID keys | `~/WivoBackups/secrets/vapid-prod.json` |
| Test copy VAPID keys | `~/WivoBackups/secrets/vapid.json` |
| Test copy Supabase project | `jhqyvancrzykxhzwnost` (eu-west-1) |
| Test copy Cloudflare Pages | `wivo-test.pages.dev` |
| Production Supabase project | `wrtucsfmpbwekugzzzxw` (eu-west-1) |
| Production Cloudflare Pages | not yet created |
| Production phone app domain | `app.wivodent.com` (planned) |

---

## Open items

### Before staff use the new build

1. **Deploy send-notifications to production** — done (VAPID keys set).
   Still needs: `RESEND_API_KEY`, `NOTIFY_FROM`, `BUG_REPORT_TO` for e-mail
   notifications, and `APP_LINK` once the production phone app exists.
2. **Dashboard settings** — three changes in the Supabase dashboard:
   - Storage → Settings → upload limit **500 MB**
   - Auth → Password security → **Prevent leaked passwords** on, minimum 12
   - Account → Security → **MFA on the dashboard account**
3. **Desktop release** — bump the version, build, and publish to GitHub
   Releases. Staff install the new build tomorrow.
4. **Staff heads-up** — everyone needs Google Authenticator or Microsoft
   Authenticator ready. First sign-in after the update asks them to scan a QR
   code (MFA is mandatory).

### After the release

5. **Production phone app** — create a Cloudflare Pages project for production
   (`app.wivodent.com`), building from `main`, with the production Supabase URL,
   anon key, and the production VAPID public key. Then set `APP_LINK` on the
   function.
6. **Real notification test** — share a job or add a file to a shared job and
   check that the phone gets "New in Wivo" within a minute.
7. **Android test** — the spec's acceptance asks for two camera apps. Check the
   gallery with each one.

### Cleanup

8. **Delete the test copy** — Supabase dashboard → the `jhqyvancrzykxhzwnost`
   project → Settings → General → Delete project. Then delete the
   `wivo-test` Cloudflare Pages project.
9. **Revoke tokens** — the `sbp_…` Supabase access tokens used today. Account →
   Access Tokens → delete them.
10. **Change the production database password** — it was exposed in an error
    message during the session. Supabase dashboard → Database → Connection Info →
    Reset database password.
11. **GitHub accounts** — the repo belongs to `SniperInSuit` but the local git
    credential is `fullgevity`. Pushes from this machine go through GitHub
    Desktop. Align these or set up a deploy key.

---

## Fix list

Things noticed during the session that aren't blockers but should be addressed:

1. **E-mail notification text** — `RESEND_API_KEY` and `NOTIFY_FROM` are not set
   on production. E-mail notifications won't go out until they are. Push works.
2. **"Sign out on this device"** — the button label still says just "Sign out".
   Consider adding "(this device)" so people know it's local.
3. **167 Supabase warnings** — `npx supabase inspect db lint` on a fresh project
   reports warnings (mostly about unindexed foreign keys). A pass through them
   would clean up the schema advisor.
4. **Schema comparison against a fresh replay** — the test copy's restore missed
   12 triggers. Run `scripts/fresh-schema.mjs` on a throwaway project and
   compare with production to confirm nothing else drifted. This is the spec's
   "restore test" (MORNING.md §3).
5. **Hetzner file backup** — the VAPID private keys and the database backups
   live only on this Mac. Copy `~/WivoBackups/` to an off-site location.
6. **Announcements** — `wivo-2.0-spec.md` mentions a changelog entry and an
   in-app "what's new" screen. Neither exists yet.
7. **Node.js 20 deprecation** — the Supabase JS SDK warns on every run. Upgrade
   to Node.js 22 when convenient.
