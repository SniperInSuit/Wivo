# Accounts: real e-mail first, usernames as a fallback

Plan only. Nothing here is built yet. Status: waiting for Kevin's go-ahead.
Branch: `testing`. Never production; Kevin applies every migration in the SQL Editor (CLAUDE.md).

---

## 0. What Kevin decides before the build starts

1. **The stand-in domain:** `nomail.wivodent.com`, a subdomain of a domain Wivo owns, with a *null MX* record (RFC 7505), so it can never receive mail (§3.2).
2. **The login name for username accounts:** `tehnik@tal`, meaning the username, then `@`, then the clinic's code (§3.3). Existing accounts keep their plain `tehnik` login.
3. **The sending domain for Resend:** `mail.wivodent.com`, a subdomain, so the root domain's existing mail and SPF stay untouched (§6.1).
4. **Who writes invite e-mails:** Wivo itself, through Resend, in the person's language. Supabase's SMTP is used only for the two e-mails a signed-out person triggers: password recovery and e-mail change (§2.2).

If any of these four is wrong, the rest of the plan still holds. Only names and the DNS records change.

---

## 1. Today (read from the code on `testing`, 18246ad)

| What | Where | Effect |
|---|---|---|
| An account without an e-mail gets `<username>@example.com` | `src/renderer/src/lib/supabase.ts` (`USERNAME_DOMAIN`, `usernameToEmail`); `VITE_USERNAME_DOMAIN` is not set in any build | The address can never be confirmed. With "Confirm email" on, that is a lockout. |
| The account is created in the **browser**, with public `auth.signUp` and the anon key | `Workers/WorkersPage.tsx` `handleInvite`, via `createSignupClient()` | Needs public sign-up to stay on. Anyone holding the public key can make an account. |
| The owner check is a 10-minute invite token from `create_worker_invite()` | `sql/086_worker_invites.sql` | Good, and kept: the server-side path reuses it. |
| **Usernames are project-wide, not per clinic** | `sql/029`: unique index `profiles_username_key` on `lower(username)`; `sql/086` `handle_new_user` checks the name against **every** profile; and `tehnik@example.com` is one row in `auth.users` | **Bug, confirmed.** Two clinics can **not** both have "tehnik". The second clinic gets "this username is already taken", which also tells it that the name exists in another clinic. |
| Password reset for a username account: the owner sets one | `sql/030` `admin_set_worker_password` | Kept for stand-in accounts. |
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

`lib/supabase.ts` gets one function, `loginAddress(typed)`, tested:

| Typed | Means | Address |
|---|---|---|
| `mari@kliinik.ee` (`@`, and a dot after it) | real e-mail | as typed |
| `tehnik@tal` (`@`, no dot after it) | username at a clinic | `tehnik.tal@nomail.wivodent.com` |
| `tehnik` (no `@`) | **existing** account (before this change) | `tehnik@example.com`, unchanged |

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

### 4.2 `sql/099_confirm_standin_logins.sql`: the one-time confirmation

It is small and self-contained: it uses nothing after sql/029, so like 098 it can run on production's base (091). It confirms an account **only** when all of these hold:
- the address is `<username>@example.com` (or the older `wivo.invalid` or `wivo.local`);
- the local part is exactly that account's `profiles.username`;
- the account is not confirmed yet;
- the account is not deleted.

Real addresses, `example.com` addresses that don't match a Wivo username, and already-confirmed accounts are untouched. It sets `email_confirmed_at = now()` and nothing else. (`confirmed_at` is a generated column and isn't written.) It reports how many accounts it confirmed (`raise notice`), to compare with §4.1.

It doesn't rename anyone, so every existing login keeps working.

**Tests** (PGlite, `sql/test/confirmStandins.test.ts`):
- an unconfirmed stand-in is confirmed;
- each of these is untouched: a real address, an `example.com` address that isn't a username, an already-confirmed account, a deleted account;
- running it twice changes nothing;
- it applies on 000–091 + 099.

### 4.3 `sql/100_accounts.sql`: per-clinic usernames and the safety fixes

1. **Usernames per clinic.**
   - Drop `profiles_username_key`.
   - Add a unique index on `(clinic_id, lower(username))` where `username is not null`.
   - Add `handle_new_user` (replacing 086): it checks the name only within the invite's clinic and stores `language` from the metadata.
   - This needs no new table. If one turns out to be needed, it gets org_id, RLS, a leak test and `select public.ensure_mfa_policies();` (CLAUDE.md).
2. **No mail to stand-ins.**
   - Add `public.is_standin_email(text)`: the current stand-in domain, `example.com` where it matches the username, `wivo.invalid` and `wivo.local`.
   - `pending_notification_emails` (replacing 075) skips those addresses.
   - In the app, the "E-mail me" switch is hidden for a stand-in account and replaced by "Add an e-mail address" (§4.4).
3. **When a stand-in is replaced by a real e-mail**, a trigger on `auth.users` (after update of `email`) clears `profiles.username`. The person now signs in with the e-mail, and the name no longer holds a username in the clinic.

