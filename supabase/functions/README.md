# Edge functions — the public surface

The only thing a patient's browser talks to. Everything here holds secrets and
therefore never ships to Framer.

## Deploy

Requires the Supabase CLI. Use it for `functions deploy` and `secrets set`
**only** — never `db push`, which would try to take ownership of the hand-run
files in `sql/`.

```bash
supabase link --project-ref <ref>          # once

supabase secrets set \
  PUBLIC_BOOKING_ORIGINS="https://your-site.framer.website,https://www.kliinik.ee" \
  IP_HASH_PEPPER="$(openssl rand -hex 32)"

# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the runtime.

supabase functions deploy public-booking --no-verify-jwt
```

`--no-verify-jwt` is deliberate: the callers are anonymous visitors. The guard is
the origin allowlist plus rate limiting, not a JWT.

## Check it

```bash
curl -s -H "Origin: https://your-site.framer.website" \
  "https://<ref>.functions.supabase.co/public-booking/services?clinic=<slug>" | jq
```

Expected: `{ "ok": true, "data": { "clinic": …, "services": [ … ] } }`.

**Then read the JSON and confirm it contains none of these:** `kulud`,
`material_costs`, `material_prices`, `pricing`, `payroll`, `soodushind`,
`sisemine`. The leak test in `shared/portal/publicQuote.test.ts` asserts the
same thing, but see it once with your own data.

## The `shared/` import — read before touching it

`import_map.json` maps `@shared/` to `../../shared/`.

**Deno needs a file extension on relative imports; the renderer's bundler does
not care.** So `shared/portal/publicQuote.ts` imports `./publicService.ts` WITH
the extension. Do not "tidy" that away — it is the only reason Deno can load it.

The rest of `shared/` stays extensionless because nothing outside the bundler
imports it. Only add extensions to a file when the edge function starts
importing it.

One asymmetry worth knowing, found the hard way: TypeScript accepts a `.ts`
extension on a **type-only** import under `moduleResolution: "bundler"`, but a
**value** import needs `allowImportingTsExtensions`. `publicQuote.ts` gets away
with it because its only relative import is a type. A future value import from
`shared/portal/` into another `shared/portal/` file will need that compiler flag
turned on — or the import inlined.

**Still unverified:** whether `supabase functions deploy` actually bundles an
import that climbs out of the function directory. If it fails, the fallback is a
generated copy under `_shared/generated/` with a "GENERATED — DO NOT EDIT" header
and a check that it matches source. Find out on the first deploy, not three
phases later.
