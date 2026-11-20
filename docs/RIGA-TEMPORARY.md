# Riga's temporary connection (for Monday 23.11.2026)

**For Kevin.** Two things, until part B of RIGA-GO-LIVE.md exists:

- **A.** a Windows installer built on your machine, with Riga's address in it;
- **B.** a separate Cloudflare Pages project for Riga's phone version.

`wivo` (Tallinn) and `wivo-test` are not touched. GitHub's secrets are not used. Nothing secret goes into either: the installer and the phone app carry **Riga's project URL and its public (anon / publishable) key**, which ship in every phone's bundle anyway. **Never** the `service_role` or secret key, an access token or Resend's key: the build refuses them.

You need first, from Riga's Supabase project (Project Settings → API): the **Project URL** and the **anon / publishable key**. Not the `service_role` key.

---

## A. The Windows installer

Everything in PowerShell, on your Windows machine.

1. **Get the code.** In the Wivo folder: `git switch testing`, then `git pull`. The working tree must be clean (the build refuses otherwise: the installer must be a known commit).
2. **Install the packages:** `npm ci`.
3. **Make `riga.env`** in the Wivo folder, with exactly two lines (Notepad is fine; the file is ignored by git):
   ```
   VITE_SUPABASE_URL=https://<riga ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<the anon / publishable key>
   ```
4. **Build:** `npm run dist:riga`. About five minutes. It refuses, in words, if:
   - the branch is not `testing`, or the tree has changes;
   - the URL is production's or the test copy's, or is not `https://<ref>.supabase.co`;
   - the key is not the public one, or belongs to another project;
   - `riga.env` holds any other name or any secret;
   - the built app or the package holds a secret or a token other than that key, or an `.env` file.
5. **It prints** the installer's path (`dist-riga\Wivo-Riga-Setup-<version>.exe`), the commit, Riga's project ref and the **SHA-256**. Write the SHA-256 down.
6. **The licence.** It must name Riga's address, so the installer refuses any other: with the YubiKey C in:
   `node scripts/make-license.mjs sign --org <Riga's org id> --api https://<riga ref>.supabase.co --name "Riga"`
   (PIN and touch.) Check it: `node scripts/make-license.mjs verify <token>`.
7. **Hand over the installer and the SHA-256 by different channels** (the file on a USB stick or a link, the SHA-256 by phone or message).
8. **On a Riga machine:** run the installer. Windows will say the file is **unsigned**: More info → Run anyway. Check the SHA-256 first: `Get-FileHash .\Wivo-Riga-Setup-<version>.exe`. Open Wivo, paste the licence, confirm the clinic's name, sign in.
9. **Check it is Riga's:** Settings → Licence shows Riga's address. A wrong address gives a red banner and sends nothing.

**Updates until the release tool exists:** this installer comes from `testing`, which pins the root keys, so it **refuses an unsigned app update**. Every update to Riga is a new installer from `npm run dist:riga`, installed by hand over the old one.

**If the build says "Refused":** read the line; each one names the fix. Do not edit the script to get past it.

---

## B. The Cloudflare project for Riga's phone

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**. Pick the Wivo repository.
2. **Project name:** `wivo-riga` (the address becomes `https://wivo-riga.pages.dev`).
3. **Production branch: `testing`.** (`main` is Tallinn's, and does not have the phone screens for jobs and stages yet.)
4. **Build settings:** framework preset *None*; build command `npm run mobile:build`; build output directory `dist-mobile`; root directory empty. Same as `wivo`'s: if `wivo` sets `NODE_VERSION`, set the same here (22).
5. **Environment variables (Production only):**
   - `VITE_SUPABASE_URL` = Riga's Project URL
   - `VITE_SUPABASE_ANON_KEY` = Riga's anon / publishable key

   Nothing else. No secret, no `service_role` key.
6. **Save and Deploy.** Wait for the first deployment to finish.
7. **No previews:** the project's **Settings → Builds → Branch control**: *Preview branches* = **None** (and automatic preview deployments off). A preview would be a second copy of the app on its own address, with these same variables.
8. **Riga's Supabase → Authentication → URL Configuration:** Site URL `https://wivo-riga.pages.dev`; add the same address to *Redirect URLs*. (Invites and password links come back to it.)
9. **Check it:** open the address on a phone, sign in with a Riga account. In the browser's developer tools → Network, the requests go to `<riga ref>.supabase.co` and nowhere else (never to `wrtucsfmpbwekugzzzxw` or `jhqyvancrzykxhzwnost`). Install it to the home screen.
10. **To change a value later:** the variable in the dashboard, then *Retry deployment*: the values are built in at build time, not read when the app runs.

`wivo-test` must keep `testing` as its production branch: Riga's project does the same on the same branch, and that is fine: two Pages projects, two sets of variables, one branch.

---

## What this does not do

- **No Resend daily limit in the log or for the owner** (NEXT.md task 4's second half). It needs database and Edge Function work and is not part of this.
- **No `wivo-update`, no release tool, no database baseline:** the baseline goes in with `psql` (docs/RIGA-SETUP.md, task 5).
- **No signed installer:** the `.exe` carries no code-signing certificate, like every release so far.

## Why the build is built this way (for the next person)

- The two values are given to the build in the **process environment**, which Vite reads before any `.env` file. The root `.env` (which holds production's address) therefore cannot reach the bundle, and CI's variables and tokens are not passed on. `MAIN_VITE_SENTRY_DSN` is blanked so Riga's errors do not go to another project.
- `package.json` ships `.env` as a resource of every release. Nothing reads it at run time. `scripts/electron-builder.riga.cjs` leaves it out, so the Riga installer cannot carry whatever the root `.env` holds.
- `scripts/rigaBuild.test.ts` runs the checks and keeps the script's two project IDs equal to `src/renderer/src/lib/testCopy.ts`'s.
