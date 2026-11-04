# GitHub account and repository: a security checklist (for Kevin, to do now)

**Why now:** today, a desktop release is whatever appears in this repository's GitHub releases. CI builds it unsigned and publishes it, and every Wivo desktop installs it by itself (`.github/workflows/build.yml`). Until releases are signed with the hardware key (docs/ARCHITECTURE-INSTANCES.md §5e), **whoever controls this GitHub account or its CI controls the code on every clinic's computers.**

The phone app is a second path: Cloudflare Pages builds it from this repository's `main` (production) and `testing` (the test site).

Tick each item. Each says where in GitHub it is.

## 1. Signing in

- [ ] **Two-factor with hardware keys.** Settings → Password and authentication → Two-factor authentication.
  - Add the two everyday hardware keys (the signing key and its spare, §5e) as **security keys** once they arrive.
  - Until then, use a passkey on the Mac plus an authenticator app.
  - Remove SMS as a method, if it is there.
- [ ] **Recovery codes:** download them again (Settings → Password and authentication → Recovery options), print them, and keep the paper with root key A in the safe. Delete the downloaded file.
- [ ] **The e-mail account** that GitHub sends password resets to has its own two-factor, preferably a hardware key. Whoever controls that mailbox can reset GitHub.
- [ ] **Sessions:** Settings → Sessions. Sign out any session you don't recognise.

## 2. Who has access

- [ ] **The repository's people:** repository → Settings → Collaborators and teams (or the organisation's People and Outside collaborators). Only you, unless you know exactly why someone else is there. Nobody else needs write access.
- [ ] **Apps with access:** Settings → Applications.
  - **Authorized OAuth Apps, Authorized GitHub Apps, Installed GitHub Apps:** remove everything you don't use now.
  - **Cloudflare Pages** stays, limited to this one repository ("Only select repositories"), because it builds the phone app.
- [ ] **Cloudflare itself:** the account that owns the `wivo` and `wivo-test` Pages projects has its own hardware-key two-factor, and only you as a member. Whoever controls it controls the phone app for every user.

## 3. Keys and tokens

- [ ] **SSH keys:** Settings → SSH and GPG keys. Delete any you can't name and date (an old laptop, a server).
- [ ] **Personal access tokens:** Settings → Developer settings → Personal access tokens, both **Fine-grained tokens** and **Tokens (classic)**.
  - Delete every token you aren't using today.
  - Any token you keep has an expiry and the narrowest scope: one repository, the fewest permissions.
  - No classic token with `repo` or `workflow` scope should exist.
- [ ] **The GitHub CLI on this Mac** (`gh auth status`) holds a token that can create releases. Keep it only if you publish from this Mac.
- [ ] **Deploy keys:** repository → Settings → Deploy keys. There should be none. Delete any you didn't add on purpose.

## 4. GitHub Actions

- [ ] **Secrets:** repository → Settings → Secrets and variables → Actions.
  - List them, and delete every secret no workflow uses (search `.github/workflows/` for its name).
  - **Today:** `build.yml` is the only workflow, and it uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (plus GitHub's own `GITHUB_TOKEN`). Anything else listed is unused.
  - **Never stored here:** a service-role key, a database password, a Resend key or any signing key. If one is there, delete it here *and* replace it where it came from.
- [ ] **Environments:** repository → Settings → Environments. A `production` environment with **you as the required reviewer** holds any secret that touches production, so no workflow run can use it without your click.
- [ ] **Workflow permissions:** repository → Settings → Actions → General → Workflow permissions.
  - Set to **"Read repository contents and packages permissions"**; `build.yml` asks for `contents: write` itself.
  - **Untick** "Allow GitHub Actions to create and approve pull requests".
- [ ] **Which actions may run:** the same page, Actions permissions → **"Allow … select actions"**: only `actions/checkout` and `actions/setup-node`, the two the workflow uses. Add one only when a workflow needs it.
- [ ] **Forks:** if the repository is public, require approval for workflows from outside contributors. Better: keep the repository **private** (Settings → General → Danger Zone shows its visibility).

## 5. Branches, tags and releases

- [ ] **A ruleset for `main`:** repository → Settings → Rules → Rulesets → New branch ruleset, target `main`.
  - Restrict updates to you.
  - **Block force pushes** and **block deletion.**
  - Optionally require the tests (status checks) to pass.
  - "Require a pull request" would stop your direct pushes, so leave it off unless you want that.
- [ ] **The same ruleset for `testing`.**
- [ ] **A tag ruleset for `v*`:** only you may create, move or delete version tags. A release points at a tag.
- [ ] **Who can publish a release:** anyone with write access, and any workflow with `contents: write` (today `build.yml`).
  - **Now:** keep write access to you alone (section 2).
  - **Once local signing is built:** the publishing step leaves `build.yml`. CI then only builds and tests, and releases are built and signed on your Mac (§5e). The app refuses a release that isn't signed.

## 6. Watching

- [ ] **Security log:** Settings → Security log. Read the last 90 days once. Look for new tokens, new OAuth grants, two-factor changes, new SSH keys and repository access changes you don't recognise.
- [ ] **Secret scanning and push protection:** repository → Settings → Code security. Turn both on, so a key committed by mistake is blocked or reported.
- [ ] **Dependabot alerts:** the same page. On.

When every box is ticked, note the date here: ____________