**Tests:**
- two clinics both have `tehnik`;
- a second `tehnik` in the same clinic is refused;
- the invite trigger works with per-clinic names;
- stand-ins never appear in `pending_notification_emails`;
- the username is cleared after an e-mail change;
- the existing MFA, leak and Advisor tests still pass.

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
   - **Minimum password length:** recommended `10` (the app's check moves with it).
   - **"Allow new users to sign up":** stays on until §5.
5. **Authentication → Emails → Templates.** I'll write the exact text in the build, in et, en and ru, with no patient data. Each link uses Wivo's page, not GoTrue's redirect:
   - **Invite user** (used only for founders Kevin invites from the dashboard):
     `{{ .SiteURL }}/auth/confirm?type=invite&token_hash={{ .TokenHash }}`
   - **Reset password:** `{{ .SiteURL }}/auth/confirm?type=recovery&token_hash={{ .TokenHash }}`
   - **Change email address:** `{{ .SiteURL }}/auth/confirm?type=email_change&token_hash={{ .TokenHash }}`
6. **Test it:** dashboard → Authentication → Users → **Invite user** with your own address. The e-mail arrives from `no-reply@mail.wivodent.com`. Resend → **Emails** shows it as *Delivered*.

### 6.4 Edge Function secrets (test copy)

In the test copy's dashboard → **Edge Functions → Secrets**:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | the `wivo-test-functions` key |
| `NOTIFY_FROM` | `Wivo <no-reply@mail.wivodent.com>` |
| `APP_LINK` | `https://wivo-test.pages.dev` |
| `STANDIN_DOMAIN` | `nomail.wivodent.com` |

Setting `RESEND_API_KEY` also turns on the notification e-mails that send-notifications already has (deferred until now, GAP-ANALYSIS). That makes §4.3's "no mail to stand-ins" a **precondition**: 100 is applied before the key is set.

**The test copy is a copy of production's data.** Its `auth.users` may hold real staff addresses. Once its SMTP and Resend are live it can send real e-mails to real people: invites from the test copy go only to your own addresses. As a safety net, I'll add an `EMAIL_ALLOW_ONLY` secret that the functions honour on the test copy, for example `@wivodent.com,fullgevity@`. Set it there and never on production.

---

## 7. Build order (after the go-ahead)

All of it on `testing`. Kevin applies the SQL; I write the steps and the read-only checks.

| # | What | Database | Can go to production |
|---|---|---|---|
| 1 | §4.1 count query | read-only | Kevin runs it on production now |
| 2 | `sql/099` the one-time confirmation + tests | yes | yes, on its own, like 098 (runs on 091); test copy first |
| 3 | §6 outside setup on the test copy (Resend, DNS, SMTP, templates) | no | — |
| 4 | **Spike on the test copy, before writing the UI:** null-MX stand-in accepted by `createUser`; password sign-in works with it; `email_change_new` completes with secure change on; password update after recovery with an authenticator | no | — |
| 5 | `sql/100` (per-clinic usernames, no mail to stand-ins, username cleared on e-mail change) + tests | yes | with the next release from `testing` |
| 6 | `team-account` Edge Function + `_shared/teamAccount.ts` + tests (owner and aal2 check, stand-in derivation, invite link, no logging of addresses or tokens, `EMAIL_ALLOW_ONLY`) | no | deploy to the test copy |
| 7 | App: `loginAddress`, Team "Add member" (e-mail / without e-mail), "Send again", "Forgot password?", `/auth/confirm` (invite, recovery, email_change), Settings "Add an e-mail address"; i18n en/et/ru | no | with the release |
| 8 | Hand test on the test copy (checklist below) | — | — |
| 9 | Release (merge `testing` → `main`, bump last); then, after every machine updates, §5 sign-up off | — | yes |

**Hand-test checklist (test copy):**
- **Invite:** invite your own address. The e-mail arrives in the chosen language. Continue, password, authenticator, then sign in on desktop and phone. The person is in the clinic as a technician.
- **Invite link:** opening it twice works the first time only. A link older than 24 h is refused with a clear message.
- **Usernames:**
  - create `tehnik` in two different test clinics; both sign in as `tehnik@<code>`;
  - a second `tehnik` in the same clinic is refused;
  - an existing `tehnik` (old format) still signs in with plain `tehnik`.
- **Username accounts are never mailed:** no notification e-mail to a stand-in (Resend → Emails shows none); "E-mail me" is hidden for that account.
- **Add an e-mail:** a username account adds your address, clicks the link, then signs in with the e-mail, and "Forgot password?" works for it.
- **Recovery:**
  - "Forgot password?" for an unknown address shows the same message.
  - For a real address: link, authenticator code, new password. Other sessions are ended.
- **Caller check:**
  - a non-owner, or an owner at aal1, calling `team-account` gets 403;
  - a partner organisation's owner can only add people to their own organisation.
- **Sign-up off:**
  - after §5, `signUp` with the anon key is refused;
  - invites and username accounts still work;
  - a dashboard "Invite user" for a new founder reaches `ClinicSetupWizard`.

---

## 8. Not in this plan

- One person in several organisations.
- Renaming existing `@example.com` accounts to the new stand-in format. It can be offered later as an owner action; nobody needs it to sign in.
- A forced password change at the first sign-in of a username account.
- Restricting who may found a clinic (§5, related gap).
