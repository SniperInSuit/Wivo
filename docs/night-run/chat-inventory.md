# Chat feature inventory (Phase 0)

Spec: "Inventory the existing chat code (tables, UI, realtime) and describe what
works and what is unfinished. Finish it or remove it. Phase 1 comments and
questions are built on top of it."

## What exists

| Layer | Where | State |
|---|---|---|
| Tables | `sql/065_chat.sql`: `channels` (kind `grupp` / `too` / `otse`, optional `job_id`, unique per job), `channel_members` (role `liige` / `vaatleja`, `last_read_at`), `messages` (soft delete via `deleted_at`, body non-empty unless deleted), `message_jobs` (job mentions as rows) | Complete |
| RLS | Same file. Membership-based: you see a channel and its messages only if you are in `channel_members` (`in_channel()`). | Complete, six gaps closed by `sql/069` (below) |
| Retention | `clinic_settings.vestlus.sailitusKuud` (default 24 months, cap 120 in the logic), `chat_prune()` | Complete |
| Retention job | `sql/067`: pg_cron, nightly 03:17 | Complete; needs pg_cron on the project (MORNING.md) |
| Realtime | `sql/066`: `messages` in `supabase_realtime` | Complete. Membership and channel changes are not published; a new channel appears on the next fetch. Fine for job threads. |
| Pure logic | `shared/chat/message.ts` (+ 35 tests): `[[job:<uuid>]]` tokens, parse into segments, mention insertion, preview text, unread count from `last_read_at`, retention cutoff | Complete |
| Hooks / data layer | none | Not started |
| User interface | none | Not started |

Nothing in the app imports the chat yet. The two `grep` hits for "channels" in
`src/` are unrelated (calendar colour channels).

## What was wrong, and is now fixed (`sql/069_chat_hardening.sql`)

Found by running the rules as two tenants (`sql/test/chat.test.ts`, 12 tests):

1. A member could add a user of another clinic to their channel.
2. A channel could be opened for another clinic's job. Because `job_id` is
   unique, that also blocked the real clinic from ever having a thread on it.
3. A message could be tagged with another clinic's job.
4. A member could promote their own membership from observer to member.
5. An observer could post; the role had no effect.
6. A channel's creator could not read it back before joining it, so
   `insert … returning` (what supabase-js does by default) failed.

Already correct, now covered by tests: a member cannot repoint their membership
at another channel, an author cannot move a message into another channel, and a
colleague cannot join someone else's direct messages.

## Decision: finish, don't remove

The backend is complete and now tested; only the data layer and screens are
missing. Phase 1's "comments and questions on a job" is exactly a channel of
kind `too` with `job_id` set, so the job thread is built there (Phase 1,
"Communication"), not as a separate chat screen tonight. A general group/direct
chat screen is not in the spec's scope and is not built.

What Phase 1 adds on top: `is_question`, `resolved_at` and `file_id` on
messages (the spec's `job_comment` columns), and partner access to a shared
job's thread through an RPC, because partners never become channel members
(spec: partners reach shared jobs only through `partner_job_view` and RPCs).
