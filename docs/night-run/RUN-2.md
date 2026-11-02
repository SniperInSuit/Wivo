# Run 2: sounds, soft delete, the phone app

2 November 2026, daytime. Branch `2.0`. Nothing pushed, nothing merged, and
nothing applied to any database.

## What's done

| What | Commit |
|---|---|
| Sound system: preloaded Web Audio, two categories, per-device settings, wired to today's events (your list) | `f94633a` |
| Deleting a job keeps it: soft delete with files, shares ended with audit rows, restore in Seaded → Audit log (sql/089) | `177bca3` |
| Push subscriptions; added files notify the other side of a shared job (sql/090) | `4f35573` |
| Push sender in `send-notifications`, and a fix: it had no e-mail subject for `files_added` | `3c9d921` |
| **Phase 1b, the phone app** (PWA from the same React code) | `e6ea58d` |
| Run notes, decisions, camera file-name fix | `14f04c9` |
| Fixes from the independent review (sql/091 and app fixes) | next commit after `14f04c9` |

Typecheck is clean, all tests pass (81 files, 1,251 tests), and
`npm run mobile:build` builds the phone app without warnings.

### The independent review

A separate reviewer checked everything above against the real migrations.
Seven findings were confirmed, and all are fixed, each with a test that
reproduces it. The full table is in **review-089-091.md**. The serious ones:

- **Push could be broken for everyone.** One signed-in user could register a
  junk push address and stop phone push for every organisation. Now only the
  real push services are accepted, and only through the database function.
- **The phone signed the desktop out.** The phone's sign-out, including the
  automatic 12-hour one, ended the desktop session too. It now signs out only
  the phone.
- **Deleted jobs could reappear.** A deleted job could be shared again and the
  partner would see it. A deleted job now can't be shared, edited or given new
  files.
- **Deleted patient names leaked.** The deleted-jobs list showed every deleted
  patient's name to anyone with write access. It now shows only jobs you could
  read.
- **Too many e-mails.** 15 phone photos meant 15 e-mails per person. Now it's
  one per job per burst.

### The phone app

- **Sign-in:** the same Supabase login and MFA screens as the desktop. You
  are signed out automatically 12 hours after signing in.
- **Home:** three tabs. "Mine" is jobs assigned to you or designed by you.
  "Active" is every unfinished job you can see. "Shared" is jobs other
  organisations shared with you. Search by job code.
- **Job:** basic info, files, the job's chat, and a big "Photo onto this job"
  button.
  - The camera runs inside the app, so a photo never goes into the phone's
    gallery and has no GPS data.
  - Photos go through the same upload queue as on the desktop.
  - The chat can attach an in-app photo too.
- **Shared jobs:** the desktop's own partner panel, so a partner sees the same
  limited view. There is no camera, because partners add design and print
  files only.
- **Settings:** notifications on this phone, sounds, language, sign out, and
  "Sign out on all other devices" for a lost phone. The desktop's Seaded →
  Profile has that button too.
- **Not on the phone:** board, stock, finance, invoices, admin.

Push notifications carry no content. The phone just says "New in Wivo" (in
your language), and the app shows the rest after sign-in. E-mail keeps coming
either way.

## Decisions

Full text in DECISIONS.md, D15–D22. In short:

- **D15, sounds:**
  - The sound files were renamed to your list's names.
  - `notify-new-work` already fires when a job is shared with you or files are
    added to a shared job.
  - There are no files for `ui-tab` and `ui-tick`, so those stay silent.
  - ffmpeg isn't installed, so the loudness script hasn't run. The −8 dB for
    interface sounds is applied at playback anyway.
- **D16, soft delete:** restoring a job doesn't bring its share back. A delete
  with no signed-in user (SQL editor, service role) is still a real delete,
  for when an organisation leaves.
- **D17, build:** the phone app has its own Vite config in the same repo. There
  are no new dependencies, and the service worker is about 80 lines written by
  hand.
- **D18, session:** 12 hours from sign-in, not from last use. Remote sign-out
  ends other devices within the hour, when their access token expires.
- **D19, push:** pushes have no payload and the signing uses WebCrypto, so
  there's no push library.
- **D20, camera:** the camera is inside the app. If the browser won't allow
  that, it falls back to the phone's own capture button.
- **D21, home lists:** search matches patient names only on your own jobs,
  never on shared ones.
