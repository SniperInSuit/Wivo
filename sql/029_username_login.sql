-- ============================================================================
-- Wivo — migration 029: log in with a username, not an email
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   Supabase Auth needs an email to hang a password on. A dental lab does not:
--   the technician on the bench has no company mailbox, and inventing
--   "tehnik2@gmail.com" for them is both a lie and a support problem later.
--
-- HOW
--   The app derives a synthetic address from the username and never shows it.
--   The domain defaults to `example.com`: RFC 2606 reserves it so it can never
--   be registered, IANA discards mail sent to it, and — unlike `.invalid` or
--   `.local`, which were tried first — Supabase's email validator accepts it.
--   Override with VITE_USERNAME_DOMAIN if you own a domain.
--
--   A real email is still allowed and still works. Anyone who types something
--   containing "@" is treated as an email address; anything else is a username.
--
-- CONSEQUENCE WORTH KNOWING
--   Usernames are therefore globally unique across every clinic in this
--   Supabase project, because the synthetic address is. For a single lab that is
--   invisible. If this ever hosts many clinics, the username will need the
--   clinic folded into it.
--
--   A user with no real email CANNOT reset their own password — there is nowhere
--   to send it. The owner resets it for them. That is the trade for not
--   requiring mailboxes, and it matches how an in-house account actually works.
-- ============================================================================

set lock_timeout = '10s';

alter table public.profiles
  add column if not exists username text;

-- Case-insensitive uniqueness: "Tehnik" and "tehnik" must not be two people.
create unique index if not exists profiles_username_key
  on public.profiles (lower(username))
  where username is not null;

comment on column public.profiles.username is
  'Sisselogimisnimi. Kaardub sünteetiliseks aadressiks <username>@wivo.invalid; päris e-post ei ole kohustuslik.';

-- Backfill: anyone already created with a synthetic address gets the local part
-- as their username, so existing in-house accounts keep working unchanged.
update public.profiles p
   set username = split_part(u.email, '@', 1)
  from auth.users u
 where u.id = p.id
   and p.username is null
   and (u.email like '%@wivo.invalid'
        or u.email like '%@wivo.local'
        or u.email like '%@example.com');
