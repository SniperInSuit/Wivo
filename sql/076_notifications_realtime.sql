-- ============================================================================
-- Wivo — migration 076: notifications over realtime
-- Run AFTER sql/075. Its own file for the same reason as sql/004, 008, 066:
-- ALTER PUBLICATION waits for a lock behind other statements, and a timeout
-- here must not roll back the table it publishes.
-- ============================================================================
-- Realtime applies the table's RLS: each user receives only their own rows.

set lock_timeout = '10s';
do $$
begin
  alter publication supabase_realtime add table public.notification;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
