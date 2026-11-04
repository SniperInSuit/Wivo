# Accounts: real e-mail first, usernames as a fallback

Status: **built on `testing`** (§7), not applied anywhere yet. Kevin's next steps are in §7.
Never production; Kevin applies every migration in the SQL Editor (CLAUDE.md).

---

## 0. Decisions (Kevin, 2026-11-03)

1. **Stand-in domain:** `nomail.wivodent.com`, with a null MX record (`MX 0 .`), `v=spf1 -all` and DMARC `p=reject`, so it can never send or receive mail (§3.2, §6.2).
2. **Sign-in format:** `tehnik@tal`. A device also remembers the last clinic code, so on a clinic computer staff can type just `tehnik` (§3.3). Existing plain logins keep working.
3. **Sending domain:** `mail.wivodent.com`, in Resend's EU region (§6.1).
4. **Invites:** Wivo sends them itself, in each person's language (§2.2).
5. **Order:**
   - first, stop e-mails to stand-in addresses and confirm the existing stand-ins (sql/099), on the test copy first, so nobody gets locked out and nothing bounces;
   - then the rest.
6. **The four checks** (§7, step 4):
   - Checks 1 and 2: Kevin runs `scripts/check-standin-auth.sh` himself, with the test copy's secret key.
   - Checks 3 and 4: tested on the test copy after the build, with the fallbacks ready.
7. **The test copy's mail is limited to Kevin's own addresses** (`EMAIL_ALLOW_ONLY`, §6.4).

---

## 1. Today (read from the code on `testing`, 18246ad)

| What | Where | Effect |
|---|---|---|
| An account without an e-mail gets `<username>@example.com` | `src/renderer/src/lib/supabase.ts` (`USERNAME_DOMAIN`, `usernameToEmail`); `VITE_USERNAME_DOMAIN` is not set in any build | The address can never be confirmed. With "Confirm email" on, that is a lockout. |
| The account is created in the **browser**, with public `auth.signUp` and the anon key | `Workers/WorkersPage.tsx` `handleInvite`, via `createSignupClient()` | Needs public sign-up to stay on. Anyone holding the public key can make an account. |
| The owner check is a 10-minute invite token from `create_worker_invite()` | `sql/086_worker_invites.sql` | Good, and kept: the server-side path reuses it. |
| **Usernames are project-wide, not per clinic** | `sql/029`: unique index `profiles_username_key` on `lower(username)`; `sql/086` `handle_new_user` checks the name against **every** profile; and `tehnik@example.com` is one row in `auth.users` | **Bug, confirmed.** Two clinics can **not** both have "tehnik". The second clinic gets "this username is already taken", which also tells it that the name exists in another clinic. |
| Password reset for a username account: the owner sets one | `sql/030` `admin_set_worker_password` | Kept for stand-in accounts. From sql/113, at least 10 characters, as everywhere else: it writes the hash itself, so Supabase Auth's minimum does not reach it. |
| Password reset by e-mail | not built (`LoginPage.tsx` has no "Forgot password") | Built in §2.3. |
| Notification e-mails go to `auth.users.email`, which includes stand-ins | `sql/075` `pending_notification_emails`; `notify_email` defaults to true | **Bug, latent.** Once Resend is live, every stand-in account is mailed at an address that doesn't exist. The bounces hurt the sending domain's reputation. Fixed in §4.3. |
| Public sign-up | `supabase/config.toml` `enable_signup = true` (local); on in both hosted projects | Switched off in §5. |
| A new clinic's founder | No sign-up screen exists (`LoginPage.tsx`: "accounts are created by the clinic"). The founder is made in the Supabase dashboard, signs in, and `ClinicSetupWizard` creates the clinic. | Kept, but the founder is invited by e-mail (§5). |

---

## 2. A real e-mail is the normal way

### 2.1 The flow

1. **Owner, in Team, chooses "Add member" and enters the name, the real e-mail and the language.**
   - The app calls a new Edge Function, `team-account`, with `{ action: 'invite', email, fullName, language }`.
   - The browser never calls `signUp` again.
