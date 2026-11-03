-- ============================================================================
-- Wivo — migration 103: what a push says
-- Run AFTER sql/102. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- Deploy send-notifications after this (it reads the new columns; without
-- them it still sends, with the generic words in English).
-- ============================================================================
--
-- Every push read "Wivo, from Wivo, New in Wivo". Now its title says what
-- happened ("Work assigned", "3 new notifications") and a short hint follows,
-- in the person's language — never a job code, patient or name, because the
-- text crosses Apple's or Google's servers and shows on the lock screen. The
-- words are chosen by the sender (supabase/functions/_shared/pushText.ts) and
-- encrypted for each phone (vapid.ts, RFC 8291).
--
-- For that the sender needs, per pending push: the notification's kind, the
-- person's language (as for the e-mails, sql/075) and how many notifications
-- are unread for them (the bell's count). Nothing else is added; the function
-- stays for the service role only.
--
-- The return type changes, so the function is dropped and made again.
-- Tests: sql/test/phonePush.test.ts.
-- ============================================================================

drop function if exists public.pending_pushes(int);

/** As sql/095, plus kind, language and the person's unread count. */
create function public.pending_pushes(p_limit int default 500)
returns table (notification_id uuid, subscription_id uuid, endpoint text, p256dh text, auth text,
               kind text, language text, unread int)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, s.id, s.endpoint, s.p256dh, s.auth,
         n.kind,
         coalesce(p.language, c.default_language, 'en'),
         (select count(*)::int from public.notification u where u.user_id = n.user_id and u.read_at is null)
    from public.notification n
    join public.push_subscription s on s.user_id = n.user_id
    join public.profiles p on p.id = n.user_id and p.notify_push
    left join public.clinics c on c.id = n.org_id
   where n.pushed_at is null and n.read_at is null and n.created_at > now() - interval '1 hour'
   order by n.created_at, n.id
   limit p_limit
$$;
revoke execute on function public.pending_pushes(int) from public, anon, authenticated;

select public.lock_anon_functions();
