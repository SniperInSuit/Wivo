#!/usr/bin/env bash
# docs/ACCOUNTS.md §7, step 4, checks 1 and 2 — run by Kevin, on the TEST COPY only.
#
#   1. GoTrue's admin API accepts a stand-in on nomail.wivodent.com (null MX),
#      confirmed at birth (email_confirm: true).
#   2. That account signs in with its password.
#
# Run it BEFORE applying sql/100: from 100 on, the database refuses a stand-in
# that does not carry its clinic's invite, and this throwaway account has none.
#
# It creates ONE throwaway account (wivo-check-<random>.tst@nomail.wivodent.com,
# random password, no clinic) and deletes it again at the end, whatever happens.
# The key is read without echo, never printed, never put on a command line (curl
# reads the headers from a file only this user can read) and gone when the
# script ends. Prints only PASS / FAIL lines and GoTrue's error codes.
#
#   bash scripts/check-standin-auth.sh
set -euo pipefail

TEST_REF='jhqyvancrzykxhzwnost'
PRODUCTION_REF='wrtucsfmpbwekugzzzxw'   # as in src/renderer/src/lib/testCopy.ts
STANDIN_DOMAIN='nomail.wivodent.com'

REF="${1:-$TEST_REF}"
if [ "$REF" = "$PRODUCTION_REF" ]; then echo "Refused: that is production."; exit 2; fi
URL="https://$REF.supabase.co"

work="$(mktemp -d)"; chmod 700 "$work"
user_id=''
pass=0; fail=0
ok()  { echo "PASS  $*"; pass=$((pass + 1)); }
bad() { echo "FAIL  $*"; fail=$((fail + 1)); }
field() { sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p" "$2" | head -1; }

cleanup() {
  if [ -n "$user_id" ]; then
    code=$(curl -sS -o "$work/del.json" -w '%{http_code}' -H @"$work/headers" -X DELETE "$URL/auth/v1/admin/users/$user_id" || true)
    if [ "$code" = 200 ]; then echo "      throwaway account deleted"
    else echo "WARN  could not delete the throwaway account (HTTP $code): delete $user_id in Authentication → Users"; fi
  fi
  rm -rf "$work"
}
trap cleanup EXIT

echo "Project: $REF (test copy)"
echo
echo "0. DNS"
mx="$(dig +short MX "$STANDIN_DOMAIN" 2>/dev/null || true)"
a="$(dig +short A "$STANDIN_DOMAIN" 2>/dev/null || true)"
if [ "$mx" = "0 ." ]; then ok "$STANDIN_DOMAIN has a null MX (0 .)"; else bad "$STANDIN_DOMAIN MX is '${mx:-none}', expected '0 .' — set up docs/ACCOUNTS.md §6.2 first"; fi
if [ -z "$a" ]; then ok "$STANDIN_DOMAIN has no A record"; else bad "$STANDIN_DOMAIN has an A record; it should have none"; fi
echo

read -rsp "Test copy's secret key (sb_secret_… or the service_role key), not shown: " KEY; echo
case "$KEY" in
  sb_secret_*) printf 'apikey: %s\n' "$KEY" > "$work/headers" ;;
  eyJ*)        printf 'apikey: %s\nAuthorization: Bearer %s\n' "$KEY" "$KEY" > "$work/headers" ;;
  *)           unset KEY; echo "That does not look like a secret key."; exit 2 ;;
esac
unset KEY
chmod 600 "$work/headers"
printf 'Content-Type: application/json\n' >> "$work/headers"

rand="$(openssl rand -hex 5)"
email="wivo-check-$rand.tst@$STANDIN_DOMAIN"
password="$(openssl rand -hex 16)"

echo "1. Create a confirmed stand-in with the admin API"
printf '{"email":"%s","password":"%s","email_confirm":true,"user_metadata":{"full_name":"Wivo check (delete me)"}}' \
  "$email" "$password" > "$work/create-body.json"
code=$(curl -sS -o "$work/create.json" -w '%{http_code}' -H @"$work/headers" \
  -X POST "$URL/auth/v1/admin/users" --data @"$work/create-body.json")
user_id="$(field id "$work/create.json")"
confirmed="$(field email_confirmed_at "$work/create.json")"
if [ "$code" = 200 ] && [ -n "$user_id" ]; then
  ok "created (HTTP 200)"
  if [ -n "$confirmed" ]; then ok "confirmed at birth"; else bad "created but NOT confirmed"; fi
else
  bad "refused (HTTP $code): $(field error_code "$work/create.json") $(field msg "$work/create.json")"
  echo; echo "Result: $pass passed, $fail failed."
  echo "A 'Database error' means sql/100 is already applied (see the top of this script)."
  echo "Anything about the address means GoTrue refuses the null MX: docs/ACCOUNTS.md §3.2, fallback."
  exit 1
fi
echo

echo "2. Sign in with the password"
printf '{"email":"%s","password":"%s"}' "$email" "$password" > "$work/signin-body.json"
code=$(curl -sS -o "$work/signin.json" -w '%{http_code}' -H @"$work/headers" \
  -X POST "$URL/auth/v1/token?grant_type=password" --data @"$work/signin-body.json")
if [ "$code" = 200 ] && grep -q '"access_token"' "$work/signin.json"; then ok "signed in (HTTP 200)"
else bad "sign-in refused (HTTP $code): $(field error_code "$work/signin.json") $(field msg "$work/signin.json")"; fi

printf '{"email":"%s","password":"%s"}' "$email" "wrong-$password" > "$work/wrong-body.json"
code=$(curl -sS -o "$work/wrong.json" -w '%{http_code}' -H @"$work/headers" \
  -X POST "$URL/auth/v1/token?grant_type=password" --data @"$work/wrong-body.json")
if [ "$code" = 400 ]; then ok "a wrong password is refused (HTTP 400)"; else bad "a wrong password gave HTTP $code"; fi
echo

echo "Result: $pass passed, $fail failed."
[ "$fail" = 0 ]
