#!/usr/bin/env bash
# docs/MIN-VERSION.md §7, step 1 — run by Kevin, on the TEST COPY only.
#
#   A. CORS: may a browser send x-wivo-version / x-wivo-client to the database
#      (PostgREST), Storage, Auth and our Edge Functions? Asked the way a
#      browser asks (a preflight), from the phone site and from the desktop
#      app's origin. No key needed. The Edge Functions pass only once the
#      versions with the new headers are deployed (docs/MIN-VERSION.md §6).
#   B. After sql/104: does the database see the header, and does a refusal
#      come back as HTTP 426 with "Update Wivo"? This uses the service-role
#      probe app_version_probe(), which changes nothing.
#
# The key is read without echo, never printed, never put on a command line
# (curl reads the headers from a file only this user can read) and gone when
# the script ends. Prints only PASS / FAIL lines.
#
#   bash scripts/check-version-header.sh            # A and B
#   bash scripts/check-version-header.sh --cors     # A only (before sql/104)
set -euo pipefail

TEST_REF='jhqyvancrzykxhzwnost'
PRODUCTION_REF='wrtucsfmpbwekugzzzxw'   # as in src/renderer/src/lib/testCopy.ts
CORS_ONLY=false
REF="$TEST_REF"
for arg in "$@"; do
  case "$arg" in
    --cors) CORS_ONLY=true ;;
    *) REF="$arg" ;;
  esac
done
if [ "$REF" = "$PRODUCTION_REF" ]; then echo "Refused: that is production."; exit 2; fi
URL="https://$REF.supabase.co"

work="$(mktemp -d)"; chmod 700 "$work"
trap 'rm -rf "$work"' EXIT
pass=0; fail=0
ok()  { echo "PASS  $*"; pass=$((pass + 1)); }
bad() { echo "FAIL  $*"; fail=$((fail + 1)); }

WANT='authorization,apikey,content-type,x-client-info,x-wivo-version,x-wivo-client'

# A preflight; PASS if the answer allows both of our headers (or any header).
preflight() {
  local label="$1" path="$2" origin="$3" method="${4:-POST}"
  local code allowed
  code=$(curl -sS -o /dev/null -D "$work/h" -w '%{http_code}' -X OPTIONS "$URL$path" \
    -H "Origin: $origin" -H "Access-Control-Request-Method: $method" -H "Access-Control-Request-Headers: $WANT" || echo 000)
  allowed=$(tr -d '\r' < "$work/h" | sed -n 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Hh]eaders: *//p' | tr 'A-Z' 'a-z' | head -1)
  if [ "${code:0:1}" = 2 ] && { [ "$allowed" = '*' ] || { [[ "$allowed" == *x-wivo-version* ]] && [[ "$allowed" == *x-wivo-client* ]]; }; }; then
    ok "$label from $origin"
  else
    bad "$label from $origin (HTTP $code, allowed: ${allowed:-none})"
  fi
}

echo "Project: $REF (test copy)"
echo
echo "A. May a browser send the version headers?"
for origin in 'https://wivo-test.pages.dev' 'null'; do   # 'null': the desktop app (a file:// page)
  preflight 'database (PostgREST)'   '/rest/v1/jobs'                     "$origin" PATCH
  preflight 'database function'      '/rest/v1/rpc/app_min_version_for_me' "$origin"
  preflight 'storage'                '/storage/v1/object/job-files/x'    "$origin"
  preflight 'sign-in (Auth)'         '/auth/v1/token?grant_type=password' "$origin"
  preflight 'Edge Function file-link'        '/functions/v1/file-link'        "$origin"
  preflight 'Edge Function team-account'     '/functions/v1/team-account'     "$origin"
  preflight 'Edge Function account-security' '/functions/v1/account-security' "$origin"
done
echo

if [ "$CORS_ONLY" = true ]; then
  echo "Result: $pass passed, $fail failed."
  [ "$fail" = 0 ]; exit
fi

echo "B. Does the database see the header, and does a refusal arrive as 426? (needs sql/104)"
read -rsp "Test copy's secret key (sb_secret_… or the service_role key), not shown: " KEY; echo
case "$KEY" in
  sb_secret_*) printf 'apikey: %s\n' "$KEY" > "$work/headers" ;;
  eyJ*)        printf 'apikey: %s\nAuthorization: Bearer %s\n' "$KEY" "$KEY" > "$work/headers" ;;
  *)           unset KEY; echo "That does not look like a secret key."; exit 2 ;;
esac
unset KEY
chmod 600 "$work/headers"
printf 'Content-Type: application/json\nx-wivo-version: 9.9.9-check\nx-wivo-client: check-script\n' >> "$work/headers"

code=$(curl -sS -o "$work/echo" -w '%{http_code}' -H @"$work/headers" -X POST "$URL/rest/v1/rpc/app_version_probe" --data '{}' || echo 000)
if [ "$code" = 200 ] && grep -q '9.9.9-check' "$work/echo"; then ok "the database sees x-wivo-version"
elif [ "$code" = 404 ]; then bad "app_version_probe not found: is sql/104 applied, and 'notify pgrst, reload schema' run?"
else bad "the header did not arrive (HTTP $code: $(head -c 200 "$work/echo"))"; fi

code=$(curl -sS -o "$work/refuse" -w '%{http_code}' -H @"$work/headers" -X POST "$URL/rest/v1/rpc/app_version_probe" --data '{"p_refuse":true}' || echo 000)
if [ "$code" = 426 ] && grep -q 'Update Wivo' "$work/refuse" && grep -q 'update_required' "$work/refuse"; then
  ok "a refused save comes back as HTTP 426 with \"Update Wivo\""
else
  bad "the refusal came back as HTTP $code: $(head -c 200 "$work/refuse")"
fi
echo

echo "Result: $pass passed, $fail failed."
[ "$fail" = 0 ]