2. **`team-account` checks the caller and creates the account** (the same caller check as `account-security`, sql/097):
   1. As the caller, it calls `create_worker_invite()`. That function returns a token only to an owner of a clinic. Since sql/098 it does so only with the second factor (`db_pre_request`), and `sessionHasMfa()` checks this again explicitly, as `file-link` does.
   2. With the service key, it calls `auth.admin.generateLink({ type: 'invite', email, options: { data: { full_name, language, invite_token } } })`.
      - This creates the user, invited and unconfirmed.
      - The existing `handle_new_user` trigger places the user in the owner's clinic as a technician, in the same transaction (sql/086, unchanged).
   3. It sends the e-mail itself through Resend: the clinic's name, the person's language, and one link. The link is Wivo's own, not GoTrue's:
      `https://app.wivodent.com/auth/confirm?type=invite&token_hash=<hashed_token>`
   4. It writes nothing personal to its logs: no address, no token.
3. **The person opens the link.** The phone app's new route `/auth/confirm` shows a "Continue" button.
   - Only that click calls `verifyOtp({ type, token_hash })`. Mail scanners that open links ahead of the person don't use up the token.
   - The person then sets a password with `updateUser({ password })`.
   - Then `MfaGate` enrols the authenticator, as it does today.
   - All of this works at aal1 after sql/098. These are GoTrue calls, and the person's own profile row stays readable.
4. **The person signs in on the desktop app or the phone with the e-mail, the password and the code.**

**Re-sending an invite.** Team shows "Invite sent, not accepted yet". "Send again" calls `{ action: 'resend', userId }`, which makes a new link for an account that hasn't been confirmed. Links expire after 24 h (§6.3).

**An address that already has an account.** It is refused with "this address already has a Wivo account". A person belongs to one organisation (`profiles.clinic_id`). Membership in several organisations is out of scope.

### 2.2 Why Wivo sends the invite and not a Supabase template

- **Language:** the person's language (et/en/ru) and the clinic's name are known when the invite is made. A Supabase template has a single text per project.
- **Testing:** the e-mail and the link are code in `_shared/`, tested like `notifySender.ts`.
- **One sender:** Resend, `RESEND_API_KEY`, and the same `from` address as the notifications.

Recovery and e-mail change are started by GoTrue, so they use Supabase's SMTP (Resend underneath). Their templates carry all three languages in one short e-mail (§6.3).

### 2.3 Password recovery by e-mail

- **Sign-in screen:** add "Forgot password?". It shows only when the field holds a real e-mail.
  - The app calls `resetPasswordForEmail(email, { redirectTo: <app>/auth/confirm })`.
  - It always answers "If the address has an account, a link is on its way", whether or not the address exists.
- **`/auth/confirm?type=recovery`:**
  1. The person clicks Continue, which runs `verifyOtp` and gives an aal1 session.
  2. **If the person has an authenticator, they enter the code first** (`MfaGate`). E-mail alone never bypasses the second factor.
  3. They set a new password.
  4. Other sessions are ended with `signOut({ scope: 'others' })`.
- **Username accounts:** "Forgot password?" says "Ask your clinic's owner". The owner sets a password (sql/030), as today.
- **A lost phone and a lost password together:** the owner resets the second factor (sql/097), then the person uses recovery.

---

## 3. Username-only as a fallback

### 3.1 Created on the server

- **Team has a second tab: "Without e-mail".** The owner enters the name, a username and an initial password, as today.
- **The app calls `team-account` with `{ action: 'create_login', username, fullName, password }`.**
  1. The caller check is the same as for an invite (owner, aal2, invite token).
  2. With the service key: `auth.admin.createUser({ email: <stand-in>, password, email_confirm: true, user_metadata: { full_name, username, language, invite_token } })`.
  3. The trigger places the person in the clinic, as for an invite.
- **Confirmed at birth.** "Confirm email" therefore never affects these accounts, and no e-mail is sent to the stand-in.
- **The owner sees the login name to pass on**, for example `tehnik@tal`.

