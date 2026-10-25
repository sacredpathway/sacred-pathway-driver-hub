#!/usr/bin/env bash
# =============================================================================
#  Owner-run: rotate (or disable / re-enable) an App Review / demo account on
#  the production Supabase project through the Auth Admin API.
#
#  Secret handling (verified by scripts/test_rotate_review_credentials.sh):
#    * the service-role key and the new password are typed at hidden prompts
#      (`IFS= read -r -s`): never arguments, never environment variables, never
#      echoed, never in shell history, never in any process's argv;
#    * they reach curl only through mode-600 files in a private temp dir that is
#      removed on exit, Ctrl-C, hang-up or error;
#    * output is the HTTP status and non-secret fields (id, email, updated_at,
#      banned_until, error code/message) only.
#
#  Safety: before anything is written the script reads the account by id and
#  refuses unless its email equals the email you pass, then asks you to type
#  the email again.
#
#  Usage (bash 3.2+, macOS or Linux; needs curl and python3):
#    scripts/rotate_review_credentials.sh rotate  <user-id> <expected-email>
#    scripts/rotate_review_credentials.sh disable <user-id> <expected-email>   # ban, reversible
#    scripts/rotate_review_credentials.sh enable  <user-id> <expected-email>   # lift the ban
#    DRY_RUN=1 …   -> does the read-only lookup, builds the request, sends nothing.
#
#  Account ids (production, read-only lookup 2026-10-25):
#    5150a545-5962-463d-b688-3370c6b55c8e  demarquishinton+appreview@gmail.com (password public on GitHub)
#    0357bef0-e75a-4142-a56b-d0749c3c6a2e  dispatcher.demo@sacredpathwaydispatch.com
#    bb000000-0000-4000-8000-000000000002  driver.demo@sacredpathwaydispatch.com
# =============================================================================
set -euo pipefail
umask 077

PROD_URL="https://rmzqxsfhjqrshhdjzhze.supabase.co"
PROJECT_URL="$PROD_URL"
# Test hook: only a local mock server may replace the production URL.
if [ -n "${ROTATE_TEST_URL:-}" ]; then
  case "$ROTATE_TEST_URL" in http://127.0.0.1:*) PROJECT_URL="$ROTATE_TEST_URL" ;; *) echo "ROTATE_TEST_URL must be http://127.0.0.1:<port>" >&2; exit 2 ;; esac
fi

ACTION="${1:-}"; USER_ID="${2:-}"; EXPECTED_EMAIL="${3:-}"
usage() { echo "usage: $0 rotate|disable|enable <user-id> <expected-email>" >&2; exit 2; }
case "$ACTION" in rotate|disable|enable) ;; *) usage ;; esac
[[ "$USER_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "user id must be a lower-case UUID" >&2; exit 2; }
[[ "$EXPECTED_EMAIL" == *@* ]] || usage

# Dependencies first, before any prompt (macOS: python3 needs the Command Line Tools).
command -v curl >/dev/null 2>&1 || { echo "curl not found" >&2; exit 2; }
python3 -c 'pass' >/dev/null 2>&1 || { echo "python3 not available (macOS: xcode-select --install)" >&2; exit 2; }

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
trap 'cleanup; trap - EXIT; exit 130' INT TERM HUP

# ---- service-role key --------------------------------------------------------
IFS= read -r -s -p "Production service-role key (Dashboard → Project Settings → API Keys): " KEY; echo
[ -n "$KEY" ] || { echo "no key entered" >&2; exit 1; }
# Classify the key without printing it: legacy JWT must carry role=service_role;
# new keys must be sb_secret_….
KIND="$(printf '%s' "$KEY" | python3 -c '
import sys, json, base64
k = sys.stdin.read()
if k.startswith("sb_secret_"):
    print("secret"); sys.exit()
if k.startswith("sb_publishable_"):
    print("publishable"); sys.exit()
try:
    p = k.split(".")[1]; p += "=" * (-len(p) % 4)
    print(json.loads(base64.urlsafe_b64decode(p)).get("role", "unknown"))
except Exception:
    print("unknown")
')"
case "$KIND" in
  secret)       printf 'apikey: %s\nContent-Type: application/json\n' "$KEY" > "$TMP/headers" ;;
  service_role) printf 'apikey: %s\nAuthorization: Bearer %s\nContent-Type: application/json\n' "$KEY" "$KEY" > "$TMP/headers" ;;
  *) unset KEY; echo "that is not a service-role / secret key (detected: $KIND); nothing sent" >&2; exit 1 ;;
