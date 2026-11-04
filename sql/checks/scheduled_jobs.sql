-- ============================================================================
-- Wivo — read-only: which project the scheduled jobs call, with whose key
-- ============================================================================
--
-- Two scheduled jobs call an Edge Function over the network, each with the
-- service key kept in the Vault (wivo_service_role_key):
--   wivo-send-invoices       every hour at :07. sql/052 writes PRODUCTION's
--                            address into it.
--   wivo-send-notifications  every minute, to the address in the Vault
--                            (wivo_functions_url, sql/077).
-- A function accepts only its own project's service key.
--
-- A test copy restored from production has production's jobs, and may have
-- production's Vault. On the TEST COPY, a job that calls PRODUCTION with a
-- key of PRODUCTION starts production's invoice and e-mail runs, at the same
-- minute as production's own, and two invoice runs at once can send the same
-- invoice twice. With the test copy's key, production only answers 401.
--
-- Paste into the SQL Editor and Run. One SELECT: it reads and changes nothing,
-- and shows no key, only which project a key was made for (its "ref").
-- If it stops with a decryption error, the Vault came from another project
-- and cannot be read here, so the jobs send no key that works.
-- ============================================================================

with project(ref, name) as (values
  ('wrtucsfmpbwekugzzzxw', 'PRODUCTION'),
  ('jhqyvancrzykxhzwnost', 'the test copy')
),
vault as (
  select name, decrypted_secret as s from vault.decrypted_secrets
   where name in ('wivo_service_role_key', 'wivo_functions_url')
),
key as (  -- what the key's JWT payload says; never the key itself
  select v.s, d.ref, d.role
    from (select (select s from vault where name = 'wivo_service_role_key') as s) v
    left join lateral (
      select substring(t from '"ref" *: *"([a-z0-9]+)"') as ref,
             substring(t from '"role" *: *"([a-z_]+)"') as role
        from (select encode(decode(translate(x.p, '-_', '+/') || repeat('=', (4 - length(x.p) % 4) % 4), 'base64'), 'escape') as t
                from (select split_part(v.s, '.', 2) as p) x
               where v.s like 'eyJ%' and x.p ~ '^[A-Za-z0-9_-]+$' and length(x.p) % 4 <> 1) y
    ) d on true
),
key_is as (
  select case
    when s is null then 'no key in the Vault'
    when s like 'sb\_secret\_%' then 'an sb_secret key (its project cannot be read from it)'
    when ref is null then 'a key whose project cannot be read from it'
    else format('a %s key of %s', coalesce(role, 'role-less'),
                coalesce((select p.name from project p where p.ref = key.ref), 'project ' || ref))
  end as said
  from key
),
url as (
  select s, coalesce((select p.name from project p where s like '%' || p.ref || '%'), 'another address') as goes_to
    from vault where name = 'wivo_functions_url'
),
found(o, what, finding) as (
  select 1, 'job ' || j.jobname,
         format('%s%s: calls %s%s', j.schedule, case when j.active then '' else ' (paused)' end,
           case when j.command ~ 'https://[a-z0-9]+\.(functions\.)?supabase\.co'
                  then coalesce((select p.name from project p where j.command like '%' || p.ref || '%'), 'another project')
                when j.command like '%wivo_functions_url%'
                  then coalesce((select 'the Vault''s address (' || goes_to || ')' from url), 'the Vault''s address, which is not set')
                else 'nothing outside this database' end,
           case when j.command like '%wivo_service_role_key%' then ', with ' || (select said from key_is) else '' end)
    from cron.job j
  union all
  select 2, 'Vault wivo_functions_url', s || ' (' || goes_to || ')' from url
  union all
  select 3, 'Vault wivo_service_role_key', said from key_is
  union all
  select 4, 'last run of ' || j.jobname, coalesce(d.status, '?') || ' at ' || d.start_time
    from (select distinct on (jobid) jobid, status, start_time
            from cron.job_run_details order by jobid, start_time desc) d
    join cron.job j on j.jobid = d.jobid
  union all
  select 5, 'answers to this database''s calls',
         format('%s, between %s and %s', string_agg(coalesce(code::text, 'none') || ' x' || n, ', ' order by code), min(first), max(last))
    from (select status_code as code, count(*) as n, min(created) as first, max(created) as last
            from net._http_response group by status_code) r
  having count(*) > 0
)
select what, finding from found order by o, what;