### 3.2 The stand-in address

`<username>.<clinic code>@nomail.wivodent.com`, for example `tehnik.tal@nomail.wivodent.com`.

- **Unique per clinic, not global.** The clinic's code (`clinics.code_prefix`) is unique (sql/070, `clinics_code_prefix_key`) and the app can't change it (sql/083, `guard_code_prefix`). So `tehnik` at TAL and `tehnik` at PAR are two different addresses.
- **Unambiguous.** A clinic code is letters plus an optional digit and never has a dot, so it is always the last segment. `a.b` + `c` (`a.b.c`) and `a` + `b.c` can't both exist.
- **Can never receive mail.**
  - Wivo owns `wivodent.com`, so nobody else can register the name.
  - `nomail.wivodent.com` publishes `MX 0 .` (null MX): "this domain accepts no mail". It also has `v=spf1 -all`, `p=reject`, and no A record.
  - A message that is sent anyway fails at the sender and reaches no one.
- **Configurable per instance:** `VITE_STANDIN_DOMAIN` in the app and `STANDIN_DOMAIN` in the Edge Function. They must match. The default is `nomail.wivodent.com`.
- **To check on the test copy first:**
  - that GoTrue accepts a null-MX domain in `admin.createUser`;
  - that sign-in with a password works for it.
  - If GoTrue refuses null MX, the fallback is the same subdomain with **no DNS records at all**. With no MX and no A record, mail can't be delivered either.
- **If the code is ever changed by hand in the SQL Editor**, that clinic's username logins stop working. The migration adds a comment on `code_prefix` that says so. Changing a code also means rewriting the stand-ins: one `update auth.users` statement, documented beside the comment.

### 3.3 What a person types at sign-in

`loginAddresses(typed)` in `shared/auth/loginAddress.ts` (tested) gives the addresses to try, in order:

| Typed | Means | Tried |
|---|---|---|
| `mari@kliinik.ee` (`@`, and a dot after it) | real e-mail | as typed |
| `tehnik@tal` (`@`, no dot after it) | username at a clinic | `tehnik.tal@nomail.wivodent.com` |
| `tehnik` (no `@`), on a device that remembers clinic TAL | that clinic's username, or an existing plain login | `tehnik.tal@nomail.wivodent.com`, then `tehnik@example.com` |
| `tehnik` (no `@`), on a device that remembers no clinic | **existing** account (before this change) | `tehnik@example.com`, unchanged |

- **Which clinic a device remembers:** the code of the last person who signed in there, once their clinic loaded (after the second factor). The sign-in page says so: "On this device, a username alone signs in at TAL."
- **When the next address is tried:** only after "wrong password". So an old `tehnik` still signs in on a computer that remembers a clinic that has its own `tehnik`.
- Existing accounts keep their login.
- No anonymous lookup endpoint is needed: the address comes from what was typed, so nobody can ask "does this user exist?".
- **New usernames:** `[a-z0-9._-]`, 2–32 characters, starting with a letter or digit, unique **per clinic**.

---

## 4. Existing `@example.com` accounts

### 4.1 First: a read-only count (Kevin runs it on production)

The query returns counts only: no address, no name, no identifier. It changes nothing.

```sql
-- Read-only: counts of accounts by kind. No personal data in the result.
select
  case
    when lower(u.email) like '%@example.com' and p.username is not null
         and lower(u.email) = lower(p.username) || '@example.com' then '1 wivo stand-in (example.com)'
    when lower(u.email) like '%@example.com'                     then '2 example.com, NOT a wivo stand-in'
    when lower(u.email) like '%@wivo.invalid'
      or lower(u.email) like '%@wivo.local'                       then '3 older stand-in'
    when u.email is null or u.email = ''                         then '4 no address'
    else                                                              '5 real address'
  end                                   as kind,
  u.email_confirmed_at is not null      as confirmed,
  u.last_sign_in_at is not null         as ever_signed_in,
  p.clinic_id is not null               as in_a_clinic,
  count(*)                              as accounts
from auth.users u
left join public.profiles p on p.id = u.id
where u.deleted_at is null
group by 1, 2, 3, 4
order by 1, 2, 3, 4;
```