esac
unset KEY

fields() {  # print only non-secret fields of a GoTrue user / error JSON
  python3 - "$1" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("non-JSON response"); sys.exit(0)
keep = ("id", "email", "updated_at", "banned_until", "last_sign_in_at", "code", "error_code", "msg", "message", "error")
print({k: d.get(k) for k in keep if k in d})
PY
}

# ---- 1. read-only identity check --------------------------------------------
code=$(curl -sS -o "$TMP/user.json" -w '%{http_code}' -H @"$TMP/headers" "$PROJECT_URL/auth/v1/admin/users/$USER_ID")
if [ "$code" != "200" ]; then echo "lookup failed: HTTP $code"; fields "$TMP/user.json"; exit 1; fi
ACTUAL_EMAIL="$(python3 -c 'import json,sys; print((json.load(open(sys.argv[1])).get("email") or "").lower())' "$TMP/user.json")"
EXP_LC="$(printf '%s' "$EXPECTED_EMAIL" | tr '[:upper:]' '[:lower:]')"
if [ "$ACTUAL_EMAIL" != "$EXP_LC" ]; then
  echo "REFUSED: account $USER_ID belongs to <$ACTUAL_EMAIL>, not <$EXP_LC>. Nothing changed." >&2; exit 1
fi
echo "Target: $USER_ID <$ACTUAL_EMAIL>  action: $ACTION"
IFS= read -r -p "Type the email again to confirm: " CONFIRM
[ "$(printf '%s' "$CONFIRM" | tr '[:upper:]' '[:lower:]')" = "$ACTUAL_EMAIL" ] || { echo "not confirmed; nothing changed" >&2; exit 1; }

# ---- 2. request body ---------------------------------------------------------
case "$ACTION" in
  rotate)
    IFS= read -r -s -p "New password (from your password manager, 16+ chars): " PW; echo
    IFS= read -r -s -p "Repeat new password: " PW2; echo
    [ "$PW" = "$PW2" ] || { unset PW PW2; echo "passwords differ; nothing changed" >&2; exit 1; }
    [ "${#PW}" -ge 16 ] || { unset PW PW2; echo "use 16+ characters; nothing changed" >&2; exit 1; }
    printf '%s' "$PW" | python3 -c 'import json,sys; sys.stdout.write(json.dumps({"password": sys.stdin.read()}))' > "$TMP/body.json"
    unset PW PW2 ;;
  disable) printf '{"ban_duration":"876000h"}' > "$TMP/body.json" ;;
  enable)  printf '{"ban_duration":"none"}'    > "$TMP/body.json" ;;
esac

if [ -n "${DRY_RUN:-}" ]; then
  echo "DRY RUN: would PUT $PROJECT_URL/auth/v1/admin/users/$USER_ID  body keys: $(python3 -c 'import json,sys; print(sorted(json.load(open(sys.argv[1]))))' "$TMP/body.json"). Nothing sent."
  exit 0
fi

# ---- 3. write ---------------------------------------------------------------
code=$(curl -sS -o "$TMP/resp.json" -w '%{http_code}' -X PUT -H @"$TMP/headers" \
  --data-binary @"$TMP/body.json" "$PROJECT_URL/auth/v1/admin/users/$USER_ID")
echo "HTTP $code"
fields "$TMP/resp.json"
[ "$code" = "200" ] || exit 1
echo "Done. Next: update the same password in App Store Connect if this account is a review sign-in, then clear your clipboard."
