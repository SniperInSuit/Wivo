-- ============================================================================
-- Wivo — migration 077: e-mail notifications every minute
-- Run AFTER sql/076. Needs pg_cron and pg_net (Database → Extensions), the
-- service-role key in Vault as `wivo_service_role_key` (sql/052 put it there),
-- and THIS project's functions URL in Vault as `wivo_functions_url`:
--
--   select vault.create_secret('https://<project-ref>.functions.supabase.co', 'wivo_functions_url');
--
-- Unlike sql/052, the URL is not written into the migration: the same file
-- runs on the test project, and a test database must never call production.
-- With the secret missing the call has no URL and does nothing.
-- ============================================================================

select cron.unschedule('wivo-send-notifications')
 where exists (select 1 from cron.job where jobname = 'wivo-send-notifications');

select cron.schedule(
  'wivo-send-notifications',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wivo_functions_url') || '/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'wivo_service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'wivo_functions_url');
  $$
);