How to read it:
- Rows of kind 1 with `confirmed = false` are what 099 will confirm, and the number 099 will report.
- Kind 2 should be 0. If it isn't, 099 leaves those accounts alone and they are looked at one by one.

### 4.2 `sql/099_standin_logins.sql`: no mail to stand-ins, and the one-time confirmation

099 is small and uses nothing after sql/075, so like 098 it can run on production's base (091).

1. **No mail to a stand-in.**
   - `public.is_standin_email(text)` is true for `nomail.wivodent.com`, every `example.com` address (that domain accepts no mail), `wivo.invalid` and `wivo.local`.
   - `pending_notification_emails` (replacing 075's) skips those addresses.
   - In the app, a stand-in account sees no "E-mail me" switch, but "Add an e-mail address" instead (§4.4).
2. **The one-time confirmation.** It confirms an account **only** when all of these hold:
   - the address is `<username>@example.com` (or `wivo.invalid` or `wivo.local`);
   - the local part is exactly that account's own `profiles.username`;
   - the account is not confirmed yet;
   - it is not deleted.

   It sets `email_confirmed_at = now()` and nothing else. It reports the count (`raise notice '099: confirmed N stand-in account(s)'`), to compare with §4.1. It renames nobody, so every existing login keeps working. Running it again confirms nothing new.

**Tests:** `sql/test/standinLogins.test.ts`.
- Which addresses count as stand-ins.
- The pending list leaves out the old and the new stand-ins and keeps a real address.
- Exactly the right accounts are confirmed. These stay untouched: a real address, a real address with a username, an `example.com` address that isn't the account's username, one without a username, a deleted account, an already-confirmed account.
- Running it twice changes nothing.
- It applies on 000–091 + 099.

### 4.3 `sql/100_accounts.sql`: per-clinic usernames, and stand-ins only with an invite

1. **Usernames are unique per clinic.**
   - `profiles_username_key` is replaced by a unique index on `(clinic_id, lower(username))`.
   - `handle_new_user` (replacing 086's) checks the name only within the invite's clinic.
2. **A stand-in only with its clinic's invite.**
   - A new account on `nomail.wivodent.com` is refused unless it carries a valid, unused invite of the clinic whose code is in the address, and the address is exactly `<username>.<code>`.
   - So nobody can take another clinic's `tehnik` through the public sign-up while it is still on (§5), and a bug in the function can't put a person in the wrong clinic.
   - **This is why `scripts/check-standin-auth.sh` must run before 100:** its throwaway account carries no invite.
3. **The person's language** comes from the invite and goes onto their profile.
4. **When a real e-mail replaces a stand-in**, a trigger on `auth.users` (after an update of `email`) clears `profiles.username`.
5. **`team_accounts()`** gives the owner's Team page how each member signs in (`tehnik@tal`, an old `tehnik`, or the address) and whether an invite is still waiting. It answers only the owner, with the second factor, about their own clinic.
   - sql/111 makes it work on Supabase (the address is `varchar(255)` there).
   - sql/112 adds `has_authenticator`: yes/no, whether the member has a verified authenticator. Nothing else about the factors. The Team page shows it as a badge, next to "Verified" or "Invite not accepted yet" for an e-mail account.
   - The Team page shows each member's sign-in under their name: the address, or "Username: tehnik@tal".

There is no new table.

**Tests:** `sql/test/accounts.test.ts`.
- Two clinics can both have `tehnik`.
- The same clinic can't have two.
- An old build's sign-up with `example.com` still works.
- Refused: a stand-in with no invite, with another clinic's invite, with a used invite, or with an address that doesn't match.
- A refused one leaves nothing behind and doesn't use up the invite.
- The language is stored.
- The username is cleared on an e-mail change.
- `team_accounts`: the owner sees their own clinic; a worker, aal1 and anon are refused; `has_authenticator` counts only a verified factor, and no other factor detail is returned.

### 4.4 Adding a real e-mail later (a change with a confirmation link)

GoTrue's own "change e-mail", with "Secure email change" on, wants a click from **both** addresses, and a stand-in can't receive one. So for a stand-in account the change goes through the Edge Function:

1. **The person starts it.** Settings → Account → "Add an e-mail address" calls `team-account` with `{ action: 'add_email', email }`.
2. **The function checks:**
   - the caller is aal2 (`sessionHasMfa`);
   - the caller's current address is a stand-in (`is_standin_email`);
   - the new address isn't taken.
3. **It creates a link for the new address only:** `auth.admin.generateLink({ type: 'email_change_new', email: <stand-in>, newEmail })`.
4. **It sends the link through Resend**, in the person's language, to the new address only.
5. **The person clicks it** (`/auth/confirm?type=email_change`). The address switches, the trigger in §4.3 clears the username, and from then on the person signs in with the e-mail and can recover a password by e-mail.

**To check on the test copy first:** that an `email_change_new` link from `generateLink` completes on its own while "Secure email change" is on. If it doesn't, the fallback is Wivo's own one-time token:
- a table with org_id, RLS and MFA, holding the token's hash and a 24 h expiry;
- after the click, `admin.updateUserById(id, { email, email_confirm: true })`.

A person who already has a real address changes it the normal way (`updateUser({ email })`). Secure email change sends a link to both addresses.

---

## 5. Public sign-up off

Once every account is made on the server (§2, §3), turn off **Authentication → Sign In / Providers → "Allow new users to sign up"**: first on the test copy, later on production. The admin API (`generateLink`, `createUser`, `inviteUserByEmail`) keeps working when it is off.

**Order, because old app builds still call `signUp`:**
1. Release the build with `team-account`. The desktop updates itself on next launch; the phone app updates on the next push to `main`.
2. Wait until every machine runs it. The minimum-version proposal from the 2.0.1 "producer and designer" bug is still open, and it is what would make this a guarantee rather than a wait.
3. Turn sign-up off. An old build's "Add member" then fails with "Signups not allowed" and nothing half-made is left behind.

**A new clinic's founder after this:**
- Kevin uses Supabase dashboard → Authentication → Users → **Invite user** with the founder's real e-mail. That uses the Supabase invite template (§6.3), which links to `/auth/confirm`.
- The founder sets a password and an authenticator, signs in, and `ClinicSetupWizard` creates the clinic, as today.

**Local:** `supabase/config.toml` gets `enable_signup = false`, so local development behaves like the hosted projects.

**A related gap, not fixed here:** any signed-in account without a clinic can found one (`clinic_insert`, sql/014; the wizard). That includes a removed worker. Once sign-up is off, only invited people can reach that point. Restricting clinic founding to people Kevin invites is a separate small change.

---

## 6. What Kevin sets up outside the code

Do these first on the **test copy**, with `wivo-test.pages.dev` as its web app. Production follows the same steps later, in a session Kevin starts. I never see a key; every key is pasted by Kevin straight into the dashboard where it is used.

### 6.1 Resend: the sending domain

1. In resend.com, go to **Domains** → **Add Domain** and enter `mail.wivodent.com`. Choose region **EU (Ireland)**: the e-mails carry staff names and addresses.
2. Resend shows the DNS records to create. Copy them **exactly as shown**; the values are specific to your account. Typically:

   | Type | Name (at your host) | Value |
   |---|---|---|
   | TXT | `resend._domainkey.mail` | the DKIM key Resend shows (`p=…`) |
   | MX | `send.mail` | `feedback-smtp.eu-west-1.amazonses.com`, priority 10 |
   | TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` |

3. Also add DMARC for the subdomain. Start in monitoring mode; tighten to `p=quarantine` after a few clean weeks:

   | Type | Name | Value |
   |---|---|---|
   | TXT | `_dmarc.mail` | `v=DMARC1; p=none;` |

4. Back in Resend, click **Verify DNS Records**. Wait until all of them show **Verified**: minutes to a few hours.
5. Go to **API Keys** → **Create API Key** three times, each with **Sending access** for `mail.wivodent.com` only:
   - `wivo-test-auth-smtp`, for Supabase SMTP on the test copy;
   - `wivo-test-functions`, for the Edge Functions on the test copy;
   - later the two `wivo-prod-…` keys.

   Each key is shown once. Paste it straight into §6.3 or §6.4.

**Names at your DNS host:** most hosts want the name *without* `wivodent.com`, as written above. Some want the full name, for example `resend._domainkey.mail.wivodent.com`. Don't touch the existing records on `wivodent.com` itself (root SPF, MX); the subdomain needs none of them.

### 6.2 DNS: the stand-in domain that can never receive mail

| Type | Name | Value |
|---|---|---|
| MX | `nomail` | `.` with priority `0` (a "null MX"). If your host won't accept `.`, tell me which host it is and I'll find its way to write it. |
| TXT | `nomail` | `v=spf1 -all` |
| TXT | `_dmarc.nomail` | `v=DMARC1; p=reject;` |

- Create **no** A, AAAA or CNAME record for `nomail`.
- To check, from any terminal:
  - `dig +short MX nomail.wivodent.com` should print `0 .`;
  - `dig +short A nomail.wivodent.com` should print nothing.

### 6.3 Supabase (test copy): SMTP, links and templates

All of this is in the Supabase dashboard of the **test copy** project (`jhqyvancrzykxhzwnost`).

1. **Authentication → Emails → SMTP Settings → Enable Custom SMTP:**

   | Field | Value |
   |---|---|
   | Sender email | `no-reply@mail.wivodent.com` |
   | Sender name | `Wivo` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | the `wivo-test-auth-smtp` key (§6.1) |

   Save.
2. **Authentication → Rate Limits:** e-mails sent per hour, `30` (the default once custom SMTP is on). Raise it only if needed.
3. **Authentication → URL Configuration:**
   - Site URL: `https://wivo-test.pages.dev`
   - Redirect URLs: add `https://wivo-test.pages.dev/auth/confirm`
   - Production later: `https://app.wivodent.com` and `https://app.wivodent.com/auth/confirm`.
4. **Authentication → Sign In / Providers → Email:**
   - **Confirm email:** on, as now.
   - **Secure email change:** on.
   - **Email OTP Expiration:** `86400` (24 h). This is how long invite and recovery links last.
   - **Minimum password length:** `10`, the same as the app (`MIN_PASSWORD` in `lib/authConfirm.ts` and in the Edge Function `team-account`). Already-set shorter passwords keep signing in.
   - **"Allow new users to sign up":** stays on until §5.
5. **Authentication → Emails → Templates.**
   - Paste the subject and body from these files:
     - `docs/auth-email-templates/reset-password.html` for **Reset password**;
     - `docs/auth-email-templates/invite.html` for **Invite user** (used only for founders you invite from the dashboard);
     - `docs/auth-email-templates/change-email.html` for **Change email address**.
   - The subject is in each file's first comment. Paste the body without that comment.
   - Each body is in Estonian, English and Russian, with no patient data.
   - Each link goes to Wivo's page (`{{ .SiteURL }}/auth/confirm?type=…&token_hash={{ .TokenHash }}&lang={{ .Data.language }}`), not GoTrue's redirect.
6. **Test it:** dashboard → Authentication → Users → **Invite user** with your own address. The e-mail arrives from `no-reply@mail.wivodent.com`. Resend → **Emails** shows it as *Delivered*.

### 6.4 Edge Function secrets (test copy)

In the test copy's dashboard → **Edge Functions → Secrets**:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | the `wivo-test-functions` key |
| `NOTIFY_FROM` | `Wivo <no-reply@mail.wivodent.com>` |
| `APP_LINK` | `https://wivo-test.pages.dev/job/{id}` (as send-notifications already reads it; team-account uses its origin) |
| `STANDIN_DOMAIN` | optional; the default is `nomail.wivodent.com` |
| `EMAIL_ALLOW_ONLY` | **test copy only:** your own addresses, for example `@wivodent.com,fullgevity@` |

**Setting `RESEND_API_KEY` also turns on send-notifications' notification e-mails**, which have been deferred until now (GAP-ANALYSIS). That makes "no mail to stand-ins" a **precondition**: 099 is applied before the key is set (§7.2, step A).

**The test copy is a copy of production's data.** Its `auth.users` may hold real staff addresses. `EMAIL_ALLOW_ONLY` keeps both functions' mail to your own addresses:
- `team-account` refuses an invite to any other address, before anything is created;
- send-notifications marks such a notice as done without sending it.

`EMAIL_ALLOW_ONLY` is never set on production.

Supabase's own e-mails (recovery, e-mail change) don't read this secret. On the test copy, use "Forgot password?" only with your own addresses.

---

## 7. What is built, and Kevin's steps

### 7.1 Built on `testing` (not pushed)

| Commit | What |
|---|---|
| Step 1 | `sql/099` (§4.2) + tests; `shared/auth/loginAddress.ts` (the sign-in rules, tested); no "E-mail me" switch for a stand-in |
| Script | `scripts/check-standin-auth.sh`: checks 1 and 2, for Kevin to run |
| Step 2 | `sql/100` (§4.3) + tests |
| Step 3 | Edge Function `team-account` + `_shared/teamAccount.ts` (tested): invite, login without e-mail, send again, add an e-mail. `EMAIL_ALLOW_ONLY` also limits send-notifications. `_shared/generated/loginAddress.ts` is a checked copy, because a deploy may not bundle imports from outside `supabase/` |
| Step 4 | The app: Team "Add staff member" (with or without e-mail, invite status, "Send again"); sign-in with `tehnik@tal` and the remembered clinic; "Forgot password?"; the phone app's `/auth/confirm` (invite, recovery, e-mail change); Settings "Add an e-mail address"; en and et text (ru falls back to en, as everywhere) |

The app no longer calls `signUp` anywhere.

### 7.2 Kevin's steps, in order (test copy `jhqyvancrzykxhzwnost` only)

**A. Nobody locked out, nothing mailed to stand-ins (099)**

1. On production, run the read-only count query in §4.1. Note the kind-1, `confirmed = false` number.
2. On the test copy, in the SQL Editor, run `sql/099_standin_logins.sql`. The output shows `099: confirmed N stand-in account(s)`.
3. As a separate query, run `notify pgrst, 'reload schema';`.
4. Read-only checks. Expect `0`, then `true` and `false`:

   ```sql
   select count(*) as unconfirmed_wivo_standins
     from auth.users u join public.profiles p on p.id = u.id
    where p.username is not null and u.email_confirmed_at is null and u.deleted_at is null
      and lower(u.email) in (lower(p.username) || '@example.com', lower(p.username) || '@wivo.invalid', lower(p.username) || '@wivo.local');
   select public.is_standin_email('x@example.com') as standin, public.is_standin_email('x@kliinik.ee') as real;
   ```

**B. DNS, then checks 1 and 2**

5. Create the DNS records in §6.2 (`nomail`). `dig +short MX nomail.wivodent.com` should print `0 .`.
6. **Before** step 7, run `bash scripts/check-standin-auth.sh`.
   - It asks for the test copy's secret key without showing it, and refuses production.
   - It creates one throwaway account and deletes it again.
   - Expected result: all PASS. If GoTrue refuses the null MX, stop and tell me (§3.2, fallback).

**C. The rest of the database (100)**

7. On the test copy, run `sql/100_accounts.sql`, then `notify pgrst, 'reload schema';` as a separate query.
8. Read-only checks:

   ```sql
   -- only profiles_clinic_username_key
   select indexname from pg_indexes where schemaname = 'public' and tablename = 'profiles' and indexname like 'profiles_%username%';
   -- on_auth_user_created, on_auth_email_changed
   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal order by 1;
   -- 0: no clinic has the same username twice
   select count(*) from (select clinic_id, lower(username) from public.profiles where username is not null group by 1, 2 having count(*) > 1) d;
   ```

**D. E-mail and the function**

9. Resend (§6.1), DNS for `mail` (§6.1), Supabase SMTP, URL configuration, Email settings and templates (§6.3).
10. Edge Function secrets on the test copy (§6.4):
    - `RESEND_API_KEY`
    - `NOTIFY_FROM`
    - `APP_LINK`, set to `https://wivo-test.pages.dev/job/{id}`, as send-notifications uses it
    - **`EMAIL_ALLOW_ONLY`**, set to your own addresses, for example `@wivodent.com,fullgevity@`
11. Deploy both functions to the test copy only:

    ```sh
    supabase functions deploy team-account --project-ref jhqyvancrzykxhzwnost --no-verify-jwt
    supabase functions deploy send-notifications --project-ref jhqyvancrzykxhzwnost --no-verify-jwt
    ```

    If the deploy can't bundle `_shared/generated/…`, tell me; the other imports are the same as account-security's.
12. Push `testing`, so `wivo-test.pages.dev` serves `/auth/confirm`. Then run `npm run dev:test` for the desktop app against the test copy.

**E. Hand test on the test copy**, including checks 3 and 4 (§7.3).

**F. Later:**
- production, in a session you start: 099, 100, §6 for production (without `EMAIL_ALLOW_ONLY`), then the release;
- §5, sign-up off, once every machine runs the release.

### 7.3 Hand test (test copy)

- **Check 3: adding an e-mail.**
  1. A username account (Settings) adds your address.
  2. The link arrives. Opening it switches the address, and the username is gone from Team.
  3. Sign in with the address; "Forgot password?" works for it.
  - If the link doesn't complete while "Secure email change" is on, the fallback in §4.4 is ready to build.
- **Check 4: recovery with an authenticator.**
  1. "Forgot password?" for your address.
  2. The link asks for the code first, then the new password.
  3. Other sessions are signed out.
  - "Forgot password?" for an unknown address gives the same message.
- **Invite:**
  1. Invite your own address in Estonian. The e-mail arrives in Estonian from `no-reply@mail.wivodent.com`.
  2. Continue, set a password, add the authenticator. Then sign in on the desktop and the phone. The person is in the clinic as a technician.
  3. Opening the link a second time says it was used.
  - Inviting an address outside `EMAIL_ALLOW_ONLY` is refused, and nothing is created.
- **Without e-mail:**
  1. Create `tehnik` in two test clinics. Both sign in as `tehnik@<code>`.
  2. On a computer where someone from that clinic signed in, `tehnik` alone works.
  3. A second `tehnik` in the same clinic is refused.
  4. An old plain login still works, on that computer too.
- **No mail to stand-ins:** a notice for a username account sends no e-mail (Resend → Emails), and the switch is replaced by "Add an e-mail address".
- **The caller check:**
  - a worker's Team page can't add anyone;
  - an owner without the second factor gets "Sign in with your second factor first";
  - a partner organisation's owner adds people only to their own organisation.
- **"Send again":** a waiting invite shows "Invite not accepted yet"; "Send again" mails a new link, and the old one stops working.

### 7.4 Known limit until §5

Old app builds (2.0.2 and earlier) still create username accounts with the public `signUp` and `<username>@example.com`.
- 100 still lets them work, with the invite.
- But with "Confirm email" on, such an account is unconfirmed and locked out. Run 099 again (it is safe to repeat) until every machine runs the release.
- Once Supabase's SMTP is live, that sign-up also tries to send a confirmation e-mail to `example.com`, which bounces.
- So on production: **release the new build before turning on custom SMTP**, then switch sign-up off (§5).

## 8. Not in this plan

- One person in several organisations.
- Renaming existing `@example.com` accounts to the new stand-in format. It can be offered later as an owner action; nobody needs it to sign in.
- A forced password change at the first sign-in of a username account.
- Restricting who may found a clinic (§5, related gap).
