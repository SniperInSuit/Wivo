-- ============================================================================
-- Wivo — read-only: one address's sign-in account, and what Wivo has for it
-- ============================================================================
--
-- For "This address already has a Wivo account" when inviting someone again.
-- Put the address in the `with address` line (instead of name@example.com),
-- paste into the SQL Editor and Run. One SELECT: it reads and changes
-- nothing. Times are the database's (UTC).
--
-- It tells apart:
--   - the sign-in account of the FIRST invite, still there: created before
--     the deletion, so the delete did not remove it;
--   - a NEW one, made by the invite again: created then, "made by an invite"
--     of your clinic, and in it or not ("profile of …");
--   - an account removed from the team ("removed from the team"): the address
--     stays taken until it is restored and deleted, by design.
-- And, about this database: whether "Delete account permanently" is sql/110's
-- and may delete sign-in accounts, and what is checked before every call
-- (sql/098, 104: a role setting, which a restore can lose).
-- ============================================================================

with address(a) as (values (lower(btrim('name@example.com')))),
acct as (
  select u.* from auth.users u join address on lower(u.email) = address.a
),
found(o, what, finding) as (
  select 1, 'sign-in account ' || u.id,
         format('created %s; %s; %s; last sign-in %s%s',
           to_char(u.created_at, 'YYYY-MM-DD HH24:MI:SS'),
           coalesce('invited ' || to_char(u.invited_at, 'YYYY-MM-DD HH24:MI:SS'), 'not invited'),
           coalesce('accepted ' || to_char(u.email_confirmed_at, 'YYYY-MM-DD HH24:MI:SS'), 'never accepted'),
           coalesce(to_char(u.last_sign_in_at, 'YYYY-MM-DD HH24:MI:SS'), 'never'),
           coalesce('; marked deleted ' || to_char(u.deleted_at, 'YYYY-MM-DD HH24:MI:SS'), ''))
    from acct u
  union all
  select 2, 'profile of ' || u.id,
         coalesce((select case when p.clinic_id is null then p.role || ', removed from the team (no clinic)'
                               else format('%s in "%s"', coalesce(p.org_role, p.role), c.name) end
                     from public.profiles p left join public.clinics c on c.id = p.clinic_id
                    where p.id = u.id),
                  'NONE: a sign-in account without a profile')
    from acct u
  union all
  select 3, 'made by an invite', format('of "%s", used %s', coalesce(c.name, '?'), to_char(i.used_at, 'YYYY-MM-DD HH24:MI:SS'))
    from public.worker_invite i
    join acct u on u.id = i.used_by
    left join public.clinics c on c.id = i.clinic_id
  union all
  select 4, 'sign-in account', 'none has this address: an invite to it makes a new one'
   where not exists (select 1 from acct)
  union all
  select 5, 'Delete account permanently (admin_delete_worker)',
         format('%s; its owner %s %s delete sign-in accounts',
           case when p.prosrc like '%account_deleted%' then 'sql/110''s: both or nothing, second factor, audit entry'
                else 'sql/031''s (sql/110 not applied)' end,
           pg_get_userbyid(p.proowner),
           case when has_table_privilege(p.proowner, 'auth.users', 'DELETE') then 'may' else 'may NOT' end)
    from pg_proc p
   where p.oid = 'public.admin_delete_worker(uuid)'::regprocedure
  union all
  select 6, 'checked before every call (db_pre_request)',
         case coalesce((select substring(s from '^pgrst\.db_pre_request=(.*)$')
                          from pg_roles r, unnest(r.rolconfig) s
                         where r.rolname = 'authenticator' and s like 'pgrst.db\_pre\_request=%'), '')
           when 'public.pre_request' then 'the second factor and the app version (sql/104)'
           when 'public.require_mfa_for_api' then 'the second factor only (sql/098; sql/104''s version check is not set)'
           else 'NOTHING on this database: a function that does not check the second factor itself runs without it'
         end
)
select what, finding from found order by o, what;