- **D22, migrations:** 089, 090 (and 091) stay off production, as you said.
- **D23, sign-out:** the phone signs out only itself. The desktop's sign-out
  stays global, as before, so it signs the phone out too.

## What needs you

### 1. Migrations 089, 090 and 091

None is applied anywhere. They go together, in order: 091 fixes what the
review found in 089 and 090. Without them the app behaves as before:

- a delete is a real delete;
- the deleted-jobs list is empty;
- turning on phone notifications shows an error;
- no "files added" notifications are created.

The phone app's sign-in, jobs, files, camera and chat all work without them.
To try push and soft delete for real before deciding, use a throwaway
project. `node scripts/fresh-schema.mjs` builds the full schema, 089–091
included, in one paste (MORNING.md has the steps).

### 2. Host the phone app on Cloudflare Pages

Create a Pages project from this repo with these settings:

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run mobile:build` |
| Output directory | `dist-mobile` |
| `VITE_SUPABASE_URL` | same value as the desktop's `.env` |
| `VITE_SUPABASE_ANON_KEY` | same value as the desktop's `.env` |
| `VITE_VAPID_PUBLIC_KEY` | from step 3 |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` (the build doesn't need Electron; this skips a large download) |

If the desktop's `.env` sets `VITE_USERNAME_DOMAIN`, set it on Pages too.
Otherwise username logins won't match.

Or build locally and upload: `npm run mobile:build`, then
`npx wrangler pages deploy dist-mobile`.

To try it locally first: `npm run mobile:dev` serves it on
http://localhost:5174. The camera and push need https on a real phone, so use
the Pages URL for those.

### 3. Turn on phone push

```
node scripts/vapid-keys.mjs
supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:<your address>
supabase functions deploy send-notifications
```

- The public key also goes into Pages as `VITE_VAPID_PUBLIC_KEY`.
- The private key goes only into the function secret.
- Deploying the function is safe before 090: the push step reports an error in
  its own result and e-mails carry on.

### 4. Point e-mail links at the phone app

`APP_LINK="https://<your pages domain>/job/{id}"`. The phone app opens that
path straight on the job. Until now the link had nowhere to go (MORNING.md).

### 5. Check on real phones (the spec's acceptance)

1. **iPhone:** open the Pages URL in Safari, tap Share → "Add to Home
   Screen", and open Wivo from the icon. Sign in with MFA, then go to Settings
   → Notifications on this phone → on.
2. **Push:** from the desktop, share a job with that organisation, or add a
   file to a job already shared. The phone should get "New in Wivo" within a
   minute, and the bell should show what it was.
3. **Camera:** on a job, take two photos. Check the Photos app has nothing
   new, and that the photos show in the job's files on the desktop.
4. **Android:** do the same in Chrome, then do it again with camera access
   denied. That uses the fallback capture button, where the phone's own camera
   app is involved. The spec asks for two camera apps, so check the gallery
   with each one.
5. **Partner:** sign in as a partner user. A shared job should show the same
   fields as on the desktop, and no camera button.
6. **Lost phone:** on the desktop, Seaded → Profile → "Sign out everywhere
   else". Within the hour the phone should be back at the login screen.

### 6. Optional: two hardening steps

- **Server-side session limit.** In the Supabase dashboard, Authentication →
  Sessions → "Time-box user sessions" enforces a maximum session length on the
  server. At the moment the phone's 12 hours is enforced by the app. This
  setting applies to the desktop too, so pick a length that suits both.
- **Content-Security-Policy.** Once the phone app runs on Pages, add a
  `script-src 'self'` and `connect-src` for your Supabase URL to
  `src/renderer/mobile-static/_headers`. Check in the browser console that
  nothing is blocked. It isn't added yet because it can't be tested here.

### 7. Optional: sound loudness

`brew install ffmpeg`, then `node scripts/process-sounds.mjs`. Listen, then
commit. The originals are kept in `brand/sounds/`.

## Known limits

- A deleted job leaves other open screens on their next refresh (about 30
  seconds, or when the window gets focus), not instantly.

- The phone app's JavaScript is about 880 kB (270 kB gzipped), because it
  shares modules with the desktop. That's fine on mobile data; it can be split
  later.
- An iPhone shows push only for the Home Screen app (iOS 16.4 or later).
  Safari in a tab gets e-mail only, and the settings screen says so.
