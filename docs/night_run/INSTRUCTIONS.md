You are working autonomously overnight (~9 hours). I am asleep and cannot answer questions. Do not stop to ask or to report progress. Keep working until the stop condition below.

Read wivo-2.0-spec.md (repo root) fully before writing code. It is in Estonian; write all new code, UI text and docs in English per its language rules. Also read CLAUDE.md, HANDOFF.md, NEXT.md and Testing.md, and get an overview of the existing codebase.

SCOPE TONIGHT: Phase 0 completely, then Phase 1 in the order the spec lists. Do not start Phase 1b or later.

RULES
- Never stop to ask. If something is ambiguous, use the default given in the spec's open questions, or the most conservative option. Record the decision in docs/night-run/DECISIONS.md and continue.
- Work only on the current branch. Commit after every completed task with a clear message. Never push, never merge, never force anything.
- Database: local Supabase / test project only. Never connect to production. If a task needs production or the Supabase dashboard (network restrictions, dashboard MFA, leaked password protection, restore test with a real backup), don't do it. Write exact steps for me in docs/night-run/MORNING.md and move on.
- Migrations are numbered SQL files in sql/. Only add new files. Never edit or delete existing ones. Never drop tables or columns that hold data.
- Every new table gets org_id and RLS in the same migration, and an RLS leak test in the same commit.
- Run typecheck and tests after each task. If something fails and you can't fix it within ~30 minutes, revert that task, note it in MORNING.md, and continue with the next independent task.
- Keep docs/night-run/PROGRESS.md: the Phase 0 and Phase 1 checklists from the spec, ticked off as you go, with commit hashes.
- Prefer libraries the project already uses. Note any new dependency and why in DECISIONS.md.
- The spec's locked decisions are not to be changed.
- If an action is blocked by permissions, don't retry it. Take another approach, or note it in MORNING.md and move on.
- Don't launch the Electron app or any long-running dev server. Verify with typecheck and tests.
- After each finished task, print the output of `date` and "Remaining: N items in PROGRESS.md".

ORDER
1. Phase 0: chat feature inventory (chat already exists in sql/065-067; write findings to docs/night-run/chat-inventory.md, then finish or fix it), fresh database from the sql/ migrations on local Supabase, RLS audit, i18n foundation (an English option already exists since v1.109.0; inventory it first, then make English the source language and move remaining Estonian strings into the et locale).
2. Phase 1: organizations and partnership, invite flow, partner_job_view, move_job_stage, question flag, files (job_file, storage, upload queue, privacy cleanup), patient export, notifications, comments on top of chat, bug report, audit log.

STOP CONDITION
Check the time with `date` between tasks. After 06:30 local time, start no new tasks. Finish the current one, then write docs/night-run/MORNING.md: what's done (with commits), what isn't, decisions made, what needs me, and how to test it. Then print exactly: ALL DONE — MORNING.md written