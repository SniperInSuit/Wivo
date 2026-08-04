# `shared/` — the code that must exist exactly once

What the desktop app and the (future) web portal both need to agree on. Right
now that is one thing, and it is the expensive one: **what a job costs**.

## Why this directory exists

The quote rules used to live in the renderer, in two copies — the job form's
live auto-price and `lib/repriceJobs.ts`. `HANDOFF.md` said out loud that the
two must change together. They did not: by v1.26 they disagreed about what a job
with no material price and `hambaHind = 0` is worth (the form stamped **0 €**,
the repricer refused to guess). A third copy on the order form would have made
that a three-way disagreement about money quoted to a customer.

So the rules live here, once, and everything imports them.

## The rules for anything in here

**No dependencies. At all.**

- no React
- no `@supabase/supabase-js`
- no `import.meta.env`
- no Node built-ins (`fs`, `path`, `crypto`, …)
- no npm packages

Pure functions over plain data. That is what lets the same file be bundled into
an Electron renderer, a browser SPA, and a Deno edge function without a build
step or a published package.

## How it is wired

A **path alias**, resolved at bundle time — `@shared/*` → `shared/*`, declared in
`electron.vite.config.ts` and `tsconfig.web.json` (and later in `web/`).

Deliberately **not** an npm workspace package. `electron.vite.config.ts` runs
`externalizeDepsPlugin()` for `main` and `preload`, which marks anything in
`dependencies` as external rather than bundling it — and electron-builder ships
`out/**/*` with no `node_modules`, so a packaged build would die at require time.
A source alias cannot fail that way.

**Nothing in here may be imported by `src/main` or `src/preload`** — that is the
same trap from the other side.

## Contents

| File | What |
|---|---|
| `pricing/workTypes.ts` | The work-type catalogue and the free-text matcher that resolves `"D14 abutmendile kroon"` to a configured type |
| `pricing/teeth.ts` | FDI tooth counting — small (positions 1–5) vs large (6–8) |
| `pricing/priceBook.ts` | The price inputs, as one plain object, plus the per-type and per-material lookups |
